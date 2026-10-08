import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../src/lib/paper-pulse-journal-contract.ts", import.meta.url), "utf8");
const exports = {};
const transpiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
vm.runInNewContext(transpiled, { exports });
const classify = exports.classifyPulseJournalPlan;

test("Pulse audit contract uses only DB-permitted statuses", () => {
  assert.deepEqual({ ...classify({ state: "waiting", selectedForSubmission: false }) }, {
    eventType: "candidate", qualification: "watch",
  });
  assert.deepEqual({ ...classify({ state: "blocked", selectedForSubmission: false }) }, {
    eventType: "rejected", qualification: "unqualified",
  });
  assert.deepEqual({ ...classify({ state: "ready", selectedForSubmission: false }) }, {
    eventType: "candidate", qualification: "qualified",
  });
  assert.deepEqual({ ...classify({ state: "ready", selectedForSubmission: true }) }, {
    eventType: "authorized", qualification: "trade-ready",
  });
});

test("Pulse runner fails closed on counterfactual persistence failure", () => {
  const code = readFileSync(new URL("../src/app/api/paper-trading/bots/momentum-breakout-run/route.ts", import.meta.url), "utf8");
  assert.match(code, /action:"counterfactual-error"/);
  assert.doesNotMatch(code, /catch\{\}/);
});

test("Pulse readiness journals heartbeat even when no setup is assigned", () => {
  const code = readFileSync(new URL("../src/app/api/paper-trading/bots/momentum-breakout-readiness/route.ts", import.meta.url), "utf8");
  assert.match(code, /event_type:"system"/);
  assert.match(code, /if\(isCron\)\{/);
  assert.doesNotMatch(code, /event_type:"prospect-intake"/);
});
