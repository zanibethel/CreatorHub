import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const sql=readFileSync(new URL("../supabase/migrations/20261010010000_paper_shared_preview_atomic_reservations.sql",import.meta.url),"utf8");

test("preview reservations and recorded decisions cannot grant broker execution",()=>{
  assert.match(sql,/broker_order_authorized boolean NOT NULL DEFAULT false CHECK \(broker_order_authorized=false\)/i);
  assert.match(sql,/v_s\.broker_execution_enabled/);
  assert.match(sql,/paper_only boolean NOT NULL DEFAULT true CHECK \(paper_only=true\)/i);
  assert.doesNotMatch(sql,/paper_bot_ledgers\s+SET|UPDATE\s+public\.paper_capital_plan|paper-api\.alpaca\.markets/i);
});

test("scenario row is locked before checking competing cash/symbol/risk claims",()=>{
  const lock=sql.indexOf("FOR UPDATE;");
  const sums=sql.indexOf("SELECT coalesce(sum(planned_notional)");
  assert.ok(lock>=0&&sums>lock);
  assert.match(sql,/v_s\.reserved_cash<>v_reserved/);
  assert.match(sql,/UPDATE public\.paper_shared_portfolio_scenarios\s+SET reserved_cash=reserved_cash\+v_notional/);
  assert.match(sql,/ON public\.paper_shared_capital_reservations \(scenario_id,normalized_symbol\)/);
  assert.match(sql,/WHERE status='held'/);
});

test("caps reflect the new $5k policy and distinguish quality rejects from unfunded studies",()=>{
  assert.match(sql,/v_loss>v_s\.equity\*0\.005/);
  assert.match(sql,/v_open_risk\+v_loss>v_s\.equity\*0\.02/);
  assert.match(sql,/v_gross\+v_notional>v_s\.equity\*0\.80/);
  assert.match(sql,/v_s\.equity\*0\.20/);
  assert.match(sql,/WHEN 'stocks' THEN 0\.45/);
  assert.match(sql,/WHEN 'swing' THEN 0\.20 ELSE 0\.15/);
  assert.match(sql,/v_status:='rejected'/);
  assert.match(sql,/THEN 'shadow-only' ELSE 'allocatable'/);
  assert.match(sql,/INSERT INTO public\.paper_shared_capital_decisions/);
});

test("idempotent claims cannot reuse keys with different proposals or silently rearm released holds",()=>{
  assert.match(sql,/Decision key reused with different proposal/);
  assert.match(sql,/previously-released/);
  assert.match(sql,/PRIMARY KEY \(scenario_id,decision_key\)/);
  assert.match(sql,/ON public\.paper_shared_capital_reservations \(scenario_id,normalized_symbol\)/);
});

test("release requires explicit no-broker proof, while RLS denies browser access",()=>{
  assert.match(sql,/confirmedNoBrokerOrder/);
  assert.match(sql,/REVOKE ALL ON public\.paper_shared_capital_reservations FROM PUBLIC,anon,authenticated/);
  assert.match(sql,/REVOKE ALL ON FUNCTION public\.paper_shared_preview_claim\(text,text,jsonb\) FROM PUBLIC,anon,authenticated/);
  assert.match(sql,/GRANT EXECUTE ON FUNCTION public\.paper_shared_preview_claim\(text,text,jsonb\) TO service_role/);
  assert.match(sql,/SECURITY INVOKER SET search_path=''/);
});
