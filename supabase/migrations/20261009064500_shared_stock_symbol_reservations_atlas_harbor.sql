-- Phase 2, all four identified stock entry bots participate in a single
-- durable Alpaca PAPER physical-stock symbol lock, with no automatic release.
-- Existing bot virtual risk checks are preserved. No broker POST occurs here.
CREATE OR REPLACE FUNCTION public.paper_stock_symbol_claim(
  p_bot_id text,p_symbol text,p_client_order_id text
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE v_tag text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RETURN false; END IF;
  IF p_bot_id NOT IN ('momentum-breakout-100','penny-volatility-day-100','default-diverse','three-trade-weekly-swing-100')
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
GRANT EXECUTE ON FUNCTION public.paper_stock_symbol_claim(text,text,text) TO service_role;

-- Atlas consumes the same physical lock BEFORE binding a funded,
-- decision-authorized, prepared stock order to a reserved Atlas pool.
CREATE OR REPLACE FUNCTION public.paper_atlas_bind_order(
  p_reservation_id uuid,p_client_order_id text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_changed integer; v_symbol text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required';
  END IF;
  PERFORM 1 FROM public.paper_bot_ledgers WHERE bot_id='default-diverse' FOR UPDATE;
  IF NOT EXISTS (
    SELECT 1
    FROM public.paper_bot_orders o
    JOIN public.paper_atlas_reservations r ON r.reservation_id=p_reservation_id
    WHERE r.bot_id='default-diverse'
      AND r.status='reserved'
      AND r.client_order_id IS NULL
      AND o.client_order_id=p_client_order_id
      AND o.bot_id='default-diverse'
      AND o.strategy_id='paper-medium-high-v1'
      AND o.strategy_version=1
      AND o.side='buy'
      AND o.pool_id=r.pool
      AND o.status='prepared'
      AND coalesce(o.requested_notional,0)>0
      AND o.requested_notional<=r.amount
      AND o.metadata->>'atlasReservationId'=r.reservation_id::text
      AND o.metadata->>'decisionId'=r.decision_id
      AND o.metadata->>'opportunityId'=r.opportunity_id
  ) THEN RETURN false; END IF;
  SELECT o.symbol INTO v_symbol
    FROM public.paper_bot_orders o
    WHERE o.client_order_id=p_client_order_id
      AND o.bot_id='default-diverse'
      AND o.asset_class='stock'
      AND o.side='buy' AND o.status='prepared';
  IF v_symbol IS NULL OR NOT public.paper_stock_symbol_claim(
    'default-diverse',v_symbol,p_client_order_id
  ) THEN RETURN false; END IF;
  UPDATE public.paper_atlas_reservations
     SET client_order_id=p_client_order_id,updated_at=now()
   WHERE reservation_id=p_reservation_id
     AND bot_id='default-diverse'
     AND status='reserved'
     AND client_order_id IS NULL;
  GET DIAGNOSTICS v_changed=ROW_COUNT;
  IF v_changed<>1 THEN RAISE EXCEPTION 'Atlas binding changed after physical symbol claim'; END IF;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.paper_atlas_bind_order(uuid,text)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.paper_atlas_bind_order(uuid,text) TO service_role;

-- Harbor: same transaction binds the staged stock buy, the bot's prepared
-- order state and its durable physical-symbol reservation.
CREATE OR REPLACE FUNCTION public.paper_swing_claim_prepared_with_symbol(
 p_client_order_id text,p_symbol text,p_requested_quantity numeric,
 p_claim_metadata jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE v_order public.paper_bot_orders%rowtype;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     OR p_client_order_id IS NULL
     OR p_symbol IS NULL OR p_symbol !~ '^[A-Z][A-Z0-9.]{0,15}$'
     OR p_requested_quantity IS NULL OR p_requested_quantity<=0
     OR p_requested_quantity>1000000
     OR p_claim_metadata IS NULL OR jsonb_typeof(p_claim_metadata)<>'object'
     OR coalesce(p_claim_metadata->>'executionMode','')<>'paper-bracket'
  THEN RETURN jsonb_build_object('claimed',false,'reason','invalid-request'); END IF;
  SELECT * INTO v_order FROM public.paper_bot_orders
   WHERE client_order_id=p_client_order_id
     AND bot_id='three-trade-weekly-swing-100'
     AND symbol=p_symbol
     AND asset_class IN ('stock','etf')
     AND side='buy' AND status='prepared'
     AND broker_order_id IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('claimed',false,'reason','not-prepared');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.paper_bot_ledgers
     WHERE bot_id='three-trade-weekly-swing-100'
       AND status='active' AND metadata->>'executionEnabled'='true')
  THEN RETURN jsonb_build_object('claimed',false,'reason','execution-disabled'); END IF;
  IF NOT public.paper_stock_symbol_claim(
    'three-trade-weekly-swing-100',p_symbol,p_client_order_id
  ) THEN RETURN jsonb_build_object('claimed',false,'reason','symbol-reservation-denied'); END IF;
  UPDATE public.paper_bot_orders
     SET status='submitted',
       requested_quantity=p_requested_quantity,
       submitted_at=now(),
       metadata=p_claim_metadata,
       updated_at=now()
   WHERE client_order_id=p_client_order_id
     AND bot_id='three-trade-weekly-swing-100'
     AND status='prepared' AND broker_order_id IS NULL
   RETURNING * INTO v_order;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Harbor order changed after physical stock reservation';
  END IF;
  RETURN jsonb_build_object('claimed',true,'order',to_jsonb(v_order));
END $$;
REVOKE ALL ON FUNCTION public.paper_swing_claim_prepared_with_symbol(text,text,numeric,jsonb)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.paper_swing_claim_prepared_with_symbol(text,text,numeric,jsonb)
 TO service_role;
