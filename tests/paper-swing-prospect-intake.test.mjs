import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function load(path, imports = {}) {
  const exports = {};
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
  }).outputText;
  vm.runInNewContext(code,{
    exports,Math,Number,Date,
    require:name=>{
      if(name in imports) return imports[name];
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  return exports;
}

const config=load("../src/lib/paper-swing-strategy-config.ts");
const intake=load("../src/lib/paper-swing-prospect-intake.ts",{
  "./paper-swing-strategy-config":config,
});

const now=Date.parse("2026-10-06T14:00:00Z");
const bars=Array.from({length:25},(_,index)=>{
  const close=20+index*0.2;
  return {
    t:new Date(Date.parse("2026-09-01T20:00:00Z")+index*86_400_000).toISOString(),
    o:close-0.1,h:close+0.3,l:close-0.4,c:close,
  };
});

function candidate(overrides={}) {
  return {
    symbol:"EARLY",
    scannerId:"paper-prospect-scanner-v3",
    scannerVersion:3,
    scannerScore:88,
    lastSeenAt:new Date(now-5*60_000).toISOString(),
    assignedBotIds:["three-trade-weekly-swing-100"],
    price:25.1,
    percentChange:8,
    spreadPct:0.08,
    scoreComponents:{acceleration:18,catalyst:6,chasePenalty:0},
    currentAsk:25.12,
    currentBid:25.10,
    quoteAt:new Date(now-5_000).toISOString(),
    dailyBars:bars,
    equity:100,
    buyingPower:100,
    now,
    expiresAt:"2026-10-06T20:00:00Z",
    existingExposure:false,
    ...overrides,
  };
}

test("fresh v3 prospect can become a prepared swing plan",()=>{
  const result=intake.evaluateSwingProspectIntake(candidate());
  assert.equal(result.eligible,true);
  assert.ok(result.plan);
  assert.ok(result.plan.entryTrigger>=25.12);
  assert.ok(result.plan.protectiveStop<result.plan.entryTrigger);
  assert.ok(result.plan.maxEntryPrice>result.plan.entryTrigger);
  assert.ok(result.plan.takeProfitPrice>result.plan.entryTrigger);
  assert.ok(result.plan.plannedRiskDollars<=1.000001);
  assert.ok(result.plan.requestedNotional<=30.000001);
});

test("late OPCH-style move is recorded but not staged when chase risk is high",()=>{
  const result=intake.evaluateSwingProspectIntake(candidate({
    symbol:"OPCH",
    scannerScore:82,
    percentChange:32.8,
    scoreComponents:{acceleration:0,catalyst:2,chasePenalty:22},
    currentAsk:31.06,currentBid:31.05,price:31.055,
  }));
  assert.equal(result.eligible,false);
  assert.ok(result.blockers.some(reason=>/chase-risk/i.test(reason)));
  assert.ok(result.blockers.some(reason=>/fresh continuation/i.test(reason)));
});

test("duplicate exposure blocks staging",()=>{
  const result=intake.evaluateSwingProspectIntake(candidate({existingExposure:true}));
  assert.equal(result.eligible,false);
  assert.ok(result.blockers.some(reason=>/existing position or active order/i.test(reason)));
});

test("stale prospect cannot be staged",()=>{
  const result=intake.evaluateSwingProspectIntake(candidate({
    lastSeenAt:new Date(now-45*60_000).toISOString(),
  }));
  assert.equal(result.eligible,false);
  assert.ok(result.blockers.some(reason=>/stale/i.test(reason)));
});
