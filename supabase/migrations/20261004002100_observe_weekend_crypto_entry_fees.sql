-- Prefer broker-observed crypto entry fees while retaining a bounded estimate fallback.

CREATE OR REPLACE FUNCTION public.paper_bot_claim_weekend_crypto_entry(p_client_order_id text, p_symbol text, p_requested_notional numeric, p_entry_trigger numeric, p_max_entry_price numeric, p_protective_stop numeric, p_take_profit_price numeric, p_planned_risk_dollars numeric, p_session_date date, p_expires_at timestamp with time zone, p_metadata jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_ledger public.paper_bot_ledgers%rowtype;
  v_daily_entries integer := 0;
begin
  if p_client_order_id !~ '^chb-wkd-v1-[a-z0-9]+-[a-z0-9]{6,24}$' then
    raise exception 'Invalid weekend client order ID';
  end if;
  if p_symbol not in ('BTC/USD','ETH/USD','SOL/USD') then
    raise exception 'Unsupported weekend crypto symbol';
  end if;
  if p_requested_notional is null or p_requested_notional <= 0
     or p_entry_trigger is null or p_entry_trigger <= 0
     or p_max_entry_price is null or p_max_entry_price <= 0
     or p_protective_stop is null or p_protective_stop <= 0
     or p_take_profit_price is null or p_take_profit_price <= 0
     or p_planned_risk_dollars is null or p_planned_risk_dollars < 0
     or p_session_date is null
     or p_expires_at is null
     or jsonb_typeof(coalesce(p_metadata,'{}'::jsonb)) <> 'object' then
    raise exception 'Invalid weekend entry claim payload';
  end if;

  select * into v_ledger
  from public.paper_bot_ledgers
  where bot_id='weekend-crypto-day-100'
  for update;

  if not found then raise exception 'Weekend crypto ledger is missing'; end if;
  if v_ledger.status <> 'active' or v_ledger.strategy_id <> 'weekend-crypto-day-v1' or v_ledger.strategy_version <> 1 then
    raise exception 'Weekend crypto bot is not active';
  end if;
  if coalesce((v_ledger.metadata->>'executionEnabled')::boolean,false) is not true then
    raise exception 'Weekend crypto PAPER execution is disabled';
  end if;
  if coalesce((v_ledger.metadata->>'liveMoneyEnabled')::boolean,false) is true then
    raise exception 'Live-money mode is not permitted';
  end if;
  if coalesce(v_ledger.daily_realized_loss_pct,0) >= 1.5 then
    raise exception 'Daily loss kill switch is active';
  end if;
  if p_requested_notional > v_ledger.equity*0.30 + 0.000001 then
    raise exception 'Weekend position allocation exceeds 30 percent';
  end if;
  if p_requested_notional > coalesce(v_ledger.buying_power,0) + 0.000001 then
    raise exception 'Insufficient weekend virtual buying power';
  end if;
  if p_planned_risk_dollars > v_ledger.equity*0.005 + 0.000001 then
    raise exception 'Weekend planned loss exceeds 0.50 percent';
  end if;
  if coalesce(v_ledger.open_planned_risk_pct,0) + (p_planned_risk_dollars/nullif(v_ledger.equity,0)*100) > 0.75 + 0.000001 then
    raise exception 'Weekend open-risk ceiling would be exceeded';
  end if;

  if exists (
    select 1 from public.paper_bot_positions
    where bot_id='weekend-crypto-day-100' and quantity>0
  ) then
    raise exception 'Weekend bot already has an open position';
  end if;

  if exists (
    select 1 from public.paper_bot_positions
    where bot_id<>'weekend-crypto-day-100' and symbol=p_symbol and quantity>0
  ) then
    raise exception 'Another bot already holds this crypto symbol';
  end if;

  if exists (
    select 1 from public.paper_bot_orders
    where bot_id='weekend-crypto-day-100'
      and side='buy'
      and status in ('prepared','submitted','partially_filled')
  ) then
    raise exception 'Weekend bot already has an active entry order';
  end if;

  select count(*) into v_daily_entries
  from public.paper_bot_orders
  where bot_id='weekend-crypto-day-100'
    and side='buy'
    and status in ('submitted','partially_filled','filled','closed','replaced')
    and (created_at at time zone 'America/Chicago')::date = p_session_date;

  if v_daily_entries >= 3 then
    raise exception 'Weekend daily entry limit has been reached';
  end if;

  insert into public.paper_bot_orders(
    client_order_id,bot_id,strategy_id,strategy_version,
    symbol,asset_class,side,status,requested_notional,pool_id,
    entry_trigger,max_entry_price,protective_stop,planned_risk_dollars,
    expires_at,stage_reason,take_profit_price,take_profit_fraction,
    take_profit_r,protect_winner_at_r,trail_remainder,metadata
  ) values (
    p_client_order_id,'weekend-crypto-day-100','weekend-crypto-day-v1',1,
    p_symbol,'crypto','buy','prepared',p_requested_notional,'day',
    p_entry_trigger,p_max_entry_price,p_protective_stop,p_planned_risk_dollars,
    p_expires_at,'Weekend crypto day scanner selected a fee-aware momentum setup.',
    p_take_profit_price,0.50,2.00,1.00,true,
    coalesce(p_metadata,'{}'::jsonb) || jsonb_build_object(
      'paperOnly',true,
      'executionMode','paper-crypto',
      'estimatedFeeBps',25,
      'sessionDate',p_session_date,
      'claimedAt',now(),
      'feeReconciliationPending',true
    )
  );

  return jsonb_build_object(
    'claimed',true,
    'clientOrderId',p_client_order_id,
    'symbol',p_symbol,
    'requestedNotional',p_requested_notional
  );
end $function$
;

revoke all on function public.paper_bot_claim_weekend_crypto_entry(
  text,text,numeric,numeric,numeric,numeric,numeric,numeric,date,timestamptz,jsonb
) from public,anon,authenticated;
grant execute on function public.paper_bot_claim_weekend_crypto_entry(
  text,text,numeric,numeric,numeric,numeric,numeric,numeric,date,timestamptz,jsonb
) to service_role;

CREATE OR REPLACE FUNCTION public.paper_bot_apply_unapplied_fills(p_collected_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_fill record; v_ledger record;
  v_position_qty numeric; v_average_entry numeric; v_position_found boolean;
  v_gross_value numeric; v_fee_bps numeric; v_fee_value numeric; v_effective_qty numeric;
  v_cash numeric; v_realized numeric; v_new_qty numeric; v_new_average numeric;
  v_positions_value numeric; v_unrealized numeric; v_equity numeric; v_peak numeric; v_drawdown numeric;
  v_fills_applied integer := 0; v_bots_updated text[] := array[]::text[];
begin
  if p_collected_at is null then raise exception 'Ledger reconciliation timestamp is required'; end if;

  for v_fill in
    select f.fill_activity_id,f.broker_order_id,f.bot_id,f.symbol,f.side,f.quantity,f.price,f.transaction_time,
           o.client_order_id,p.asset_class as prepared_asset_class,p.strategy_id as prepared_strategy_id,
           p.strategy_version as prepared_strategy_version,p.pool_id as prepared_pool_id,
           p.protective_stop as prepared_stop,p.planned_risk_dollars as prepared_risk,
           greatest(0,coalesce(
             nullif(p.metadata->>'observedEntryFeeBps','')::numeric,
             nullif(p.metadata->>'estimatedFeeBps','')::numeric,
             0
           )) as estimated_fee_bps,
           case when nullif(p.metadata->>'observedEntryFeeBps','') is not null
             then 'broker-observed-entry' else 'estimated' end as fee_source
    from public.paper_bot_broker_fills f
    join public.paper_bot_broker_orders o on o.broker_order_id=f.broker_order_id and o.bot_id=f.bot_id
    join public.paper_bot_orders p
      on p.client_order_id=coalesce(nullif(o.metadata->>'attributionClientOrderId',''),o.client_order_id)
     and p.bot_id=f.bot_id
    where f.ledger_applied_at is null
      and not (
        f.side='buy'
        and p.asset_class='crypto'
        and coalesce(nullif(p.metadata->>'feeReconciliationPending','')::boolean,false)
        and coalesce(p.submitted_at,p.created_at) > p_collected_at - interval '30 seconds'
      )
    order by f.transaction_time asc,f.fill_activity_id asc
  loop
    select * into v_ledger from public.paper_bot_ledgers where bot_id=v_fill.bot_id for update;
    if not found then raise exception 'Missing virtual ledger for bot %',v_fill.bot_id; end if;

    v_position_qty:=null; v_average_entry:=null;
    select quantity,average_entry into v_position_qty,v_average_entry
    from public.paper_bot_positions where bot_id=v_fill.bot_id and symbol=v_fill.symbol for update;
    v_position_found:=found;

    v_gross_value:=v_fill.quantity*v_fill.price;
    v_fee_bps:=case when v_fill.prepared_asset_class='crypto' then v_fill.estimated_fee_bps else 0 end;
    v_fee_value:=v_gross_value*v_fee_bps/10000;
    v_cash:=v_ledger.cash; v_realized:=0;

    if v_fill.side='buy' then
      v_effective_qty:=case when v_fill.prepared_asset_class='crypto'
        then v_fill.quantity*(1-v_fee_bps/10000) else v_fill.quantity end;
      if v_effective_qty<=0 then raise exception 'Fee-adjusted buy quantity is not positive'; end if;
      v_new_qty:=coalesce(v_position_qty,0)+v_effective_qty;
      v_new_average:=case when v_new_qty>0 then
        ((coalesce(v_position_qty,0)*coalesce(v_average_entry,v_fill.price))+v_gross_value)/v_new_qty
        else v_fill.price end;
      v_cash:=v_cash-v_gross_value;

      if v_position_found then
        update public.paper_bot_positions
        set quantity=v_new_qty,average_entry=v_new_average,market_value=v_new_qty*v_fill.price,
            unrealized_pl=(v_fill.price-v_new_average)*v_new_qty,
            pool_id=coalesce(pool_id,v_fill.prepared_pool_id),
            protective_stop=coalesce(protective_stop,v_fill.prepared_stop),
            planned_risk_dollars=coalesce(planned_risk_dollars,v_fill.prepared_risk),
            planned_risk_pct=case when v_ledger.equity>0 and v_fill.prepared_risk is not null then
              100*v_fill.prepared_risk/v_ledger.equity else planned_risk_pct end,
            strategy_id=v_fill.prepared_strategy_id,strategy_version=v_fill.prepared_strategy_version,
            updated_at=p_collected_at,
            metadata=metadata||jsonb_build_object(
              'lastFillActivityId',v_fill.fill_activity_id,'lastFillPrice',v_fill.price,
              'lastFillAt',v_fill.transaction_time,'ledgerSource','alpaca-paper',
              'estimatedFeeBps',v_fee_bps,'feeBpsApplied',v_fee_bps,'feeSource',v_fill.fee_source,'estimatedFeeValueUsd',v_fee_value,
              'grossFillQuantity',v_fill.quantity,'netFillQuantity',v_effective_qty
            )
        where bot_id=v_fill.bot_id and symbol=v_fill.symbol;
      else
        insert into public.paper_bot_positions(
          bot_id,symbol,asset_class,side,quantity,average_entry,market_value,unrealized_pl,
          protective_stop,planned_risk_dollars,planned_risk_pct,strategy_id,strategy_version,pool_id,
          opened_at,updated_at,metadata
        ) values (
          v_fill.bot_id,v_fill.symbol,v_fill.prepared_asset_class,'long',v_effective_qty,v_new_average,
          v_effective_qty*v_fill.price,(v_fill.price-v_new_average)*v_effective_qty,
          v_fill.prepared_stop,v_fill.prepared_risk,
          case when v_ledger.equity>0 and v_fill.prepared_risk is not null then 100*v_fill.prepared_risk/v_ledger.equity else null end,
          v_fill.prepared_strategy_id,v_fill.prepared_strategy_version,v_fill.prepared_pool_id,
          v_fill.transaction_time,p_collected_at,
          jsonb_build_object(
            'lastFillActivityId',v_fill.fill_activity_id,'lastFillPrice',v_fill.price,
            'lastFillAt',v_fill.transaction_time,'ledgerSource','alpaca-paper',
            'estimatedFeeBps',v_fee_bps,'feeBpsApplied',v_fee_bps,'feeSource',v_fill.fee_source,'estimatedFeeValueUsd',v_fee_value,
            'grossFillQuantity',v_fill.quantity,'netFillQuantity',v_effective_qty
          )
        );
      end if;
    elsif v_fill.side='sell' then
      if not v_position_found or v_position_qty is null or v_average_entry is null then
        raise exception 'Sell fill % has no virtual position for bot % symbol %',v_fill.fill_activity_id,v_fill.bot_id,v_fill.symbol;
      end if;
      if v_fill.quantity>v_position_qty+0.000000001 then raise exception 'Sell fill % exceeds virtual position quantity',v_fill.fill_activity_id; end if;

      v_realized:=(v_gross_value-v_fee_value)-(v_average_entry*v_fill.quantity);
      v_cash:=v_cash+(v_gross_value-v_fee_value);
      v_new_qty:=greatest(0,v_position_qty-v_fill.quantity);
      if v_new_qty<=0.000000001 then
        delete from public.paper_bot_positions where bot_id=v_fill.bot_id and symbol=v_fill.symbol;
      else
        update public.paper_bot_positions
        set quantity=v_new_qty,market_value=v_new_qty*v_fill.price,
            unrealized_pl=(v_fill.price-v_average_entry)*v_new_qty,updated_at=p_collected_at,
            metadata=metadata||jsonb_build_object(
              'lastFillActivityId',v_fill.fill_activity_id,'lastFillPrice',v_fill.price,
              'lastFillAt',v_fill.transaction_time,'ledgerSource','alpaca-paper',
              'estimatedFeeBps',v_fee_bps,'feeBpsApplied',v_fee_bps,'feeSource',v_fill.fee_source,'estimatedFeeValueUsd',v_fee_value
            )
        where bot_id=v_fill.bot_id and symbol=v_fill.symbol;
      end if;
    else raise exception 'Unsupported fill side %',v_fill.side; end if;

    select coalesce(sum(coalesce(market_value,0)),0),coalesce(sum(coalesce(unrealized_pl,0)),0)
      into v_positions_value,v_unrealized from public.paper_bot_positions where bot_id=v_fill.bot_id;
    v_equity:=v_cash+v_positions_value; v_peak:=greatest(v_ledger.peak_equity,v_equity);
    v_drawdown:=case when v_peak>0 then least(0,(v_equity/v_peak-1)*100) else 0 end;

    update public.paper_bot_ledgers
    set cash=v_cash,equity=v_equity,realized_pl=realized_pl+v_realized,unrealized_pl=v_unrealized,
        buying_power=greatest(v_cash,0),peak_equity=v_peak,current_drawdown_pct=v_drawdown,
        last_synced_at=p_collected_at,source='virtual-ledger+alpaca-fills',updated_at=now()
    where bot_id=v_fill.bot_id;

    update public.paper_bot_broker_fills
    set ledger_applied_at=p_collected_at,ledger_realized_pl=v_realized
    where fill_activity_id=v_fill.fill_activity_id and ledger_applied_at is null;

    update public.paper_bot_journal
    set realized_pl=case when v_fill.side='sell' then v_realized else realized_pl end,
        metadata=metadata||jsonb_build_object(
          'ledgerApplied',true,'ledgerAppliedAt',p_collected_at,'ledgerCashAfter',v_cash,
          'ledgerEquityAfter',v_equity,'estimatedFeeBps',v_fee_bps,'feeBpsApplied',v_fee_bps,'feeSource',v_fill.fee_source,'estimatedFeeValueUsd',v_fee_value
        )
    where event_type='filled' and metadata->>'fillActivityId'=v_fill.fill_activity_id;

    insert into public.paper_bot_equity_history(bot_id,bucket_minute,collected_at,equity,cash,realized_pl,unrealized_pl)
    select bot_id,date_trunc('minute',p_collected_at),p_collected_at,equity,cash,realized_pl,unrealized_pl
    from public.paper_bot_ledgers where bot_id=v_fill.bot_id
    on conflict (bot_id,bucket_minute) do update
    set collected_at=excluded.collected_at,equity=excluded.equity,cash=excluded.cash,
        realized_pl=excluded.realized_pl,unrealized_pl=excluded.unrealized_pl;

    v_fills_applied:=v_fills_applied+1;
    if not v_fill.bot_id=any(v_bots_updated) then v_bots_updated:=array_append(v_bots_updated,v_fill.bot_id); end if;
  end loop;
  return jsonb_build_object('fillsApplied',v_fills_applied,'botsUpdated',to_jsonb(v_bots_updated));
end $function$
;

revoke all on function public.paper_bot_apply_unapplied_fills(timestamptz)
from public,anon,authenticated;
grant execute on function public.paper_bot_apply_unapplied_fills(timestamptz)
to service_role;
