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

const { analyzeCryptoBook, analyzeStockPrints } = exports;
const now = Date.parse("2026-10-08T14:30:00.000Z");

test("buy-side depth is observable but never attributed to a specific buyer", () => {
  const book = {
    t: new Date(now - 8_000).toISOString(),
    b: [{ p: 99.5, s: 1000 }, { p: 98.5, s: 200 }],
    a: [{ p: 100.5, s: 100 }, { p: 101, s: 100 }],
  };
  const result = analyzeCryptoBook("TEST/USD", book, now);
  assert.equal(result.direction, "buy-side-depth");
  assert.equal(result.actor_class, "unattributed");
  assert.equal(result.source_name, "alpaca-crypto-us-orderbook");
  assert.ok(result.score <= 65);
  assert.equal(result.confidence, 30);
  assert.equal(result.available_at, result.observed_at);
  assert.ok(Date.parse(result.available_at) > Date.parse(result.event_at));
});

test("sell-side depth retains negative direction rather than masquerading as accumulation", () => {
  const result = analyzeCryptoBook("TEST/USD", {
    t: new Date(now - 1_000).toISOString(),
    b: [{ p: 99, s: 1 }],
    a: [{ p: 101, s: 500 }],
  }, now);
  assert.equal(result.direction, "sell-side-depth");
  assert.ok(result.score > 0);
});

test("stale or crossed crypto orderbooks are discarded", () => {
  assert.equal(analyzeCryptoBook("BAD/USD", {
    t: new Date(now - 200_000).toISOString(),
    b: [{ p: 99, s: 100 }], a: [{ p: 100, s: 100 }],
  }, now), null);
  assert.equal(analyzeCryptoBook("BAD/USD", {
    t: new Date(now).toISOString(),
    b: [{ p: 105, s: 100 }], a: [{ p: 100, s: 100 }],
  }, now), null);
});

test("large IEX print is labeled unknown-side, not whale buying", () => {
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
