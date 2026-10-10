import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const read=p=>readFileSync(path.join(root,p),"utf8");
const modules=new Map();
const loaded=(name)=>{
  if(modules.has(name))return modules.get(name);
  const key=name.startsWith("./")?name.slice(2):name;
  const p="src/lib/"+key+".ts";
  const out={};modules.set(name,out);
  const js=ts.transpileModule(read(p),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
  }).outputText;
  vm.runInNewContext(js,{exports:out,require:loaded,Date,Math,Number,Set,Map},
    {filename:p});
  return out;
};
const api=loaded("./paper-challenge-proposals");
const portability=loaded("./paper-challenge-portability-audit");
const strategies=portability.TRADING_STRATEGIES;
const BOTS=strategies.map(x=>x.legacyBotId);
const now="2026-10-09T19:00:15Z";
const id=(bot)=>strategies.find(x=>x.legacyBotId===bot);
const member=(bot,instance="instance-one")=>({
  legacyBotId:bot,botInstanceId:instance,strategyId:id(bot).strategyId,
  strategyVersion:bot==="weekend-crypto-day-100"?5:1,role:"trading",
});
const ctx=(bot,challenge="small-500",balance=500,instance="instance-one")=>
  portability.createObservationChallenge({
    challengeId:challenge,startingCapitalUsd:balance,equityUsd:balance,
    settledCashUsd:balance,reservedCashUsd:0,buyingPowerUsd:balance,
    botInstances:[member(bot,instance)],researchContributors:[],mode:"shadow",
    brokerAccountRef:null,riskPolicyId:"shared-paper-capital-v1",
  });
const evidence=()=>({
  sourceRecordKey:"plan-identity-1",sourceObservedAt:"2026-10-09T19:00:00Z",
  quoteTimestamp:"2026-10-09T19:00:00Z",quoteSource:"alpaca-data",
  completedCandleTimestamp:"2026-10-09T18:55:00Z",
  sourceEvidenceIds:["journal-123"],marketSessionEligible:true,
  spreadPct:0.1,roundTripCostPct:0.2,concentrationGroup:"test-sector",
  expiresAt:"2026-10-09T19:05:00Z",researchEvidence:[],
});
const generic=(bot,assetClass="stock")=>({
  contractVersion:1,botId:bot,strategyId:id(bot).strategyId,strategyVersion:1,
  symbol:assetClass==="crypto"?"SOL/USD":"XYZ",label:"Sample",assetClass,
  score:95,detail:"Strategy evidence",state:"ready",
  executionEligible:true,selectedForSubmission:true,blockers:[],warnings:[],
  horizons:["day"],currentPrice:100,
  plan:{phase:"ready",entryPrice:100,stopPrice:98,exitPrice:115,
    purchaseAmount:10,maxLossDollars:0.2,projectedProfitDollars:1,
    projectedProfitPct:10},
});
function source(bot){
  switch(bot){
    case "default-diverse":return {botId:bot,adapter:"atlas",plan:generic(bot),maxEntryPrice:100};
    case "penny-volatility-day-100":return {botId:bot,adapter:"fuse",result:{
      ...generic(bot),researchOnly:true,maximumEntry:100,plannedShares:1,
    }};
    case "three-trade-weekly-swing-100":return {botId:bot,adapter:"harbor",plan:{
      symbol:"XYZ",requestedNotional:10,entryTrigger:100,maxEntryPrice:100,
      protectiveStop:98,plannedRiskDollars:0.2,expiresAt:"2026-10-09T19:05:00Z",
    },result:{symbol:"XYZ",state:"ready",selectedForSubmission:true,blockers:[],waitingOn:[]},
      targetPrice:115};
    case "weekend-crypto-day-100":return {botId:bot,adapter:"flash",result:{
      symbol:"SOL/USD",executionEligible:true,selectedForSubmission:true,state:"ready",
      trigger:100,maxEntry:100,protectiveStop:98,takeProfit:115,firstTakeProfitPrice:110,
      blockers:[],waitingOn:[],
    }};
    case "momentum-breakout-100":return {botId:bot,adapter:"pulse",result:{
      symbol:"XYZ",selectedForSubmission:true,state:"ready",trigger:100,
      maxEntry:100,protectiveStop:98,takeProfit:115,blockers:[],waitingOn:[],
    }};
    case "crypto-ignition-100":return {botId:bot,adapter:"spark",result:{
      symbol:"SOL/USD",selectedForSubmission:false,state:"ready",trigger:100,
      maxEntry:100,protectiveStop:98,takeProfit:115,blockers:[],waitingOn:[],
    }};
    case "crypto-swing-100":return {botId:bot,adapter:"orbit",
      plan:generic(bot,"crypto"),maximumEntryPrice:100};
    case "squeeze-breakout-100":return {botId:bot,adapter:"coil",
      plan:generic(bot),maximumEntryPrice:100};
    default:throw Error(bot);
  }
}
const input=(bot,challenge="small-500",balance=500,instance="instance-one")=>({
  challenge:ctx(bot,challenge,balance,instance),botInstanceId:instance,
  source:source(bot),evidence:evidence(),observedAt:now,
  currentSymbols:[],pendingSymbols:[],riskBreakersClear:true,
});
test("eight distinct strategy adapters exactly cover the historical bots",()=>{
  assert.equal(api.CHALLENGE_SOURCE_ADAPTERS.length,8);
  assert.equal(new Set(api.CHALLENGE_SOURCE_ADAPTERS.map(x=>x.botId)).size,8);
  assert.equal(new Set(api.CHALLENGE_SOURCE_ADAPTERS.map(x=>x.strategyId)).size,8);
  for(const bot of BOTS)assert.ok(api.CHALLENGE_SOURCE_ADAPTERS.find(x=>x.botId===bot));
});
test("all eight real source shapes normalize to immutable PAPER-only observation contracts",()=>{
  for(const bot of BOTS){
    const r=api.normalizeChallengeTradeProposal(input(bot));
    assert.equal(r.contractVersion,2);
    assert.equal(r.botId,bot);assert.equal(r.strategyId,id(bot).strategyId);
    assert.equal(r.brokerOrderAuthorized,false);
    assert.equal(r.sharedCapitalCompatible,false);
    assert.equal(r.sizingBasis,"challenge-observation-only");
    assert.equal(r.protectiveStop,98);
    assert.equal(r.entryPrice,100);
    assert.equal(r.finalTargetPrice,115);
  }
});
test("same Spark strategy yields independent capital-scaled shadows in $500 and $5,000",()=>{
  const bot="crypto-ignition-100";
  const a=api.normalizeChallengeTradeProposal(input(bot,"spark-smaller",500));
  const b=api.normalizeChallengeTradeProposal(input(bot,"spark-larger",5000));
  assert.ok(b.requestedNotionalUsd>a.requestedNotionalUsd);
  assert.ok(b.plannedDollarLoss>a.plannedDollarLoss);
  assert.ok(a.plannedDollarLoss<=500*0.0035+0.000001);
  assert.ok(b.plannedDollarLoss<=5000*0.0035+0.000001);
  assert.notEqual(a.decisionKey,b.decisionKey);
  assert.equal(a.brokerOrderAuthorized,false);
  assert.equal(b.brokerOrderAuthorized,false);
});
test("same source record namespaced per bot instance and cannot reuse another instance",()=>{
  const bot="crypto-ignition-100";
  const a=input(bot,"spark-hypothesis",500,"instance-a");
  const b=input(bot,"spark-hypothesis",500,"instance-b");
  b.challenge=portability.createObservationChallenge({...b.challenge,
    botInstances:[member(bot,"instance-b")]});
  assert.notEqual(api.normalizeChallengeTradeProposal(a).decisionKey,
    api.normalizeChallengeTradeProposal(b).decisionKey);
  assert.throws(()=>api.normalizeChallengeTradeProposal({...a,botInstanceId:"unknown-instance"}),/belong/);
});
test("fake source strategy identity is rejected rather than associated with the wrong bot",()=>{
  const a=input("default-diverse");
  a.source.plan.botId="crypto-ignition-100";
  assert.throws(()=>api.normalizeChallengeTradeProposal(a),/identity/);
});
test("research Orbit, Coil, and historical Fuse planning never become authorized",()=>{
  for(const bot of ["crypto-swing-100","squeeze-breakout-100","penny-volatility-day-100"]){
    const r=api.normalizeChallengeTradeProposal(input(bot));
    assert.equal(r.strategyApproved,false);
    assert.equal(r.brokerOrderAuthorized,false);
    assert.notEqual(r.observationState,"qualified-observation");
  }
});
test("a true Flash strategy selection remains only qualified observation",()=>{
  const r=api.normalizeChallengeTradeProposal(input("weekend-crypto-day-100"));
  assert.equal(r.observationState,"qualified-observation");
  assert.equal(r.strategyApproved,true);
  assert.equal(r.brokerOrderAuthorized,false);
  assert.equal(r.partialTargets.length,1);
});
test("missing or future quotes cannot be transformed into ready status",()=>{
  const a=input("weekend-crypto-day-100");
  a.evidence.quoteTimestamp=null;
  const r=api.normalizeChallengeTradeProposal(a);
  assert.equal(r.quoteFresh,false);
  assert.equal(r.observationState,"blocked");
  assert.ok(r.blockers.some(x=>x.includes("quote")));
  a.evidence.quoteTimestamp="2026-10-10T19:00:00Z";
  assert.equal(api.normalizeChallengeTradeProposal(a).quoteFresh,false);
});
test("missing stop and missing target are blocked, never guessed",()=>{
  const a=input("weekend-crypto-day-100");
  a.source.result.protectiveStop=null;
  const r=api.normalizeChallengeTradeProposal(a);
  assert.equal(r.protectiveStop,null);
  assert.equal(r.requestedQuantity,null);
  assert.equal(r.observationState,"insufficient-evidence");
});
test("unknown asset classes stay unknown rather than defaulting to stock",()=>{
  const a=input("default-diverse");
  a.source.plan.assetClass="unknown";
  const r=api.normalizeChallengeTradeProposal(a);
  assert.equal(r.assetClass,"unknown");
  assert.ok(r.blockers.some(x=>x.includes("Asset class")));
});
test("missing pending positions or active loss breakers fail closed",()=>{
  const a=input("weekend-crypto-day-100");
  a.pendingSymbols=null;a.riskBreakersClear=null;
  const r=api.normalizeChallengeTradeProposal(a);
  assert.equal(r.observationState,"blocked");
  assert.ok(r.blockers.some(x=>x.includes("loss-breaker")));
});
test("same-symbol conflict inside challenge must be rejected",()=>{
  const a=input("weekend-crypto-day-100");
  a.currentSymbols=["SOLUSD"];
  assert.ok(api.normalizeChallengeTradeProposal(a).blockers.some(x=>x.includes("holding")));
});
test("requested higher risk cannot relax Spark strategy 0.35 percent",()=>{
  const a=input("crypto-ignition-100");
  a.requestedMaximumRiskPct=0.75;
  const r=api.normalizeChallengeTradeProposal(a);
  assert.ok(r.blockers.some(x=>x.includes("looser")));
  assert.ok(r.plannedDollarLoss<=500*0.0035+0.000001);
});
test("Catalog and Midas evidence must be opted in and never authorize orders",()=>{
  const a=input("weekend-crypto-day-100");
  a.evidence.researchEvidence=[{contributorId:"midas",evidenceId:"form4",observedAt:"2026-10-09T18:00:00Z"}];
  assert.ok(api.normalizeChallengeTradeProposal(a).blockers.some(x=>x.includes("Research evidence")));
  a.challenge=portability.createObservationChallenge({...a.challenge,
    researchContributors:[{contributorId:"midas",role:"research",canSubmitOrders:false}]});
  const b=api.normalizeChallengeTradeProposal(a);
  assert.equal(b.brokerOrderAuthorized,false);
  assert.ok(!b.blockers.some(x=>x.includes("Research evidence")));
});
test("invalid costs, missing candle, expired decision, or no provenance never yield an approved spend",()=>{
  for(const mutation of [
    x=>{x.evidence.roundTripCostPct=null;},
    x=>{x.evidence.completedCandleTimestamp=null;},
    x=>{x.evidence.expiresAt="2026-10-09T18:00:00Z";},
    x=>{x.evidence.sourceEvidenceIds=[];},
  ]){
    const a=input("weekend-crypto-day-100");mutation(a);
    const r=api.normalizeChallengeTradeProposal(a);
    assert.equal(r.brokerOrderAuthorized,false);
    assert.notEqual(r.observationState,"qualified-observation");
  }
});
test("observation normalization never mutates the source challenge or proposal",()=>{
  const a=input("crypto-ignition-100"),before=JSON.stringify(a);
  const first=api.normalizeChallengeTradeProposal(a);
  const second=api.normalizeChallengeTradeProposal(a);
  assert.equal(JSON.stringify(first),JSON.stringify(second));
  assert.equal(JSON.stringify(a),before);
});
test("no broker POST, DB writes, or allocator reservations in Step 2 contract",()=>{
  const src=read("src/lib/paper-challenge-proposals.ts");
  assert.doesNotMatch(src,/\bfetch\s*\(/);
  assert.doesNotMatch(src,/\.from\s*\(/);
  assert.doesNotMatch(src,/paper_shared_preview_claim|paper_shared_preview_release/);
  assert.doesNotMatch(src,/method:\s*["'](?:POST|PATCH|DELETE)["']/);
});
