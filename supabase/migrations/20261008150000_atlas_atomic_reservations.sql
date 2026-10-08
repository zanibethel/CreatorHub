-- Atlas-only paper order reservations. Does not submit broker orders.
-- Locking the Atlas ledger serializes competing claims, even for different symbols.
CREATE TABLE IF NOT EXISTS public.paper_atlas_reservations (
  reservation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id text NOT NULL DEFAULT 'default-diverse' CHECK (bot_id = 'default-diverse'),
  decision_id text NOT NULL,
  opportunity_id text NOT NULL,
  strategy_id text NOT NULL DEFAULT 'paper-medium-high-v1' CHECK (strategy_id = 'paper-medium-high-v1'),
  strategy_version integer NOT NULL DEFAULT 1 CHECK (strategy_version = 1),
  pool text NOT NULL CHECK (pool IN ('day','multi-day','multi-week')),
  amount numeric(18,6) NOT NULL CHECK (amount > 0),
  client_order_id text NULL REFERENCES public.paper_bot_orders(client_order_id),
  status text NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved','released','consumed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bot_id, decision_id, strategy_version, opportunity_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS paper_atlas_reservation_order_uidx ON public.paper_atlas_reservations (client_order_id) WHERE client_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS paper_atlas_active_reservation_idx
  ON public.paper_atlas_reservations (bot_id,pool) WHERE status = 'reserved';
ALTER TABLE public.paper_atlas_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.paper_atlas_reservations FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.paper_atlas_reservations TO service_role;
-- Writes must go through the ledger-locked RPCs, not direct REST mutations.

CREATE OR REPLACE FUNCTION public.paper_atlas_reserve(
  p_decision_id text,p_opportunity_id text,p_pool text,p_amount numeric,
  p_expected_bot text DEFAULT 'default-diverse')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_cash numeric;
  v_starting_cash numeric;
  v_pool_limit numeric;
  v_pool_committed numeric;
  v_pending numeric;
  v_reserved numeric;
  v_pool_reserved numeric;
  v_id uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required';
  END IF;
  IF nullif(trim(p_decision_id),'') IS NULL OR nullif(trim(p_opportunity_id),'') IS NULL
    OR length(p_decision_id)>160 OR length(p_opportunity_id)>240
    OR p_pool NOT IN ('day','multi-day','multi-week')
    OR p_amount IS NULL OR p_amount<=0 OR p_amount>100
    OR p_expected_bot <> 'default-diverse' THEN
    RETURN jsonb_build_object('reserved',false,'reason','invalid-request');
  END IF;
  -- No caller can reserve a scanner-only discovery or an unapproved strategy decision.
  -- Current read-only Atlas decisions retain blockers, so this intentionally
  -- denies reservations until a separately reviewed executable decision exists.
  IF NOT EXISTS (
    SELECT 1 FROM public.paper_bot_journal j
    WHERE j.bot_id='default-diverse' AND j.strategy_id='paper-medium-high-v1'
      AND j.strategy_version=1 AND j.event_type='candidate'
      AND j.metadata->>'decisionId'=p_decision_id
      AND j.metadata#>>'{inputProvenance,scanner,opportunityId}'=p_opportunity_id
      AND j.qualification='trade-ready'
      AND j.blockers='[]'::jsonb
      AND j.metadata->>'orderAuthorization'='true'
  ) THEN
    RETURN jsonb_build_object('reserved',false,'reason','decision-not-authorized');
  END IF;
  -- A locked ledger row is the concurrency gate for all Atlas claims.
  SELECT cash,starting_cash INTO v_cash,v_starting_cash FROM public.paper_bot_ledgers
    WHERE bot_id='default-diverse' FOR UPDATE;
  IF NOT FOUND OR v_cash IS NULL OR v_cash<0 OR v_starting_cash IS NULL OR v_starting_cash<=0 THEN
    RETURN jsonb_build_object('reserved',false,'reason','ledger-unavailable');
  END IF;
  SELECT reservation_id INTO v_id FROM public.paper_atlas_reservations
    WHERE bot_id='default-diverse' AND decision_id=p_decision_id
      AND opportunity_id=p_opportunity_id AND strategy_version=1;
  IF FOUND THEN
    RETURN jsonb_build_object('reserved',false,'reason','duplicate','reservationId',v_id);
  END IF;
  -- Pool ceilings are derived from Atlas's own starting cash, never caller-supplied.
  v_pool_limit := v_starting_cash * CASE p_pool WHEN 'day' THEN 0.20 WHEN 'multi-day' THEN 0.40 ELSE 0.40 END;
  SELECT coalesce(sum(greatest(market_value,0)),0) INTO v_pool_committed
    FROM public.paper_bot_positions WHERE bot_id='default-diverse' AND pool_id=p_pool;
  -- Fail closed while any order is unresolved; an unconfirmed fill may already consume cash.
  SELECT count(*) INTO v_pending FROM public.paper_bot_orders
    WHERE bot_id='default-diverse' AND status IN ('prepared','submitted','accepted','partially_filled','pending_new');
  IF v_pending>0 THEN
    RETURN jsonb_build_object('reserved',false,'reason','unresolved-orders');
  END IF;
  SELECT coalesce(sum(amount),0),
         coalesce(sum(amount) FILTER (WHERE pool=p_pool),0)
    INTO v_reserved,v_pool_reserved FROM public.paper_atlas_reservations
    WHERE bot_id='default-diverse' AND status='reserved';
  IF v_cash-v_reserved<p_amount OR v_pool_committed+v_pool_reserved+p_amount>v_pool_limit THEN
    RETURN jsonb_build_object('reserved',false,'reason','insufficient-capacity');
  END IF;
  INSERT INTO public.paper_atlas_reservations
    (decision_id,opportunity_id,pool,amount)
  VALUES (p_decision_id,p_opportunity_id,p_pool,p_amount)
  RETURNING reservation_id INTO v_id;
  RETURN jsonb_build_object('reserved',true,'reservationId',v_id);
END $$;
REVOKE ALL ON FUNCTION public.paper_atlas_reserve(text,text,text,numeric,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.paper_atlas_reserve(text,text,text,numeric,text)
  TO service_role;

-- Release requires exact reservation ID and remains idempotent.
CREATE OR REPLACE FUNCTION public.paper_atlas_release(p_reservation_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_changed integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required';
  END IF;
  RETURN false;
END $$;
REVOKE ALL ON FUNCTION public.paper_atlas_release(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.paper_atlas_release(uuid) TO service_role;

-- A reservation may be consumed only after a matching fully filled Atlas order is observed.
-- Partial fills retain the full reservation until a separate terminal reconciliation protocol exists.
-- Do not mark ambiguous broker outcomes consumed or released automatically.
CREATE OR REPLACE FUNCTION public.paper_atlas_consume(
  p_reservation_id uuid,p_client_order_id text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_changed integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required';
  END IF;
  PERFORM 1 FROM public.paper_bot_ledgers WHERE bot_id='default-diverse' FOR UPDATE;
  IF NOT EXISTS (
    SELECT 1 FROM public.paper_bot_orders o
    JOIN public.paper_atlas_reservations r ON r.reservation_id=p_reservation_id
    WHERE o.client_order_id=p_client_order_id
      AND o.bot_id='default-diverse'
      AND o.strategy_id='paper-medium-high-v1'
      AND o.strategy_version=1
      AND o.side='buy'
      AND o.pool_id=r.pool
      AND (r.client_order_id IS NULL OR r.client_order_id=p_client_order_id)
      AND o.status = 'filled'
      AND coalesce(o.requested_notional,0)>0
      AND o.requested_notional<=r.amount
  ) THEN RETURN false; END IF;
  UPDATE public.paper_atlas_reservations
     SET status='consumed',client_order_id=p_client_order_id,updated_at=now()
   WHERE reservation_id=p_reservation_id AND bot_id='default-diverse' AND status='reserved';
  GET DIAGNOSTICS v_changed=ROW_COUNT;
  RETURN v_changed=1;
END $$;
REVOKE ALL ON FUNCTION public.paper_atlas_consume(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.paper_atlas_consume(uuid,text) TO service_role;
