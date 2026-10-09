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

test("Pulse final broker gate chooses fractional only with protected manager enabled", () => {
  const readiness = load("../src/lib/paper-momentum-breakout-readiness.ts");
  const executor = load("../src/app/api/paper-trading/bots/momentum-breakout-execute/route.ts");
  const manager = load("../src/app/api/paper-trading/bots/momentum-breakout-manage/route.ts");
  assert.match(readiness,/fractionalExecutionEnabled\?fractionalReferenceQuantity:null/);
  assert.match(executor,/pulseEntryOrderMode\(plan.plannedQuantity\)/);
  assert.ok(executor.indexOf("if(fractional&&!readiness.fractionalExecutionEnabled)") <
    executor.indexOf("const claim=await fetch("));
  assert.match(executor,/order_class:fractional\?"simple":"bracket"/);
  assert.match(executor,/type:fractional\?"limit":"market"/);
  assert.match(manager,/time_in_force:"day"/);
  assert.match(manager,/parentClientOrderId/);
  assert.match(manager,/15\*60\+40/);
  assert.match(manager,/get\("authorization"\)/);
  const cron=JSON.parse(load("../vercel.json"));
  assert.ok(cron.crons.some(c=>c.path==="/api/paper-trading/bots/momentum-breakout-manage" && c.schedule==="* * * * 1-5"));
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
