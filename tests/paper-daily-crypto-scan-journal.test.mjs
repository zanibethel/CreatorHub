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

const journal = module("../src/lib/paper-daily-crypto-scan-journal.ts");

const baseCandidate = {
  symbol: "BTC/USD",
  tier: "execution",
  executionEligible: true,
  state: "ready",
  selectedForSubmission: true,
  score: 90,
  bid: 100,
  ask: 100.05,
  spreadPct: 0.05,
  quoteAgeSeconds: 5,
  fastMomentumPct: 0.2,
  slowMomentumPct: 0.3,
  atrPct: 0.5,
  trigger: 100,
  maxEntry: 100.2,
  protectiveStop: 99,
  takeProfit: 102,
  plannedNotional: 30,
  plannedQuantity: 0.3,
  plannedRiskDollars: 0.3,
  plannedRiskPct: 0.3,
  estimatedRoundTripFees: 0.15,
  estimatedGrossTargetDollars: 0.6,
  feeCoverageMultiple: 4,
  waitingOn: [],
  blockers: [],
};

test("five-minute Daily Crypto journal preserves evidence without broker IDs", () => {
  const snapshot = {
    collectedAt: "2026-10-04T03:05:00.000Z",
    strategyId: "daily-crypto-day-v3",
    strategyVersion: 3,
    paperOnly: true,
    broadCryptoSupportive: true,
    executionEnabled: true,
    submissionReady: true,
    selectedSymbol: "BTC/USD",
    session: {
      localDate: "2026-10-03",
      localWeekday: "Sat",
      localTime: "22:05",
      isTradingDay: true,
      entriesOpen: true,
      flattenDue: false,
    },
    candidates: [
      baseCandidate,
      {
        ...baseCandidate,
        symbol: "XRP/USD",
        tier: "monitor",
        executionEligible: false,
        selectedForSubmission: false,
        score: 90,
      },
    ],
  };

  const rows = journal.buildDailyCryptoScanJournalRows("weekend-crypto-day-100", snapshot);
  assert.equal(rows.length, 2);

  const btc = rows.find(row => row.symbol === "BTC/USD");
  const xrp = rows.find(row => row.symbol === "XRP/USD");

  assert.equal(btc.qualification, "trade-ready");
  assert.equal(btc.metadata.selectedForSubmission, true);
  assert.equal(btc.market_snapshot.spreadPct, 0.05);
  assert.equal(btc.risk_plan.feeCoverageMultiple, 4);

  assert.equal(xrp.qualification, "qualified");
  assert.equal(xrp.metadata.tier, "monitor");
  assert.equal(xrp.metadata.executionEligible, false);
  assert.equal(xrp.metadata.selectedForSubmission, false);

  for (const row of rows) {
    assert.equal(Object.hasOwn(row, "broker_order_id"), false);
    assert.equal(Object.hasOwn(row, "client_order_id"), false);
  }
});
