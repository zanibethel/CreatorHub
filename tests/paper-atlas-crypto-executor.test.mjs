import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const route=readFileSync(new URL("../src/app/api/paper-trading/bots/atlas-crypto-run/route.ts",import.meta.url),"utf8");
const stockRoute=readFileSync(new URL("../src/app/api/paper-trading/bots/atlas-run/route.ts",import.meta.url),"utf8");
const sql=readFileSync(new URL("../supabase/migrations/20261008204500_atlas_crypto_authorization_v4.sql",import.meta.url),"utf8");
const config=JSON.parse(readFileSync(new URL("../vercel.json",import.meta.url),"utf8"));

test("Atlas crypto runner is 24/7, cron-secret gated, and paper-only",()=>{
  assert.match(route,/CRON_SECRET/);
  assert.match(route,/paperOnly:true/g);
  assert.ok(config.crons.some(x=>x.path==="/api/paper-trading/bots/atlas-crypto-run"&&x.schedule==="* * * * *"));
  assert.match(route,/cryptoExecutionEnabled/);
  assert.match(route,/liveMoneyEnabled/);
});

test("Atlas crypto uses GTC simple limit entries and GTC stop-limit protection",()=>{
  assert.match(route,/type:"limit",time_in_force:"gtc"/);
  assert.match(route,/type:"stop_limit"/);
  assert.match(route,/time_in_force:"gtc"/);
  assert.match(route,/crypto-gtc-stop-limit/);
  assert.match(route,/emergencyFlatten/);
});

test("Atlas crypto prefers swing horizons and carries fee reserve",()=>{
  assert.match(route,/atlasCryptoExecutionPool/);
  assert.match(route,/reservedAmount/);
  assert.match(route,/estimatedFeeBps/);
  assert.match(route,/ATLAS_CRYPTO_ESTIMATED_FEE_BPS_PER_SIDE/);
  assert.match(route,/poolRemaining=startingCash\*\.40/);
});

test("Atlas stock and crypto runners cannot claim each other's lifecycle",()=>{
  assert.match(stockRoute,/crypto-reservation-owned-by-crypto-runner/);
  assert.match(stockRoute,/crypto-position-owned-by-crypto-runner/);
  assert.match(route,/stock-reservation-owned-by-stock-runner/);
  assert.match(route,/stock-position-owned-by-stock-runner/);
});

test("Atlas crypto entry is authorized, reserved and bound before broker submission",()=>{
  const authorize=route.indexOf('db.rpc("paper_atlas_authorize_candidate"');
  const reserve=route.indexOf('db.rpc("paper_atlas_reserve"',authorize);
  const insert=route.indexOf('db.from("paper_bot_orders").insert',reserve);
  const bind=route.indexOf('db.rpc("paper_atlas_bind_order"',insert);
  const submit=route.indexOf("submitWithLookup(clientOrderId",bind);
  assert.ok(authorize>=0&&reserve>authorize&&insert>reserve&&bind>insert&&submit>bind);
});

test("Atlas crypto authorization RPC validates candidate asset class and serializes active reservation",()=>{
  assert.match(sql,/v_candidate\.asset_class NOT IN \('stock','crypto'\)/);
  assert.match(sql,/p_preflight->>'assetClass'<>v_candidate\.asset_class/);
  assert.match(sql,/active-reservation-exists/);
  assert.match(sql,/current_setting\('request\.jwt\.claim\.role',true\)/);
  assert.match(sql,/REVOKE ALL ON FUNCTION public\.paper_atlas_authorize_candidate/);
  assert.match(sql,/REVOKE ALL ON FUNCTION public\.paper_atlas_reserve/);
});

test("Atlas crypto remains blocked when another bot owns the same broker symbol",()=>{
  assert.match(route,/sharedPositions\.some/);
  assert.match(route,/sharedOrders\.some/);
  assert.match(route,/normalize\(row\.symbol\)===compact/);
});

test("Atlas crypto partial profit restores fee-aware protection",()=>{
  assert.match(route,/take-profit-partial/);
  assert.match(route,/partialProfitState:"completed"/);
  assert.match(route,/average\/\(1-feeRate\)/);
  assert.match(route,/Math\.max\(currentStop,breakEven,mark-riskDistance\)/);
});
