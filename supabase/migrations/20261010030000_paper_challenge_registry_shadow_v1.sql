-- Step 3: challenge-scoped PAPER observation ledger and instance registry.
-- Forward only. Historical paper_bot_* records and shared preview RPCs are untouched.
-- This migration DOES NOT add broker execution, allocate funds or submit orders.
CREATE TABLE IF NOT EXISTS public.paper_challenges (
  challenge_id text PRIMARY KEY CHECK (challenge_id ~ '^[a-z0-9][a-z0-9_-]{1,95}$'),
  display_name text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 120),
  legacy_scenario_id text UNIQUE REFERENCES public.paper_shared_portfolio_scenarios(scenario_id),
  policy_id text NOT NULL,
  lifecycle text NOT NULL DEFAULT 'preview' CHECK (lifecycle IN ('preview','paused','archived')),
  starting_capital numeric(18,6) NOT NULL CHECK (starting_capital > 0),
  currency text NOT NULL DEFAULT 'USD' CHECK (currency='USD'),
  paper_only boolean NOT NULL DEFAULT true CHECK (paper_only=true),
  broker_execution_enabled boolean NOT NULL DEFAULT false CHECK (broker_execution_enabled=false),
  broker_account_ref text CHECK (broker_account_ref IS NULL),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.paper_challenges IS
  'Challenge definitions; no independent broker rights or double spendable legacy balances.';

CREATE TABLE IF NOT EXISTS public.paper_challenge_bot_instances (
  challenge_id text NOT NULL REFERENCES public.paper_challenges(challenge_id) ON DELETE RESTRICT,
  bot_instance_id text NOT NULL CHECK (bot_instance_id ~ '^[a-z0-9][a-z0-9_-]{1,95}$'),
  legacy_source_bot_id text REFERENCES public.paper_bot_ledgers(bot_id) ON DELETE RESTRICT,
  strategy_id text NOT NULL CHECK (length(btrim(strategy_id)) BETWEEN 3 AND 100),
  strategy_version integer NOT NULL CHECK (strategy_version > 0),
  display_name text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 120),
  role text NOT NULL DEFAULT 'trading' CHECK (role='trading'),
  lifecycle text NOT NULL DEFAULT 'preview' CHECK (lifecycle IN ('preview','paused')),
  execution_enabled boolean NOT NULL DEFAULT false CHECK (execution_enabled=false),
  risk_overrides jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(risk_overrides)='object'),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (challenge_id,bot_instance_id)
);
CREATE INDEX IF NOT EXISTS paper_challenge_instances_strategy_idx
  ON public.paper_challenge_bot_instances (challenge_id,strategy_id,strategy_version);
COMMENT ON COLUMN public.paper_challenge_bot_instances.legacy_source_bot_id IS
  'Strategy provenance only. NEVER permission to use the linked $100 legacy ledger cash.';

CREATE TABLE IF NOT EXISTS public.paper_challenge_research_contributors (
  challenge_id text NOT NULL REFERENCES public.paper_challenges(challenge_id) ON DELETE RESTRICT,
  contributor_id text NOT NULL CHECK (contributor_id IN ('catalog','midas')),
  role text NOT NULL DEFAULT 'research' CHECK (role='research'),
  can_submit_orders boolean NOT NULL DEFAULT false CHECK (can_submit_orders=false),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (challenge_id,contributor_id)
);

-- Observation account is not an independent broker buying-power ledger.
-- Linked scenario remains authoritative. Never sum linked account + scenario cash.
CREATE TABLE IF NOT EXISTS public.paper_challenge_capital_accounts (
  challenge_id text PRIMARY KEY REFERENCES public.paper_challenges(challenge_id) ON DELETE RESTRICT,
  source_kind text NOT NULL CHECK (source_kind IN ('linked-scenario-mirror','standalone-shadow')),
  source_scenario_id text REFERENCES public.paper_shared_portfolio_scenarios(scenario_id),
  starting_capital numeric(18,6) NOT NULL CHECK (starting_capital>0),
  cash numeric(18,6) NOT NULL CHECK (cash>=0),
  settled_cash numeric(18,6) NOT NULL CHECK (settled_cash>=0),
  buying_power numeric(18,6) NOT NULL CHECK (buying_power>=0),
  equity numeric(18,6) NOT NULL CHECK (equity>0),
  reserved_cash numeric(18,6) NOT NULL DEFAULT 0 CHECK (reserved_cash>=0),
  version bigint NOT NULL DEFAULT 1 CHECK (version>0),
  observation_only boolean NOT NULL DEFAULT true CHECK (observation_only=true),
  broker_execution_enabled boolean NOT NULL DEFAULT false CHECK (broker_execution_enabled=false),
  last_snapshot_at timestamptz NOT NULL DEFAULT now(),
  CHECK (settled_cash<=cash AND reserved_cash<=cash),
  CHECK ((source_kind='linked-scenario-mirror' AND source_scenario_id IS NOT NULL) OR
         (source_kind='standalone-shadow' AND source_scenario_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS paper_challenge_account_source_scenario_idx
  ON public.paper_challenge_capital_accounts (source_scenario_id)
  WHERE source_scenario_id IS NOT NULL;

-- Dated, idempotent funding CHANGE RECORDS. Do not treat as posted funding:
-- applying funding requires a future separately audited atomic accounting path.
CREATE TABLE IF NOT EXISTS public.paper_challenge_funding_events (
  event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  challenge_id text NOT NULL REFERENCES public.paper_challenges(challenge_id) ON DELETE RESTRICT,
  event_key text NOT NULL CHECK (length(event_key) BETWEEN 2 AND 160),
  event_type text NOT NULL CHECK (event_type IN ('deposit','withdrawal','accounting-adjustment')),
  amount_delta numeric(18,6) NOT NULL CHECK (amount_delta<>0),
  effective_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 4 AND 500),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(evidence)='object'),
  posting_state text NOT NULL DEFAULT 'recorded-unposted' CHECK (posting_state='recorded-unposted'),
  paper_only boolean NOT NULL DEFAULT true CHECK (paper_only=true),
  broker_order_authorized boolean NOT NULL DEFAULT false CHECK (broker_order_authorized=false),
  UNIQUE (challenge_id,event_key),
  CHECK ((event_type='deposit' AND amount_delta>0) OR
         (event_type='withdrawal' AND amount_delta<0) OR
         (event_type='accounting-adjustment'))
);
CREATE INDEX IF NOT EXISTS paper_challenge_funding_timeline_idx
  ON public.paper_challenge_funding_events(challenge_id,effective_at DESC,event_id DESC);

-- No proposal/decision history may collide across a challenge/instance pair.
CREATE TABLE IF NOT EXISTS public.paper_challenge_proposal_journal (
  challenge_id text NOT NULL,
  bot_instance_id text NOT NULL,
  decision_key text NOT NULL CHECK (length(decision_key) BETWEEN 2 AND 240),
  legacy_source_bot_id text,
  strategy_id text NOT NULL,
  strategy_version integer NOT NULL CHECK (strategy_version>0),
  symbol text NOT NULL CHECK (length(symbol) BETWEEN 1 AND 32),
  observation_state text NOT NULL CHECK (observation_state IN
    ('reference','qualified-observation','blocked','insufficient-evidence')),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(evidence)='object'),
  observed_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  paper_only boolean NOT NULL DEFAULT true CHECK (paper_only=true),
  broker_order_authorized boolean NOT NULL DEFAULT false CHECK (broker_order_authorized=false),
  PRIMARY KEY (challenge_id,bot_instance_id,decision_key),
  FOREIGN KEY (challenge_id,bot_instance_id)
    REFERENCES public.paper_challenge_bot_instances(challenge_id,bot_instance_id)
    ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS paper_challenge_proposals_timeline_idx
  ON public.paper_challenge_proposal_journal(challenge_id,bot_instance_id,observed_at DESC);

-- Funding and proposal observation history is permanently append-only.
CREATE OR REPLACE FUNCTION public.paper_challenge_refuse_journal_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $fn$
BEGIN
  RAISE EXCEPTION 'PAPER challenge historical journal rows are immutable.';
END;
$fn$;
CREATE TRIGGER paper_challenge_funding_immutable
  BEFORE UPDATE OR DELETE ON public.paper_challenge_funding_events
  FOR EACH ROW EXECUTE FUNCTION public.paper_challenge_refuse_journal_mutation();
CREATE TRIGGER paper_challenge_proposal_immutable
  BEFORE UPDATE OR DELETE ON public.paper_challenge_proposal_journal
  FOR EACH ROW EXECUTE FUNCTION public.paper_challenge_refuse_journal_mutation();

-- All new public tables deny anon/auth. There is no public table CRUD or RPC.
ALTER TABLE public.paper_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paper_challenge_bot_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paper_challenge_research_contributors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paper_challenge_capital_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paper_challenge_funding_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paper_challenge_proposal_journal ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE
  public.paper_challenges,public.paper_challenge_bot_instances,
  public.paper_challenge_research_contributors,public.paper_challenge_capital_accounts,
  public.paper_challenge_funding_events,public.paper_challenge_proposal_journal
  FROM PUBLIC,anon,authenticated;
GRANT SELECT ON TABLE
  public.paper_challenges,public.paper_challenge_bot_instances,
  public.paper_challenge_research_contributors,public.paper_challenge_capital_accounts,
  public.paper_challenge_funding_events,public.paper_challenge_proposal_journal
  TO service_role;
REVOKE ALL ON SEQUENCE public.paper_challenge_funding_events_event_id_seq
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.paper_challenge_refuse_journal_mutation()
  FROM PUBLIC,anon,authenticated;

-- Register the ONE existing shared-paper-v1 candidate, without resetting it.
INSERT INTO public.paper_challenges
  (challenge_id,display_name,legacy_scenario_id,policy_id,lifecycle,starting_capital,
   paper_only,broker_execution_enabled,metadata)
SELECT s.scenario_id,'BigOrders All Eight (preview)',s.scenario_id,s.policy_id,s.state,
  s.initial_equity,true,false,
  jsonb_build_object('origin','Step 3 first candidate wrapper',
    'legacyBotLedgersIndependent',true,'capitalAuthority','paper_shared_portfolio_scenarios',
    'requiresBrokerIsolation',true)
FROM public.paper_shared_portfolio_scenarios s
WHERE s.scenario_id='shared-paper-v1' AND s.paper_only AND NOT s.broker_execution_enabled
ON CONFLICT (challenge_id) DO NOTHING;

INSERT INTO public.paper_challenge_capital_accounts
  (challenge_id,source_kind,source_scenario_id,starting_capital,cash,settled_cash,
   buying_power,equity,reserved_cash,observation_only,broker_execution_enabled)
SELECT c.challenge_id,'linked-scenario-mirror',s.scenario_id,s.initial_equity,
  s.cash,s.settled_cash,s.buying_power,s.equity,s.reserved_cash,true,false
FROM public.paper_challenges c
JOIN public.paper_shared_portfolio_scenarios s ON s.scenario_id=c.legacy_scenario_id
WHERE c.challenge_id='shared-paper-v1'
ON CONFLICT (challenge_id) DO NOTHING;

-- Every strategy instance has independent challenge-local identity. These are
-- explicit preview registrations, NOT claimants of legacy broker/ledger funds.
WITH bot_map(bot_instance_id,legacy_bot_id,strategy_id,strategy_version,display_name) AS (
  VALUES
  ('atlas-01','default-diverse','paper-medium-high-v1',1,'Atlas'),
  ('fuse-01','penny-volatility-day-100','penny-volatility-day-v1',1,'Fuse'),
  ('harbor-01','three-trade-weekly-swing-100','three-trade-weekly-swing-v1',1,'Harbor'),
  ('flash-01','weekend-crypto-day-100','daily-crypto-day-v5',5,'Flash'),
  ('pulse-01','momentum-breakout-100','stock-momentum-breakout-v1',1,'Pulse'),
  ('spark-01','crypto-ignition-100','crypto-ignition-v1',1,'Spark'),
  ('orbit-01','crypto-swing-100','crypto-swing-v1',1,'Orbit'),
  ('coil-01','squeeze-breakout-100','squeeze-breakout-v1',1,'Coil')
)
INSERT INTO public.paper_challenge_bot_instances
  (challenge_id,bot_instance_id,legacy_source_bot_id,strategy_id,
   strategy_version,display_name,role,lifecycle,execution_enabled)
SELECT 'shared-paper-v1',m.bot_instance_id,l.bot_id,m.strategy_id,
  m.strategy_version,m.display_name,'trading','preview',false
FROM bot_map m JOIN public.paper_bot_ledgers l ON l.bot_id=m.legacy_bot_id
WHERE EXISTS(SELECT 1 FROM public.paper_challenges WHERE challenge_id='shared-paper-v1')
ON CONFLICT (challenge_id,bot_instance_id) DO NOTHING;

-- Abort/roll back if the candidate or any of its eight original strategies is missing.
DO $fn$
BEGIN
  IF (SELECT count(*) FROM public.paper_challenge_bot_instances
      WHERE challenge_id='shared-paper-v1')<>8
    OR NOT EXISTS (SELECT 1 FROM public.paper_challenge_capital_accounts
                   WHERE challenge_id='shared-paper-v1'
                     AND observation_only=true AND broker_execution_enabled=false)
    OR NOT EXISTS (SELECT 1 FROM public.paper_challenges
                   WHERE challenge_id='shared-paper-v1'
                     AND legacy_scenario_id='shared-paper-v1'
                     AND broker_execution_enabled=false)
  THEN
    RAISE EXCEPTION 'First challenge seed failed safety/participant invariants.';
  END IF;
END;
$fn$;
