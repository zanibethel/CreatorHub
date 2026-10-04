import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function load(path, imports = {}) {
  const exports = {};
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, {
    exports,
    Intl,
    Date,
    require: name => {
      if (name in imports) return imports[name];
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  return exports;
}

const config = load("../src/lib/paper-weekend-crypto-strategy-config.ts");
const readiness = load("../src/lib/paper-weekend-crypto-readiness.ts", {
  "./paper-weekend-crypto-strategy-config": config,
});

const now = Date.parse("2026-10-03T18:00:00Z");

function bars(count, minutes, base, step) {
  return Array.from({ length: count }, (_, index) => {
    const close = base + step * index;
    return {
      t: new Date(now - (count - index) * minutes * 60_000).toISOString(),
      o: close - 0.03,
      h: close + 0.08,
      l: close - 0.08,
      c: close,
      v: 10,
    };
  });
}

function input(overrides = {}) {
  const universe = config.DAILY_CRYPTO_DAY_STRATEGY_V4.universe;
  const bars5m = Object.fromEntries(universe.map(symbol => [symbol, bars(30,5,100,0.05)]));
  const bars15m = Object.fromEntries(universe.map(symbol => [symbol, bars(20,15,95,0.20)]));
  const ask = bars5m["BTC/USD"].at(-1).c + 0.09;
  const quotes = Object.fromEntries(universe.map(symbol => [
    symbol,
    { bid: ask - 0.03, ask, timestamp: new Date(now - 2_000).toISOString() },
  ]));
  return {
    now,
    ledger: {
      active: true,
      equity: 100,
      buyingPower: 100,
      openRiskPct: 0,
      dailyRealizedLossPct: 0,
      openPositions: 0,
      dailyNewEntries: 0,
      executionEnabled: false,
    },
    quotes,
    bars5m,
    bars15m,
    occupiedByOtherBots: [],
    ...overrides,
  };
}

test("daily crypto scanner can select one qualified PAPER candidate while execution is disabled", () => {
  const result = readiness.evaluateWeekendCryptoReadiness(input());
  assert.equal(result.session.isTradingDay, true);
  assert.equal(result.session.isWeekend, true);
  assert.equal(result.session.entriesOpen, true);
  assert.equal(result.paperOnly, true);
  assert.equal(result.executionEnabled, false);
  assert.equal(result.submissionReady, false);
  assert.equal(result.candidates.filter(candidate => candidate.selectedForSubmission).length, 1);
  const selected = result.candidates.find(candidate => candidate.selectedForSubmission);
  assert.equal(selected.state, "ready");
  assert.equal(selected.executionEligible, true);
  assert.equal(selected.tier, "execution");
  assert.ok(selected.score >= 80);
  assert.ok(selected.plannedNotional <= 30.000001);
  assert.ok(selected.plannedRiskPct <= 0.500001);
  assert.ok(selected.feeCoverageMultiple >= 2.5);
});

test("v4 makes LINK and DOT executable while extended alts stay monitor-only", () => {
  const result = readiness.evaluateWeekendCryptoReadiness(input());
  for (const symbol of ["BTC/USD","ETH/USD","SOL/USD","LINK/USD","DOT/USD"]) {
    const candidate = result.candidates.find(item => item.symbol === symbol);
    assert.equal(candidate.executionEligible, true);
    assert.equal(candidate.tier, "execution");
  }
  for (const symbol of ["XRP/USD","LTC/USD","AVAX/USD","DOGE/USD","ADA/USD","BCH/USD","AAVE/USD","HYPE/USD","RENDER/USD"]) {
    const candidate = result.candidates.find(item => item.symbol === symbol);
    assert.equal(candidate.executionEligible, false);
    assert.equal(candidate.tier, "monitor");
  }
});

test("all monitor-only READY candidates can never be selected for submission", () => {
  const base = input({
    occupiedByOtherBots: [...config.DAILY_CRYPTO_DAY_STRATEGY_V4.executionUniverse],
  });
  const result = readiness.evaluateWeekendCryptoReadiness(base);

  for (const symbol of config.DAILY_CRYPTO_DAY_STRATEGY_V4.monitorOnlyUniverse) {
    const candidate = result.candidates.find(item => item.symbol === symbol);
    assert.equal(candidate.state, "ready");
    assert.equal(candidate.executionEligible, false);
    assert.equal(candidate.tier, "monitor");
    assert.equal(candidate.selectedForSubmission, false);
  }

  assert.equal(
    result.candidates.some(candidate => candidate.tier === "monitor" && candidate.selectedForSubmission),
    false,
  );
  assert.equal(result.selectedSymbol, null);
  assert.equal(result.submissionReady, false);
});

test("another bot holding the same symbol blocks that daily crypto candidate", () => {
  const result = readiness.evaluateWeekendCryptoReadiness(input({
    occupiedByOtherBots: ["SOL/USD"],
  }));
  const sol = result.candidates.find(candidate => candidate.symbol === "SOL/USD");
  assert.equal(sol.state, "blocked");
  assert.match(sol.blockers.join(" "), /already holds this symbol/i);
});

test("weekday session remains an eligible trading day", () => {
  const monday = Date.parse("2026-10-05T18:00:00Z");
  const base = input();
  const quotes = Object.fromEntries(Object.entries(base.quotes).map(([symbol, quote]) => [
    symbol,
    { ...quote, timestamp: new Date(monday - 2_000).toISOString() },
  ]));
  const result = readiness.evaluateWeekendCryptoReadiness({ ...base, now: monday, quotes });
  assert.equal(result.session.isWeekend, false);
  assert.equal(result.session.isTradingDay, true);
  assert.equal(result.session.entriesOpen, true);
  assert.equal(result.candidates.some(candidate => !candidate.blockers.some(blocker => /session is closed/i.test(blocker))), true);
});

test("daily loss kill switch blocks new daily crypto risk", () => {
  const base = input();
  const result = readiness.evaluateWeekendCryptoReadiness({
    ...base,
    ledger: { ...base.ledger, dailyRealizedLossPct: 1.5 },
  });
  assert.equal(result.candidates.every(candidate => candidate.state === "blocked"), true);
  assert.match(result.candidates[0].blockers.join(" "), /daily realized-loss kill switch/i);
});

test("one open position blocks additional entries", () => {
  const base = input();
  const result = readiness.evaluateWeekendCryptoReadiness({
    ...base,
    ledger: { ...base.ledger, openPositions: 1 },
  });
  assert.equal(result.openPositionSlotsRemaining, 0);
  assert.equal(result.candidates.every(candidate => candidate.state === "blocked"), true);
});


test("broker minimum buffer blocks a risk-valid but undersized challenge entry", () => {
  const base = input();
  const result = readiness.evaluateWeekendCryptoReadiness({
    ...base,
    ledger: { ...base.ledger, equity: 30, buyingPower: 30 },
  });
  assert.equal(result.candidates.every(candidate => candidate.state === "blocked"), true);
  assert.match(result.candidates[0].blockers.join(" "), /broker-minimum buffer/i);
});

test("armed execution still requires a selected ready setup", () => {
  const base = input();
  const armed = readiness.evaluateWeekendCryptoReadiness({
    ...base,
    ledger: { ...base.ledger, executionEnabled: true },
  });
  assert.equal(armed.submissionReady, true);

  const staleQuotes = Object.fromEntries(Object.entries(base.quotes).map(([symbol, quote]) => [
    symbol,
    { ...quote, timestamp: new Date(now - 120_000).toISOString() },
  ]));
  const stale = readiness.evaluateWeekendCryptoReadiness({
    ...base,
    ledger: { ...base.ledger, executionEnabled: true },
    quotes: staleQuotes,
  });
  assert.equal(stale.submissionReady, false);
});


test("v4 keeps entries open after the old 22:30 cutoff and never schedules a routine nightly flatten", () => {
  const late = Date.parse("2026-10-04T04:50:00Z"); // 23:50 Saturday America/Chicago
  const base = input();
  const quotes = Object.fromEntries(Object.entries(base.quotes).map(([symbol, quote]) => [
    symbol,
    { ...quote, timestamp: new Date(late - 2_000).toISOString() },
  ]));
  const result = readiness.evaluateWeekendCryptoReadiness({ ...base, now: late, quotes });
  assert.equal(result.session.localTime, "23:50");
  assert.equal(result.session.entriesOpen, true);
  assert.equal(result.session.flattenDue, false);
  assert.equal(
    result.candidates.some(candidate => candidate.blockers.some(blocker => /entry window|session.*closed/i.test(blocker))),
    false,
  );
});

test("v4 local midnight remains an accounting boundary rather than a market close", () => {
  const before = readiness.dailyCryptoSession(Date.parse("2026-10-04T04:59:00Z"));
  const after = readiness.dailyCryptoSession(Date.parse("2026-10-04T05:01:00Z"));
  assert.notEqual(before.localDate, after.localDate);
  assert.equal(before.entriesOpen, true);
  assert.equal(after.entriesOpen, true);
  assert.equal(before.flattenDue, false);
  assert.equal(after.flattenDue, false);
});
