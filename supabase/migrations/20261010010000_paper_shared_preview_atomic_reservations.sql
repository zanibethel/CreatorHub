-- BigOrders shared PAPER portfolio: atomic PREVIEW reservations only.
-- This migration never grants order submission permission or touches $100 bot ledgers.
CREATE TABLE IF NOT EXISTS public.paper_shared_capital_reservations (
  scenario_id text NOT NULL REFERENCES public.paper_shared_portfolio_scenarios(scenario_id),
  decision_key text NOT NULL,
  bot_id text NOT NULL,
  symbol text NOT NULL,
  asset_class text NOT NULL CHECK (asset_class IN ('stock','etf','crypto')),
  normalized_symbol text GENERATED ALWAYS AS (upper(replace(btrim(symbol),'/', ''))) STORED,
  sleeve text NOT NULL CHECK (sleeve IN ('stocks','swing','crypto')),
  concentration_group text NOT NULL,
  quantity numeric(20,9) NOT NULL CHECK (quantity>0),
  entry_price numeric(20,9) NOT NULL CHECK (entry_price>0),
  planned_notional numeric(14,6) NOT NULL CHECK (planned_notional>0),
  planned_loss numeric(14,6) NOT NULL CHECK (planned_loss>0),
  status text NOT NULL DEFAULT 'held' CHECK (status IN ('held','released')),
  paper_only boolean NOT NULL DEFAULT true CHECK (paper_only=true),
  broker_order_authorized boolean NOT NULL DEFAULT false CHECK (broker_order_authorized=false),
  release_proof jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz,
  PRIMARY KEY (scenario_id,decision_key),
  CHECK ((status='held' AND released_at IS NULL) OR
         (status='released' AND released_at IS NOT NULL AND release_proof IS NOT NULL))
);
-- Physical stock/crypto positions are netted by broker symbol, not bot ID.
CREATE UNIQUE INDEX IF NOT EXISTS paper_shared_preview_one_holder_per_symbol
ON public.paper_shared_capital_reservations (scenario_id,asset_class,normalized_symbol)
WHERE status='held';
CREATE INDEX IF NOT EXISTS paper_shared_preview_reservations_active
ON public.paper_shared_capital_reservations (scenario_id,sleeve,concentration_group)
WHERE status='held';

ALTER TABLE public.paper_shared_capital_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.paper_shared_capital_reservations FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.paper_shared_capital_reservations TO service_role;

-- Every preview claim locks the scenario row BEFORE reading sums.
-- No public endpoint calls this RPC and the function cannot submit broker orders.
CREATE OR REPLACE FUNCTION public.paper_shared_preview_claim(
  p_scenario_id text,
  p_decision_key text,
  p_proposal jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $fn$
DECLARE
  v_s public.paper_shared_portfolio_scenarios%ROWTYPE;
  v_old public.paper_shared_capital_decisions%ROWTYPE;
  v_bot text; v_symbol text; v_asset text; v_sleeve text; v_group text;
  v_quantity numeric; v_entry numeric; v_stop numeric; v_target numeric; v_cost numeric;
  v_notional numeric; v_loss numeric; v_net_rr numeric;
  v_gross numeric; v_open_risk numeric; v_sleeve_notional numeric; v_group_notional numeric;
  v_reserved numeric; v_held_count integer; v_active_symbol integer;
  v_limit numeric; v_status text; v_reasons jsonb := '[]'::jsonb;
BEGIN
  IF p_scenario_id IS NULL OR length(p_scenario_id) NOT BETWEEN 1 AND 80
    OR p_decision_key IS NULL OR length(p_decision_key) NOT BETWEEN 1 AND 120
    OR p_proposal IS NULL OR jsonb_typeof(p_proposal)<>'object'
    OR pg_column_size(p_proposal)>16000 THEN
    RAISE EXCEPTION 'Invalid preview claim identifier/payload.';
  END IF;
  -- Atomic lock serializes concurrent decisions competing for the same cash.
  SELECT * INTO v_s
  FROM public.paper_shared_portfolio_scenarios
  WHERE scenario_id=p_scenario_id
  FOR UPDATE;
  IF NOT FOUND OR v_s.state<>'preview' OR v_s.broker_execution_enabled
     OR NOT v_s.paper_only OR v_s.policy_id<>'shared-paper-capital-v1'
     OR coalesce(v_s.metadata->>'executionIntegrated','true') <> 'false' THEN
    RAISE EXCEPTION 'Scenario is not a broker-disabled shared PAPER preview.';
  END IF;
  SELECT * INTO v_old
  FROM public.paper_shared_capital_decisions
  WHERE scenario_id=p_scenario_id AND decision_key=p_decision_key;
  IF FOUND THEN
    IF v_old.evidence->'request' IS DISTINCT FROM p_proposal THEN
      RAISE EXCEPTION 'Decision key reused with different proposal.';
    END IF;
    RETURN jsonb_build_object('state',v_old.decision_state,'decisionKey',p_decision_key,
      'reasons',v_old.reasons,'idempotent',true,'paperOnly',true,'brokerOrderAuthorized',false);
  END IF;
  IF jsonb_typeof(p_proposal->'quantity')<>'number'
     OR jsonb_typeof(p_proposal->'entryPrice')<>'number'
     OR jsonb_typeof(p_proposal->'stopPrice')<>'number'
     OR jsonb_typeof(p_proposal->'targetPrice')<>'number'
     OR jsonb_typeof(p_proposal->'roundTripCostPct')<>'number'
     OR jsonb_typeof(p_proposal->'strategyQualified')<>'boolean'
     OR jsonb_typeof(p_proposal->'freshQuote')<>'boolean'
     OR jsonb_typeof(p_proposal->'marketSessionEligible')<>'boolean'
     OR jsonb_typeof(p_proposal->'brokerProtectionSupported')<>'boolean'
     OR jsonb_typeof(p_proposal->'speculative')<>'boolean'
     OR p_proposal->'paperOnly'<>'true'::jsonb THEN
    RAISE EXCEPTION 'Incomplete or untrusted PAPER preview inputs.';
  END IF;
  v_bot := p_proposal->>'botId';
  v_symbol := p_proposal->>'symbol';
  v_asset := p_proposal->>'assetClass';
  v_sleeve := p_proposal->>'sleeve';
  v_group := upper(btrim(p_proposal->>'concentrationGroup'));
  v_quantity := (p_proposal->>'quantity')::numeric;
  v_entry := (p_proposal->>'entryPrice')::numeric;
  v_stop := (p_proposal->>'stopPrice')::numeric;
  v_target := (p_proposal->>'targetPrice')::numeric;
  v_cost := (p_proposal->>'roundTripCostPct')::numeric;
  IF v_bot IS NULL OR length(v_bot) NOT BETWEEN 1 AND 64
    OR v_symbol IS NULL OR length(v_symbol) NOT BETWEEN 1 AND 32
    OR v_symbol !~ '^[[:alnum:]_/.-]+$'
    OR v_asset NOT IN ('stock','etf','crypto')
    OR v_sleeve NOT IN ('stocks','swing','crypto')
    OR (v_asset='crypto')<>(v_sleeve='crypto')
    OR v_group IS NULL OR length(v_group) NOT BETWEEN 1 AND 80
    OR v_quantity<=0 OR v_quantity<>trunc(v_quantity,9)
    OR (v_asset<>'crypto' AND v_quantity<>trunc(v_quantity))
    OR v_entry<=0 OR v_entry<>trunc(v_entry,9)
    OR v_stop<=0 OR v_stop>=v_entry OR v_target<=v_entry
    OR v_cost<=0 OR v_cost>10 THEN
    RAISE EXCEPTION 'Invalid instrument, quantity, stop, target, or cost.';
  END IF;
  v_notional := round(v_quantity*v_entry,6);
  v_loss := round(v_quantity*((v_entry-v_stop)+(v_entry*v_cost/100)),6);
  v_net_rr := ((v_target-v_entry)-(v_entry*v_cost/100))/
              ((v_entry-v_stop)+(v_entry*v_cost/100));
  IF v_notional<=0 OR v_loss<=0 THEN
    RAISE EXCEPTION 'Invalid numeric sizing.';
  END IF;
  IF p_proposal->'strategyQualified'<>'true'::jsonb
    THEN v_reasons:=v_reasons||jsonb_build_array('strategy-not-qualified'); END IF;
  IF p_proposal->'freshQuote'<>'true'::jsonb
    THEN v_reasons:=v_reasons||jsonb_build_array('stale-quote'); END IF;
  IF p_proposal->'marketSessionEligible'<>'true'::jsonb
    THEN v_reasons:=v_reasons||jsonb_build_array('entry-session-ineligible'); END IF;
  IF p_proposal->'brokerProtectionSupported'<>'true'::jsonb
    THEN v_reasons:=v_reasons||jsonb_build_array('unverified-protection'); END IF;
  IF v_net_rr<2
    THEN v_reasons:=v_reasons||jsonb_build_array('net-reward-risk-below-2'); END IF;
  IF jsonb_array_length(v_reasons)>0 THEN
    v_status:='rejected';
  ELSE
    -- No direct path from "allocatable" to an Alpaca submission.
    SELECT coalesce(sum(planned_notional),0),coalesce(sum(planned_loss),0),
           coalesce(sum(planned_notional) FILTER (WHERE sleeve=v_sleeve),0),
           coalesce(sum(planned_notional) FILTER (WHERE concentration_group=v_group),0),
           count(*)::integer,
           count(*) FILTER (WHERE asset_class=v_asset AND normalized_symbol=
               upper(replace(btrim(v_symbol),'/', '')))::integer
      INTO v_gross,v_open_risk,v_sleeve_notional,v_group_notional,v_held_count,v_active_symbol
    FROM public.paper_shared_capital_reservations
    WHERE scenario_id=p_scenario_id AND status='held';
    v_reserved := v_gross; -- In preview, no filled/settled positions yet.
    IF v_s.reserved_cash<>v_reserved THEN
      RAISE EXCEPTION 'Shared portfolio reservation ledger drift: fail closed.';
    END IF;
    IF v_active_symbol>0 THEN
      v_reasons:=v_reasons||jsonb_build_array('physical-symbol-occupied');
    END IF;
    IF v_held_count>=8 THEN
      v_reasons:=v_reasons||jsonb_build_array('max-open-preview-holds');
    END IF;
    IF v_loss>v_s.equity*0.005 THEN
      v_reasons:=v_reasons||jsonb_build_array('per-trade-risk-cap');
    END IF;
    IF v_open_risk+v_loss>v_s.equity*0.02 THEN
      v_reasons:=v_reasons||jsonb_build_array('aggregate-risk-cap');
    END IF;
    v_limit := CASE v_sleeve WHEN 'stocks' THEN 0.45
                 WHEN 'swing' THEN 0.20 ELSE 0.15 END;
    IF v_sleeve_notional+v_notional>v_s.equity*v_limit THEN
      v_reasons:=v_reasons||jsonb_build_array('sleeve-cap');
    END IF;
    IF v_group_notional+v_notional>v_s.equity*0.25 THEN
      v_reasons:=v_reasons||jsonb_build_array('concentration-cap');
    END IF;
    IF v_gross+v_notional>v_s.equity*0.80 THEN
      v_reasons:=v_reasons||jsonb_build_array('gross-exposure-cap');
    END IF;
    IF v_notional>v_s.equity *
       (CASE WHEN p_proposal->'speculative'='true'::jsonb THEN 0.05 ELSE 0.12 END) THEN
      v_reasons:=v_reasons||jsonb_build_array('single-position-cap');
    END IF;
    IF v_notional>greatest(0,least(v_s.cash,v_s.settled_cash,v_s.buying_power)
        -v_s.reserved_cash-(v_s.equity*0.20)) THEN
      v_reasons:=v_reasons||jsonb_build_array('settled-cash-or-cash-reserve');
    END IF;
    IF v_asset='crypto' AND v_notional<10 THEN
      v_reasons:=v_reasons||jsonb_build_array('minimum-crypto-notional');
    END IF;
    v_status := CASE WHEN jsonb_array_length(v_reasons)>0
                   THEN 'shadow-only' ELSE 'allocatable' END;
  END IF;
  -- Keep all outcomes; evidence is immutable and keyed by the scan/decision.
  INSERT INTO public.paper_shared_capital_decisions
    (scenario_id,decision_key,bot_id,symbol,sleeve,decision_state,
     estimated_notional,estimated_risk,reasons,evidence)
  VALUES (p_scenario_id,p_decision_key,v_bot,v_symbol,v_sleeve,v_status,
          v_notional,v_loss,v_reasons,jsonb_build_object('request',p_proposal,
          'previewOnly',true,'netRewardRisk',round(v_net_rr,6),
          'allocationModel','atomic-preview-v1'));
  IF v_status='allocatable' THEN
    INSERT INTO public.paper_shared_capital_reservations
      (scenario_id,decision_key,bot_id,symbol,asset_class,sleeve,concentration_group,
       quantity,entry_price,planned_notional,planned_loss)
    VALUES (p_scenario_id,p_decision_key,v_bot,v_symbol,v_asset,v_sleeve,v_group,
            v_quantity,v_entry,v_notional,v_loss);
    UPDATE public.paper_shared_portfolio_scenarios
      SET reserved_cash=reserved_cash+v_notional,updated_at=now()
      WHERE scenario_id=p_scenario_id;
  END IF;
  RETURN jsonb_build_object('state',v_status,'decisionKey',p_decision_key,
    'reasons',v_reasons,'idempotent',false,'paperOnly',true,
    'brokerOrderAuthorized',false,'proposedNotional',v_notional,
    'proposedRisk',v_loss);
END;
$fn$;

-- Preview release demands an explicit no-broker reconciliation acknowledgment.
-- It cannot release a live instrument because all these claims are broker-disabled.
CREATE OR REPLACE FUNCTION public.paper_shared_preview_release(
  p_scenario_id text,
  p_decision_key text,
  p_proof jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $fn$
DECLARE
 v_s public.paper_shared_portfolio_scenarios%ROWTYPE;
 v_r public.paper_shared_capital_reservations%ROWTYPE;
BEGIN
 SELECT * INTO v_s FROM public.paper_shared_portfolio_scenarios
 WHERE scenario_id=p_scenario_id FOR UPDATE;
 IF NOT FOUND OR v_s.state<>'preview' OR v_s.broker_execution_enabled
 OR coalesce(v_s.metadata->>'executionIntegrated','true')<>'false' THEN
   RAISE EXCEPTION 'Preview-only scenario required.';
 END IF;
 IF p_proof IS NULL OR jsonb_typeof(p_proof)<>'object'
 OR p_proof->'confirmedNoBrokerOrder'<>'true'::jsonb
 OR coalesce(length(p_proof->>'reason'),0)<8 THEN
   RAISE EXCEPTION 'Explicit simulated no-broker release proof is required.';
 END IF;
 SELECT * INTO v_r FROM public.paper_shared_capital_reservations
 WHERE scenario_id=p_scenario_id AND decision_key=p_decision_key FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Unknown preview reservation.'; END IF;
 IF v_r.status='released' THEN
   RETURN jsonb_build_object('released',true,'idempotent',true,'paperOnly',true);
 END IF;
 IF v_r.broker_order_authorized THEN
   RAISE EXCEPTION 'Broker-linked reservation cannot use preview release.';
 END IF;
 IF v_s.reserved_cash < v_r.planned_notional THEN
   RAISE EXCEPTION 'Reserved cash insufficient to safely release.';
 END IF;
 UPDATE public.paper_shared_capital_reservations
   SET status='released', released_at=now(),release_proof=p_proof
   WHERE scenario_id=p_scenario_id AND decision_key=p_decision_key;
 UPDATE public.paper_shared_portfolio_scenarios
   SET reserved_cash=reserved_cash-v_r.planned_notional, updated_at=now()
   WHERE scenario_id=p_scenario_id;
 RETURN jsonb_build_object('released',true,'idempotent',false,'paperOnly',true);
END;
$fn$;

REVOKE ALL ON FUNCTION public.paper_shared_preview_claim(text,text,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.paper_shared_preview_release(text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.paper_shared_preview_claim(text,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.paper_shared_preview_release(text,text,jsonb) TO service_role;
