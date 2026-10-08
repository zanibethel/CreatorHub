import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const load = path => readFileSync(new URL(path, import.meta.url), "utf8");
const compiled = ts.transpileModule(load("../src/lib/paper-momentum-breakout-readiness.ts"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const exports = {};
vm.runInNewContext(compiled, {
  exports,
  require: () => ({ MOMENTUM_BREAKOUT_STRATEGY_V1: {} }),
});
const quantity = exports.pulseBracketWholeShareQuantity;

test("Pulse broker-hosted brackets use whole shares under the original risk and allocation caps", () => {
  assert.equal(quantity(1.9, 4.5), 1);
  assert.equal(quantity(9, 2.99), 2);
  assert.equal(quantity(0.99, 100), null);
  assert.equal(quantity(10, 0.8), null);
  assert.equal(quantity(NaN, 10), null);
  assert.equal(quantity(Infinity, 10), null);
});

test("Pulse final broker gate refuses fractions before claiming a prepared order", () => {
  const readiness = load("../src/lib/paper-momentum-breakout-readiness.ts");
  const executor = load("../src/app/api/paper-trading/bots/momentum-breakout-execute/route.ts");
  assert.match(readiness, /plannedQuantity=pulseBracketWholeShareQuantity\(qtyByRisk,qtyByAllocation\)/);
  assert.match(executor, /if\(!Number\.isSafeInteger\(plan\.plannedQuantity\)\|\|plan\.plannedQuantity<1\)/);
  assert.ok(executor.indexOf("Number.isSafeInteger(plan.plannedQuantity)") < executor.indexOf("const claim=await fetch("));
  assert.match(executor, /order_class:"bracket"/);
  assert.match(executor, /https:\/\/paper-api\.alpaca\.markets\/v2/);
});

test("Fuse research journals only database-allowed events, qualification and regime", () => {
  const source = load("../src/app/api/paper-trading/bots/fuse-readiness/route.ts");
  assert.match(source, /event_type:row\.readiness==="rejected"\?"rejected":"candidate"/);
  assert.match(source, /qualification:row\.readiness==="research-ready"\?"qualified":row\.readiness==="rejected"\?"unqualified":"watch"/);
  assert.match(source, /regime:"unknown"/);
  assert.doesNotMatch(source, /event_type:"prospect-intake"/);
  assert.doesNotMatch(source, /regime:"intraday"/);
  assert.match(source, /researchOnly:true,executionEnabled:false,submissionReady:false/);
});
