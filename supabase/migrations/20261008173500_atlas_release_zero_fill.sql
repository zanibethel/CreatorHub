-- Atlas reservation release requires a broker-confirmed terminal no-fill outcome.
CREATE OR REPLACE FUNCTION public.paper_atlas_release(p_reservation_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_changed integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required';
  END IF;
  PERFORM 1 FROM public.paper_bot_ledgers WHERE bot_id='default-diverse' FOR UPDATE;
  IF NOT EXISTS (
    SELECT 1
    FROM public.paper_bot_orders o
    JOIN public.paper_atlas_reservations r
      ON r.reservation_id=p_reservation_id
     AND r.client_order_id=o.client_order_id
    WHERE r.bot_id='default-diverse'
      AND r.status='reserved'
      AND o.bot_id='default-diverse'
      AND o.strategy_id='paper-medium-high-v1'
      AND o.strategy_version=1
      AND o.side='buy'
      AND o.pool_id=r.pool
      AND o.status IN ('canceled','rejected','expired')
      AND o.broker_order_id IS NOT NULL
      AND o.last_reconciled_at IS NOT NULL
      AND coalesce(nullif(o.metadata->>'filledQuantityObserved','')::numeric,-1)=0
      AND o.metadata->>'atlasReservationId'=r.reservation_id::text
      AND o.metadata->>'decisionId'=r.decision_id
      AND o.metadata->>'opportunityId'=r.opportunity_id
      AND NOT EXISTS (
        SELECT 1 FROM public.paper_bot_broker_fills f
         WHERE f.bot_id='default-diverse'
           AND f.broker_order_id=o.broker_order_id
           AND f.side='buy'
           AND coalesce(f.quantity,0)>0
      )
  ) THEN RETURN false; END IF;
  UPDATE public.paper_atlas_reservations
     SET status='released',updated_at=now()
   WHERE reservation_id=p_reservation_id
     AND bot_id='default-diverse'
     AND status='reserved'
     AND client_order_id IS NOT NULL;
  GET DIAGNOSTICS v_changed=ROW_COUNT;
  RETURN v_changed=1;
END $$;
REVOKE ALL ON FUNCTION public.paper_atlas_release(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.paper_atlas_release(uuid) TO service_role;
