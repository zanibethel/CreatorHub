import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const exports = {};
const source = readFileSync(new URL("../src/lib/paper-market-mover-intelligence.ts", import.meta.url), "utf8");
const transpiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
vm.runInNewContext(transpiled, { exports, Math, Number, Date });
const { analyzeCryptoBook, analyzeStockPrints, MIDAS_CRYPTO_QUALITY_V2 } = exports;
const now = Date.parse("2026-10-08T14:30:00.000Z");

function liquidBook(at = now - 8_000) {
  return {
    t: new Date(at).toISOString(),
    b: [{ p: 99.9, s: 800 }, { p: 99.8, s: 600 }, { p: 99.7, s: 500 }],
    a: [{ p: 100.1, s: 400 }, { p: 100.2, s: 350 }, { p: 100.3, s: 300 }],
  };
}

function priorFor(current, elapsedMinutes = 15) {
  const observed = new Date(now - elapsedMinutes * 60_000).toISOString();
  return {
    symbol: current.symbol,
    signal_kind: current.signal_kind,
    observed_bucket: new Date(now - elapsedMinutes * 60_000).toISOString(),
    observed_at: observed,
    available_at: observed,
    direction: current.direction,
    source_name: current.source_name,
    evidence: {
      quality_version: MIDAS_CRYPTO_QUALITY_V2.version,
      quality_gates_passed: true,
    },
  };
}

test("liquid directional first scan is watching with zero eligible score", () => {
  const result = analyzeCryptoBook("TEST/USD", liquidBook(), now);
  assert.equal(result.direction, "buy-side-depth");
  assert.equal(result.actor_class, "unattributed");
  assert.equal(result.source_name, "alpaca-crypto-us-orderbook");
  assert.equal(result.evidence.quality_status, "watching");
  assert.equal(result.evidence.quality_gates_passed, true);
  assert.equal(result.score, 0);
  assert.equal(result.confidence, 0);
  assert.equal(result.evidence.confirmed_scan_count, 1);
  assert.equal(result.available_at, result.observed_at);
  assert.ok(Date.parse(result.event_at) < Date.parse(result.available_at));
});

test("second independently persisted same-direction qualified scan confirms low-confidence evidence", () => {
  const first = analyzeCryptoBook("TEST/USD", liquidBook(), now);
  const second = analyzeCryptoBook("TEST/USD", liquidBook(), now, [priorFor(first)]);
  assert.equal(second.evidence.quality_status, "confirmed");
  assert.equal(second.evidence.confirmed_scan_count, 2);
  assert.ok(second.score > 0 && second.score <= 65);
  assert.equal(second.confidence, 30);
  assert.equal(second.actor_class, "unattributed");
});

test("BAT-style $7 ask liquidity and wide spread cannot produce high score even repeatedly", () => {
  const book = {
    t: new Date(now - 2_000).toISOString(),
    b: [{ p: 0.100, s: 70_000 }, { p: 0.099, s: 45_000 }],
    a: [{ p: 0.1006, s: 35 }, { p: 0.101, s: 35 }],
  };
  const first = analyzeCryptoBook("BAT/USD", book, now);
  assert.equal(first.direction, "buy-side-depth");
  assert.equal(first.evidence.quality_status, "rejected");
  assert.equal(first.score, 0);
  assert.match(first.evidence.quality_reason, /insufficient-two-sided-depth/);
  assert.match(first.evidence.quality_reason, /wide-spread/);
  const again = analyzeCryptoBook("BAT/USD", book, now, [priorFor(first)]);
  assert.equal(again.evidence.quality_status, "rejected");
  assert.equal(again.score, 0);
});

test("repeated unvalidated legacy v1 observation never confirms an apparent whale", () => {
  const first = analyzeCryptoBook("TEST/USD", liquidBook(), now);
  const legacy = priorFor(first);
  legacy.evidence = { bid_depth_usd: 500_000, ask_depth_usd: 100_000 };
  const result = analyzeCryptoBook("TEST/USD", liquidBook(), now, [legacy]);
  assert.equal(result.evidence.quality_status, "watching");
  assert.equal(result.score, 0);
});

test("same bucket, reverse direction, future, stale or other symbol cannot confirm", () => {
  const first = analyzeCryptoBook("TEST/USD", liquidBook(), now);
  const wrong = [
    { ...priorFor(first), observed_bucket: first.observed_bucket },
    { ...priorFor(first), direction: "sell-side-depth" },
    { ...priorFor(first), symbol: "OTHER/USD" },
    priorFor(first, 75),
    priorFor(first, 2),
    {
      ...priorFor(first), available_at: new Date(now + 60_000).toISOString(),
    },
  ];
  for (const previous of wrong) {
    const result = analyzeCryptoBook("TEST/USD", liquidBook(), now, [previous]);
    assert.equal(result.score, 0);
    assert.equal(result.evidence.quality_status, "watching");
  }
});

test("single concentrated order or too few levels cannot masquerade as broad depth", () => {
  const result = analyzeCryptoBook("TEST/USD", {
    t: new Date(now - 1_000).toISOString(),
    b: [{ p: 99.9, s: 3_000 }, { p: 99.8, s: 1 }],
    a: [{ p: 100.1, s: 1_000 }, { p: 100.2, s: 1 }],
  }, now);
  assert.equal(result.score, 0);
  assert.equal(result.evidence.quality_status, "rejected");
  assert.match(result.evidence.quality_reason, /concentrated-displayed-liquidity/);
});

test("sell-side liquidity remains sell-side and must satisfy the same depth gates", () => {
  const book = liquidBook();
  book.b = [{ p: 99.9, s: 400 }, { p: 99.8, s: 350 }, { p: 99.7, s: 300 }];
  book.a = [{ p: 100.1, s: 800 }, { p: 100.2, s: 600 }, { p: 100.3, s: 500 }];
  const first = analyzeCryptoBook("TEST/USD", book, now);
  assert.equal(first.direction, "sell-side-depth");
  assert.equal(first.evidence.quality_status, "watching");
  const result = analyzeCryptoBook("TEST/USD", book, now, [priorFor(first)]);
  assert.equal(result.evidence.quality_status, "confirmed");
  assert.equal(result.direction, "sell-side-depth");
  assert.ok(result.score > 0);
});

test("stale or crossed crypto orderbooks are discarded instead of saved", () => {
  const stale = liquidBook(now - 200_000);
  assert.equal(analyzeCryptoBook("BAD/USD", stale, now), null);
  assert.equal(analyzeCryptoBook("BAD/USD", {
    t: new Date(now).toISOString(),
    b: [{ p: 105, s: 100 }], a: [{ p: 100, s: 100 }],
  }, now), null);
});

test("large IEX print remains unattributed with unknown trade side", () => {
  const trades = [100, 100, 100, 100, 100, 12_000].map((size, i) => ({
    t: new Date(now - (i + 1) * 1_000).toISOString(), p: 10, s: size,
  }));
  const result = analyzeStockPrints("TEST", trades, now);
  assert.equal(result.direction, "unknown");
  assert.equal(result.actor_class, "unattributed");
  assert.equal(result.evidence.trade_direction_known, false);
  assert.equal(result.evidence.sampled_trade_count, 6);
  assert.equal(result.evidence.largest_print_usd, 120_000);
  assert.ok(result.score <= 65);
});

test("small, stale or insufficient prints do not invent a signal", () => {
  const small = [100, 100, 100, 100, 110].map(size => ({
    t: new Date(now - 2_000).toISOString(), p: 10, s: size,
  }));
  assert.equal(analyzeStockPrints("TEST", small, now), null);
  assert.equal(analyzeStockPrints("TEST", small.slice(0, 2), now), null);
  assert.equal(analyzeStockPrints("TEST", small.map(trade => ({
    ...trade, t: new Date(now - 25 * 60_000).toISOString(),
  })), now), null);
});
