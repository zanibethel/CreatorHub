import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function module(path, imports = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, {
    exports,
    require: name => {
      if (name in imports) return imports[name];
      throw new Error(`Unexpected import ${name}`);
    },
  });
  return exports;
}

const config = module("../src/lib/paper-strategy-config.ts");
const engine = module("../src/lib/paper-decision-engine.ts", { "./paper-strategy-config": config });
const now = Date.parse("2026-10-03T15:00:00Z");

const candidate = {
  symbol: "AAPL", label: "Apple", role: "Individual-stock candidate",
  pools: ["day", "multi-day", "multi-week"], rationale: "fixture",
  return1y: 30, volatility: 25, maxDrawdown: -14, fractionable: true, tradable: true, tier: "initial",
};

function candles({ start = 100, step = 0.2, volumeStart = 1000 } = {}) {
  return Array.from({ length: 35 }, (_, index) => {
    const close = start + step * index;
    return {
      time: new Date(now - (34 - index) * 86_400_000).toISOString(),
      close,
      high: close * 1.006,
      low: close * 0.994,
      volume: volumeStart + index * 25,
    };
  });
}

function evaluate(overrides = {}) {
  return engine.evaluatePaperCandidate({
    candidate,
    assetClass: "stock",
    quote: { bid: 106.7, ask: 106.8, timestamp: new Date(now - 10_000).toISOString() },
    candles: candles(),
    benchmarkCandles: candles({ step: 0.05 }),
    now,
    risk: { accountEquity: 100, openRiskPct: 0, correlatedRiskPct: 0, dailyRealizedLossPct: 0, weeklyDrawdownPct: 0 },
    ...overrides,
  });
}

test("strategy v1 persists approved score and risk defaults", () => {
  const strategy = config.PAPER_STRATEGY_V1;
  assert.equal(strategy.version, 1);
  assert.equal(Object.values(strategy.score.weights).reduce((a, b) => a + b, 0), 100);
  assert.equal(strategy.score.thresholds.tradeReady, 85);
  assert.equal(strategy.risk.standardRiskPct, 0.75);
  assert.equal(strategy.risk.highConvictionRiskPct, 1);
  assert.equal(strategy.risk.maxOpenRiskPct, 4);
  assert.equal(strategy.risk.dailyRealizedLossLimitPct, 2.5);
  assert.equal(strategy.risk.weeklyDrawdownLimitPct, 6);
});

test("strong bullish setup is scored but dry-run never authorizes an order", () => {
  const result = evaluate();
  assert.ok(result.score >= 85, `expected trade-ready score, got ${result.score}`);
  assert.equal(result.qualification, "trade-ready");
  assert.equal(result.regime, "bullish");
  assert.equal(result.riskPlan.riskDollars, result.score >= 92 ? 1 : 0.75);
  assert.equal(result.orderSubmission, false);
  assert.equal(result.eligibleUnderAvailableRules, false);
  assert.ok(result.blockers.some(reason => /pool allocation capacity/i.test(reason)));
});

test("stale quotes and bearish regime independently veto a candidate", () => {
  const result = evaluate({
    quote: { bid: 106.7, ask: 106.8, timestamp: new Date(now - 120_000).toISOString() },
    benchmarkCandles: candles({ start: 110, step: -0.3 }),
  });
  assert.ok(result.blockers.some(reason => /fresh quote/i.test(reason)));
  assert.ok(result.blockers.some(reason => /regime is bearish/i.test(reason)));
});

test("portfolio loss and heat limits veto new risk", () => {
  const result = evaluate({
    risk: { accountEquity: 100, openRiskPct: 3.5, correlatedRiskPct: 1.5, dailyRealizedLossPct: 2.5, weeklyDrawdownPct: 6 },
  });
  assert.ok(result.blockers.some(reason => /open-risk ceiling/i.test(reason)));
  assert.ok(result.blockers.some(reason => /correlated-risk ceiling/i.test(reason)));
  assert.ok(result.blockers.some(reason => /Daily loss kill switch/i.test(reason)));
  assert.ok(result.blockers.some(reason => /Weekly drawdown kill switch/i.test(reason)));
});

test("inverse candidates remain monitor-only", () => {
  const result = evaluate({ candidate: { ...candidate, symbol: "SH", pools: [], role: "Inverse monitor only" } });
  assert.ok(result.blockers.some(reason => /monitor-only/i.test(reason)));
  assert.equal(result.orderSubmission, false);
});
