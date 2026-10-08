-- Atlas fractional DAY v2 hardening.
-- One Atlas position at a time and reservation settlement only after the
-- matching broker fill has been applied to Atlas's virtual ledger.

CREATE OR REPLACE FUNCTION public.paper_atlas_reserve(
  p_decision_id text,p_opportunity_id text,p_pool text,p_amount numeric,
  p_expected_bot text DEFAULT 'default-diverse')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=''
AS $$
DECLARE
  v_cash numeric; v_starting_cash numeric; v_pool_limit numeric;
  v_pool_committed numeric; v_pending numeric; v_reserved numeric;
  v_pool_reserved numeric; v_id uuid; v_symbol text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required';
  END IF;
  IF nullif(trim(p_decision_id),'') IS NULL OR nullif(trim(p_opportunity_id),'') IS NULL
     OR p_pool NOT IN ('day','multi-day','multi-week')
     OR p_amount IS NULL OR p_amount<=0 OR p_amount>100
     OR p_expected_bot<>'default-diverse' THEN
    RETURN jsonb_build_object('reserved',false,'reason','invalid-request');
  END IF;

  SELECT symbol INTO v_symbol
    FROM public.paper_bot_journal
   WHERE bot_id='default-diverse'
     AND strategy_id='paper-medium-high-v1'
     AND strategy_version=1
     AND event_type='authorized'
     AND metadata->>'authorizedFromDecisionId'=p_decision_id
     AND metadata->>'opportunityId'=p_opportunity_id
     AND metadata->>'pool'=p_pool
     AND metadata->>'orderAuthorization'='true'
     AND qualification='trade-ready'
     AND blockers='[]'::jsonb
     AND occurred_at>=now()-interval '90 seconds'
     AND abs(coalesce(nullif(metadata->>'proposedNotional','')::numeric,-1)-p_amount)<0.01
   ORDER BY occurred_at DESC
   LIMIT 1;
  IF v_symbol IS NULL THEN
    RETURN jsonb_build_object('reserved',false,'reason','decision-not-authorized');
  END IF;

  SELECT cash,starting_cash INTO v_cash,v_starting_cash
    FROM public.paper_bot_ledgers
   WHERE bot_id='default-diverse'
   FOR UPDATE;
  IF NOT FOUND OR v_cash IS NULL OR v_cash<0 OR v_starting_cash IS NULL OR v_starting_cash<=0 THEN
    RETURN jsonb_build_object('reserved',false,'reason','ledger-unavailable');
  END IF;

  SELECT reservation_id INTO v_id
    FROM public.paper_atlas_reservations
   WHERE bot_id='default-diverse' AND decision_id=p_decision_id
     AND opportunity_id=p_opportunity_id AND strategy_version=1;
  IF FOUND THEN
    RETURN jsonb_build_object('reserved',false,'reason','duplicate','reservationId',v_id);
  END IF;

  IF EXISTS(
    SELECT 1 FROM public.paper_bot_positions
     WHERE bot_id='default-diverse' AND quantity>0
  ) THEN
    RETURN jsonb_build_object('reserved',false,'reason','open-position-exists');
  END IF;

  v_pool_limit:=v_starting_cash*CASE p_pool
    WHEN 'day' THEN 0.20 WHEN 'multi-day' THEN 0.40 ELSE 0.40 END;

  SELECT coalesce(sum(greatest(market_value,0)),0) INTO v_pool_committed
    FROM public.paper_bot_positions
   WHERE bot_id='default-diverse' AND pool_id=p_pool;

  SELECT count(*) INTO v_pending
    FROM public.paper_bot_orders
   WHERE bot_id='default-diverse'
     AND side='buy'
     AND status IN ('prepared','submitted','partially_filled');
  IF v_pending>0 THEN
    RETURN jsonb_build_object('reserved',false,'reason','unresolved-orders');
  END IF;

  SELECT coalesce(sum(amount),0),
         coalesce(sum(amount) FILTER (WHERE pool=p_pool),0)
    INTO v_reserved,v_pool_reserved
    FROM public.paper_atlas_reservations
   WHERE bot_id='default-diverse' AND status='reserved';

  IF v_cash-v_reserved<p_amount
     OR v_pool_committed+v_pool_reserved+p_amount>v_pool_limit THEN
    RETURN jsonb_build_object('reserved',false,'reason','insufficient-capacity');
  END IF;

  INSERT INTO public.paper_atlas_reservations(decision_id,opportunity_id,pool,amount)
  VALUES(p_decision_id,p_opportunity_id,p_pool,p_amount)
  RETURNING reservation_id INTO v_id;

  RETURN jsonb_build_object('reserved',true,'reservationId',v_id,'symbol',v_symbol);
END $$;

REVOKE ALL ON FUNCTION public.paper_atlas_reserve(text,text,text,numeric,text)
FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.paper_atlas_reserve(text,text,text,numeric,text)
TO service_role;

CREATE OR REPLACE FUNCTION public.paper_atlas_consume(
  p_reservation_id uuid,p_client_order_id text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=''
AS $$
DECLARE
  v_changed integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required';
  END IF;

  PERFORM 1 FROM public.paper_bot_ledgers
   WHERE bot_id='default-diverse'
   FOR UPDATE;

  IF NOT EXISTS (
    SELECT 1
      FROM public.paper_bot_orders o
      JOIN public.paper_atlas_reservations r
        ON r.reservation_id=p_reservation_id
     WHERE o.client_order_id=p_client_order_id
       AND o.bot_id='default-diverse'
       AND o.strategy_id='paper-medium-high-v1'
       AND o.strategy_version=1
       AND o.side='buy'
       AND o.pool_id=r.pool
       AND r.client_order_id=p_client_order_id
       AND o.broker_order_id IS NOT NULL
       AND o.last_reconciled_at IS NOT NULL
       AND o.metadata->>'atlasReservationId'=r.reservation_id::text
       AND o.metadata->>'decisionId'=r.decision_id
       AND o.metadata->>'opportunityId'=r.opportunity_id
       AND o.status IN ('filled','canceled','expired')
       AND coalesce(nullif(o.metadata->>'filledQuantityObserved','')::numeric,0)>0
       AND coalesce(o.requested_notional,0)>0
       AND o.requested_notional<=r.amount
       AND NOT EXISTS (
         SELECT 1
           FROM public.paper_bot_broker_fills pending
          WHERE pending.bot_id='default-diverse'
            AND pending.broker_order_id=o.broker_order_id
            AND pending.side='buy'
            AND pending.ledger_applied_at IS NULL
       )
       AND EXISTS (
         SELECT 1
           FROM public.paper_bot_broker_fills applied
          WHERE applied.bot_id='default-diverse'
            AND applied.broker_order_id=o.broker_order_id
            AND applied.side='buy'
            AND applied.ledger_applied_at IS NOT NULL
          GROUP BY applied.broker_order_id
         HAVING max(coalesce(applied.cumulative_quantity,applied.quantity,0))
                >= coalesce(nullif(o.metadata->>'filledQuantityObserved','')::numeric,0)-0.000000001
       )
  ) THEN
    RETURN false;
  END IF;

  UPDATE public.paper_atlas_reservations
     SET status='consumed',client_order_id=p_client_order_id,updated_at=now()
   WHERE reservation_id=p_reservation_id
     AND bot_id='default-diverse'
     AND status='reserved';

  GET DIAGNOSTICS v_changed=ROW_COUNT;
  RETURN v_changed=1;
END $$;

REVOKE ALL ON FUNCTION public.paper_atlas_consume(uuid,text)
FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.paper_atlas_consume(uuid,text)
TO service_role;
