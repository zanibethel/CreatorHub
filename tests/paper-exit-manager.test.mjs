import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import vm from "node:vm";
import ts from "typescript";

function module(path, globals = {}) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, {
    exports, fetch, Request, Response, AbortSignal, URL, crypto: webcrypto,
    setTimeout, clearTimeout, ...globals,
    require: name => { throw new Error(`Unexpected import: ${name}`); },
  });
  return exports;
}

const exits = module("../supabase/functions/paper-report-sync/exits.ts");

const basePosition = {
  bot_id: "default-diverse",
  symbol: "SOL/USD",
  asset_class: "crypto",
  quantity: 0.163,
  average_entry: 120,
  protective_stop: 118,
  initial_protective_stop: 118,
  take_profit_price: 123.5,
  take_profit_fraction: 0.25,
  take_profit_r: 1.75,
  protect_winner_at_r: 1,
  trail_remainder: true,
  strategy_id: "paper-medium-high-v1",
  strategy_version: 1,
  metadata: { estimatedFeeBps: 25 },
  exit_manager_state: { partialProfitState: "armed" },
};

const protective = {
  client_order_id: "chb-div-v1-stop-fixture001",
  bot_id: "default-diverse",
  symbol: "SOL/USD",
  side: "sell",
  status: "submitted",
  broker_order_id: "broker-stop",
  requested_quantity: 0.163,
  protective_stop: 118,
  metadata: { purpose: "protective-stop" },
};

test("exit manager holds before +1R", () => {
  const plan = exits.planCryptoExit(basePosition, 121, [protective], true);
  assert.equal(plan.kind, "hold");
});

test("exit manager tightens toward fee-adjusted breakeven after +1R", () => {
  const plan = exits.planCryptoExit(basePosition, 122.5, [protective], true);
  assert.equal(plan.kind, "tighten_stop");
  assert.equal(plan.reason, "breakeven");
  assert.ok(plan.stop > basePosition.average_entry);
  assert.ok(plan.stop > basePosition.protective_stop);
});

test("first take-profit threshold takes precedence over breakeven tightening", () => {
  const plan = exits.planCryptoExit(basePosition, 123.5, [protective], true);
  assert.equal(plan.kind, "partial_profit");
  assert.equal(plan.fraction, 0.25);
});

test("missing broker protection creates a repair action", () => {
  const plan = exits.planCryptoExit(basePosition, 120, [], false);
  assert.equal(plan.kind, "repair_stop");
  assert.equal(plan.stop, 118);
});

test("after partial profit the remainder trails without widening", () => {
  const position = {
    ...basePosition,
    protective_stop: 120.4,
    exit_manager_state: { partialProfitState: "completed" },
  };
  const plan = exits.planCryptoExit(position, 125, [protective], true);
  assert.equal(plan.kind, "tighten_stop");
  assert.equal(plan.reason, "trail");
  assert.ok(plan.stop > position.protective_stop);
});

test("filled partial order prevents a duplicate first take profit", () => {
  const filled = {
    ...protective,
    client_order_id: "chb-div-v1-tp-fixture0001",
    broker_order_id: "broker-tp",
    status: "filled",
    metadata: { purpose: "take-profit-partial" },
  };
  const plan = exits.planCryptoExit(basePosition, 124, [protective, filled], true);
  assert.notEqual(plan.kind, "partial_profit");
});
