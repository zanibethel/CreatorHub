import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import ts from "typescript";
import vm from "node:vm";

const code=ts.transpileModule(
  readFileSync(new URL("../src/lib/paper-atlas-crypto-execution-plan.ts",import.meta.url),"utf8"),
  {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}
).outputText;
const mod={};
vm.runInNewContext(code,{exports:mod,require:(id)=>id.includes("paper-atlas-execution-plan")?{}:{}});

const base={
  ask:100.2,quoteAgeMs:5_000,cash:100,poolRemaining:40,
  referencePlan:{entryTrigger:100,stopPrice:95,exitPrice:110,riskDollars:.75,uncappedPositionValue:15},
};

test("Atlas crypto sizing reserves estimated entry fee and stays within risk",()=>{
  const plan=mod.buildAtlasCryptoExecutionPlan(base);
  assert.equal(plan.executable,true);
  assert.ok(plan.requestedNotional>1);
  assert.ok(plan.reservedAmount>plan.requestedNotional);
  assert.ok(plan.reservedAmount<=15.01);
  assert.ok(plan.plannedRiskDollars<=.751);
  assert.equal(plan.feeBpsPerSide,25);
});

test("Atlas crypto refuses stale quote, untriggered breakout and chase",()=>{
  assert.equal(mod.buildAtlasCryptoExecutionPlan({...base,quoteAgeMs:61_000}).executable,false);
  assert.equal(mod.buildAtlasCryptoExecutionPlan({...base,ask:99.9}).executable,false);
  assert.equal(mod.buildAtlasCryptoExecutionPlan({...base,ask:100.61}).executable,false);
});

test("Atlas crypto rejects stops wider than 8 percent",()=>{
  const plan=mod.buildAtlasCryptoExecutionPlan({
    ...base,referencePlan:{...base.referencePlan,stopPrice:90}
  });
  assert.equal(plan.executable,false);
  assert.ok(plan.blockers.some(x=>x.includes("8.00%")));
});

test("Atlas crypto uses swing horizons, never invents a crypto day session",()=>{
  assert.equal(mod.atlasCryptoExecutionPool(["day","multi-day","multi-week"]),"multi-day");
  assert.equal(mod.atlasCryptoExecutionPool(["multi-day","multi-week"]),"multi-day");
  assert.equal(mod.atlasCryptoExecutionPool(["multi-week"]),"multi-week");
  assert.equal(mod.atlasCryptoExecutionPool(["day"]),null);
});
