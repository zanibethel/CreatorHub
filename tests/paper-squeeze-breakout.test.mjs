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

const strategy = module("../src/lib/paper-squeeze-breakout-strategy-config.ts");
const scanner = module("../src/lib/paper-squeeze-scanner.ts", {
  "./paper-squeeze-breakout-strategy-config": strategy,
});
const tradePlan = module("../src/lib/paper-bot-trade-plan.ts");
const readiness = module("../src/lib/paper-squeeze-breakout-readiness.ts", {
  "./paper-bot-trade-plan": tradePlan,
  "./paper-squeeze-breakout-strategy-config": strategy,
});

function compressedBars() {
  const start = Date.parse("2026-07-01T20:00:00Z");
  return Array.from({ length: 50 }, (_, index) => {
    const dry = index >= 40;
    const center = 102 + (index % 5) * 0.25;
    return {
      t: new Date(start + index * 86_400_000).toISOString(),
      o: center,
      h: 108,
      l: 100,
      c: index === 49 ? 102 : center,
      v: dry ? 400_000 : 1_000_000,
    };
  });
}

test("squeeze scanner rewards a quiet compressed base followed by volume ignition", () => {
  const result = scanner.scoreSqueezeProspect({
    symbol: "TEST",
    bars: compressedBars(),
    currentPrice: 108.5,
    previousClose: 102,
    currentVolume: 2_000_000,
    sessionElapsedFraction: 0.5,
    spreadPct: 0.2,
  });

  assert.equal(result.status, "review-ready");
  assert.equal(result.watchlistEligible, true);
  assert.equal(result.botReviewEligible, true);
  assert.ok(result.score >= 85);
  assert.ok(result.metrics.volumeDryRatio <= 0.5);
  assert.ok(result.metrics.relativeVolumePace >= 2);
  assert.ok(result.metrics.breakoutDistancePct <= 0);
});

test("squeeze scanner rejects a broad loose range without ignition", () => {
  const bars = compressedBars().map((bar, index) => ({
    ...bar,
    h: 140,
    l: 100,
    c: 112 + (index % 8),
    v: 1_000_000,
  }));
  const result = scanner.scoreSqueezeProspect({
    symbol: "LOOSE",
    bars,
    currentPrice: 115,
    previousClose: 114,
    currentVolume: 300_000,
    sessionElapsedFraction: 0.75,
    spreadPct: 0.8,
  });

  assert.equal(result.watchlistEligible, false);
  assert.ok(result.score < strategy.SQUEEZE_BREAKOUT_STRATEGY_V1.scanner.thresholds.watchlistScore);
});

test("ready-quality squeeze remains non-executable while PAPER research execution is disabled", () => {
  const plan = readiness.evaluateSqueezeBreakoutCandidate({
    now: Date.parse("2026-10-05T15:00:00Z"),
    prospect: {
      symbol: "TEST",
      scannerScore: 95,
      baseHigh: 100,
      baseLow: 94,
      baseRangePct: 6,
      relativeVolumePace: 3,
      sessionChangePct: 5,
      spreadPct: 0.2,
      averageDollarVolume: 5_000_000,
      reasons: ["compressed base", "volume ignition"],
    },
    quote: {
      bid: 100.4,
      ask: 100.6,
      timestamp: "2026-10-05T14:59:30Z",
    },
    ledger: {
      active: true,
      equity: 100,
      buyingPower: 100,
      openRiskPct: 0,
      openPositions: 0,
      executionEnabled: false,
    },
  });

  assert.ok(plan.score >= 85);
  assert.equal(plan.state, "QUALIFIED");
  assert.equal(plan.executionEligible, false);
  assert.equal(plan.selectedForSubmission, false);
  assert.equal(plan.plan.phase, "reference");
  assert.ok(Math.abs(plan.plan.entryPrice - 100.25) < 0.0001);
  assert.ok(Math.abs(plan.plan.projectedProfitPct - 25) < 0.0001);
  assert.match(plan.warnings.join(" "), /execution.*not armed/i);
});


test("squeeze strategy explicitly includes the requested penny stock range", () => {
  const scannerConfig = strategy.SQUEEZE_BREAKOUT_STRATEGY_V1.scanner;
  assert.equal(scannerConfig.minimumPriceUsd, 0.08);
  assert.equal(scannerConfig.pennyStockMaximumPriceUsd, 5);
  assert.ok(scannerConfig.maximumPriceUsd > scannerConfig.pennyStockMaximumPriceUsd);
});


test("squeeze scanner preserves valid sub-cent historical base prices", () => {
  const bars = compressedBars().map(bar => ({
    ...bar,
    o: 0.0045,
    h: 0.0049,
    l: 0.0041,
    c: 0.0045,
  }));
  const result = scanner.scoreSqueezeProspect({
    symbol: "MICRO",
    bars,
    currentPrice: 0.08,
    previousClose: 0.0045,
    currentVolume: 2_000_000,
    sessionElapsedFraction: 0.5,
    spreadPct: 0.2,
  });

  assert.equal(result.metrics.baseLow, 0.0041);
  assert.equal(result.metrics.baseHigh, 0.0049);
  assert.ok(result.metrics.baseLow > 0);
});
