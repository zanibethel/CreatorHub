-- Atlas v4: allow the existing authorization bridge to validate both stock and crypto candidates.
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
  IF current_setting('request.jwt.claim.role',true) IS DISTINCT FROM 'service_role' THEN
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

  IF v_candidate.asset_class NOT IN ('stock','crypto')
     OR v_candidate.qualification<>'trade-ready'
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
     OR p_preflight->>'assetClass'<>v_candidate.asset_class
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
     WHERE bot_id='default-diverse'
       AND event_type='authorized'
       AND metadata->>'authorizedFromDecisionId'=p_decision_id
       AND metadata->>'opportunityId'=p_opportunity_id
       AND metadata->>'pool'=p_pool
       AND metadata->>'orderAuthorization'='true');
END $$;

REVOKE ALL ON FUNCTION public.paper_atlas_authorize_candidate(text,text,text,numeric,jsonb)
FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.paper_atlas_authorize_candidate(text,text,text,numeric,jsonb)
TO service_role;

UPDATE public.paper_bot_ledgers
SET metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
  'executionEnabled',true,
  'liveMoneyEnabled',false,
  'atlasExecutionMode','multi-asset-v4',
  'cryptoExecutionEnabled',true,
  'cryptoProtectionMode','gtc-stop-limit',
  'cryptoEstimatedFeeBpsPerSide',25
), updated_at=now()
WHERE bot_id='default-diverse';
