import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const route=readFileSync(new URL("../src/app/api/paper-trading/bots/atlas-run/route.ts",import.meta.url),"utf8");
const authSql=readFileSync(new URL("../supabase/migrations/20261008173000_atlas_execution_authorization.sql",import.meta.url),"utf8");
const releaseSql=readFileSync(new URL("../supabase/migrations/20261008173500_atlas_release_zero_fill.sql",import.meta.url),"utf8");
const daySql=readFileSync(new URL("../supabase/migrations/20261008192500_atlas_fractional_day_settlement.sql",import.meta.url),"utf8");
const config=JSON.parse(readFileSync(new URL("../vercel.json",import.meta.url),"utf8"));

test("Atlas keeps five-minute decision audits and one-minute weekday protection management",()=>{
  assert.match(route,/CRON_SECRET/);
  assert.match(route,/paperOnly:true/g);
  assert.ok(config.crons.some(x=>x.path==="/api/paper-trading/bots/atlas-decision-audit"&&x.schedule==="*/5 * * * *"));
  assert.ok(config.crons.some(x=>x.path==="/api/paper-trading/bots/atlas-run"&&x.schedule==="* * * * 1-5"));
  assert.doesNotMatch(route,/executionArmed=false/);
});

test("Atlas fractional entries are DAY simple limits, never fractional brackets or GTC",()=>{
  assert.match(route,/type:"limit",time_in_force:"day"/);
  assert.match(route,/order_class:"simple"/);
  assert.doesNotMatch(route,/order_class:"bracket"/);
  assert.doesNotMatch(route,/time_in_force:"gtc"/);
  assert.match(route,/protectionMode:"fractional-day-simple-stop"/);
});

test("Atlas requires authorization, reservation and binding before entry submission",()=>{
  const entryStart=route.indexOf("const {data:authorized");
  const authorize=route.indexOf('db.rpc("paper_atlas_authorize_candidate"',entryStart);
  const reserve=route.indexOf('db.rpc("paper_atlas_reserve"',authorize);
  const insert=route.indexOf('db.from("paper_bot_orders").insert',reserve);
  const bind=route.indexOf('db.rpc("paper_atlas_bind_order"',insert);
  const submit=route.indexOf("submitWithLookup(clientOrderId",bind);
  assert.ok(entryStart>=0&&authorize>=entryStart&&reserve>authorize&&insert>reserve&&bind>insert&&submit>bind);
});

test("Atlas fractional protection is broker-hosted DAY stop with emergency flatten",()=>{
  assert.match(route,/purpose:"protective-stop"/);
  assert.match(route,/type:"stop"/);
  assert.match(route,/time_in_force:"day"/);
  assert.match(route,/emergencyFlatten/);
  assert.match(route,/mandatory intraday exit before the regular-session close/);
  assert.match(route,/minutesToClose<=10/);
});

test("Atlas preserves partial-profit, breakeven and trailing management",()=>{
  assert.match(route,/take-profit-partial/);
  assert.match(route,/partialProfitState:"completed"/);
  assert.match(route,/Math\.max\(currentStop,average,mark-riskDistance\)/);
  assert.match(route,/rMultiple>=protectWinnerAtR/);
});

test("Atlas retries ambiguous entry with the same client order id",()=>{
  assert.match(route,/orders:by_client_order_id/);
  assert.match(route,/brokerLookupPending/);
  assert.match(route,/reservation remains locked/);
});

test("Atlas authorization remains separate from immutable candidate evidence",()=>{
  assert.match(authSql,/event_type='candidate'/);
  assert.match(authSql,/event_type='authorized'/);
  assert.match(authSql,/authorizedFromDecisionId/);
  assert.match(authSql,/candidateSource}'<>'persisted-paper-watchlist'/);
  assert.match(authSql,/approvedPools/);
  assert.match(authSql,/occurred_at>=now\(\)-interval '90 seconds'/);
  assert.match(authSql,/proposedNotional/);
});

test("Atlas terminal release still requires broker-observed and imported zero fills",()=>{
  assert.match(releaseSql,/filledQuantityObserved/);
  assert.match(releaseSql,/paper_bot_broker_fills/);
  assert.match(releaseSql,/f\.side='buy'/);
});

test("Atlas consumes reservations only after matching fills reach the virtual ledger",()=>{
  assert.match(daySql,/ledger_applied_at IS NULL/);
  assert.match(daySql,/ledger_applied_at IS NOT NULL/);
  assert.match(daySql,/cumulative_quantity/);
  assert.match(daySql,/open-position-exists/);
  assert.match(daySql,/paper_atlas_release_unsubmitted/);
  assert.match(daySql,/'executionEnabled',true/);
  assert.match(daySql,/'liveMoneyEnabled',false/);
});
