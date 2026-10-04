import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function module(path) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { exports, Date, Number, Math });
  return exports;
}

const cf = module("../src/lib/paper-counterfactual.ts");

const snapshot = {
  collectedAt:"2026-10-04T01:00:00Z",
  strategyId:"daily-crypto-day-v3",
  strategyVersion:3,
  executionEnabled:true,
  submissionReady:false,
  selectedSymbol:null,
  broadCryptoSupportive:true,
  session:{localDate:"2026-10-03",entriesOpen:true,flattenDue:false},
  candidates:[
    {
      symbol:"DOT/USD",executionEligible:true,state:"waiting",selectedForSubmission:false,score:65,
      bid:1.17,ask:1.171,spreadPct:0.08,trigger:1.18,maxEntry:1.185,protectiveStop:1.16,takeProfit:1.22,
      plannedRiskDollars:0.24,waitingOn:["breakout"],blockers:[],
      trackingBars:[{t:"2026-10-04T00:55:00Z",o:1.17,h:1.175,l:1.168,c:1.172}],
    },
    {
      symbol:"AVAX/USD",executionEligible:false,state:"waiting",selectedForSubmission:false,score:85,
      bid:11,ask:11.1,spreadPct:0.9,trigger:11.2,maxEntry:11.3,protectiveStop:10.9,takeProfit:11.8,
      plannedRiskDollars:0.24,waitingOn:[],blockers:[],
      trackingBars:[],
    },
  ],
};

function state(overrides={}) {
  return {
    id:1,setupKey:"daily-crypto:daily-crypto-day-v3:v3:2026-10-03:DOT/USD",
    botId:"weekend-crypto-day-100",strategyId:"daily-crypto-day-v3",strategyVersion:3,
    symbol:"DOT/USD",assetClass:"crypto",decisionAt:"2026-10-04T01:00:00Z",sessionKey:"2026-10-03",
    status:"watching",score:65,triggerPrice:1.18,maxEntryPrice:1.185,protectiveStop:1.16,
    plannedTakeProfit:1.22,assumedEntryPrice:null,riskPerUnit:null,oneRPrice:null,twoRPrice:null,
    triggeredAt:null,stopHitAt:null,oneRHitAt:null,twoRHitAt:null,firstOutcome:null,
    peakPrice:null,troughPrice:null,lastBarAt:"2026-10-04T00:55:00Z",markCount:0,mfeR:0,maeR:0,
    blockers:[],warnings:["breakout"],metadata:{paperOnly:true},...overrides,
  };
}

test("serious execution-tier near miss seeds once while monitor-only does not",()=>{
  const seeds=cf.buildDailyCryptoCounterfactualSeeds("weekend-crypto-day-100",snapshot);
  assert.equal(seeds.length,1);
  assert.equal(seeds[0].symbol,"DOT/USD");
  assert.equal(seeds[0].score,65);
  assert.equal(seeds[0].status,"watching");
  assert.equal(seeds[0].last_bar_at,"2026-10-04T00:55:00Z");
});

test("a setup selected for an actual enabled submission is not seeded as a missed trade",()=>{
  const current={...snapshot,submissionReady:true,selectedSymbol:"DOT/USD"};
  current.candidates=[{...snapshot.candidates[0],state:"ready",score:90,selectedForSubmission:true}];
  assert.equal(cf.buildDailyCryptoCounterfactualSeeds("weekend-crypto-day-100",current).length,0);
});

test("future bars trigger the setup, record +1R, then record stop after +1R",()=>{
  const bars=[
    {t:"2026-10-04T01:00:00Z",o:1.17,h:1.181,l:1.17,c:1.18},
    {t:"2026-10-04T01:05:00Z",o:1.18,h:1.205,l:1.176,c:1.20},
    {t:"2026-10-04T01:10:00Z",o:1.20,h:1.204,l:1.155,c:1.16},
  ];
  const result=cf.advancePaperCounterfactual(state(),bars,{expire:false});
  assert.equal(result.changed,true);
  assert.equal(result.state.assumedEntryPrice,1.18);
  assert.equal(result.state.oneRPrice,1.2);
  assert.equal(result.state.oneRHitAt,"2026-10-04T01:05:00Z");
  assert.equal(result.state.stopHitAt,"2026-10-04T01:10:00Z");
  assert.equal(result.state.status,"completed");
  assert.equal(result.state.firstOutcome,"stop-after-one-r");
  assert.ok(result.state.mfeR>=1);
  assert.ok(result.state.maeR<=-1);
});

test("stop and target in the same post-entry bar are explicitly ambiguous",()=>{
  const triggered=state({
    status:"triggered",assumedEntryPrice:1.18,riskPerUnit:0.02,oneRPrice:1.20,twoRPrice:1.22,
    triggeredAt:"2026-10-04T01:00:00Z",peakPrice:1.19,troughPrice:1.18,lastBarAt:"2026-10-04T01:00:00Z",
  });
  const result=cf.advancePaperCounterfactual(triggered,[
    {t:"2026-10-04T01:05:00Z",o:1.18,h:1.225,l:1.155,c:1.19},
  ],{expire:false});
  assert.equal(result.state.status,"ambiguous");
  assert.equal(result.state.firstOutcome,"stop-or-two-r-same-bar");
  assert.equal(result.state.stopHitAt,"2026-10-04T01:05:00Z");
  assert.equal(result.state.twoRHitAt,"2026-10-04T01:05:00Z");
});

test("a gap entirely above max entry does not invent a fill",()=>{
  const result=cf.advancePaperCounterfactual(state(),[
    {t:"2026-10-04T01:00:00Z",o:1.20,h:1.21,l:1.19,c:1.205},
  ],{expire:false});
  assert.equal(result.state.status,"watching");
  assert.equal(result.state.assumedEntryPrice,null);
  assert.equal(result.state.metadata.gapAboveMaxEntryObserved,true);
});

test("session expiry distinguishes never-triggered from triggered without resolution",()=>{
  const never=cf.advancePaperCounterfactual(state(),[],{expire:true});
  assert.equal(never.state.status,"expired");
  assert.equal(never.state.firstOutcome,"never-triggered");

  const triggered=cf.advancePaperCounterfactual(state({
    status:"triggered",assumedEntryPrice:1.18,riskPerUnit:0.02,oneRPrice:1.20,twoRPrice:1.22,
    triggeredAt:"2026-10-04T01:00:00Z",peakPrice:1.195,troughPrice:1.175,
  }),[],{expire:true});
  assert.equal(triggered.state.status,"expired");
  assert.equal(triggered.state.firstOutcome,"session-end-before-one-r");
});
