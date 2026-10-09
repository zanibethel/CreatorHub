import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source=readFileSync(new URL("../src/lib/paper-shared-capital-manager.ts",import.meta.url),"utf8");
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const exports={};
vm.runInNewContext(code,{exports,require:()=>{throw new Error("Unexpected import");}});
const {PAPER_SHARED_CAPITAL_POLICY_V1:policy,previewSharedPaperAllocation:preview,wilsonWinRateLowerBound:wilson}=exports;

const portfolio=(patch={})=>({
  equityUsd:5000,settledCashUsd:5000,buyingPowerUsd:5000,reservedCashUsd:0,
  dayStartEquityUsd:5000,weekStartEquityUsd:5000,dayProfitLossUsd:0,weekProfitLossUsd:0,
  holdings:[],pendingEntries:[],...patch,
});
const stock=(patch={})=>({
  botId:"default-diverse",symbol:"ACME",sleeve:"stocks",assetClass:"stock",
  concentrationGroup:"industrials",entryPrice:100,stopPrice:97,targetPrice:109,
  roundTripCostPct:0.2,strategyQualified:true,freshQuote:true,
  marketSessionEligible:true,brokerProtectionSupported:true,
  speculative:false,...patch,
});

test("new baseline is $5k preview-only; original $100 bot challenge untouched",()=>{
  assert.equal(policy.startingEquityUsd,5000);
  assert.equal(policy.paperOnly,true);
  assert.equal(policy.status,"preview-only");
});

test("whole-share allocation is limited by position cap, actual stop and friction",()=>{
  const x=preview(stock(),portfolio());
  assert.equal(x.state,"allocatable");
  assert.equal(x.quantity,6);
  assert.equal(x.plannedNotionalUsd,600);
  assert.ok(x.plannedLossUsd<=25);
  assert.ok(x.plannedNetTargetRewardUsd>0);
  assert.ok(x.netRewardRisk>2);
  assert.equal(x.brokerOrderAuthorized,false);
});

test("a $100 parallel account gets a shadow trade instead of an invalid one-share bracket",()=>{
  const x=preview(stock(),portfolio({equityUsd:100,settledCashUsd:100,buyingPowerUsd:100,
    dayStartEquityUsd:100,weekStartEquityUsd:100}));
  assert.equal(x.state,"shadow-only");
  assert.equal(x.quantity,0);
  assert.ok(x.reasons.some(s=>s.includes("protected position")));
});

test("settled cash and reserve are enforced even if broker reports margin buying power",()=>{
  const x=preview(stock(),portfolio({settledCashUsd:1050,buyingPowerUsd:20000}));
  assert.equal(x.state,"shadow-only");
  assert.equal(x.cashAvailableForDeploymentUsd,50);
});

test("crypto uses fractional quantity but cannot exceed 15% crypto sleeve",()=>{
  const x=preview(stock({botId:"weekend-crypto-day-100",symbol:"BTC/USD",assetClass:"crypto",
    sleeve:"crypto",concentrationGroup:"CRYPTO",entryPrice:60000,stopPrice:57000,
    targetPrice:69000,roundTripCostPct:0.7}),portfolio());
  assert.equal(x.state,"allocatable");
  assert.ok(x.quantity>0&&x.quantity<0.0125);
  assert.ok(x.plannedNotionalUsd<=750.00001);
  assert.equal(x.brokerOrderAuthorized,false);
});

test("already-owned or pending physical symbols cannot receive a second real-sized allocation",()=>{
  const existing={symbol:"ACME",sleeve:"stocks",concentrationGroup:"industrials",
    marketValueUsd:100,plannedLossUsd:3};
  assert.equal(preview(stock(),portfolio({holdings:[existing]})).state,"shadow-only");
  assert.equal(preview(stock(),portfolio({pendingEntries:[existing]})).state,"shadow-only");
  assert.equal(preview(stock({symbol:"ACME/USD"}),portfolio({holdings:[existing]})).state,"shadow-only");
});

test("sector concentration, open risk, and existing sleeve exposure cap further spending",()=>{
  const exposure={symbol:"XYZ",sleeve:"stocks",concentrationGroup:"industrials",
    marketValueUsd:1250,plannedLossUsd:10};
  const x=preview(stock(),portfolio({holdings:[exposure]}));
  assert.equal(x.state,"shadow-only");
  assert.ok(x.limitingFactors.includes("concentration cap"));
  const risk=preview(stock(),portfolio({holdings:[
    {symbol:"X",sleeve:"swing",concentrationGroup:"utilities",marketValueUsd:600,plannedLossUsd:100},
  ]}));
  assert.equal(risk.state,"shadow-only");
  assert.ok(risk.limitingFactors.includes("aggregate open risk"));
});

test("daily and weekly circuit breakers prevent allocations, never authorize bypass",()=>{
  assert.equal(preview(stock(),portfolio({dayProfitLossUsd:-100})).state,"shadow-only");
  assert.equal(preview(stock(),portfolio({weekProfitLossUsd:-200})).state,"shadow-only");
});

test("quality requirements are separate from affordability",()=>{
  const stale=preview(stock({freshQuote:false}),portfolio());
  assert.equal(stale.state,"rejected");
  assert.ok(stale.reasons.some(s=>s.includes("fresh")));
  const noProtection=preview(stock({brokerProtectionSupported:false}),portfolio());
  assert.equal(noProtection.state,"rejected");
  assert.equal(preview(stock({strategyQualified:false}),portfolio()).state,"rejected");
  assert.equal(preview(stock({targetPrice:103}),portfolio()).state,"rejected");
});

test("historical scores never imply a 95% win probability",()=>{
  const x=preview(stock({meritEvidence:{
    sampleSize:10,winners:10,averageWinR:3,averageLossR:1,
  }}),portfolio());
  assert.equal(x.expectedNetR,null);
  assert.equal(x.riskBudgetUsd,25);
  assert.ok(wilson(50,100)<0.5);
});

test("proven sizing needs ample conservative historical evidence",()=>{
  const x=preview(stock({meritEvidence:{
    sampleSize:300,winners:270,averageWinR:3,averageLossR:1,
  }}),portfolio());
  assert.equal(x.state,"allocatable");
  assert.equal(x.riskBudgetUsd,37.5);
  assert.ok(x.expectedNetR>0);
  const weak=preview(stock({meritEvidence:{
    sampleSize:100,winners:25,averageWinR:2,averageLossR:1,
  }}),portfolio());
  assert.equal(weak.state,"rejected");
  assert.ok(weak.reasons.some(s=>s.includes("expected value")));
});

test("incomplete, malformed or zero-cost snapshots fail closed",()=>{
  assert.throws(()=>preview(stock(),portfolio({equityUsd:NaN})),/Invalid portfolio/);
  assert.throws(()=>preview(stock({roundTripCostPct:0}),portfolio()),/Invalid candidate/);
  assert.throws(()=>preview(stock(),portfolio({holdings:[{
    symbol:"XYZ",sleeve:"stocks",concentrationGroup:"",
    marketValueUsd:100,plannedLossUsd:5,
  }]})),/Invalid portfolio exposure/);
});
