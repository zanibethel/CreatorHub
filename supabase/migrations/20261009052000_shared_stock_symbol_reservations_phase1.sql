-- Shared, durable PAPER stock ownership reservation: phase 1 (Pulse + Fuse).
-- No live broker activity is initiated by this migration. Reservations are
-- permanently held until independently audited/reconciled; do not use TTLs to
-- infer a canceled or still-physically-held Alpaca position is free.
CREATE TABLE IF NOT EXISTS public.paper_stock_symbol_reservations (
  reservation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL CHECK (symbol ~ '^[A-Z][A-Z0-9.]{0,15}$'),
  bot_id text NOT NULL REFERENCES public.paper_bot_ledgers(bot_id),
  client_order_id text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','released')),
  created_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz,
  CONSTRAINT paper_stock_symbol_release_consistency CHECK (
    (status='active' AND released_at IS NULL) OR
    (status='released' AND released_at IS NOT NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS paper_stock_symbol_active_symbol
  ON public.paper_stock_symbol_reservations(symbol) WHERE status='active';
CREATE INDEX IF NOT EXISTS paper_stock_symbol_bot_idx
  ON public.paper_stock_symbol_reservations(bot_id,status);
ALTER TABLE public.paper_stock_symbol_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.paper_stock_symbol_reservations FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.paper_stock_symbol_reservations TO service_role;

CREATE OR REPLACE FUNCTION public.paper_stock_symbol_claim(
  p_bot_id text,p_symbol text,p_client_order_id text
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE v_tag text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RETURN false; END IF;
  IF p_bot_id NOT IN ('momentum-breakout-100','penny-volatility-day-100')
     OR p_symbol IS NULL OR p_symbol !~ '^[A-Z][A-Z0-9.]{0,15}$'
     OR p_client_order_id IS NULL OR length(p_client_order_id)>128 THEN
    RETURN false;
  END IF;
  SELECT broker_tag INTO v_tag
  FROM public.paper_bot_ledgers
  WHERE bot_id=p_bot_id AND status='active';
  IF v_tag IS NULL OR p_client_order_id !~
     ('^chb-'||v_tag||'-v[1-9][0-9]*-[a-z0-9]+-[a-z0-9]{6,24}$') THEN
    RETURN false;
  END IF;
  -- All participating bot claims serialize on identical advisory lock keys.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('paper-stock:'||p_symbol,0)
  );
  -- Preserve any existing ownership indefinitely until broker and ledger
  -- positions have been independently reconciled and explicitly released.
  IF EXISTS (SELECT 1 FROM public.paper_stock_symbol_reservations
             WHERE symbol=p_symbol AND status='active')
     OR EXISTS (SELECT 1 FROM public.paper_stock_symbol_reservations
                WHERE client_order_id=p_client_order_id)
     OR EXISTS (SELECT 1 FROM public.paper_bot_positions
                WHERE symbol=p_symbol AND quantity>0)
     OR EXISTS (SELECT 1 FROM public.paper_bot_orders
                WHERE symbol=p_symbol AND asset_class IN ('stock','etf')
                AND client_order_id<>p_client_order_id
                AND (
                  status IN ('prepared','submitted','accepted','pending_new','partially_filled')
                  OR (status='filled' AND created_at > pg_catalog.now()-interval '2 minutes')
                ))
  THEN RETURN false; END IF;
  INSERT INTO public.paper_stock_symbol_reservations
    (symbol,bot_id,client_order_id)
  VALUES (p_symbol,p_bot_id,p_client_order_id);
  RETURN true;
EXCEPTION WHEN unique_violation THEN RETURN false;
END $$;

REVOKE ALL ON FUNCTION public.paper_stock_symbol_claim(text,text,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.paper_stock_symbol_claim(text,text,text)
  TO service_role;
-- Deliberately NO release endpoint yet. An active reservation is stronger
-- than the broker's temporary open-order state and cannot be reused by a
-- timed-out or rejected-but-uncertain order without a follow-up audit.

-- Both current one-shot PAPER claims must reserve the same stock symbol
-- in their existing ledger-locked transaction, before any broker POST.
-- Atomic, one-time gate for Pulse's initial real Alpaca PAPER fractional test.
-- A broker order is not submitted until the claim commits; a failed/ambiguous
-- claim stops submission, preventing simultaneous cron runs from doubling risk.
create or replace function public.paper_pulse_claim_fractional_pilot(p_client_order_id text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_affected integer := 0; v_symbol text; v_ledger public.paper_bot_ledgers%rowtype;
begin
  if p_client_order_id is null or
     p_client_order_id !~ '^chb-pls-v1-[a-z0-9]+-[a-z0-9]{6,24}$'
     then return false;
  end if;
  select * into v_ledger from public.paper_bot_ledgers
    where bot_id='momentum-breakout-100' for update;
  if not found or v_ledger.status<>'active'
    or v_ledger.metadata->>'executionEnabled'<>'true'
    or v_ledger.metadata->>'fractionalExecutionEnabled'<>'true'
    or v_ledger.metadata ? 'fractionalPilotClientOrderId'
  then return false; end if;

  select symbol into v_symbol from public.paper_bot_orders
    where client_order_id=p_client_order_id
      and bot_id='momentum-breakout-100'
      and side='buy' and asset_class in ('stock','etf')
      and status='prepared' and broker_order_id is null;
  if v_symbol is null then return false; end if;
  -- Atomic transaction: never persist the one-shot pilot claim unless
  -- the shared physical venue's stock symbol is also reserved.
  if not public.paper_stock_symbol_claim(
    'momentum-breakout-100',v_symbol,p_client_order_id
  ) then return false; end if;
  update public.paper_bot_ledgers
  set metadata = jsonb_set(metadata, '{fractionalPilotClientOrderId}',
                           to_jsonb(p_client_order_id), true),
      updated_at = now()
  where bot_id = 'momentum-breakout-100'
    and status = 'active'
    and metadata->>'executionEnabled' = 'true'
    and metadata->>'fractionalExecutionEnabled' = 'true'
    and not metadata ? 'fractionalPilotClientOrderId';
  get diagnostics v_affected = row_count;
  if v_affected<>1 then raise exception 'Pulse pilot ledger claim changed unexpectedly'; end if;
  return true;
end
$$;

revoke all on function public.paper_pulse_claim_fractional_pilot(text)
  from public, anon, authenticated;
grant execute on function public.paper_pulse_claim_fractional_pilot(text)
  to service_role;

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
  -- Reserve the same physical stock symbol in the same transaction.
  if not public.paper_stock_symbol_claim(
    'penny-volatility-day-100',p_symbol,p_client_order_id
  ) then return false; end if;
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
