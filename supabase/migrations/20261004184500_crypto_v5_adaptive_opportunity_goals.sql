-- Crypto v5: adaptive 5-20% opportunity goals with 2R as a partial-risk checkpoint.
-- The displayed/stored take_profit_price is now the current opportunity goal.
-- A 2R event trims 25% and protects the remainder; reaching the goal exits the remainder.

update public.paper_bot_ledgers
set strategy_id='daily-crypto-day-v5',
    strategy_version=5,
    metadata=metadata || jsonb_build_object(
      'opportunityGoalMinPct',5.0,
      'opportunityGoalMaxPct',20.0,
      'firstTakeProfitR',2.0,
      'firstTakeProfitFraction',0.25,
      'strategyRevisionReason','Separate the adaptive opportunity goal from the 2R de-risk checkpoint so qualifying crypto trades can pursue larger 5-20% moves when market structure supports them.'
    ),
    updated_at=now()
where bot_id='weekend-crypto-day-100';

create or replace function public.paper_bot_claim_weekend_crypto_entry(
  p_client_order_id text,
  p_symbol text,
  p_requested_notional numeric,
  p_entry_trigger numeric,
  p_max_entry_price numeric,
  p_protective_stop numeric,
  p_take_profit_price numeric,
  p_planned_risk_dollars numeric,
  p_session_date date,
  p_expires_at timestamptz,
  p_metadata jsonb
) returns jsonb
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_ledger public.paper_bot_ledgers%rowtype;
  v_daily_entries integer := 0;
begin
  if p_client_order_id !~ '^chb-wkd-v5-[a-z0-9]+-[a-z0-9]{6,24}$' then
    raise exception 'Invalid daily crypto v5 client order ID';
  end if;
  if p_symbol not in ('BTC/USD','ETH/USD','SOL/USD','LINK/USD','DOT/USD') then
    raise exception 'Unsupported daily crypto symbol';
  end if;
  if p_requested_notional is null or p_requested_notional <= 0
     or p_entry_trigger is null or p_entry_trigger <= 0
     or p_max_entry_price is null or p_max_entry_price <= 0
     or p_protective_stop is null or p_protective_stop <= 0
     or p_take_profit_price is null or p_take_profit_price <= p_entry_trigger
     or p_planned_risk_dollars is null or p_planned_risk_dollars < 0
     or p_session_date is null
     or p_expires_at is null
     or jsonb_typeof(coalesce(p_metadata,'{}'::jsonb)) <> 'object' then
    raise exception 'Invalid daily crypto v5 entry claim payload';
  end if;

  select * into v_ledger
  from public.paper_bot_ledgers
  where bot_id='weekend-crypto-day-100'
  for update;

  if not found then raise exception 'Daily crypto ledger is missing'; end if;
  if v_ledger.status <> 'active'
     or v_ledger.strategy_id <> 'daily-crypto-day-v5'
     or v_ledger.strategy_version <> 5 then
    raise exception 'Daily crypto v5 bot is not active';
  end if;
  if coalesce((v_ledger.metadata->>'executionEnabled')::boolean,false) is not true then
    raise exception 'Daily crypto PAPER execution is disabled';
  end if;
  if coalesce((v_ledger.metadata->>'liveMoneyEnabled')::boolean,false) is true then
    raise exception 'Live-money mode is not permitted';
  end if;
  if coalesce(v_ledger.daily_realized_loss_pct,0) >= 1.5 then
    raise exception 'Daily loss kill switch is active';
  end if;
  if p_requested_notional > v_ledger.equity*0.30 + 0.000001 then
    raise exception 'Daily crypto position allocation exceeds 30 percent';
  end if;
  if p_requested_notional > coalesce(v_ledger.buying_power,0) + 0.000001 then
    raise exception 'Insufficient daily crypto virtual buying power';
  end if;
  if p_planned_risk_dollars > v_ledger.equity*0.005 + 0.000001 then
    raise exception 'Daily crypto planned loss exceeds 0.50 percent';
  end if;
  if coalesce(v_ledger.open_planned_risk_pct,0)
       + (p_planned_risk_dollars/nullif(v_ledger.equity,0)*100) > 0.75 + 0.000001 then
    raise exception 'Daily crypto open-risk ceiling would be exceeded';
  end if;

  if exists (
    select 1 from public.paper_bot_positions
    where bot_id='weekend-crypto-day-100' and quantity>0
  ) then
    raise exception 'Daily crypto bot already has an open position';
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
    raise exception 'Daily crypto bot already has an active entry order';
  end if;

  select count(*) into v_daily_entries
  from public.paper_bot_orders
  where bot_id='weekend-crypto-day-100'
    and side='buy'
    and status in ('submitted','partially_filled','filled','closed','replaced')
    and (created_at at time zone 'America/Chicago')::date = p_session_date;

  if v_daily_entries >= 3 then
    raise exception 'Daily crypto entry limit has been reached';
  end if;

  insert into public.paper_bot_orders(
    client_order_id,bot_id,strategy_id,strategy_version,
    symbol,asset_class,side,status,requested_notional,pool_id,
    entry_trigger,max_entry_price,protective_stop,planned_risk_dollars,
    expires_at,stage_reason,take_profit_price,take_profit_fraction,
    take_profit_r,protect_winner_at_r,trail_remainder,metadata
  ) values (
    p_client_order_id,'weekend-crypto-day-100','daily-crypto-day-v5',5,
    p_symbol,'crypto','buy','prepared',p_requested_notional,'day',
    p_entry_trigger,p_max_entry_price,p_protective_stop,p_planned_risk_dollars,
    p_expires_at,'Daily crypto v5 selected an adaptive opportunity setup.',
    p_take_profit_price,0.25,2.00,1.00,true,
    coalesce(p_metadata,'{}'::jsonb) || jsonb_build_object(
      'paperOnly',true,
      'executionMode','paper-crypto',
      'estimatedFeeBps',25,
      'sessionDate',p_session_date,
      'claimedAt',now(),
      'feeReconciliationPending',true,
      'goalExitMode','adaptive-opportunity',
      'firstTrimR',2.0,
      'firstTrimFraction',0.25
    )
  );

  return jsonb_build_object(
    'claimed',true,
    'clientOrderId',p_client_order_id,
    'symbol',p_symbol,
    'requestedNotional',p_requested_notional,
    'goalExitPrice',p_take_profit_price
  );
end $$;

revoke all on function public.paper_bot_claim_weekend_crypto_entry(
  text,text,numeric,numeric,numeric,numeric,numeric,numeric,date,timestamptz,jsonb
) from public,anon,authenticated;
grant execute on function public.paper_bot_claim_weekend_crypto_entry(
  text,text,numeric,numeric,numeric,numeric,numeric,numeric,date,timestamptz,jsonb
) to service_role;

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
      p.take_profit_r,
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
        when take_profit_price is not null and mark_price>=take_profit_price
          then 'goal_exit'
        when not partial_done
          and take_profit_r is not null
          and take_profit_r>0
          and r_multiple>=take_profit_r
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
          'version','paper-exit-v2',
          'mode','adaptive-goal',
          'plannedAction',d.planned_action,
          'rMultiple',round(d.r_multiple,4),
          'markPrice',d.mark_price,
          'evaluatedAt',p_collected_at,
          'hasActiveStop',d.has_active_stop,
          'goalExitPrice',d.take_profit_price,
          'reason',case d.planned_action
            when 'repair_stop' then 'Broker protection is missing.'
            when 'goal_exit' then 'Adaptive opportunity goal has been reached.'
            when 'partial_profit' then '2R de-risk checkpoint has been reached.'
            when 'tighten_stop_trail' then 'Trailing stop can tighten.'
            when 'tighten_stop_breakeven' then 'Winner-protection threshold reached.'
            else 'No exit-management threshold is active.'
          end
        )
        || case when d.desired_stop is not null
             then jsonb_build_object('desiredStop',round(d.desired_stop,6))
             else '{}'::jsonb end
        || case when d.planned_action='partial_profit'
             then jsonb_build_object('partialFraction',coalesce(d.take_profit_fraction,0.25))
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
