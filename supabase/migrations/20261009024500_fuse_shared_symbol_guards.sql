-- Cross-bot symbol occupancy hardening: additive to Alpaca PAPER broker
-- position/open-order preflight, not a substitute for other bots adopting
-- a single venue-wide reservation protocol.
-- Fuse is PAPER-only. This function reserves one and only one guarded
-- autonomous pilot entry, and creates its attributable local order BEFORE
-- the caller may POST the order to Alpaca. No toggles are turned on here.
create or replace function public.paper_fuse_claim_pilot_entry(
  p_client_order_id text,
  p_symbol text,
  p_qty integer,
  p_limit_price numeric,
  p_stop_price numeric,
  p_target_price numeric,
  p_scanner_score integer
) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_ledger public.paper_bot_ledgers%rowtype;
  v_loss numeric;
  v_notional numeric;
begin
  if p_client_order_id is null or p_client_order_id !~
       '^chb-pny-v1-[a-z0-9]+-[a-z0-9]{6,24}$'
    or p_symbol is null or p_symbol !~ '^[A-Z][A-Z0-9.]{0,15}$'
    or p_qty is null or p_qty < 1 or p_qty > 100000
    or p_limit_price is null or p_limit_price <= 0
    or p_stop_price is null or p_stop_price <= 0
    or p_target_price is null or p_target_price <= p_limit_price
    or p_stop_price >= p_limit_price
    or p_scanner_score is null or p_scanner_score < 80 or p_scanner_score > 100
  then return false;
  end if;
  -- PostgreSQL decimals are exact. Broker precision and loss limit checks
  -- must remain server-enforced even if app code regresses.
  if p_limit_price > 5.10
    or (p_limit_price >= 1 and mod(p_limit_price * 100,1) <> 0)
    or (p_limit_price < 1 and mod(p_limit_price * 10000,1) <> 0)
    or (p_stop_price >= 1 and mod(p_stop_price * 100,1) <> 0)
    or (p_stop_price < 1 and mod(p_stop_price * 10000,1) <> 0)
    or (p_target_price >= 1 and mod(p_target_price * 100,1) <> 0)
    or (p_target_price < 1 and mod(p_target_price * 10000,1) <> 0)
    or p_limit_price-p_stop_price < 0.01
  then return false;
  end if;

  -- Serializes concurrent Fuse reservation attempts for the same stock.
  -- Other bots still require their own broker checks, because they do not
  -- all take this advisory lock.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('paper-stock-fuse:'||p_symbol,0)
  );
  select * into v_ledger from public.paper_bot_ledgers
  where bot_id = 'penny-volatility-day-100' for update;
  if not found or v_ledger.status <> 'active'
    or v_ledger.metadata->>'executionEnabled' <> 'true'
    or v_ledger.metadata->>'fusePilotEnabled' <> 'true'
    or v_ledger.metadata ? 'fusePilotClientOrderId'
    or v_ledger.equity <= 0 or coalesce(v_ledger.buying_power,0) <= 0
    or coalesce(v_ledger.daily_realized_loss_pct,0) >= 1.5
    or coalesce(v_ledger.open_planned_risk_pct,0) >= 1.0
  then return false;
  end if;
  v_loss := (p_limit_price-p_stop_price)*p_qty;
  v_notional := p_limit_price*p_qty;
  if v_loss <= 0 or v_loss > v_ledger.equity*0.005 + 0.00000001
    or v_notional > least(v_ledger.equity*0.20,v_ledger.buying_power) + 0.00000001
    or coalesce(v_ledger.open_planned_risk_pct,0) +
       v_loss / v_ledger.equity * 100 > 1.0 + 0.00000001
    or exists(select 1 from public.paper_bot_positions
       where bot_id=v_ledger.bot_id and quantity>0)
    -- Refuse any known competing virtual owner: the venue holds net
    -- Alpaca shares, not segregated physical accounts by bot.
    or exists(select 1 from public.paper_bot_positions other_position
       where other_position.symbol=p_symbol and other_position.quantity>0)
    or exists(select 1 from public.paper_bot_orders other_order
       where other_order.bot_id<>v_ledger.bot_id
         and other_order.symbol=p_symbol
         and (other_order.status in ('prepared','submitted','partially_filled')
           or (other_order.status='filled'
             and other_order.created_at > pg_catalog.now() - interval '2 minutes')))
    or exists(select 1 from public.paper_bot_orders
       where bot_id=v_ledger.bot_id
         and status in ('prepared','submitted','partially_filled','filled'))
  then return false;
  end if;
  insert into public.paper_bot_orders (
    client_order_id,bot_id,strategy_id,strategy_version,
    broker_order_id,symbol,asset_class,side,status,requested_quantity,
    requested_notional,pool_id,entry_trigger,max_entry_price,protective_stop,
    take_profit_price,planned_risk_dollars,submitted_at,metadata
  ) values (
    p_client_order_id,v_ledger.bot_id,'penny-volatility-day-v1',1,
    null,p_symbol,'stock','buy','submitted',p_qty,
    v_notional,'day',p_limit_price,p_limit_price,p_stop_price,
    p_target_price,v_loss,now(),
    jsonb_build_object('paperOnly',true,'liveMoneyEnabled',false,
      'executionMode','fuse-whole-share-bracket-pilot-v1',
      'brokerLookupPending',true,'bracketProtectionVerified',false,
      'fuseScore',p_scanner_score,'pilotClaimed',true,
      'limitPrice',p_limit_price,'stopPrice',p_stop_price,
      'targetPrice',p_target_price)
  );
  update public.paper_bot_ledgers set
    metadata=jsonb_set(metadata,'{fusePilotClientOrderId}',
        to_jsonb(p_client_order_id),true),
    updated_at=now()
  where bot_id=v_ledger.bot_id;
  return true;
exception when unique_violation then
  return false;
end $$;

revoke all on function public.paper_fuse_claim_pilot_entry(text,text,integer,numeric,numeric,numeric,integer) from public;
revoke all on function public.paper_fuse_claim_pilot_entry(text,text,integer,numeric,numeric,numeric,integer) from anon;
revoke all on function public.paper_fuse_claim_pilot_entry(text,text,integer,numeric,numeric,numeric,integer) from authenticated;
grant execute on function public.paper_fuse_claim_pilot_entry(text,text,integer,numeric,numeric,numeric,integer) to service_role;
