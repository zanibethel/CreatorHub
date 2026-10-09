import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function load(path,imports={}){
  const code=readFileSync(new URL(path,import.meta.url),"utf8");
  const exports={};
  vm.runInNewContext(ts.transpileModule(code,{compilerOptions:{
    module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,
  }}).outputText,{exports,require:name=>imports[name]??{},Date,Intl,Object,Math,Number,Set,Array,RegExp});
  return exports;
}
const {fuseExitWindow,fuseFlattenOrderId,chooseFuseExitAction:pick}=load("../src/lib/paper-fuse-exit-manager.ts");
const CLIENT="chb-pny-v1-mvzpxd60-aabcdef123456789";
function state(overrides={}){
  return {marketOpen:true,regularClockMinute:true,flattenDue:false,
    brokerQty:5,virtualQty:5,entryFilledQty:5,entryPending:false,
    stopOrTargetActive:true,takeProfitHasFills:false,foreignSymbolOrder:false,parentVerified:true,
    protection:{state:"protected"},...overrides};
}
test("Fuse waits under broker protection and requires staged close at 3:40 ET",()=>{
  assert.equal(pick(state()).action,"protected");
  assert.equal(pick(state({flattenDue:true})).action,"cancel-bracket-exits");
  assert.equal(pick(state({flattenDue:true,stopOrTargetActive:false})).action,"flatten-ready");
  assert.equal(pick(state({protection:{state:"unprotected"}})).action,"cancel-bracket-exits");
  assert.equal(pick(state({protection:{state:"unprotected"},stopOrTargetActive:false})).action,"flatten-ready");
});
test("Fuse preserves broker target exits on partial-fill OCO uncertainty, even at the session cutoff",()=>{
  const partial=state({brokerQty:3,virtualQty:3,entryFilledQty:5,
    takeProfitHasFills:true,protection:{state:"unprotected"}});
  const denied=pick(partial);
  assert.equal(denied.action,"manual-reconciliation");
  assert.match(denied.reason,/Partial take-profit/);
  assert.equal(pick(state({...partial,flattenDue:true})).action,"manual-reconciliation");
  // When Alpaca has correctly resized the stop and the regular session
  // continues, this is still broker protected without an extra sell.
  assert.equal(pick(state({...partial,protection:{state:"protected"}})).action,"protected");
  // But an in-flight partial target cannot be canceled for flatten at 15:40.
  assert.equal(pick(state({...partial,protection:{state:"protected"},flattenDue:true})).action,
    "manual-reconciliation");
});

test("Fuse never flattens before physical and virtual fills match or during symbol collision",()=>{
  assert.equal(pick(state({virtualQty:4})).action,"manual-reconciliation");
  assert.equal(pick(state({foreignSymbolOrder:true})).action,"manual-reconciliation");
  assert.equal(pick(state({entryFilledQty:4})).action,"manual-reconciliation");
  assert.equal(pick(state({brokerQty:5.5})).action,"manual-reconciliation");
  assert.equal(pick(state({parentVerified:false})).action,"manual-reconciliation");
  assert.equal(pick(state({protection:{state:"ownership-collision"}})).action,"manual-reconciliation");
  assert.equal(pick(state({protection:{state:"unconfirmed"},stopOrTargetActive:false})).action,"manual-reconciliation");
});
test("Fuse cancels partial entry BEFORE touching linked child exits",()=>{
  assert.equal(pick(state({entryPending:true,entryFilledQty:7,brokerQty:3,virtualQty:3})).action,"cancel-pending-entry");
  assert.equal(pick(state({entryPending:true,brokerQty:0,virtualQty:0,entryFilledQty:0,flattenDue:true})).action,"cancel-pending-entry");
  assert.equal(pick(state({entryPending:true,brokerQty:0,virtualQty:0,entryFilledQty:0})).action,"awaiting-entry");
});
test("Fuse exits never send orders outside the independent paper exchange clock",()=>{
  assert.equal(pick(state({marketOpen:false})).action,"market-closed");
  assert.equal(pick(state({regularClockMinute:false})).action,"market-closed");
  const ny=(iso)=>fuseExitWindow(Date.parse(iso));
  assert.equal(ny("2026-10-08T19:39:00Z").entryCutoff,false);
  assert.equal(ny("2026-10-08T19:40:00Z").entryCutoff,true);
  assert.equal(ny("2026-10-08T20:01:00Z").regularClockMinute,false);
  assert.equal(ny("2026-10-10T19:45:00Z").regularWeekday,false);
});
test("Fuse exit is stable and only derived from its parent PNY PAPER ID",()=>{
  const derived=fuseFlattenOrderId(CLIENT);
  assert.equal(derived,"chb-pny-v1-mvzpxd60fx-aabcdef123456789");
  assert.equal(fuseFlattenOrderId("chb-spk-v1-mvzpxd60-aabcdef123456789"),null);
  assert.equal(fuseFlattenOrderId("random"),null);
  assert.match(derived,/^chb-pny-v1-[a-z0-9]+-[a-z0-9]{6,24}$/);
  assert.ok(derived.length<=128);
});
test("Fuse manager endpoint contains an atomic one-shot local claim and rechecks shared venue",()=>{
  const src=readFileSync(new URL("../src/app/api/paper-trading/bots/fuse-manage/route.ts",import.meta.url),"utf8");
  assert.match(src,/request\.headers\.get\("authorization"\)/);
  assert.match(src,/paper-api\.alpaca\.markets\/v2/);
  assert.match(src,/const \[nowPositions,nowOpen\]=await Promise\.all/);
  assert.match(src,/status=eq\.prepared&broker_order_id=is\.null/);
  assert.match(src,/if\(local\.status!=="prepared"\|\|local\.broker_order_id\)/);
  assert.match(src,/fuseFlattenOrderId/);
  assert.match(src,/fuseExitWindow/);
  assert.match(src,/FUSE_ACTIVE_PAPER_ORDER_STATUSES/);
  assert.match(src,/method:"GET"\|"DELETE"\|"POST"/);
  const cron=JSON.parse(readFileSync(new URL("../vercel.json",import.meta.url),"utf8"));
  assert.ok(cron.crons.some(c=>c.path==="/api/paper-trading/bots/fuse-manage"&&c.schedule==="* * * * 1-5"));
});

test("Fuse emergency sell ID is valid for actual CreatorHub PAPER fill attribution parser",()=>{
  const attribution=load("../src/lib/paper-order-attribution.ts",{
    "./paper-bot-profiles":{PAPER_BOT_PROFILES:[{id:"penny-volatility-day-100",brokerTag:"pny"}]},
  });
  const original=attribution.parsePaperClientOrderId(CLIENT);
  const emergency=attribution.parsePaperClientOrderId(fuseFlattenOrderId(CLIENT));
  assert.equal(original.botId,"penny-volatility-day-100");
  assert.equal(emergency.botId,original.botId);
  assert.equal(emergency.strategyVersion,original.strategyVersion);
  assert.notEqual(emergency.clientOrderId,original.clientOrderId);
});
