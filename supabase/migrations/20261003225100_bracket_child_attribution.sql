-- Preserve Alpaca bracket child-order attribution back to the prepared parent bot plan.
CREATE OR REPLACE FUNCTION public.paper_bot_reconcile_broker_activity(p_orders jsonb, p_fills jsonb, p_collected_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_orders integer := 0;
  v_fills integer := 0;
  v_submitted integer := 0;
  v_fill_events integer := 0;
begin
  if jsonb_typeof(coalesce(p_orders,'[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_fills,'[]'::jsonb)) <> 'array'
     or p_collected_at is null then
    raise exception 'Invalid broker reconciliation payload';
  end if;

  insert into public.paper_bot_broker_orders(
    broker_order_id,client_order_id,bot_id,strategy_id,strategy_version,
    symbol,asset_class,side,order_type,order_class,status,quantity,
    filled_quantity,average_fill_price,submitted_at,filled_at,last_seen_at,metadata
  )
  select
    left(item->>'brokerOrderId',80),
    left(item->>'clientOrderId',128),
    l.bot_id,
    l.strategy_id,
    nullif(substring(coalesce(nullif(item->>'attributionClientOrderId',''),item->>'clientOrderId')
      from '^chb-[a-z0-9]{2,12}-v([1-9][0-9]*)-'),'')::integer,
    left(item->>'symbol',32),
    case when item->>'assetClass' in ('stock','etf','crypto') then item->>'assetClass' else 'unknown' end,
    case when lower(item->>'side')='sell' then 'sell' else 'buy' end,
    nullif(left(item->>'orderType',40),''),
    nullif(left(item->>'orderClass',40),''),
    left(coalesce(item->>'status','unknown'),40),
    nullif(item->>'quantity','')::numeric,
    nullif(item->>'filledQuantity','')::numeric,
    nullif(item->>'averageFillPrice','')::numeric,
    nullif(item->>'submittedAt','')::timestamptz,
    nullif(item->>'filledAt','')::timestamptz,
    p_collected_at,
    jsonb_build_object(
      'source','alpaca-paper',
      'attribution',case when coalesce(item->>'parentBrokerOrderId','')<>'' then 'parent-bracket-client-order-id' else 'client-order-id' end,
      'attributionClientOrderId',coalesce(nullif(item->>'attributionClientOrderId',''),item->>'clientOrderId'),
      'parentBrokerOrderId',nullif(item->>'parentBrokerOrderId','')
    )
  from jsonb_array_elements(coalesce(p_orders,'[]'::jsonb)) item
  join public.paper_bot_ledgers l
    on l.broker_tag = substring(
      coalesce(nullif(item->>'attributionClientOrderId',''),item->>'clientOrderId')
      from '^chb-([a-z0-9]{2,12})-v[1-9][0-9]*-[a-z0-9]+-[a-z0-9]{6,24}$'
    )
  where coalesce(item->>'brokerOrderId','') <> ''
    and coalesce(item->>'clientOrderId','') <> ''
    and coalesce(item->>'symbol','') <> ''
  on conflict (broker_order_id) do update set
    client_order_id=excluded.client_order_id,
    bot_id=excluded.bot_id,
    strategy_id=excluded.strategy_id,
    strategy_version=excluded.strategy_version,
    symbol=excluded.symbol,
    asset_class=excluded.asset_class,
    side=excluded.side,
    order_type=excluded.order_type,
    order_class=excluded.order_class,
    status=excluded.status,
    quantity=excluded.quantity,
    filled_quantity=excluded.filled_quantity,
    average_fill_price=excluded.average_fill_price,
    submitted_at=excluded.submitted_at,
    filled_at=excluded.filled_at,
    last_seen_at=excluded.last_seen_at,
    metadata=excluded.metadata;
  get diagnostics v_orders = row_count;

  insert into public.paper_bot_broker_fills(
    fill_activity_id,broker_order_id,bot_id,symbol,side,quantity,price,
    cumulative_quantity,leaves_quantity,transaction_time
  )
  select
    left(item->>'fillActivityId',160),
    left(item->>'brokerOrderId',80),
    o.bot_id,
    left(item->>'symbol',32),
    case when lower(item->>'side')='sell' then 'sell' else 'buy' end,
    (item->>'quantity')::numeric,
    (item->>'price')::numeric,
    nullif(item->>'cumulativeQuantity','')::numeric,
    nullif(item->>'leavesQuantity','')::numeric,
    (item->>'transactionTime')::timestamptz
  from jsonb_array_elements(coalesce(p_fills,'[]'::jsonb)) item
  join public.paper_bot_broker_orders o
    on o.broker_order_id = item->>'brokerOrderId'
  where coalesce(item->>'fillActivityId','') <> ''
    and nullif(item->>'quantity','')::numeric > 0
    and nullif(item->>'price','')::numeric > 0
    and nullif(item->>'transactionTime','') is not null
  on conflict (fill_activity_id) do nothing;
  get diagnostics v_fills = row_count;

  insert into public.paper_bot_journal(
    bot_id,strategy_id,strategy_version,event_type,symbol,asset_class,occurred_at,
    broker_order_id,client_order_id,quantity,metadata
  )
  select
    o.bot_id,o.strategy_id,o.strategy_version,'submitted',o.symbol,o.asset_class,
    coalesce(o.submitted_at,o.last_seen_at),o.broker_order_id,o.client_order_id,o.quantity,
    jsonb_build_object(
      'side',o.side,'status',o.status,'orderType',o.order_type,'orderClass',o.order_class,
      'source','alpaca-paper','attributionClientOrderId',o.metadata->>'attributionClientOrderId',
      'parentBrokerOrderId',o.metadata->>'parentBrokerOrderId'
    )
  from public.paper_bot_broker_orders o
  where o.last_seen_at = p_collected_at
    and not exists (
      select 1 from public.paper_bot_journal j
      where j.bot_id=o.bot_id and j.event_type='submitted' and j.client_order_id=o.client_order_id
    )
  on conflict do nothing;
  get diagnostics v_submitted = row_count;

  insert into public.paper_bot_journal(
    bot_id,strategy_id,strategy_version,event_type,symbol,asset_class,occurred_at,
    broker_order_id,client_order_id,entry_price,exit_price,quantity,metadata
  )
  select
    f.bot_id,o.strategy_id,o.strategy_version,'filled',f.symbol,o.asset_class,f.transaction_time,
    f.broker_order_id,o.client_order_id,
    case when f.side='buy' then f.price else null end,
    case when f.side='sell' then f.price else null end,
    f.quantity,
    jsonb_build_object(
      'fillActivityId',f.fill_activity_id,'side',f.side,'cumulativeQuantity',f.cumulative_quantity,
      'leavesQuantity',f.leaves_quantity,'source','alpaca-paper',
      'attributionClientOrderId',o.metadata->>'attributionClientOrderId',
      'parentBrokerOrderId',o.metadata->>'parentBrokerOrderId'
    )
  from public.paper_bot_broker_fills f
  join public.paper_bot_broker_orders o on o.broker_order_id=f.broker_order_id
  where not exists (
    select 1 from public.paper_bot_journal j
    where j.event_type='filled' and j.metadata->>'fillActivityId'=f.fill_activity_id
  )
  on conflict do nothing;
  get diagnostics v_fill_events = row_count;

  update public.paper_bot_ledgers l
  set last_synced_at=p_collected_at,
      source='virtual-ledger+alpaca-audit',
      updated_at=now()
  where exists (
    select 1 from public.paper_bot_broker_orders o
    where o.bot_id=l.bot_id and o.last_seen_at=p_collected_at
  );

  return jsonb_build_object(
    'ordersSeen',v_orders,
    'fillsAdded',v_fills,
    'submittedEventsAdded',v_submitted,
    'fillEventsAdded',v_fill_events
  );
end $function$
;

revoke all on function public.paper_bot_reconcile_broker_activity(jsonb,jsonb,timestamptz)
  from public,anon,authenticated;
grant execute on function public.paper_bot_reconcile_broker_activity(jsonb,jsonb,timestamptz)
  to service_role;

-- Apply both parent-entry and broker-generated bracket-child fills to the same virtual ledger.
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
           greatest(0,coalesce(nullif(p.metadata->>'estimatedFeeBps','')::numeric,0)) as estimated_fee_bps
    from public.paper_bot_broker_fills f
    join public.paper_bot_broker_orders o on o.broker_order_id=f.broker_order_id and o.bot_id=f.bot_id
    join public.paper_bot_orders p
      on p.client_order_id=coalesce(nullif(o.metadata->>'attributionClientOrderId',''),o.client_order_id)
     and p.bot_id=f.bot_id
    where f.ledger_applied_at is null
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
              'estimatedFeeBps',v_fee_bps,'estimatedFeeValueUsd',v_fee_value,
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
            'estimatedFeeBps',v_fee_bps,'estimatedFeeValueUsd',v_fee_value,
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
              'estimatedFeeBps',v_fee_bps,'estimatedFeeValueUsd',v_fee_value
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
          'ledgerEquityAfter',v_equity,'estimatedFeeBps',v_fee_bps,'estimatedFeeValueUsd',v_fee_value
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
