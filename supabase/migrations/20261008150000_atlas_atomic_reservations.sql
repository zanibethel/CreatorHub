-- Atlas-only paper order reservations. Does not submit broker orders.
-- Locking the Atlas ledger serializes competing claims, even for different symbols.
CREATE TABLE IF NOT EXISTS public.paper_atlas_reservations (
  reservation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id text NOT NULL DEFAULT 'default-diverse' CHECK (bot_id = 'default-diverse'),
  decision_id text NOT NULL,
  opportunity_id text NOT NULL,
  strategy_id text NOT NULL CHECK (strategy_id = 'paper-medium-high-v1'),
  strategy_version integer NOT NULL CHECK (strategy_version = 1),
  pool text NOT NULL CHECK (pool IN ('day','multi-day','multi-week')),
  amount numeric(18,6) NOT NULL CHECK (amount > 0),
  status text NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved','released','consumed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bot_id, decision_id, strategy_version, opportunity_id)
);
CREATE INDEX IF NOT EXISTS paper_atlas_active_reservation_idx
  ON public.paper_atlas_reservations (bot_id,pool) WHERE status = 'reserved';
ALTER TABLE public.paper_atlas_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.paper_atlas_reservations FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.paper_atlas_reservations TO service_role;

CREATE OR REPLACE FUNCTION public.paper_atlas_reserve(
  p_decision_id text,p_opportunity_id text,p_pool text,p_amount numeric,
  p_pool_limit numeric,p_pool_committed numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_cash numeric;
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
    OR p_pool_limit IS NULL OR p_pool_limit<0
    OR p_pool_committed IS NULL OR p_pool_committed<0 THEN
    RETURN jsonb_build_object('reserved',false,'reason','invalid-request');
  END IF;
  -- A locked ledger row is the concurrency gate for all Atlas claims.
  SELECT cash INTO v_cash FROM public.paper_bot_ledgers
    WHERE bot_id='default-diverse' FOR UPDATE;
  IF NOT FOUND OR v_cash IS NULL OR v_cash<0 THEN
    RETURN jsonb_build_object('reserved',false,'reason','ledger-unavailable');
  END IF;
  SELECT reservation_id INTO v_id FROM public.paper_atlas_reservations
    WHERE bot_id='default-diverse' AND decision_id=p_decision_id
      AND opportunity_id=p_opportunity_id AND strategy_version=1;
  IF FOUND THEN
    RETURN jsonb_build_object('reserved',false,'reason','duplicate','reservationId',v_id);
  END IF;
  SELECT coalesce(sum(amount),0),
         coalesce(sum(amount) FILTER (WHERE pool=p_pool),0)
    INTO v_reserved,v_pool_reserved FROM public.paper_atlas_reservations
    WHERE bot_id='default-diverse' AND status='reserved';
  IF v_cash-v_reserved<p_amount OR p_pool_committed+v_pool_reserved+p_amount>p_pool_limit THEN
    RETURN jsonb_build_object('reserved',false,'reason','insufficient-capacity');
  END IF;
  INSERT INTO public.paper_atlas_reservations
    (decision_id,opportunity_id,pool,amount)
  VALUES (p_decision_id,p_opportunity_id,p_pool,p_amount)
  RETURNING reservation_id INTO v_id;
  RETURN jsonb_build_object('reserved',true,'reservationId',v_id);
END $$;
REVOKE ALL ON FUNCTION public.paper_atlas_reserve(text,text,text,numeric,numeric,numeric)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.paper_atlas_reserve(text,text,text,numeric,numeric,numeric)
  TO service_role;

-- Release requires exact reservation ID and remains idempotent.
CREATE OR REPLACE FUNCTION public.paper_atlas_release(p_reservation_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_changed integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required';
  END IF;
  UPDATE public.paper_atlas_reservations SET status='released',updated_at=now()
   WHERE reservation_id=p_reservation_id AND bot_id='default-diverse' AND status='reserved';
  GET DIAGNOSTICS v_changed = ROW_COUNT;
  RETURN v_changed=1;
END $$;
REVOKE ALL ON FUNCTION public.paper_atlas_release(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.paper_atlas_release(uuid) TO service_role;
