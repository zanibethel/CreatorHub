-- Reserve estimated crypto fees immediately in virtual challenge accounting.
-- Alpaca's official CFEE activity can later true-up the estimate.
create or replace function public.paper_bot_apply_unapplied_fills(p_collected_at timestamptz)
returns jsonb
language plpgsql security invoker set search_path=''
as $$
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
    join public.paper_bot_orders p on p.client_order_id=o.client_order_id and p.bot_id=f.bot_id
      and (p.broker_order_id is null or p.broker_order_id=o.broker_order_id)
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
        ((coalesce(v_position_qty,0)*coalesce(v_average_entry,v_fill.price))+v_gross_value)/v_new_qty else v_fill.price end;
      v_cash:=v_cash-v_gross_value;
      if v_position_found then
        update public.paper_bot_positions
        set quantity=v_new_qty,average_entry=v_new_average,market_value=v_new_qty*v_fill.price,
            unrealized_pl=(v_fill.price-v_new_average)*v_new_qty,pool_id=coalesce(pool_id,v_fill.prepared_pool_id),
            protective_stop=coalesce(protective_stop,v_fill.prepared_stop),
            planned_risk_dollars=coalesce(planned_risk_dollars,v_fill.prepared_risk),
            planned_risk_pct=case when v_ledger.equity>0 and v_fill.prepared_risk is not null then 100*v_fill.prepared_risk/v_ledger.equity else planned_risk_pct end,
            strategy_id=v_fill.prepared_strategy_id,strategy_version=v_fill.prepared_strategy_version,updated_at=p_collected_at,
            metadata=metadata||jsonb_build_object('lastFillActivityId',v_fill.fill_activity_id,'lastFillPrice',v_fill.price,'lastFillAt',v_fill.transaction_time,'ledgerSource','alpaca-paper','estimatedFeeBps',v_fee_bps,'estimatedFeeValueUsd',v_fee_value,'grossFillQuantity',v_fill.quantity,'netFillQuantity',v_effective_qty)
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
          jsonb_build_object('lastFillActivityId',v_fill.fill_activity_id,'lastFillPrice',v_fill.price,'lastFillAt',v_fill.transaction_time,'ledgerSource','alpaca-paper','estimatedFeeBps',v_fee_bps,'estimatedFeeValueUsd',v_fee_value,'grossFillQuantity',v_fill.quantity,'netFillQuantity',v_effective_qty)
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
        set quantity=v_new_qty,market_value=v_new_qty*v_fill.price,unrealized_pl=(v_fill.price-v_average_entry)*v_new_qty,
            updated_at=p_collected_at,metadata=metadata||jsonb_build_object('lastFillActivityId',v_fill.fill_activity_id,'lastFillPrice',v_fill.price,'lastFillAt',v_fill.transaction_time,'ledgerSource','alpaca-paper','estimatedFeeBps',v_fee_bps,'estimatedFeeValueUsd',v_fee_value)
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
        metadata=metadata||jsonb_build_object('ledgerApplied',true,'ledgerAppliedAt',p_collected_at,'ledgerCashAfter',v_cash,'ledgerEquityAfter',v_equity,'estimatedFeeBps',v_fee_bps,'estimatedFeeValueUsd',v_fee_value)
    where event_type='filled' and metadata->>'fillActivityId'=v_fill.fill_activity_id;
    insert into public.paper_bot_equity_history(bot_id,bucket_minute,collected_at,equity,cash,realized_pl,unrealized_pl)
    select bot_id,date_trunc('minute',p_collected_at),p_collected_at,equity,cash,realized_pl,unrealized_pl
    from public.paper_bot_ledgers where bot_id=v_fill.bot_id
    on conflict (bot_id,bucket_minute) do update set collected_at=excluded.collected_at,equity=excluded.equity,cash=excluded.cash,realized_pl=excluded.realized_pl,unrealized_pl=excluded.unrealized_pl;
    v_fills_applied:=v_fills_applied+1;
    if not v_fill.bot_id=any(v_bots_updated) then v_bots_updated:=array_append(v_bots_updated,v_fill.bot_id); end if;
  end loop;
  return jsonb_build_object('fillsApplied',v_fills_applied,'botsUpdated',to_jsonb(v_bots_updated));
end $$;

revoke all on function public.paper_bot_apply_unapplied_fills(timestamptz) from public,anon,authenticated;
grant execute on function public.paper_bot_apply_unapplied_fills(timestamptz) to service_role;
