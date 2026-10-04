-- Daily Crypto Day v4: continuous 24/7 PAPER entry availability.
-- America/Chicago remains only the daily accounting boundary for entry count
-- and realized-loss guardrails. There is no routine nightly flatten.

update public.paper_bot_ledgers
set strategy_id='daily-crypto-day-v4',
    strategy_version=4,
    metadata=(metadata - 'stopNewEntriesLocal' - 'sessionFlatByLocal') || jsonb_build_object(
      'executionUniverse',jsonb_build_array('BTC/USD','ETH/USD','SOL/USD','LINK/USD','DOT/USD'),
      'monitorOnlyUniverse',jsonb_build_array('XRP/USD','LTC/USD','AVAX/USD','DOGE/USD','ADA/USD','BCH/USD','AAVE/USD','HYPE/USD','RENDER/USD'),
      'continuous24x7',true,
      'routineSessionFlatten',false,
      'dailyAccountingTimezone','America/Chicago',
      'maximumNewEntriesPerDay',3,
      'strategyRevisionReason','Removed artificial 22:30 entry cutoff and 23:45 routine flatten so the PAPER crypto strategy can operate continuously 24/7 while preserving daily accounting and all existing risk/quality gates.'
    ),
    updated_at=now()
where bot_id='weekend-crypto-day-100';

CREATE OR REPLACE FUNCTION public.paper_bot_claim_weekend_crypto_entry(p_client_order_id text, p_symbol text, p_requested_notional numeric, p_entry_trigger numeric, p_max_entry_price numeric, p_protective_stop numeric, p_take_profit_price numeric, p_planned_risk_dollars numeric, p_session_date date, p_expires_at timestamp with time zone, p_metadata jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_ledger public.paper_bot_ledgers%rowtype;
  v_daily_entries integer := 0;
begin
  if p_client_order_id !~ '^chb-wkd-v4-[a-z0-9]+-[a-z0-9]{6,24}$' then
    raise exception 'Invalid daily crypto client order ID';
  end if;
  if p_symbol not in ('BTC/USD','ETH/USD','SOL/USD','LINK/USD','DOT/USD') then
    raise exception 'Unsupported daily crypto symbol';
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
    raise exception 'Invalid daily crypto entry claim payload';
  end if;

  select * into v_ledger
  from public.paper_bot_ledgers
  where bot_id='weekend-crypto-day-100'
  for update;

  if not found then raise exception 'Daily crypto ledger is missing'; end if;
  if v_ledger.status <> 'active' or v_ledger.strategy_id <> 'daily-crypto-day-v4' or v_ledger.strategy_version <> 4 then
    raise exception 'Daily crypto bot is not active';
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
  if coalesce(v_ledger.open_planned_risk_pct,0) + (p_planned_risk_dollars/nullif(v_ledger.equity,0)*100) > 0.75 + 0.000001 then
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
    p_client_order_id,'weekend-crypto-day-100','daily-crypto-day-v4',4,
    p_symbol,'crypto','buy','prepared',p_requested_notional,'day',
    p_entry_trigger,p_max_entry_price,p_protective_stop,p_planned_risk_dollars,
    p_expires_at,'Daily crypto day scanner selected a fee-aware momentum setup.',
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
