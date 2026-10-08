import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const sql=readFileSync(new URL("../supabase/migrations/20261008150000_atlas_atomic_reservations.sql",import.meta.url),"utf8");
test("Atlas reservation schema locks isolated ledger and uniquely identifies decisions",()=>{
  assert.match(sql,/UNIQUE \(bot_id, decision_id, strategy_version, opportunity_id\)/);
  assert.match(sql,/WHERE bot_id='default-diverse' FOR UPDATE/g);
  assert.match(sql,/v_cash-v_reserved<p_amount/);
  assert.match(sql,/v_pool_committed\+v_pool_reserved\+p_amount>v_pool_limit/);
});
test("pool caps are computed inside SQL and service role only RPCs",()=>{
  assert.match(sql,/v_starting_cash \* CASE p_pool WHEN 'day' THEN 0\.20 WHEN 'multi-day' THEN 0\.40 ELSE 0\.40 END/);
  assert.match(sql,/GRANT EXECUTE ON FUNCTION public\.paper_atlas_reserve\(text,text,text,numeric,text\)/);
  assert.doesNotMatch(sql,/GRANT (?:INSERT|UPDATE) ON public\.paper_atlas_reservations TO service_role/);
});
test("ambiguous orders block reservation and only confirmed fills may consume",()=>{
  assert.match(sql,/status IN \('prepared','submitted','accepted','partially_filled','pending_new'\)/);
  assert.match(sql,/o\.status = 'filled'/);
  assert.doesNotMatch(sql,/o\.status IN \('filled','partially_filled'\)/);
  assert.match(sql,/o\.bot_id='default-diverse'/);
  assert.match(sql,/o\.pool_id=r\.pool/);
});

test("scanner-only and read-only Atlas decisions cannot reserve cash",()=>{
  assert.match(sql,/j\.event_type='candidate'/);
  assert.match(sql,/j\.metadata->>'decisionId'=p_decision_id/);
  assert.match(sql,/j\.metadata->>'orderAuthorization'='true'/);
  assert.match(sql,/j\.blockers='\[\]'::jsonb/);
  assert.match(sql,/decision-not-authorized/);
});


test("binds reservations to exact prepared orders before settlement",()=>{
  assert.match(sql,/paper_atlas_bind_order/);
  assert.match(sql,/o\.status='prepared'/);
  assert.match(sql,/o\.metadata->>'atlasReservationId'=r\.reservation_id::text/);
  assert.match(sql,/o\.metadata->>'decisionId'=r\.decision_id/);
  assert.match(sql,/o\.metadata->>'opportunityId'=r\.opportunity_id/);
  assert.match(sql,/r\.client_order_id=p_client_order_id/);
  assert.match(sql,/o\.broker_order_id IS NOT NULL/);
  assert.match(sql,/o\.last_reconciled_at IS NOT NULL/);
});

test("release requires broker-confirmed terminal no-fill state",()=>{
  assert.match(sql,/o\.status IN \('canceled','rejected','expired'\)/);
  assert.match(sql,/o\.last_reconciled_at IS NOT NULL/);
  assert.doesNotMatch(sql,/o\.status IN \('canceled','rejected','expired','error'\)/);
});


test("migration has no malformed single-dollar PL/pgSQL delimiters",()=>{
  assert.doesNotMatch(sql,/AS \$\nDECLARE/);
  assert.doesNotMatch(sql,/END \$;/);
});
