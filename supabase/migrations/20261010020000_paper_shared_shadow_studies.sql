-- The PAPER shared-capital lane may decline fully qualified opportunities for capital reasons.
-- Persist those as separate *hypothetical* studies, never as broker orders/fills or realized P/L.
CREATE TABLE IF NOT EXISTS public.paper_shared_shadow_studies (
  scenario_id text NOT NULL,
  decision_key text NOT NULL,
  bot_id text NOT NULL,
  symbol text NOT NULL,
  asset_class text NOT NULL CHECK (asset_class IN ('stock','etf','crypto')),
  sleeve text NOT NULL CHECK (sleeve IN ('stocks','swing','crypto')),
  decision_at timestamptz NOT NULL,
  reference_entry numeric(20,9) NOT NULL CHECK (reference_entry>0),
  protective_stop numeric(20,9) NOT NULL CHECK (protective_stop>0 AND protective_stop<reference_entry),
  planned_target numeric(20,9) NOT NULL CHECK (planned_target>reference_entry),
  hypothetical_quantity numeric(20,9) NOT NULL CHECK (hypothetical_quantity>0),
  estimated_round_trip_cost_pct numeric(12,6) NOT NULL CHECK (estimated_round_trip_cost_pct>0),
  status text NOT NULL DEFAULT 'watching'
    CHECK (status IN ('watching','triggered','completed','expired','ambiguous')),
  assumed_entry numeric(20,9),
  assumed_exit numeric(20,9),
  entry_at timestamptz,
  exit_at timestamptz,
  last_bar_at timestamptz,
  mark_count integer NOT NULL DEFAULT 0 CHECK (mark_count>=0),
  gross_pl numeric(18,6),
  estimated_costs numeric(18,6),
  hypothetical_net_pl numeric(18,6),
  mfe_r numeric(16,6),
  mae_r numeric(16,6),
  first_outcome text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata)='object'),
  paper_only boolean NOT NULL DEFAULT true CHECK (paper_only=true),
  broker_order_authorized boolean NOT NULL DEFAULT false CHECK (broker_order_authorized=false),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scenario_id,decision_key),
  FOREIGN KEY (scenario_id,decision_key)
    REFERENCES public.paper_shared_capital_decisions(scenario_id,decision_key),
  CHECK ((status IN ('watching','triggered','ambiguous','expired'))
          OR (status='completed' AND assumed_entry IS NOT NULL AND assumed_exit IS NOT NULL)),
  CHECK (hypothetical_net_pl IS NULL OR status='completed')
);
CREATE INDEX IF NOT EXISTS paper_shared_shadow_studies_active_idx
  ON public.paper_shared_shadow_studies (scenario_id,status,decision_at DESC)
  WHERE status IN ('watching','triggered');
ALTER TABLE public.paper_shared_shadow_studies ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.paper_shared_shadow_studies FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.paper_shared_shadow_studies TO service_role;

CREATE OR REPLACE FUNCTION public.paper_shared_shadow_seed_decision()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $body$
DECLARE v_request jsonb;
BEGIN
  IF NEW.decision_state<>'shadow-only' THEN RETURN NEW; END IF;
  v_request:=NEW.evidence->'request';
  IF v_request IS NULL OR jsonb_typeof(v_request)<>'object'
    OR jsonb_typeof(v_request->'entryPrice') IS DISTINCT FROM 'number'
    OR jsonb_typeof(v_request->'stopPrice') IS DISTINCT FROM 'number'
    OR jsonb_typeof(v_request->'targetPrice') IS DISTINCT FROM 'number'
    OR jsonb_typeof(v_request->'quantity') IS DISTINCT FROM 'number'
    OR jsonb_typeof(v_request->'roundTripCostPct') IS DISTINCT FROM 'number'
    OR v_request->'paperOnly' IS DISTINCT FROM 'true'::jsonb THEN
    RAISE EXCEPTION 'Shadow study requires complete PAPER strategy inputs.';
  END IF;
  INSERT INTO public.paper_shared_shadow_studies(
    scenario_id,decision_key,bot_id,symbol,asset_class,sleeve,decision_at,
    reference_entry,protective_stop,planned_target,hypothetical_quantity,
    estimated_round_trip_cost_pct,metadata
  ) VALUES (
    NEW.scenario_id,NEW.decision_key,NEW.bot_id,NEW.symbol,
    v_request->>'assetClass',NEW.sleeve,NEW.evaluated_at,
    (v_request->>'entryPrice')::numeric,(v_request->>'stopPrice')::numeric,
    (v_request->>'targetPrice')::numeric,(v_request->>'quantity')::numeric,
    (v_request->>'roundTripCostPct')::numeric,
    jsonb_build_object(
      'source','shared-capital-shadow-intake-v1',
      'studyType','hypothetical-not-executed',
      'allocationBlockers',NEW.reasons,
      'strategyQualifiedAtDecision',true,
      'cashAllocationUsed',0,
      'futureBarsRequired',true,
      'noAssumedFillAtDecision',true
    )
  ) ON CONFLICT (scenario_id,decision_key) DO NOTHING;
  RETURN NEW;
END;
$body$;

DROP TRIGGER IF EXISTS paper_shared_shadow_from_decision
ON public.paper_shared_capital_decisions;
CREATE TRIGGER paper_shared_shadow_from_decision
AFTER INSERT ON public.paper_shared_capital_decisions
FOR EACH ROW EXECUTE FUNCTION public.paper_shared_shadow_seed_decision();

REVOKE ALL ON FUNCTION public.paper_shared_shadow_seed_decision() FROM PUBLIC,anon,authenticated;
-- Trigger is internal and cannot be invoked as an ordinary API RPC.
