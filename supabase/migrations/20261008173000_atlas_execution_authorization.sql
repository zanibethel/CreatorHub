-- Atlas execution authorization bridge.
-- Candidate evidence remains immutable. Authorization is a separate journal event.

CREATE UNIQUE INDEX IF NOT EXISTS paper_bot_journal_atlas_authorized_from_uidx
ON public.paper_bot_journal (bot_id, (metadata ->> 'authorizedFromDecisionId'))
WHERE bot_id='default-diverse' AND event_type='authorized'
  AND metadata ? 'authorizedFromDecisionId';

CREATE OR REPLACE FUNCTION public.paper_atlas_authorize_candidate(
  p_decision_id text,
  p_opportunity_id text,
  p_pool text,
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
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required';
  END IF;
  IF nullif(trim(p_decision_id),'') IS NULL
     OR nullif(trim(p_opportunity_id),'') IS NULL
     OR p_pool NOT IN ('day','multi-day','multi-week')
     OR p_amount IS NULL OR p_amount<=0 OR p_amount>100
     OR jsonb_typeof(p_preflight) IS DISTINCT FROM 'object' THEN
    RETURN false;
  END IF;

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
     OR NOT (coalesce(v_candidate.metadata#>'{inputProvenance,approvedPools}','[]'::jsonb) ? p_pool)
     OR v_candidate.occurred_at < now()-interval '6 minutes'
     OR coalesce((v_candidate.metadata#>>'{inputProvenance,quoteAt}')::timestamptz,'epoch'::timestamptz)
        < now()-interval '75 seconds'
     OR p_preflight->>'brokerAssetVerified'<>'true'
     OR p_preflight->>'marketSessionOpen'<>'true'
     OR p_preflight->>'quoteFresh'<>'true'
     OR p_preflight->>'sharedSymbolClear'<>'true'
     OR p_preflight->>'triggerReached'<>'true'
     OR p_preflight->>'noChase'<>'true'
     OR p_preflight->>'assetClass'<>'stock'
     OR p_preflight->>'symbol'<>v_candidate.symbol THEN
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
      'pool',p_pool,
      'proposedNotional',p_amount,
      'orderAuthorization',true,
      'preflight',p_preflight,
      'source','atlas-executable-preflight'))
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_inserted=ROW_COUNT;
  RETURN v_inserted=1 OR EXISTS(
    SELECT 1 FROM public.paper_bot_journal
     WHERE bot_id='default-diverse' AND event_type='authorized'
       AND metadata->>'authorizedFromDecisionId'=p_decision_id
       AND metadata->>'opportunityId'=p_opportunity_id
       AND metadata->>'pool'=p_pool
       AND metadata->>'orderAuthorization'='true');
END $$;

REVOKE ALL ON FUNCTION public.paper_atlas_authorize_candidate(text,text,text,numeric,jsonb)
FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.paper_atlas_authorize_candidate(text,text,text,numeric,jsonb)
TO service_role;

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
     WHERE bot_id='default-diverse'
       AND replace(symbol,'/','-')=replace(v_symbol,'/','-')
       AND quantity>0
  ) THEN
    RETURN jsonb_build_object('reserved',false,'reason','symbol-position-exists');
  END IF;

  v_pool_limit:=v_starting_cash*CASE p_pool
    WHEN 'day' THEN 0.20 WHEN 'multi-day' THEN 0.40 ELSE 0.40 END;

  SELECT coalesce(sum(greatest(market_value,0)),0) INTO v_pool_committed
    FROM public.paper_bot_positions
   WHERE bot_id='default-diverse' AND pool_id=p_pool;

  SELECT count(*) INTO v_pending
    FROM public.paper_bot_orders
   WHERE bot_id='default-diverse'
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

  RETURN jsonb_build_object(
    'reserved',true,'reservationId',v_id,'symbol',v_symbol);
END $$;

REVOKE ALL ON FUNCTION public.paper_atlas_reserve(text,text,text,numeric,text)
FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.paper_atlas_reserve(text,text,text,numeric,text)
TO service_role;


-- Safe recovery for an application failure before any order is linked or submitted.
CREATE OR REPLACE FUNCTION public.paper_atlas_abandon_unbound(p_reservation_id uuid)
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
    SELECT 1 FROM public.paper_atlas_reservations r
     WHERE r.reservation_id=p_reservation_id
       AND r.bot_id='default-diverse'
       AND r.status='reserved'
       AND r.client_order_id IS NULL
       AND NOT EXISTS(
         SELECT 1 FROM public.paper_bot_orders o
          WHERE o.bot_id='default-diverse'
            AND o.metadata->>'atlasReservationId'=r.reservation_id::text
       )
  ) THEN RETURN false; END IF;
  UPDATE public.paper_atlas_reservations
     SET status='released',updated_at=now()
   WHERE reservation_id=p_reservation_id
     AND bot_id='default-diverse'
     AND status='reserved'
     AND client_order_id IS NULL;
  GET DIAGNOSTICS v_changed=ROW_COUNT;
  RETURN v_changed=1;
END $$;

REVOKE ALL ON FUNCTION public.paper_atlas_abandon_unbound(uuid)
FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.paper_atlas_abandon_unbound(uuid)
TO service_role;
