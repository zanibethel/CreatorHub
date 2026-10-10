import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const file=readFileSync(path.join(root,"src/lib/paper-challenge-portability-audit.ts"),"utf8");
const exports={};
vm.runInNewContext(ts.transpileModule(file,{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText,{exports});
const {TRADING_STRATEGIES:strategies,CAPITAL_DEPENDENCIES:deps,
  createObservationChallenge:create,plannedObservationLimits:limits,
  namespacedAuditKey:key,assessChallengeBrokerIsolation:isolation}=exports;

const member=(id,index)=>({
  legacyBotId:id,
  strategyId:strategies.find(s=>s.legacyBotId===id).strategyId,
  strategyVersion:1,botInstanceId:"instance-"+index,role:"trading",
});
const context=(challengeId,startingCapitalUsd,members,brokerAccountRef=null)=>create({
  challengeId,startingCapitalUsd,equityUsd:startingCapitalUsd,
  settledCashUsd:startingCapitalUsd,buyingPowerUsd:startingCapitalUsd,reservedCashUsd:0,
  botInstances:members,researchContributors:[],riskPolicyId:"shared-paper-capital-v1",
  brokerAccountRef,mode:"shadow",
});

test("all eight stable legacy IDs map to canonical, versioned trading strategies",()=>{
  assert.equal(strategies.length,8);
  assert.equal(new Set(strategies.map(x=>x.legacyBotId)).size,8);
  assert.equal(new Set(strategies.map(x=>x.strategyId)).size,8);
  assert.ok(strategies.every(x=>x.strategyId.includes("v")));
});
test("legacy $100 identifiers are retained, never renamed into challenge IDs",()=>{
  assert.ok(strategies.some(x=>x.legacyBotId==="penny-volatility-day-100"));
  assert.ok(strategies.some(x=>x.legacyBotId==="default-diverse"));
});
test("each detected capital dependency has explicit impact, parameter, adapter and risk",()=>{
  assert.ok(deps.length>=15);
  for(const row of deps){
    assert.ok(row.source&&row.assumption&&row.impact&&row.parameter&&row.adapter&&row.risk);
    assert.ok(["low","medium","high","critical"].includes(row.risk));
  }
  for(const area of ["src/lib/paper-trading-config.ts","src/lib/paper-shared-capital-manager.ts",
    "src/app/api/paper-trading/bots/route.ts","paper_bot_ledgers"]){
    assert.ok(deps.some(x=>x.source.includes(area)),area);
  }
});
test("a $500 Fuse/Pulse and $5000 all-eight observation context are independent",()=>{
  const all=context("bigorders-all-eight",5000,strategies.map((x,i)=>member(x.legacyBotId,i)));
  const small=context("fuse-vs-pulse",500,[member("penny-volatility-day-100",0),member("momentum-breakout-100",1)]);
  assert.equal(all.botInstances.length,8);
  assert.equal(small.botInstances.length,2);
  const a=limits(all,0.5,12);
  const b=limits(small,0.5,12);
  assert.equal(a.maxRiskUsd,25);
  assert.equal(b.maxRiskUsd,2.5);
  assert.equal(a.maxPositionUsd,600);
  assert.equal(b.maxPositionUsd,60);
  assert.equal(a.spendAuthorized,false);
  assert.equal(b.spendAuthorized,false);
  assert.notEqual(key(all,"instance-0","setup-alpha"),key(small,"instance-0","setup-alpha"));
  assert.equal(all.brokerIsolationVerified,false);
});
test("two Spark instances in different challenges have disjoint reservation/journal keys",()=>{
  const bot=member("crypto-ignition-100",0);
  const a=context("spark-intelligence-a",5000,[bot]);
  const b=context("spark-intelligence-b",5000,[bot]);
  assert.notEqual(key(a,bot.botInstanceId,"same"),key(b,bot.botInstanceId,"same"));
  assert.throws(()=>key(a,"not-in-challenge","same"),/belong/);
});
test("duplicate bot instance IDs in one challenge are rejected",()=>{
  const memberA=member("crypto-ignition-100",0);
  assert.throws(()=>context("bad-duplicate",500,[memberA,memberA]),/duplicate/);
});
test("optional Catalog/Midas research contributors can never request order submission",()=>{
  const base=context("spark-intelligence",5000,[member("crypto-ignition-100",0)]);
  assert.throws(()=>create({...base,researchContributors:[{contributorId:"midas",role:"research",canSubmitOrders:true}]}),/research/);
  const accepted=create({...base,researchContributors:[
    {contributorId:"catalog",role:"research",canSubmitOrders:false},
    {contributorId:"midas",role:"research",canSubmitOrders:false},
  ]});
  assert.equal(accepted.researchContributors.length,2);
  assert.ok(accepted.researchContributors.every(r=>r.canSubmitOrders===false));
});
test("shadow challenge prototypes never acquire broker authority",()=>{
  const base=context("valid-id",500,[member("crypto-ignition-100",0)]);
  assert.throws(()=>create({...base,mode:"broker-paper"}),/shadow-only/);
  assert.throws(()=>context("zero-cash",0,[member("crypto-ignition-100",0)]),/capital/);
  assert.throws(()=>context("invalid characters!",500,[member("crypto-ignition-100",0)]),/ID/);
});
test("overlapping Alpaca PAPER account ownership cannot be certified safe",()=>{
  const bot=member("crypto-ignition-100",0);
  const a=context("spark-a",5000,[bot],"alpaca-paper-account-one");
  const b=context("spark-b",5000,[bot],"alpaca-paper-account-one");
  const snapshot=isolation([{...a,mode:"broker-paper"},{...b,mode:"broker-paper"}]);
  assert.equal(snapshot.concurrentBrokerExecutionSafe,false);
  assert.equal(snapshot.brokerExecutionAuthorized,false);
  assert.ok(snapshot.issues.some(x=>x.includes("Physical PAPER account shared")));
});
test("distinct shadow-only challenges remain independent of broker positions",()=>{
  const bot=member("crypto-ignition-100",0);
  const a=context("spark-a",5000,[bot],"alpaca-paper-account-one");
  const b=context("spark-b",5000,[bot],"alpaca-paper-account-one");
  const result=isolation([a,b]);
  assert.equal(result.independentShadowAllowed,true);
  assert.equal(result.brokerExecutionAuthorized,false);
});
test("challenge observations are deterministic and non-mutating",()=>{
  const a=context("spark-a",5000,[member("crypto-ignition-100",0)]);
  const before=JSON.stringify(a);
  assert.equal(key(a,"instance-0","setup-1"),key(a,"instance-0","setup-1"));
  limits(a,0.5,12);isolation([a]);
  assert.equal(JSON.stringify(a),before);
  assert.ok(!file.includes("POST \"https://paper-api.alpaca.markets"));
});
