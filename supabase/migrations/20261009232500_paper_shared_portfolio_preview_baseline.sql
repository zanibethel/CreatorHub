-- Shared BigOrders PAPER portfolio PREVIEW baseline only.
-- Existing $100 challenge ledgers, paper_capital_plan(main), orders,
-- broker permissions and strategy execution switches are unaffected.
CREATE TABLE IF NOT EXISTS public.paper_shared_portfolio_scenarios (
  scenario_id text PRIMARY KEY,
  policy_id text NOT NULL,
  state text NOT NULL DEFAULT 'preview' CHECK (state IN ('preview','paused')),
  initial_equity numeric(14,6) NOT NULL CHECK (initial_equity > 0),
  equity numeric(14,6) NOT NULL CHECK (equity > 0),
  cash numeric(14,6) NOT NULL CHECK (cash >= 0),
  settled_cash numeric(14,6) NOT NULL CHECK (settled_cash >= 0),
  buying_power numeric(14,6) NOT NULL CHECK (buying_power >= 0),
  reserved_cash numeric(14,6) NOT NULL DEFAULT 0 CHECK (reserved_cash >= 0),
  paper_only boolean NOT NULL DEFAULT true CHECK (paper_only = true),
  broker_execution_enabled boolean NOT NULL DEFAULT false CHECK (broker_execution_enabled = false),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (settled_cash <= cash),
  CHECK (reserved_cash <= cash)
);

-- Future durable merit/capital-decision trail. Append-only via service_role.
-- No writes from the new preview endpoint in phase 1.
CREATE TABLE IF NOT EXISTS public.paper_shared_capital_decisions (
  decision_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  scenario_id text NOT NULL REFERENCES public.paper_shared_portfolio_scenarios(scenario_id),
  decision_key text NOT NULL,
  bot_id text NOT NULL,
  symbol text NOT NULL,
  sleeve text NOT NULL CHECK (sleeve IN ('stocks','swing','crypto')),
  decision_state text NOT NULL CHECK (decision_state IN ('allocatable','shadow-only','rejected')),
  estimated_notional numeric(14,6) NOT NULL DEFAULT 0 CHECK (estimated_notional >= 0),
  estimated_risk numeric(14,6) NOT NULL DEFAULT 0 CHECK (estimated_risk >= 0),
  reasons jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(reasons)='array'),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(evidence)='object'),
  paper_only boolean NOT NULL DEFAULT true CHECK (paper_only = true),
  broker_order_authorized boolean NOT NULL DEFAULT false CHECK (broker_order_authorized = false),
  evaluated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scenario_id,decision_key)
);
CREATE INDEX IF NOT EXISTS paper_shared_capital_decisions_timeline_idx
  ON public.paper_shared_capital_decisions (scenario_id,evaluated_at DESC);

ALTER TABLE public.paper_shared_portfolio_scenarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paper_shared_capital_decisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.paper_shared_portfolio_scenarios FROM PUBLIC,anon,authenticated;
REVOKE ALL ON TABLE public.paper_shared_capital_decisions FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON TABLE public.paper_shared_portfolio_scenarios TO service_role;
GRANT SELECT,INSERT ON TABLE public.paper_shared_capital_decisions TO service_role;
REVOKE ALL ON SEQUENCE public.paper_shared_capital_decisions_decision_id_seq FROM PUBLIC,anon,authenticated;
GRANT USAGE,SELECT ON SEQUENCE public.paper_shared_capital_decisions_decision_id_seq TO service_role;

INSERT INTO public.paper_shared_portfolio_scenarios
  (scenario_id,policy_id,state,initial_equity,equity,cash,settled_cash,buying_power,reserved_cash,paper_only,broker_execution_enabled,metadata)
VALUES ('shared-paper-v1','shared-paper-capital-v1','preview',5000,5000,5000,5000,5000,0,true,false,
  '{"baseline":"2026-10-09","currency":"USD","kind":"independent simulated portfolio","model":"shared merit-allocated capital","legacyLedgersUnchanged":true,"executionIntegrated":false,"minimumCashReservePct":20,"officialChallengeStarted":false}'::jsonb)
ON CONFLICT (scenario_id) DO NOTHING;
