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
  vm.runInNewContext(code, { exports, Date });
  return exports;
}

const evidence = module("../src/lib/paper-order-lifecycle-evidence.ts");

test("execution failure evidence is explicit and contains no broker identifier field", () => {
  const row = evidence.buildPaperExecutionFailureJournalRow({
    botId: "three-trade-weekly-swing-100",
    strategyId: "three-trade-weekly-swing-v1",
    strategyVersion: 1,
    symbol: "QQQ",
    assetClass: "etf",
    clientOrderId: "chb-sw3-v1-20261003-qqqstage01",
    occurredAt: "2026-10-05T14:00:00Z",
    phase: "broker-submission",
    reason: "Broker outcome could not be confirmed.",
    side: "buy",
    brokerLookupPending: true,
  });

  assert.equal(row.event_type, "execution_error");
  assert.equal(row.metadata.paperOnly, true);
  assert.equal(row.metadata.phase, "broker-submission");
  assert.equal(row.metadata.brokerLookupPending, true);
  assert.deepEqual(Array.from(row.blockers), ["Broker outcome could not be confirmed."]);
  assert.equal(Object.hasOwn(row, "broker_order_id"), false);
});
