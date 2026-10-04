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
  vm.runInNewContext(code, { exports });
  return exports;
}

const evidence = module("../src/lib/paper-swing-evidence.ts");

const plan = {
  clientOrderId: "chb-sw3-v1-20261003-qqqstage01",
  symbol: "QQQ",
  requestedNotional: 26.6,
  entryTrigger: 755,
  maxEntryPrice: 760,
  protectiveStop: 727,
  plannedRiskDollars: 1,
  expiresAt: "2026-10-06T00:00:00Z",
  createdAt: "2026-10-03T18:34:16Z",
  stageReason: "Monday breakout continuation.",
  takeProfitPrice: 812,
  takeProfitFraction: 0.5,
  takeProfitR: 2,
  protectWinnerAtR: 1,
  trailRemainder: true,
  metadata: { setup: "breakout", sourceDate: "2026-10-02" },
};

test("swing revalidation evidence preserves staged plan and readiness context", () => {
  const [row] = evidence.buildSwingRevalidationJournalRows({
    botId: "three-trade-weekly-swing-100",
    strategyId: "three-trade-weekly-swing-v1",
    strategyVersion: 1,
    collectedAt: "2026-10-05T14:00:00Z",
    broadMarketSupportive: true,
    marketOpen: true,
    minutesSinceOpen: 30,
    weeklySlotsRemaining: 3,
    openPositionSlotsRemaining: 3,
    executionEnabled: true,
    plans: [plan],
    readiness: [{
      symbol: "QQQ",
      state: "ready",
      selectedForSubmission: true,
      bid: 755.4,
      ask: 755.5,
      spreadPct: 0.013,
      quoteAgeSeconds: 5,
      plannedRiskPct: 1,
      allocationPct: 26.6,
      correlationGroup: "us-megacap-tech",
      blockers: [],
      waitingOn: [],
    }],
  });

  assert.equal(row.event_type, "authorized");
  assert.equal(row.qualification, "trade-ready");
  assert.equal(row.client_order_id, plan.clientOrderId);
  assert.equal(row.risk_plan.entryTrigger, 755);
  assert.equal(row.risk_plan.takeProfitR, 2);
  assert.equal(row.metadata.stageReason, "Monday breakout continuation.");
  assert.equal(row.metadata.terminalDisposition, null);
});

test("expired swing plans are journaled with explicit terminal disposition", () => {
  const [row] = evidence.buildSwingRevalidationJournalRows({
    botId: "three-trade-weekly-swing-100",
    strategyId: "three-trade-weekly-swing-v1",
    strategyVersion: 1,
    collectedAt: "2026-10-06T00:01:00Z",
    broadMarketSupportive: true,
    marketOpen: false,
    minutesSinceOpen: null,
    weeklySlotsRemaining: 3,
    openPositionSlotsRemaining: 3,
    executionEnabled: true,
    plans: [plan],
    readiness: [{
      symbol: "QQQ",
      state: "blocked",
      selectedForSubmission: false,
      bid: null,
      ask: null,
      spreadPct: null,
      quoteAgeSeconds: null,
      plannedRiskPct: 1,
      allocationPct: 26.6,
      correlationGroup: "us-megacap-tech",
      blockers: ["Prepared plan has expired."],
      waitingOn: ["Market is closed."],
    }],
  });

  assert.equal(row.event_type, "rejected");
  assert.equal(row.metadata.expired, true);
  assert.equal(row.metadata.terminalDisposition, "expired");
  assert.ok(row.blockers.some(reason => /expired/i.test(reason)));
});
