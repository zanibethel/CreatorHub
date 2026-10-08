import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import ts from "typescript";
import vm from "node:vm";

const code=ts.transpileModule(
  readFileSync(new URL("../src/lib/paper-atlas-execution-plan.ts",import.meta.url),"utf8"),
  {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}
).outputText;
const mod={};
vm.runInNewContext(code,{exports:mod,require:()=>{throw new Error("Unexpected dependency");}});

const base={
  ask:100.2,quoteAgeMs:5_000,cash:99.75,poolRemaining:40,fractionable:true,
  referencePlan:{entryTrigger:100,stopPrice:95,exitPrice:110,riskDollars:.75,uncappedPositionValue:12},
};

test("Atlas stock execution requires trigger and respects risk sizing",()=>{
  const plan=mod.buildAtlasStockExecutionPlan(base);
  assert.equal(plan.executable,true);
  assert.ok(plan.requestedNotional>1);
  assert.ok(plan.requestedNotional<=12.01);
  assert.ok(plan.plannedRiskDollars<=.751);
  assert.equal(plan.maxEntryPrice,100.6);
});

test("Atlas stock execution refuses chase beyond 0.60 percent",()=>{
  const plan=mod.buildAtlasStockExecutionPlan({...base,ask:100.61});
  assert.equal(plan.executable,false);
  assert.ok(plan.blockers.some(x=>x.includes("chase ceiling")));
});

test("Atlas stock execution refuses before breakout trigger",()=>{
  const plan=mod.buildAtlasStockExecutionPlan({...base,ask:99.99});
  assert.equal(plan.executable,false);
  assert.ok(plan.blockers.some(x=>x.includes("not been reached")));
});

test("Atlas stock execution fails closed on stale quote or missing fractional support",()=>{
  const plan=mod.buildAtlasStockExecutionPlan({...base,quoteAgeMs:61_000,fractionable:false});
  assert.equal(plan.executable,false);
  assert.ok(plan.blockers.some(x=>x.includes("60 seconds")));
  assert.ok(plan.blockers.some(x=>x.includes("fractional")));
});

test("Atlas fractional v2 executes the day pool only",()=>{
  assert.equal(mod.atlasExecutionPool(["day","multi-day","multi-week"]),"day");
  assert.equal(mod.atlasExecutionPool(["day"]),"day");
  assert.equal(mod.atlasExecutionPool(["multi-day","multi-week"]),null);
});
