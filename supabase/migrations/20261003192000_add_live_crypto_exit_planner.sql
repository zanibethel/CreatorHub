create or replace function public.paper_bot_plan_crypto_exits(p_collected_at timestamptz)
returns integer
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_count integer := 0;
begin
  with base as (
    select
      p.bot_id,
      p.symbol,
      p.average_entry,
      p.protective_stop,
      coalesce(p.initial_protective_stop,p.protective_stop) as initial_stop,
      p.take_profit_price,
      p.take_profit_fraction,
      p.protect_winner_at_r,
      p.trail_remainder,
      p.metadata,
      p.exit_manager_state,
      nullif(p.metadata->>'markPrice','')::numeric as mark_price,
      greatest(0,coalesce(nullif(p.metadata->>'estimatedFeeBps','')::numeric,0)) as fee_bps,
      exists (
        select 1 from public.paper_bot_orders o
        where o.bot_id=p.bot_id
          and o.symbol=p.symbol
          and o.side='sell'
          and o.status in ('prepared','submitted','partially_filled')
          and o.broker_order_id is not null
          and o.metadata->>'purpose'='protective-stop'
      ) as has_active_stop,
      (
        coalesce(p.exit_manager_state->>'partialProfitState','armed')='completed'
        or exists (
          select 1 from public.paper_bot_orders o
          where o.bot_id=p.bot_id
            and o.symbol=p.symbol
            and o.side='sell'
            and o.status='filled'
            and o.metadata->>'purpose'='take-profit-partial'
        )
      ) as partial_done
    from public.paper_bot_positions p
    join public.paper_bot_ledgers l on l.bot_id=p.bot_id and l.status='active'
    where p.asset_class='crypto' and p.quantity>0
  ),
  metrics as (
    select *,
      case when average_entry is not null and initial_stop is not null and initial_stop<average_entry
        then average_entry-initial_stop else null end as risk_distance,
      case when average_entry is not null and (1-fee_bps/10000)>0
        then average_entry/(1-fee_bps/10000) else average_entry end as break_even
    from base
  ),
  planned as (
    select *,
      case when risk_distance is not null and risk_distance>0 and mark_price is not null
        then (mark_price-average_entry)/risk_distance else 0 end as r_multiple,
      case when risk_distance is not null and risk_distance>0 and mark_price is not null
        then greatest(risk_distance*0.10,mark_price*0.0015) else 0 end as minimum_step
    from metrics
  ),
  decisions as (
    select *,
      case
        when mark_price is null or average_entry is null or risk_distance is null or risk_distance<=0
          then 'hold'
        when not has_active_stop and protective_stop is not null and protective_stop>0
          then 'repair_stop'
        when not partial_done
          and take_profit_price is not null
          and take_profit_fraction is not null
          and take_profit_fraction>0
          and mark_price>=take_profit_price
          then 'partial_profit'
        when partial_done and trail_remainder
          and break_even is not null
          and greatest(coalesce(protective_stop,0),break_even,mark_price-risk_distance)
                >= coalesce(protective_stop,0)+minimum_step
          then 'tighten_stop_trail'
        when not partial_done
          and protect_winner_at_r is not null
          and r_multiple>=protect_winner_at_r
          and break_even is not null
          and break_even>=coalesce(protective_stop,0)+minimum_step
          then 'tighten_stop_breakeven'
        else 'hold'
      end as planned_action,
      case
        when not has_active_stop and protective_stop is not null and protective_stop>0
          then protective_stop
        when partial_done and trail_remainder and break_even is not null
          then greatest(coalesce(protective_stop,0),break_even,mark_price-risk_distance)
        when not partial_done and protect_winner_at_r is not null and r_multiple>=protect_winner_at_r
          then break_even
        else null
      end as desired_stop
    from planned
  )
  update public.paper_bot_positions p
  set exit_manager_state =
        p.exit_manager_state
        || jsonb_build_object(
          'version','paper-exit-v1',
          'mode','staged-action',
          'plannedAction',d.planned_action,
          'rMultiple',round(d.r_multiple,4),
          'markPrice',d.mark_price,
          'evaluatedAt',p_collected_at,
          'hasActiveStop',d.has_active_stop,
          'reason',case d.planned_action
            when 'repair_stop' then 'Broker protection is missing.'
            when 'partial_profit' then 'First take-profit threshold reached.'
            when 'tighten_stop_trail' then 'Trailing stop can tighten.'
            when 'tighten_stop_breakeven' then 'Winner-protection threshold reached.'
            else 'No exit-management threshold is active.'
          end
        )
        || case when d.desired_stop is not null
             then jsonb_build_object('desiredStop',round(d.desired_stop,6))
             else '{}'::jsonb end
        || case when d.planned_action='partial_profit'
             then jsonb_build_object('partialFraction',d.take_profit_fraction)
             else '{}'::jsonb end,
      last_exit_manager_at=p_collected_at,
      updated_at=now()
  from decisions d
  where p.bot_id=d.bot_id and p.symbol=d.symbol;

  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke all on function public.paper_bot_plan_crypto_exits(timestamptz) from public,anon,authenticated;
grant execute on function public.paper_bot_plan_crypto_exits(timestamptz) to service_role;

create or replace function public.paper_bot_mark_to_market(p_prices jsonb,p_collected_at timestamptz)
returns jsonb
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_item jsonb;
  v_symbol text;
  v_price numeric;
  v_bot text;
  v_equity numeric;
  v_peak numeric;
  v_open_risk numeric;
  v_daily_loss numeric;
  v_weekly_dd numeric;
  v_day numeric;
  v_multi_day numeric;
  v_multi_week numeric;
  v_updated integer := 0;
  v_exits integer := 0;
begin
  if jsonb_typeof(coalesce(p_prices,'[]'::jsonb)) <> 'array' or p_collected_at is null then
    raise exception 'Invalid mark-to-market payload';
  end if;

  for v_item in select value from jsonb_array_elements(coalesce(p_prices,'[]'::jsonb))
  loop
    v_symbol := nullif(v_item->>'symbol','');
    v_price := nullif(v_item->>'price','')::numeric;
    if v_symbol is null or v_price is null or v_price <= 0 then continue; end if;

    update public.paper_bot_positions
    set market_value=quantity*v_price,
        unrealized_pl=(v_price-average_entry)*quantity,
        updated_at=p_collected_at,
        metadata=metadata || jsonb_build_object(
          'markPrice',v_price,'markAt',p_collected_at,'markSource',coalesce(v_item->>'source','alpaca-data')
        )
    where symbol=v_symbol and quantity>0;
  end loop;

  for v_bot in select distinct bot_id from public.paper_bot_positions
  loop
    select l.cash + coalesce(sum(p.market_value),0),
           greatest(l.peak_equity,l.cash + coalesce(sum(p.market_value),0)),
           case when l.cash + coalesce(sum(p.market_value),0) > 0 then
             100 * coalesce(sum(
               case when p.protective_stop is not null and p.average_entry is not null
                 then greatest(0,p.average_entry-p.protective_stop)*p.quantity else 0 end
             ),0) / (l.cash + coalesce(sum(p.market_value),0))
           else 0 end,
           case when (l.cash+coalesce(sum(p.market_value),0))>0 then 100*coalesce(sum(case when p.pool_id='day' then p.market_value else 0 end),0)/(l.cash+coalesce(sum(p.market_value),0)) else 0 end,
           case when (l.cash+coalesce(sum(p.market_value),0))>0 then 100*coalesce(sum(case when p.pool_id='multi-day' then p.market_value else 0 end),0)/(l.cash+coalesce(sum(p.market_value),0)) else 0 end,
           case when (l.cash+coalesce(sum(p.market_value),0))>0 then 100*coalesce(sum(case when p.pool_id='multi-week' then p.market_value else 0 end),0)/(l.cash+coalesce(sum(p.market_value),0)) else 0 end
    into v_equity,v_peak,v_open_risk,v_day,v_multi_day,v_multi_week
    from public.paper_bot_ledgers l
    left join public.paper_bot_positions p on p.bot_id=l.bot_id
    where l.bot_id=v_bot
    group by l.bot_id,l.cash,l.peak_equity;

    select case when v_equity>0 then 100*abs(least(0,coalesce(sum(realized_pl),0)))/v_equity else 0 end
      into v_daily_loss
    from public.paper_bot_journal
    where bot_id=v_bot and event_type='filled'
      and occurred_at >= date_trunc('day',p_collected_at);

    select case when max(equity)>0 then greatest(0,100*(max(equity)-v_equity)/max(equity)) else 0 end
      into v_weekly_dd
    from public.paper_bot_equity_history
    where bot_id=v_bot and collected_at >= date_trunc('week',p_collected_at);

    update public.paper_bot_ledgers
    set equity=v_equity,
        unrealized_pl=coalesce((select sum(unrealized_pl) from public.paper_bot_positions where bot_id=v_bot),0),
        buying_power=greatest(cash,0),
        peak_equity=v_peak,
        current_drawdown_pct=case when v_peak>0 then least(0,(v_equity/v_peak-1)*100) else 0 end,
        open_planned_risk_pct=coalesce(v_open_risk,0),
        daily_realized_loss_pct=coalesce(v_daily_loss,0),
        weekly_drawdown_pct=coalesce(v_weekly_dd,0),
        pool_usage=jsonb_build_object('day',coalesce(v_day,0),'multi-day',coalesce(v_multi_day,0),'multi-week',coalesce(v_multi_week,0)),
        last_synced_at=p_collected_at,
        updated_at=now()
    where bot_id=v_bot;

    insert into public.paper_bot_equity_history(bot_id,bucket_minute,collected_at,equity,cash,realized_pl,unrealized_pl)
    select bot_id,date_trunc('minute',p_collected_at),p_collected_at,equity,cash,realized_pl,unrealized_pl
    from public.paper_bot_ledgers where bot_id=v_bot
    on conflict (bot_id,bucket_minute) do update
      set collected_at=excluded.collected_at,equity=excluded.equity,cash=excluded.cash,
          realized_pl=excluded.realized_pl,unrealized_pl=excluded.unrealized_pl;

    v_updated := v_updated+1;
  end loop;

  v_exits := public.paper_bot_plan_crypto_exits(p_collected_at);
  return jsonb_build_object('botsMarked',v_updated,'exitPlansUpdated',v_exits);
end $$;

revoke all on function public.paper_bot_mark_to_market(jsonb,timestamptz) from public,anon,authenticated;
grant execute on function public.paper_bot_mark_to_market(jsonb,timestamptz) to service_role;
