import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function load(path, imports={}) {
  const exports={};
  const transpiled=ts.transpileModule(readFileSync(new URL(path,import.meta.url),"utf8"),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
  }).outputText;
  vm.runInNewContext(transpiled,{exports,require:(name)=>{
    if(name in imports)return imports[name];
    throw Error("Unexpected import "+name);
  },Intl,Date,Math,Number,Map,Object,Array,Set});
  return exports;
}
const config=load("../src/lib/paper-fuse-strategy-config.ts");
const contract=load("../src/lib/paper-bot-trade-plan.ts");
const {evaluateFuseCandidate,fuseSession}=load("../src/lib/paper-fuse-readiness.ts",{
  "./paper-fuse-strategy-config":config,"./paper-bot-trade-plan":contract,
});
const now=Date.parse("2026-10-08T15:00:00Z");
function sample(price=1.17){
  const bars=Array.from({length:17},(_,i)=>({
    t:new Date(Date.parse("2026-10-08T13:30:00Z")+i*300000).toISOString(),
    o:1.14+i*0.0006,h:i===16?1.168:1.154+i*0.0006,
    l:1.115+i*0.0006,c:i===16?1.164:1.144+i*0.0006,v:i===16?90000:14000,
  }));
  return {now,prospect:{symbol:"FUSE",scannerScore:85,scannerVersion:3,
    lastSeenAt:new Date(now-120000).toISOString(),price,sessionChangePct:4,volume:500000,assigned:true},
    quote:{bid:price-0.002,ask:price+0.002,timestamp:new Date(now-10000).toISOString()},
    bars5m:bars,ledger:{active:true,equity:100,buyingPower:100,openRiskPct:0,dailyLossPct:0,
      openPositions:0,dailyEntries:0,hasExistingOrderOrPosition:false}};
}
test("Fuse is a distinct research-only penny strategy",()=>{
 assert.equal(config.FUSE_PENNY_STRATEGY_V1.id,"penny-volatility-day-v1");
 const result=evaluateFuseCandidate(sample());
 assert.equal(result.botId,"penny-volatility-day-100");
 assert.equal(result.executionEligible,false);
 assert.equal(result.selectedForSubmission,false);
 assert.equal(result.researchOnly,true);
 assert.equal(result.horizons[0],"day");
});
test("minimum and maximum penny prices are inclusive",()=>{
 for(const price of [0.08,5]){
   const input=sample(price);input.prospect.price=price;input.quote.bid=price;input.quote.ask=price;
   const p=evaluateFuseCandidate(input);
   assert.equal(p.blockers.some(s=>s.includes("Outside $0.08")),false);
 }
 for(const price of [0.07999,5.00001]){
   const input=sample(price);input.prospect.price=price;input.quote.bid=price;input.quote.ask=price;
   const p=evaluateFuseCandidate(input);
   assert.ok(p.blockers.some(s=>s.includes("Outside $0.08")));
 }
});
test("stale or future-dated quotes never research-ready",()=>{
 for(const age of [200,-60]){
   const input=sample();
   input.quote.timestamp=new Date(now-age*1000).toISOString();
   assert.notEqual(evaluateFuseCandidate(input).readiness,"research-ready");
 }
});
test("wide penny spreads are refused",()=>{
 const input=sample();input.quote.bid=1.1;input.quote.ask=1.2;
 assert.ok(evaluateFuseCandidate(input).blockers.some(s=>s.includes("spread")));
});
test("risk sizing uses only Fuse $100 and never exceeds 20% or 0.5% planned stop loss",()=>{
 const plan=evaluateFuseCandidate(sample());
 assert.ok(plan.plan.purchaseAmount<=20.000001);
 assert.ok(plan.plan.maxLossDollars<=0.500001);
 assert.ok(Number.isInteger(plan.plannedShares));
 assert.ok(plan.plan.stopPrice<plan.plan.entryPrice);
 assert.ok(plan.plan.exitPrice>plan.plan.entryPrice);
});
test("existing order or position refuses duplicates",()=>{
 const input=sample();input.ledger.hasExistingOrderOrPosition=true;
 assert.ok(evaluateFuseCandidate(input).blockers.some(s=>s.includes("Duplicate")));
});
test("daily loss, open risk, positions, and trade count trigger vetoes",()=>{
 for(const key of ["dailyLossPct","openRiskPct","openPositions","dailyEntries"]){
   const input=sample();input.ledger[key]=10;
   assert.notEqual(evaluateFuseCandidate(input).readiness,"research-ready");
 }
});
test("chase >1.25% and >12% session gain both refuse",()=>{
 const high=sample(1.45);
 assert.ok(evaluateFuseCandidate(high).blockers.some(s=>s.includes("chase")));
 const moved=sample();moved.prospect.sessionChangePct=18;
 assert.ok(evaluateFuseCandidate(moved).blockers.some(s=>s.includes("extended")));
});
test("session and incomplete bars cannot authorize research-ready",()=>{
 const input=sample();input.now=Date.parse("2026-10-08T21:00:00Z");
 assert.notEqual(evaluateFuseCandidate(input).readiness,"research-ready");
 assert.equal(fuseSession(Date.parse("2026-10-08T19:50:00Z")).canEnter,false);
 assert.equal(fuseSession(Date.parse("2026-10-08T19:50:00Z")).mustFlattenByClose,true);
 const short=sample();short.bars5m=short.bars5m.slice(0,3);
 assert.notEqual(evaluateFuseCandidate(short).readiness,"research-ready");
});
test("history signals cannot override liquidity and duplicate gates",()=>{
 const input=sample();input.ledger.hasExistingOrderOrPosition=true;
 input.historicalPatternScore=99;
 assert.notEqual(evaluateFuseCandidate(input).readiness,"research-ready");
});
