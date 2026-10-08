import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const route=readFileSync(new URL("../src/app/api/paper-trading/bots/atlas-run/route.ts",import.meta.url),"utf8");
const baseAuthSql=readFileSync(new URL("../supabase/migrations/20261008173000_atlas_execution_authorization.sql",import.meta.url),"utf8");
const daySql=readFileSync(new URL("../supabase/migrations/20261008182000_atlas_fractional_day_authorization.sql",import.meta.url),"utf8");
const releaseSql=readFileSync(new URL("../supabase/migrations/20261008173500_atlas_release_zero_fill.sql",import.meta.url),"utf8");
const config=JSON.parse(readFileSync(new URL("../vercel.json",import.meta.url),"utf8"));

test("Atlas runner is paper-only, cron-secret gated and scheduled every five minutes",()=>{
  assert.match(route,/CRON_SECRET/);
  assert.match(route,/paperOnly:true/g);
  assert.match(route,/runAtlasAudit/);
  assert.match(route,/EXECUTION_ARMED=true/);
  assert.ok(config.crons.some(x=>x.path==="/api/paper-trading/bots/atlas-run"&&x.schedule==="*/5 * * * *"));
});

test("Atlas fractional execution uses simple DAY orders only",()=>{
  assert.match(route,/time_in_force:"day"/g);
  assert.match(route,/brokerOrderType:"limit"/);
  assert.match(route,/brokerOrderType:"stop"/);
  assert.match(route,/brokerOrderType:"market"/);
  assert.doesNotMatch(route,/time_in_force:"gtc"/);
  assert.doesNotMatch(route,/order_class|take_profit:|stop_loss:/);
  assert.match(route,/fractionalSimpleOnly:true/);
  assert.match(route,/atlas-fractional-day-v1/);
});

test("Atlas entry still requires authorization, reservation and exact order binding",()=>{
  const authorize=route.indexOf('db.rpc("paper_atlas_authorize_day_candidate"');
  const reserve=route.indexOf('db.rpc("paper_atlas_reserve"');
  const insert=route.indexOf('db.from("paper_bot_orders").insert',reserve);
  const bind=route.indexOf('db.rpc("paper_atlas_bind_order"');
  const settle=route.indexOf("settleEntry(prepared)",bind);
  assert.ok(authorize>=0&&reserve>authorize&&insert>reserve&&bind>insert&&settle>bind);
});

test("Atlas DAY manager protects, trims, trails and force-flattens",()=>{
  assert.match(route,/purpose:"protective-stop"/);
  assert.match(route,/purpose:"take-profit-partial"/);
  assert.match(route,/purpose:carried\?"overnight-recovery":"forced-day-flatten"/);
  assert.match(route,/purpose:"emergency-flatten"/);
  assert.match(route,/atlasDayPositionAction/);
  assert.match(route,/session\.flattenDue/);
  assert.match(route,/session\.entriesOpen/);
});

test("Atlas retries ambiguous broker outcomes using the same client order id",()=>{
  assert.match(route,/orders:by_client_order_id/);
  assert.match(route,/client_order_id:order\.client_order_id|client_order_id:order\.client_order_id/);
  assert.match(route,/brokerLookupPending:true/);
  assert.match(route,/broker-outcome-unconfirmed/);
});

test("Atlas new authorizer is DAY-only and old generic authorizer is revoked",()=>{
  assert.match(daySql,/REVOKE EXECUTE ON FUNCTION public\.paper_atlas_authorize_candidate/);
  assert.match(daySql,/paper_atlas_authorize_day_candidate/);
  assert.match(daySql,/approvedPools/);
  assert.match(daySql,/\? 'day'/);
  assert.match(daySql,/minutesToClose/);
  assert.match(daySql,/v_minutes<60/);
  assert.match(daySql,/fractionalSimpleOnly/);
  assert.match(daySql,/atlas-fractional-day-v1/);
  assert.match(baseAuthSql,/paper_atlas_authorize_candidate/);
});

test("Atlas terminal settlement distinguishes no-fill and partial-fill exposure",()=>{
  assert.match(releaseSql,/filledQuantityObserved/);
  assert.match(releaseSql,/paper_bot_broker_fills/);
  assert.match(daySql,/paper_atlas_consume_partial_terminal/);
  assert.match(daySql,/brokerObservedStatus.*canceled.*expired/s);
  assert.match(daySql,/filledQuantityObserved/);
  assert.match(daySql,/paper_atlas_release_bound_rejection/);
  assert.match(daySql,/paper_atlas_release_never_submitted/);
});
