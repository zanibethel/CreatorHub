import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const config={FUSE_PENNY_STRATEGY_V1:{
  market:{maximumQuoteAgeSeconds:90},
  risk:{riskPerTradePct:0.5,maximumAllocationPct:20},
}};
const source=readFileSync(new URL("../src/lib/paper-fuse-bracket.ts",import.meta.url),"utf8");
const transpiled=ts.transpileModule(source,{compilerOptions:{
  module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,
}}).outputText;
const exports={};
vm.runInNewContext(transpiled,{exports,require:key=>{
  if(key==="./paper-fuse-strategy-config")return config;
  throw Error("Unexpected module "+key);
},Number,Math,Date,RegExp});
const draft=exports.fuseBracketPreview;

function candidate(override={}){
  return {symbol:"NVD",readiness:"research-ready",blockers:[],
    quoteAgeSeconds:12,bid:3.49,ask:3.5,entryTrigger:3.46346,
    maximumEntry:3.50675,plannedShares:6,
    plan:{stopPrice:3.428825,exitPrice:3.53273},...override};
}
const ledger={equity:100,buyingPower:100};
test("Fuse bracket preview caps whole shares by $20 cash, $0.50 risk, and actual limit price",()=>{
  const out=draft(candidate(),ledger);
  assert.equal(out.eligible,true,JSON.stringify(out.blockers));
  assert.equal(out.order.qty,5);
  assert.equal(out.order.limitPrice,3.5);
  assert.equal(out.order.stopPrice,3.43);
  assert.equal(out.order.takeProfitPrice,3.54);
  assert.ok(out.order.plannedNotional<=20);
  assert.ok(out.order.plannedLoss<=0.5);
  assert.equal(out.order.orderClass,"bracket");
  assert.equal(out.order.timeInForce,"day");
  assert.equal(out.order.entryType,"limit");
});
test("Fuse refuses quote-chasing beyond max entry and stale data without lower thresholds",()=>{
  assert.equal(draft(candidate({ask:3.51}),ledger).eligible,false);
  assert.equal(draft(candidate({quoteAgeSeconds:91}),ledger).eligible,false);
  assert.equal(draft(candidate({readiness:"prepared"}),ledger).eligible,false);
  assert.equal(draft(candidate({blockers:["halt"]}),ledger).eligible,false);
  assert.equal(draft(candidate({ask:null}),ledger).eligible,false);
});
test("Fuse penny-stock bracket rejects stops too close for Alpaca's $0.01 advanced-order rule",()=>{
  const sample=candidate({symbol:"FNGR",bid:0.205,ask:0.206,
    entryTrigger:0.205,maximumEntry:0.208,plannedShares:80,
    plan:{stopPrice:0.1995,exitPrice:0.216}});
  const out=draft(sample,ledger);
  assert.equal(out.eligible,false);
  assert.match(out.blockers.join(" "),/\$0.01/);
});
test("Fuse supports four-decimal penny ticks but refuses whole-share cash-risk overflow",()=>{
  const sample=candidate({symbol:"FNGR",bid:0.208,ask:0.20921,
    entryTrigger:0.209,maximumEntry:0.2118,plannedShares:99,
    plan:{stopPrice:0.19721,exitPrice:0.24001}});
  const out=draft(sample,ledger);
  assert.equal(out.eligible,true,JSON.stringify(out.blockers));
  assert.equal(out.order.limitPrice,0.2093);
  assert.equal(out.order.stopPrice,0.1973);
  assert.equal(out.order.takeProfitPrice,0.2401);
  assert.ok(out.order.plannedLoss<=0.5+1e-9);
  assert.ok(out.order.plannedNotional<=20+1e-9);
  assert.ok(out.order.qty<99);
});
test("Fuse entry planner is publicly read-only and cannot submit broker orders",()=>{
  const route=readFileSync(new URL("../src/app/api/paper-trading/bots/fuse-execution-preview/route.ts",import.meta.url),"utf8");
  const readiness=readFileSync(new URL("../src/lib/paper-fuse-readiness.ts",import.meta.url),"utf8");
  assert.match(route,/export async function GET/);
  assert.doesNotMatch(route,/export async function POST/);
  assert.doesNotMatch(route,/paper-api\.alpaca|\/orders/);
  assert.match(route,/const executionEnabled=ledger.metadata.executionEnabled===true/);
  assert.match(route,/const pilotEnabled=ledger.metadata.fusePilotEnabled===true/);
  assert.match(route,/pilotArmed,submissionReady:false/);
  assert.match(route,/protectedExitManagerRequired:true/);
  assert.match(readiness,/bid:validQuote\?quote\.bid:null,ask:validQuote\?quote\.ask:null/);
});
