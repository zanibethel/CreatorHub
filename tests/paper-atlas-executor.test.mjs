import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const route=readFileSync(new URL("../src/app/api/paper-trading/bots/atlas-run/route.ts",import.meta.url),"utf8");
const authSql=readFileSync(new URL("../supabase/migrations/20261008173000_atlas_execution_authorization.sql",import.meta.url),"utf8");
const releaseSql=readFileSync(new URL("../supabase/migrations/20261008173500_atlas_release_zero_fill.sql",import.meta.url),"utf8");
const config=JSON.parse(readFileSync(new URL("../vercel.json",import.meta.url),"utf8"));

test("Atlas scheduled runner remains paper-only and cron-secret gated",()=>{
  assert.match(route,/CRON_SECRET/);
  assert.match(route,/paperOnly:true/g);
  assert.match(route,/runAtlasAudit/);
  assert.ok(config.crons.some(x=>x.path==="/api/paper-trading/bots/atlas-run"&&x.schedule==="*/5 * * * *"));
});

test("Atlas executes stocks only after authorization, reservation and exact binding",()=>{
  const authorize=route.indexOf('db.rpc("paper_atlas_authorize_candidate"');
  const reserve=route.indexOf('db.rpc("paper_atlas_reserve"');
  const insert=route.indexOf('db.from("paper_bot_orders").insert');
  const bind=route.indexOf('db.rpc("paper_atlas_bind_order"');
  const submitCall=route.indexOf("submitBracket(prepared)",bind);
  assert.ok(authorize>=0&&reserve>authorize&&insert>reserve&&bind>insert&&submitCall>bind);
  assert.match(route,/asset_class!=="stock"/);
  assert.match(route,/atlasExecutionPool/);
  assert.match(route,/time_in_force:"gtc"/);
  assert.match(route,/order_class:"bracket"/);
  assert.match(route,/take_profit/);
  assert.match(route,/stop_loss/);
});

test("Atlas retries broker ambiguity with the same client order id",()=>{
  assert.match(route,/orders:by_client_order_id/);
  assert.match(route,/client_order_id:order\.client_order_id/);
  assert.match(route,/brokerLookupPending:true/);
  assert.match(route,/same client-order ID will be reconciled before any retry/);
});

test("Atlas authorization remains separate from immutable candidate evidence",()=>{
  assert.match(authSql,/event_type='candidate'/);
  assert.match(authSql,/event_type='authorized'/);
  assert.match(authSql,/authorizedFromDecisionId/);
  assert.match(authSql,/candidateSource}'<>'persisted-paper-watchlist'/);
  assert.match(authSql,/approvedPools/);
  assert.match(authSql,/occurred_at>=now\(\)-interval '90 seconds'/);
  assert.match(authSql,/proposedNotional/);
  assert.match(authSql,/symbol-position-exists/);
});

test("Atlas terminal release requires broker-observed and imported zero fills",()=>{
  assert.match(releaseSql,/filledQuantityObserved/);
  assert.match(releaseSql,/paper_bot_broker_fills/);
  assert.match(releaseSql,/f\.side='buy'/);
  assert.match(releaseSql,/coalesce\(f\.quantity,0\)>0/);
});
