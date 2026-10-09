import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const executor=readFileSync(new URL("../src/app/api/paper-trading/bots/momentum-breakout-execute/route.ts",import.meta.url),"utf8");
const manager=readFileSync(new URL("../src/app/api/paper-trading/bots/momentum-breakout-manage/route.ts",import.meta.url),"utf8");
const sql=readFileSync(new URL("../supabase/migrations/20261009003000_pulse_fractional_pilot_claim.sql",import.meta.url),"utf8");

test("Pulse fractional broker order requires authenticated, healthy manager before claiming a prepared order",()=>{
  const health=executor.indexOf("Pulse fractional protection manager is not healthy;");
  const reserve=executor.indexOf("paper_pulse_claim_fractional_pilot");
  const claim=executor.indexOf("const claim=await fetch(");
  const brokerPost=executor.indexOf("const response=await fetch(`${ALPACA_PAPER}/orders`");
  assert.ok(health>0 && reserve>health && claim>reserve && brokerPost>claim);
  assert.match(executor,/manager\.ok&&health\.ok===true&&health\.paperOnly===true&&health\.marketOpen===true/);
  assert.match(executor,/if\(!cron\)return reply/);
  assert.match(executor,/if\(!reserved\)return reply/);
});

test("Pulse pilot reserves atomically against one active ledger and one order ID",()=>{
  assert.match(sql,/update public\.paper_bot_ledgers/);
  assert.match(sql,/fractionalPilotClientOrderId/);
  assert.match(sql,/not metadata \? 'fractionalPilotClientOrderId'/);
  assert.match(sql,/metadata->>'fractionalExecutionEnabled' = 'true'/);
  assert.match(sql,/metadata->>'executionEnabled' = 'true'/);
  assert.match(sql,/status = 'active'/);
  assert.match(sql,/get diagnostics v_affected = row_count/);
  assert.match(sql,/return v_affected = 1/);
  assert.match(sql,/revoke all on function[\s\S]*from public, anon, authenticated/);
  assert.match(sql,/grant execute on function[\s\S]*to service_role/);
  assert.match(executor,/p_client_order_id:prepared.client_order_id/);
});

test("Pulse readiness switch stays explicitly opt-in and manager preserves existing stop controls",()=>{
  const readiness=readFileSync(new URL("../src/app/api/paper-trading/bots/momentum-breakout-readiness/route.ts",import.meta.url),"utf8");
  assert.match(readiness,/fractionalExecutionEnabled=ledger.metadata.fractionalExecutionEnabled===true/);
  assert.match(manager,/const flattenDue=marketOpen&&minute>=15\*60\+40/);
  assert.match(manager,/stop-outcome-unconfirmed/);
  assert.match(manager,/manual-reconciliation/);
});
