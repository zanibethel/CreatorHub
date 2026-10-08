-- Atlas v1 fractional equity execution is intraday-only.
-- Alpaca fractional equities accept simple DAY orders but reject advanced/bracket orders.
-- Keep the previous generic authorizer unavailable to application code and use this narrower RPC.

REVOKE EXECUTE ON FUNCTION public.paper_atlas_authorize_candidate(text,text,text,numeric,jsonb)
FROM service_role;

CREATE OR REPLACE FUNCTION public.paper_atlas_authorize_day_candidate(
  p_decision_id text,
  p_opportunity_id text,
  p_amount numeric,
  p_preflight jsonb)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=''
AS $$
DECLARE
  v_candidate public.paper_bot_journal%ROWTYPE;
  v_inserted integer;
  v_minutes numeric;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required';
  END IF;
  IF nullif(trim(p_decision_id),'') IS NULL
     OR nullif(trim(p_opportunity_id),'') IS NULL
     OR p_amount IS NULL OR p_amount<=0 OR p_amount>20
     OR jsonb_typeof(p_preflight) IS DISTINCT FROM 'object' THEN
    RETURN false;
  END IF;

  BEGIN
    v_minutes := nullif(p_preflight->>'minutesToClose','')::numeric;
  EXCEPTION WHEN others THEN
    RETURN false;
  END;

  SELECT * INTO v_candidate
    FROM public.paper_bot_journal
   WHERE bot_id='default-diverse'
     AND strategy_id='paper-medium-high-v1'
     AND strategy_version=1
     AND event_type='candidate'
     AND metadata->>'decisionId'=p_decision_id
   ORDER BY occurred_at DESC
   LIMIT 1;
  IF NOT FOUND THEN RETURN false; END IF;

  IF v_candidate.qualification<>'trade-ready'
     OR coalesce(v_candidate.score,0)<85
     OR v_candidate.blockers<>jsonb_build_array(
       'Current pool allocation capacity must be checked before order authorization.')
     OR v_candidate.metadata#>>'{inputProvenance,candidateSource}'<>'persisted-paper-watchlist'
     OR v_candidate.metadata#>>'{inputProvenance,opportunityId}'<>p_opportunity_id
     OR NOT (coalesce(v_candidate.metadata#>'{inputProvenance,approvedPools}','[]'::jsonb) ? 'day')
     OR v_candidate.occurred_at < now()-interval '6 minutes'
     OR coalesce((v_candidate.metadata#>>'{inputProvenance,quoteAt}')::timestamptz,'epoch'::timestamptz)
        < now()-interval '75 seconds'
     OR p_preflight->>'brokerAssetVerified'<>'true'
     OR p_preflight->>'marketSessionOpen'<>'true'
     OR p_preflight->>'quoteFresh'<>'true'
     OR p_preflight->>'sharedSymbolClear'<>'true'
     OR p_preflight->>'triggerReached'<>'true'
     OR p_preflight->>'noChase'<>'true'
     OR p_preflight->>'fractionalSimpleOnly'<>'true'
     OR p_preflight->>'executionMode'<>'atlas-fractional-day-v1'
     OR p_preflight->>'assetClass'<>'stock'
     OR p_preflight->>'symbol'<>v_candidate.symbol
     OR v_minutes IS NULL OR v_minutes<60 OR v_minutes>390 THEN
    RETURN false;
  END IF;

  INSERT INTO public.paper_bot_journal(
    bot_id,strategy_id,strategy_version,event_type,symbol,asset_class,occurred_at,
    score,qualification,regime,component_scores,market_snapshot,risk_plan,
    blockers,warnings,entry_price,exit_price,metadata)
  VALUES(
    'default-diverse','paper-medium-high-v1',1,'authorized',
    v_candidate.symbol,v_candidate.asset_class,now(),
    v_candidate.score,'trade-ready',v_candidate.regime,
    v_candidate.component_scores,v_candidate.market_snapshot,v_candidate.risk_plan,
    '[]'::jsonb,v_candidate.warnings,v_candidate.entry_price,v_candidate.exit_price,
    jsonb_build_object(
      'authorizedFromDecisionId',p_decision_id,
      'opportunityId',p_opportunity_id,
      'pool','day',
      'proposedNotional',p_amount,
      'orderAuthorization',true,
      'preflight',p_preflight,
      'source','atlas-fractional-day-preflight'))
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_inserted=ROW_COUNT;

  RETURN v_inserted=1 OR EXISTS(
    SELECT 1 FROM public.paper_bot_journal
     WHERE bot_id='default-diverse'
       AND event_type='authorized'
       AND metadata->>'authorizedFromDecisionId'=p_decision_id
       AND metadata->>'opportunityId'=p_opportunity_id
       AND metadata->>'pool'='day'
       AND metadata->>'orderAuthorization'='true'
       AND metadata->>'source'='atlas-fractional-day-preflight'
       AND occurred_at>=now()-interval '90 seconds'
       AND abs(coalesce(nullif(metadata->>'proposedNotional','')::numeric,-1)-p_amount)<0.01
  );
END $$;

REVOKE ALL ON FUNCTION public.paper_atlas_authorize_day_candidate(text,text,numeric,jsonb)
FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.paper_atlas_authorize_day_candidate(text,text,numeric,jsonb)
TO service_role;

-- A marketable DAY limit can partially fill before cancellation. That is real exposure.
-- Consume the reservation conservatively after a terminal partial fill; never release it.
CREATE OR REPLACE FUNCTION public.paper_atlas_consume_partial_terminal(
  p_reservation_id uuid,
  p_client_order_id text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=''
AS $$
DECLARE v_changed integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required';
  END IF;
  PERFORM 1 FROM public.paper_bot_ledgers
   WHERE bot_id='default-diverse' FOR UPDATE;

  IF NOT EXISTS(
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
       AND r.pool='day'
       AND r.client_order_id=p_client_order_id
       AND r.status='reserved'
       AND o.status='partially_filled'
       AND o.broker_order_id IS NOT NULL
       AND o.last_reconciled_at IS NOT NULL
       AND o.metadata->>'brokerObservedStatus' IN ('canceled','expired')
       AND coalesce(nullif(o.metadata->>'filledQuantityObserved','')::numeric,0)>0
       AND o.metadata->>'atlasReservationId'=r.reservation_id::text
       AND o.metadata->>'decisionId'=r.decision_id
       AND o.metadata->>'opportunityId'=r.opportunity_id
       AND coalesce(o.requested_notional,0)>0
       AND o.requested_notional<=r.amount
  ) THEN RETURN false; END IF;

  UPDATE public.paper_atlas_reservations
     SET status='consumed',updated_at=now()
   WHERE reservation_id=p_reservation_id
     AND bot_id='default-diverse'
     AND status='reserved'
     AND client_order_id=p_client_order_id;
  GET DIAGNOSTICS v_changed=ROW_COUNT;
  RETURN v_changed=1;
END $$;

REVOKE ALL ON FUNCTION public.paper_atlas_consume_partial_terminal(uuid,text)
FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.paper_atlas_consume_partial_terminal(uuid,text)
TO service_role;


-- Explicit venue rejection before an order exists is the only safe bound/no-broker release.
CREATE OR REPLACE FUNCTION public.paper_atlas_release_bound_rejection(
  p_reservation_id uuid,
  p_client_order_id text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=''
AS $$
DECLARE v_changed integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required';
  END IF;
  PERFORM 1 FROM public.paper_bot_ledgers
   WHERE bot_id='default-diverse' FOR UPDATE;

  IF NOT EXISTS(
    SELECT 1
      FROM public.paper_bot_orders o
      JOIN public.paper_atlas_reservations r
        ON r.reservation_id=p_reservation_id
     WHERE o.client_order_id=p_client_order_id
       AND o.bot_id='default-diverse'
       AND o.strategy_id='paper-medium-high-v1'
       AND o.strategy_version=1
       AND o.side='buy'
       AND o.pool_id='day'
       AND r.bot_id='default-diverse'
       AND r.pool='day'
       AND r.status='reserved'
       AND r.client_order_id=p_client_order_id
       AND o.status='rejected'
       AND o.broker_order_id IS NULL
       AND o.last_reconciled_at IS NOT NULL
       AND o.metadata->>'brokerSubmissionRejected'='true'
       AND o.metadata->>'brokerLookupConfirmedMissing'='true'
       AND o.metadata->>'atlasReservationId'=r.reservation_id::text
       AND o.metadata->>'decisionId'=r.decision_id
       AND o.metadata->>'opportunityId'=r.opportunity_id
  ) THEN RETURN false; END IF;

  UPDATE public.paper_atlas_reservations
     SET status='released',updated_at=now()
   WHERE reservation_id=p_reservation_id
     AND bot_id='default-diverse'
     AND status='reserved'
     AND client_order_id=p_client_order_id;
  GET DIAGNOSTICS v_changed=ROW_COUNT;
  RETURN v_changed=1;
END $$;

REVOKE ALL ON FUNCTION public.paper_atlas_release_bound_rejection(uuid,text)
FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.paper_atlas_release_bound_rejection(uuid,text)
TO service_role;
