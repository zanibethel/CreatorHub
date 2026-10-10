-- BigOrders Step 4: atomic, service-only SHADOW challenge management.
-- No broker execution, no orders, no legacy scenario/account changes.
-- Legacy $100 bot ledgers are never capital authority for new challenges.

-- An immutable receipt reconciles already-existing append-only funding events
-- with atomic capital postings. recorded-unposted means "unposted unless receipt exists".
CREATE TABLE IF NOT EXISTS public.paper_challenge_funding_postings (
  challenge_id text NOT NULL,
  event_key text NOT NULL,
  account_version_before bigint NOT NULL CHECK (account_version_before>0),
  account_version_after bigint NOT NULL CHECK (account_version_after=account_version_before+1),
  amount_delta numeric(18,6) NOT NULL CHECK (amount_delta<>0),
  equity_after numeric(18,6) NOT NULL CHECK (equity_after>0),
  cash_after numeric(18,6) NOT NULL CHECK (cash_after>=0),
  posted_at timestamptz NOT NULL DEFAULT now(),
  paper_only boolean NOT NULL DEFAULT true CHECK (paper_only=true),
  broker_order_authorized boolean NOT NULL DEFAULT false CHECK (broker_order_authorized=false),
  PRIMARY KEY(challenge_id,event_key),
  FOREIGN KEY(challenge_id,event_key)
    REFERENCES public.paper_challenge_funding_events(challenge_id,event_key)
    ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS paper_challenge_funding_postings_timeline_idx
  ON public.paper_challenge_funding_postings(challenge_id,posted_at DESC);
CREATE TRIGGER paper_challenge_postings_immutable
  BEFORE UPDATE OR DELETE ON public.paper_challenge_funding_postings
  FOR EACH ROW EXECUTE FUNCTION public.paper_challenge_refuse_journal_mutation();
ALTER TABLE public.paper_challenge_funding_postings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.paper_challenge_funding_postings FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.paper_challenge_funding_postings TO service_role;

-- Small audited write privilege surface, only for backend service_role.
-- Direct public REST/JWT clients have neither table grants nor RPC execution.
GRANT INSERT,UPDATE ON public.paper_challenges TO service_role;
GRANT INSERT,UPDATE ON public.paper_challenge_capital_accounts TO service_role;
GRANT INSERT,DELETE ON public.paper_challenge_bot_instances TO service_role;
GRANT INSERT,DELETE ON public.paper_challenge_research_contributors TO service_role;
GRANT INSERT ON public.paper_challenge_funding_events TO service_role;
GRANT USAGE,SELECT ON SEQUENCE public.paper_challenge_funding_events_event_id_seq TO service_role;

-- Canonical legacy-source identity lookup. NOT an authorization function.
CREATE OR REPLACE FUNCTION public.paper_challenge_strategy_identity(p_bot_id text)
RETURNS TABLE(strategy_id text,strategy_version integer,display_name text)
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=''
AS $body$
 SELECT v.strategy_id,v.strategy_version,v.display_name
 FROM (VALUES
  ('default-diverse','paper-medium-high-v1',1,'Atlas'),
  ('penny-volatility-day-100','penny-volatility-day-v1',1,'Fuse'),
  ('three-trade-weekly-swing-100','three-trade-weekly-swing-v1',1,'Harbor'),
  ('weekend-crypto-day-100','daily-crypto-day-v5',5,'Flash'),
  ('momentum-breakout-100','stock-momentum-breakout-v1',1,'Pulse'),
  ('crypto-ignition-100','crypto-ignition-v1',1,'Spark'),
  ('crypto-swing-100','crypto-swing-v1',1,'Orbit'),
  ('squeeze-breakout-100','squeeze-breakout-v1',1,'Coil')
 ) AS v(legacy_bot_id,strategy_id,strategy_version,display_name)
 WHERE v.legacy_bot_id=p_bot_id;
$body$;

-- The only supported input is an array of
-- {"botInstanceId":"spark-01","legacyBotId":"crypto-ignition-100"}.
-- The strategy catalog and FK bind every instance to a recognized strategy.
CREATE OR REPLACE FUNCTION public.paper_challenge_set_shadow_participants(
  p_challenge_id text,p_bots jsonb,p_research text[],p_replace boolean
) RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $body$
DECLARE v_bot jsonb;v_instance text;v_source text;v_strategy record;v_count integer:=0;
  v_research text;v_distinct integer;
BEGIN
 IF p_bots IS NULL OR jsonb_typeof(p_bots)<>'array'
    OR jsonb_array_length(p_bots) NOT BETWEEN 1 AND 16
    OR pg_column_size(p_bots)>8000 THEN RAISE EXCEPTION 'Invalid bot instances.';END IF;
 IF p_research IS NULL OR array_length(p_research,1)>2 THEN
    RAISE EXCEPTION 'Invalid research contributors.';END IF;
 IF EXISTS(SELECT 1 FROM unnest(p_research) x
           WHERE x IS NULL OR x NOT IN ('catalog','midas'))
    OR (SELECT count(DISTINCT x) FROM unnest(p_research) x)<>coalesce(array_length(p_research,1),0)
 THEN RAISE EXCEPTION 'Unknown or duplicate research contributors.';END IF;
 -- Only safe when no proposal/journal references exist; callers also lock the
 -- capital row first to serialize with funding and lifecycle state changes.
 IF p_replace THEN
   IF EXISTS(SELECT 1 FROM public.paper_challenge_proposal_journal
             WHERE challenge_id=p_challenge_id)
     THEN RAISE EXCEPTION 'Challenge strategy history exists; refuse participant rewrite.';END IF;
   DELETE FROM public.paper_challenge_bot_instances
    WHERE challenge_id=p_challenge_id;
   DELETE FROM public.paper_challenge_research_contributors
    WHERE challenge_id=p_challenge_id;
 END IF;
 FOR v_bot IN SELECT value FROM jsonb_array_elements(p_bots) LOOP
   IF jsonb_typeof(v_bot)<>'object' OR
     v_bot - 'botInstanceId' - 'legacyBotId' <> '{}'::jsonb THEN
      RAISE EXCEPTION 'Unrecognized bot instance fields.';END IF;
   v_instance:=v_bot->>'botInstanceId';v_source:=v_bot->>'legacyBotId';
   IF v_instance IS NULL OR v_instance !~ '^[a-z0-9][a-z0-9_-]{1,95}$'
      THEN RAISE EXCEPTION 'Invalid bot instance identifier.';END IF;
   SELECT * INTO v_strategy
     FROM public.paper_challenge_strategy_identity(v_source);
   IF NOT FOUND THEN RAISE EXCEPTION 'Unknown bot strategy source.';END IF;
   IF NOT EXISTS(SELECT 1 FROM public.paper_bot_ledgers WHERE bot_id=v_source)
     THEN RAISE EXCEPTION 'Legacy strategy identity not registered.';END IF;
   INSERT INTO public.paper_challenge_bot_instances
    (challenge_id,bot_instance_id,legacy_source_bot_id,strategy_id,
     strategy_version,display_name,role,lifecycle,execution_enabled)
    VALUES(p_challenge_id,v_instance,v_source,v_strategy.strategy_id,
      v_strategy.strategy_version,v_strategy.display_name,'trading','preview',false);
   v_count:=v_count+1;
 END LOOP;
 FOREACH v_research IN ARRAY p_research LOOP
   INSERT INTO public.paper_challenge_research_contributors
    (challenge_id,contributor_id,role,can_submit_orders)
    VALUES(p_challenge_id,v_research,'research',false);
 END LOOP;
 RETURN v_count;
END;
$body$;

CREATE OR REPLACE FUNCTION public.paper_challenge_create_shadow(
 p_id text,p_name text,p_starting_usd numeric,p_bots jsonb,
 p_research text[] DEFAULT ARRAY[]::text[],
 p_policy_id text DEFAULT 'shared-paper-capital-v1'
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $body$
DECLARE v_count integer;
BEGIN
 IF p_id IS NULL OR p_id !~ '^[a-z0-9][a-z0-9_-]{1,95}$'
   OR p_id IN ('shared-paper-v1','legacy-paper-100-v1')
   OR p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 1 AND 120
   OR p_policy_id <> 'shared-paper-capital-v1'
   OR p_starting_usd IS NULL OR p_starting_usd<=0 OR p_starting_usd>1000000
   OR p_starting_usd<>round(p_starting_usd,2)
   THEN RAISE EXCEPTION 'Invalid shadow challenge configuration.';END IF;
 IF EXISTS(SELECT 1 FROM public.paper_shared_portfolio_scenarios WHERE scenario_id=p_id)
   THEN RAISE EXCEPTION 'Cannot duplicate or replace an existing scenario.';END IF;
 INSERT INTO public.paper_challenges(challenge_id,display_name,legacy_scenario_id,
  policy_id,lifecycle,starting_capital,paper_only,broker_execution_enabled,broker_account_ref,metadata)
 VALUES(p_id,btrim(p_name),NULL,p_policy_id,'preview',p_starting_usd,true,false,NULL,
   '{"source":"shadow-challenge-create-v1","brokerIsolationVerified":false}'::jsonb);
 INSERT INTO public.paper_challenge_capital_accounts
   (challenge_id,source_kind,source_scenario_id,starting_capital,cash,
    settled_cash,buying_power,equity,reserved_cash,version,observation_only,broker_execution_enabled)
 VALUES(p_id,'standalone-shadow',NULL,p_starting_usd,p_starting_usd,
   p_starting_usd,p_starting_usd,p_starting_usd,0,1,true,false);
 v_count:=public.paper_challenge_set_shadow_participants(p_id,p_bots,p_research,false);
 RETURN jsonb_build_object('challengeId',p_id,'startingCapitalUsd',p_starting_usd,
  'accountVersion',1,'participantCount',v_count,'paperOnly',true,
  'brokerOrderAuthorized',false,'observationOnly',true);
END;
$body$;

CREATE OR REPLACE FUNCTION public.paper_challenge_configure_shadow(
 p_id text,p_expected_version bigint,p_lifecycle text,p_bots jsonb,p_research text[]
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $body$
DECLARE v_c public.paper_challenges%ROWTYPE;
 v_a public.paper_challenge_capital_accounts%ROWTYPE;v_count integer;
BEGIN
 IF p_id IS NULL OR p_expected_version IS NULL OR p_expected_version<1
   OR p_lifecycle NOT IN ('preview','paused','archived')
   THEN RAISE EXCEPTION 'Invalid challenge lifecycle request.';END IF;
 SELECT * INTO v_c FROM public.paper_challenges WHERE challenge_id=p_id FOR UPDATE;
 SELECT * INTO v_a FROM public.paper_challenge_capital_accounts WHERE challenge_id=p_id FOR UPDATE;
 IF NOT FOUND OR v_c.legacy_scenario_id IS NOT NULL OR v_c.broker_execution_enabled
   OR v_c.lifecycle='archived' OR v_a.source_kind<>'standalone-shadow'
   OR v_a.broker_execution_enabled OR NOT v_a.observation_only
   OR v_a.version<>p_expected_version
   THEN RAISE EXCEPTION 'Challenge cannot be configured or version is stale.';END IF;
 IF p_lifecycle='archived' AND EXISTS(
    SELECT 1 FROM public.paper_challenge_proposal_journal WHERE challenge_id=p_id)
   THEN RAISE EXCEPTION 'Cannot archive challenge with recorded strategy decisions.';END IF;
 IF p_lifecycle <> 'archived' THEN
    v_count:=public.paper_challenge_set_shadow_participants(p_id,p_bots,p_research,true);
 ELSE
    v_count:=(SELECT count(*) FROM public.paper_challenge_bot_instances WHERE challenge_id=p_id);
 END IF;
 UPDATE public.paper_challenges SET lifecycle=p_lifecycle,updated_at=now()
  WHERE challenge_id=p_id;
 UPDATE public.paper_challenge_capital_accounts
  SET version=version+1,last_snapshot_at=now()
  WHERE challenge_id=p_id;
 RETURN jsonb_build_object('challengeId',p_id,'lifecycle',p_lifecycle,
   'accountVersion',p_expected_version+1,'participantCount',v_count,
   'brokerOrderAuthorized',false,'paperOnly',true);
END;
$body$;

CREATE OR REPLACE FUNCTION public.paper_challenge_post_shadow_funding(
 p_id text,p_expected_version bigint,p_event_key text,
 p_delta numeric,p_reason text,p_evidence jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $body$
DECLARE v_c public.paper_challenges%ROWTYPE;
 v_a public.paper_challenge_capital_accounts%ROWTYPE;
 v_old public.paper_challenge_funding_events%ROWTYPE;
 v_receipt public.paper_challenge_funding_postings%ROWTYPE;
 v_cash numeric;v_equity numeric;
BEGIN
 IF p_id IS NULL OR p_expected_version IS NULL OR p_expected_version<1
    OR p_event_key IS NULL OR length(p_event_key) NOT BETWEEN 2 AND 160
    OR p_event_key !~ '^[a-zA-Z0-9:_-]+$'
    OR p_delta IS NULL OR p_delta=0 OR abs(p_delta)>1000000
    OR p_delta<>round(p_delta,2)
    OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 4 AND 500
    OR p_evidence IS NULL OR jsonb_typeof(p_evidence)<>'object'
    OR pg_column_size(p_evidence)>4000
 THEN RAISE EXCEPTION 'Invalid shadow funding instruction.';END IF;
 SELECT * INTO v_c FROM public.paper_challenges WHERE challenge_id=p_id FOR UPDATE;
 SELECT * INTO v_a FROM public.paper_challenge_capital_accounts WHERE challenge_id=p_id FOR UPDATE;
 IF NOT FOUND OR v_c.legacy_scenario_id IS NOT NULL OR v_c.lifecycle='archived'
    OR v_c.broker_execution_enabled OR NOT v_c.paper_only
    OR v_a.source_kind<>'standalone-shadow' OR v_a.source_scenario_id IS NOT NULL
    OR v_a.broker_execution_enabled OR NOT v_a.observation_only
    OR v_a.reserved_cash<>0
 THEN RAISE EXCEPTION 'Funding is forbidden for linked or unsafe challenge.';END IF;
 -- Idempotent retry returns the original receipt, even after later events.
 SELECT * INTO v_old FROM public.paper_challenge_funding_events
  WHERE challenge_id=p_id AND event_key=p_event_key;
 IF FOUND THEN
   SELECT * INTO v_receipt FROM public.paper_challenge_funding_postings
    WHERE challenge_id=p_id AND event_key=p_event_key;
   IF v_old.amount_delta<>p_delta OR v_old.reason<>btrim(p_reason)
      OR v_old.evidence<>p_evidence OR v_receipt.event_key IS NULL
     THEN RAISE EXCEPTION 'Conflicting or incomplete duplicate funding event.';END IF;
   RETURN jsonb_build_object('challengeId',p_id,'eventKey',p_event_key,
     'posted',true,'idempotentReplay',true,'accountVersion',v_receipt.account_version_after,
     'cashAfterUsd',v_receipt.cash_after,'equityAfterUsd',v_receipt.equity_after,
     'brokerOrderAuthorized',false);
 END IF;
 IF v_a.version<>p_expected_version THEN
    RAISE EXCEPTION 'Stale challenge capital account version.';END IF;
 v_cash:=v_a.cash+p_delta;v_equity:=v_a.equity+p_delta;
 IF v_cash<0 OR v_equity<=0 OR v_a.settled_cash+p_delta<0
    OR v_a.buying_power+p_delta<0
 THEN RAISE EXCEPTION 'Insufficient shadow balance for withdrawal.';END IF;
 INSERT INTO public.paper_challenge_funding_events
  (challenge_id,event_key,event_type,amount_delta,effective_at,reason,evidence,
   posting_state,paper_only,broker_order_authorized)
 VALUES(p_id,p_event_key,CASE WHEN p_delta>0 THEN 'deposit' ELSE 'withdrawal' END,
    p_delta,now(),btrim(p_reason),p_evidence,'recorded-unposted',true,false);
 UPDATE public.paper_challenge_capital_accounts
  SET cash=v_cash,equity=v_equity,settled_cash=settled_cash+p_delta,
      buying_power=buying_power+p_delta,version=version+1,last_snapshot_at=now()
  WHERE challenge_id=p_id;
 INSERT INTO public.paper_challenge_funding_postings
  (challenge_id,event_key,account_version_before,account_version_after,
   amount_delta,cash_after,equity_after,paper_only,broker_order_authorized)
 VALUES(p_id,p_event_key,p_expected_version,p_expected_version+1,
     p_delta,v_cash,v_equity,true,false);
 RETURN jsonb_build_object('challengeId',p_id,'eventKey',p_event_key,
  'posted',true,'idempotentReplay',false,'accountVersion',p_expected_version+1,
  'cashAfterUsd',v_cash,'equityAfterUsd',v_equity,'brokerOrderAuthorized',false);
END;
$body$;

-- Nothing in these functions may be called via the public Data API.
REVOKE ALL ON FUNCTION public.paper_challenge_strategy_identity(text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.paper_challenge_set_shadow_participants(text,jsonb,text[],boolean) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.paper_challenge_create_shadow(text,text,numeric,jsonb,text[],text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.paper_challenge_configure_shadow(text,bigint,text,jsonb,text[]) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.paper_challenge_post_shadow_funding(text,bigint,text,numeric,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.paper_challenge_strategy_identity(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.paper_challenge_set_shadow_participants(text,jsonb,text[],boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.paper_challenge_create_shadow(text,text,numeric,jsonb,text[],text) TO service_role;
GRANT EXECUTE ON FUNCTION public.paper_challenge_configure_shadow(text,bigint,text,jsonb,text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.paper_challenge_post_shadow_funding(text,bigint,text,numeric,text,jsonb) TO service_role;
