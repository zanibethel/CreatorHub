-- Atlas paper-only audit; no broker, ledger, strategy or trade mutations.
ALTER TABLE public.paper_bot_journal DROP CONSTRAINT paper_bot_journal_event_type_check;
ALTER TABLE public.paper_bot_journal ADD CONSTRAINT paper_bot_journal_event_type_check
CHECK (event_type = ANY (ARRAY['candidate','rejected','authorized','submitted','filled','position_update','stop_update','partial_exit','closed','risk_event','system','canceled','expired','replaced','execution_error','scanner_observed','scanner_assigned']::text[]));

CREATE UNIQUE INDEX IF NOT EXISTS paper_bot_journal_atlas_decision_uidx
ON public.paper_bot_journal (bot_id, (metadata ->> 'decisionId'))
WHERE bot_id = 'default-diverse' AND metadata ? 'decisionId';

CREATE OR REPLACE FUNCTION public.paper_atlas_scanner_audit_observation()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_bucket timestamptz;
  v_opportunity text;
  v_stage text;
  v_received boolean;
BEGIN
  v_bucket := date_bin('5 minutes', NEW.scanned_at, '2020-01-01 00:00:00+00'::timestamptz);
  v_received := 'default-diverse' = ANY (NEW.suggested_bot_ids);
  SELECT concat_ws(':', 'scanner', NEW.scanner_id, NEW.asset_class, NEW.symbol, coalesce(p.first_seen_at::text, 'unknown'))
    INTO v_opportunity FROM public.paper_prospects p
   WHERE p.asset_class = NEW.asset_class AND p.symbol = NEW.symbol;
  v_opportunity := coalesce(v_opportunity, concat_ws(':','scanner', NEW.scanner_id, NEW.asset_class, NEW.symbol));
  FOR v_stage IN SELECT unnest(CASE WHEN v_received
    THEN ARRAY['scanner_observed','scanner_assigned']::text[]
    ELSE ARRAY['scanner_observed']::text[] END)
  LOOP
    INSERT INTO public.paper_bot_journal
      (bot_id, strategy_id, strategy_version, event_type, symbol, asset_class, occurred_at,
       component_scores, market_snapshot, risk_plan, blockers, warnings, metadata)
    VALUES
      ('default-diverse','paper-medium-high-v1',1,v_stage,NEW.symbol,NEW.asset_class,NEW.scanned_at,
       '{}'::jsonb,
       jsonb_build_object('scannerScore',NEW.score,'scannerComponents',NEW.score_components,
         'scannerReasons',NEW.reasons,'sourceFlags',NEW.source_flags,
         'marketPrice',NEW.price,'spreadPct',NEW.spread_pct,
         'volume',NEW.volume,'scannerStatus',NEW.status,'reviewEligible',NEW.bot_review_eligible),
       '{}'::jsonb,'[]'::jsonb,'[]'::jsonb,
       jsonb_build_object(
         'decisionId',md5(concat_ws('|','atlas-scanner-v1',v_stage,NEW.scanner_id,NEW.asset_class,NEW.symbol,v_bucket::text)),
         'correlationId',concat_ws(':','scan',NEW.scanner_id,NEW.asset_class,NEW.symbol,v_bucket::text),
         'opportunityId',v_opportunity,
         'scannerId',NEW.scanner_id,'scannerVersion',NEW.scanner_version,
         'scanBucketUtc',v_bucket,'sourceObservedAt',NEW.scanned_at,
         'sourceMetadata',NEW.metadata,'scannerSuggestedAtlas',v_received,
         'evidenceStage','scanner-only','orderAuthorization',false))
      ON CONFLICT DO NOTHING;
  END LOOP;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.paper_atlas_scanner_audit_observation() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.paper_atlas_scanner_audit_observation() TO service_role;
DROP TRIGGER IF EXISTS paper_atlas_scanner_observation_audit ON public.paper_prospect_observations;
CREATE TRIGGER paper_atlas_scanner_observation_audit
AFTER INSERT ON public.paper_prospect_observations
FOR EACH ROW EXECUTE FUNCTION public.paper_atlas_scanner_audit_observation();

-- Service-only insert for actual, read-only strategy evaluations; explicit stable id.
CREATE OR REPLACE FUNCTION public.paper_atlas_record_candidate(p_event jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_inserted int;
BEGIN
  IF jsonb_typeof(p_event) <> 'object'
    OR coalesce(length(p_event->>'decisionId'),0) NOT BETWEEN 16 AND 80
    OR p_event->>'strategyId' <> 'paper-medium-high-v1'
    OR coalesce((p_event->>'strategyVersion')::integer,0) <> 1
    OR p_event->>'source' <> 'atlas-read-only-evaluation'
    OR coalesce(length(p_event->>'symbol'),0) NOT BETWEEN 1 AND 32
    OR p_event->>'assetClass' NOT IN ('stock','crypto')
    OR jsonb_typeof(p_event->'components') <> 'object'
    OR jsonb_typeof(p_event->'blockers') <> 'array'
    OR jsonb_typeof(p_event->'warnings') <> 'array'
  THEN RAISE EXCEPTION 'Invalid Atlas audit event'; END IF;
  INSERT INTO public.paper_bot_journal
   (bot_id,strategy_id,strategy_version,event_type,symbol,asset_class,occurred_at,
    score,qualification,regime,component_scores,market_snapshot,risk_plan,blockers,warnings,entry_price,exit_price,metadata)
  VALUES
   ('default-diverse','paper-medium-high-v1',1,'candidate',p_event->>'symbol',p_event->>'assetClass',
    (p_event->>'evaluatedAt')::timestamptz,(p_event->>'score')::numeric,
    p_event->>'qualification',p_event->>'regime',p_event->'components',
    coalesce(p_event->'marketSnapshot','{}'::jsonb),coalesce(p_event->'riskPlan','{}'::jsonb),
    p_event->'blockers',p_event->'warnings',
    nullif(p_event->>'entryPrice','')::numeric,nullif(p_event->>'exitPrice','')::numeric,
    jsonb_build_object('decisionId',p_event->>'decisionId',
     'correlationId',p_event->>'correlationId','symbolSessionKey',p_event->>'symbolSessionKey',
     'source','atlas-read-only-evaluation','orderAuthorization',false,
     'referencePlan',coalesce(p_event->'referencePlan','{}'::jsonb),
     'inputProvenance',coalesce(p_event->'inputProvenance','{}'::jsonb),
     'scanBucketUtc',p_event->>'scanBucketUtc','dryRun',true,'evidenceStage','strategy-evaluated'))
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted > 0;
END $$;
REVOKE ALL ON FUNCTION public.paper_atlas_record_candidate(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.paper_atlas_record_candidate(jsonb) TO service_role;
