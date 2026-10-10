-- BigOrders Step 6: provenance-linked, challenge/instance-scoped SHADOW observations.
-- Replays selected legacy STRATEGY RESEARCH JOURNAL evidence only.
-- It does not rerun source evaluators, certify a new challenge signal, simulate fills,
-- create exposure, change virtual cash, or authorize Alpaca PAPER trading.
CREATE TABLE IF NOT EXISTS public.paper_challenge_source_observations (
 challenge_id text NOT NULL REFERENCES public.paper_challenges(challenge_id) ON DELETE RESTRICT,
 bot_instance_id text NOT NULL CHECK (bot_instance_id ~ '^[a-z0-9][a-z0-9_-]{1,95}$'),
 source_journal_id bigint NOT NULL REFERENCES public.paper_bot_journal(id) ON DELETE RESTRICT,
 legacy_bot_id text NOT NULL REFERENCES public.paper_bot_ledgers(bot_id) ON DELETE RESTRICT,
 strategy_id text NOT NULL,
 strategy_version integer NOT NULL CHECK(strategy_version>0),
 source_event_type text NOT NULL CHECK(source_event_type IN ('candidate','rejected','scanner_assigned')),
 source_qualification text CHECK(source_qualification IN ('unqualified','watch','qualified','trade-ready')),
 source_symbol text NOT NULL CHECK(length(source_symbol) BETWEEN 1 AND 32),
 asset_class text CHECK(asset_class IN ('stock','etf','crypto','unknown')),
 source_occurred_at timestamptz NOT NULL,
 projected_at timestamptz NOT NULL DEFAULT now(),
 capital_source text NOT NULL CHECK (capital_source IN ('linked-scenario','standalone-shadow')),
 capital_equity_snapshot numeric(18,6) NOT NULL CHECK (capital_equity_snapshot>0),
 capital_version_snapshot bigint CHECK(capital_version_snapshot>0),
 reference_risk_plan jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(reference_risk_plan)='object'),
 reference_metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(reference_metadata)='object'),
 attribution_kind text NOT NULL DEFAULT 'legacy-research-replay' CHECK(attribution_kind='legacy-research-replay'),
 challenge_strategy_revalidated boolean NOT NULL DEFAULT false CHECK(challenge_strategy_revalidated=false),
 validated_quote_available boolean NOT NULL DEFAULT false CHECK(validated_quote_available=false),
 simulated_fill_verified boolean NOT NULL DEFAULT false CHECK(simulated_fill_verified=false),
 hypothetical_pl_usd numeric(18,6) CHECK(hypothetical_pl_usd IS NULL),
 paper_only boolean NOT NULL DEFAULT true CHECK(paper_only=true),
 broker_order_authorized boolean NOT NULL DEFAULT false CHECK(broker_order_authorized=false),
 PRIMARY KEY(challenge_id,bot_instance_id,source_journal_id)
);
CREATE INDEX IF NOT EXISTS paper_challenge_source_obs_timeline_idx
 ON public.paper_challenge_source_observations(challenge_id,source_occurred_at DESC);
CREATE INDEX IF NOT EXISTS paper_challenge_source_obs_instance_idx
 ON public.paper_challenge_source_observations(challenge_id,bot_instance_id,source_occurred_at DESC);
CREATE TRIGGER paper_challenge_source_observations_immutable
 BEFORE UPDATE OR DELETE ON public.paper_challenge_source_observations
 FOR EACH ROW EXECUTE FUNCTION public.paper_challenge_refuse_journal_mutation();
ALTER TABLE public.paper_challenge_source_observations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.paper_challenge_source_observations FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON TABLE public.paper_challenge_source_observations TO service_role;

-- Service role only. The private legacy journal is the source of each row.
-- A user-supplied symbol, P/L, quote, or arbitrary source ID cannot be inserted.
CREATE OR REPLACE FUNCTION public.paper_challenge_sync_source_observations(
 p_challenge_id text,
 p_limit_per_instance integer DEFAULT 8
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $fn$
DECLARE
 v_challenge public.paper_challenges%ROWTYPE;
 v_equity numeric;
 v_source text;
 v_version bigint;
 v_inserted integer:=0;
 v_participants integer:=0;
 v_pending integer:=0;
 v_i record;
 v_added integer;
BEGIN
 IF p_challenge_id IS NULL OR p_challenge_id !~ '^[a-z0-9][a-z0-9_-]{1,95}$'
    OR p_limit_per_instance IS NULL OR p_limit_per_instance NOT BETWEEN 1 AND 15
 THEN RAISE EXCEPTION 'Invalid shadow observation sync scope.';END IF;
 SELECT * INTO v_challenge
 FROM public.paper_challenges
 WHERE challenge_id=p_challenge_id FOR UPDATE;
 IF NOT FOUND OR v_challenge.lifecycle<>'preview'
    OR NOT v_challenge.paper_only OR v_challenge.broker_execution_enabled
    OR v_challenge.broker_account_ref IS NOT NULL
 THEN RAISE EXCEPTION 'Only safe, broker-disabled preview challenges can ingest legacy research.';END IF;
 IF v_challenge.legacy_scenario_id IS NOT NULL THEN
   SELECT s.equity INTO v_equity
   FROM public.paper_shared_portfolio_scenarios s
   WHERE s.scenario_id=v_challenge.legacy_scenario_id AND s.state='preview'
     AND s.paper_only AND NOT s.broker_execution_enabled;
   v_source:='linked-scenario';
   SELECT version INTO v_version FROM public.paper_challenge_capital_accounts
     WHERE challenge_id=p_challenge_id AND source_kind='linked-scenario-mirror'
     AND observation_only=true AND NOT broker_execution_enabled;
 ELSE
   SELECT a.equity,a.version INTO v_equity,v_version
   FROM public.paper_challenge_capital_accounts a
   WHERE a.challenge_id=p_challenge_id AND a.source_kind='standalone-shadow'
     AND a.observation_only AND NOT a.broker_execution_enabled
     AND a.reserved_cash=0 FOR SHARE;
   v_source:='standalone-shadow';
 END IF;
 IF v_equity IS NULL OR v_equity<=0 OR v_version IS NULL
 THEN RAISE EXCEPTION 'Authoritative preview capital is unavailable.';END IF;
 FOR v_i IN
   SELECT i.bot_instance_id,i.legacy_source_bot_id,i.strategy_id,i.strategy_version,
     i.created_at
   FROM public.paper_challenge_bot_instances i
   WHERE i.challenge_id=p_challenge_id AND i.lifecycle='preview'
     AND i.role='trading' AND NOT i.execution_enabled
   ORDER BY i.bot_instance_id
 LOOP
  v_participants:=v_participants+1;
  IF v_i.legacy_source_bot_id IS NULL THEN
    RAISE EXCEPTION 'Unattributable instance source.';END IF;
  -- Take the most recent bounded source events, never a random caller payload.
  -- Source events BEFORE a challenge or participant existed are deliberately excluded.
  WITH recent AS (
   SELECT j.id,j.bot_id,j.strategy_id,j.strategy_version,j.event_type,
       j.qualification,j.symbol,j.asset_class,j.occurred_at,
       j.risk_plan,j.metadata
   FROM public.paper_bot_journal j
   WHERE j.bot_id=v_i.legacy_source_bot_id
     AND j.strategy_id=v_i.strategy_id AND j.strategy_version=v_i.strategy_version
     AND j.event_type IN ('candidate','rejected','scanner_assigned')
     AND j.symbol IS NOT NULL
     AND j.occurred_at>=GREATEST(v_challenge.created_at,v_i.created_at)
     AND j.occurred_at>=now()-interval '36 hours'
   ORDER BY j.occurred_at DESC,j.id DESC
   LIMIT p_limit_per_instance
  )
  INSERT INTO public.paper_challenge_source_observations
    (challenge_id,bot_instance_id,source_journal_id,legacy_bot_id,strategy_id,
     strategy_version,source_event_type,source_qualification,source_symbol,
     asset_class,source_occurred_at,capital_source,capital_equity_snapshot,
     capital_version_snapshot,reference_risk_plan,reference_metadata,
     challenge_strategy_revalidated,validated_quote_available,simulated_fill_verified,
     hypothetical_pl_usd,paper_only,broker_order_authorized)
  SELECT p_challenge_id,v_i.bot_instance_id,j.id,j.bot_id,j.strategy_id,
     j.strategy_version,j.event_type,j.qualification,j.symbol,j.asset_class,
     j.occurred_at,v_source,v_equity,v_version,
     jsonb_build_object('source', 'paper_bot_journal', 'riskPlan', j.risk_plan),
     jsonb_build_object('sourceEventType',j.event_type,
       'qualification',j.qualification,
       'sourceMetadata',jsonb_build_object('selectedForSubmission', j.metadata->'selectedForSubmission',
            'executionEligible',j.metadata->'executionEligible'),
       'provenance','legacy-only-not-challenge-revalidated'),
     false,false,false,NULL,true,false
  FROM recent j
  ON CONFLICT (challenge_id,bot_instance_id,source_journal_id) DO NOTHING;
  GET DIAGNOSTICS v_added=ROW_COUNT;
  v_inserted:=v_inserted+v_added;
 END LOOP;
 IF v_participants<1 OR v_participants>16
 THEN RAISE EXCEPTION 'Invalid challenge participation count.';END IF;
 RETURN jsonb_build_object('challengeId',p_challenge_id,'participantsScanned',v_participants,
    'newObservations',v_inserted,'perInstanceLimit',p_limit_per_instance,
    'paperOnly',true,'brokerOrderAuthorized',false,'sourceEvidenceOnly',true,
    'shadowFillsCreated',0,'challengeStrategyRevalidated',false);
END;
$fn$;
REVOKE ALL ON FUNCTION public.paper_challenge_sync_source_observations(text,integer)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.paper_challenge_sync_source_observations(text,integer)
 TO service_role;
