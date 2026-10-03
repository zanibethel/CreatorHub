import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";

function module(path, imports = {}, globals = {}) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, {
    exports, Response, AbortSignal, ...globals,
    require: name => {
      if (name in imports) return imports[name];
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  return exports;
}

const ledger = module("../src/lib/paper-bot-ledger.ts", { zod: { z } });
const stamp = "2026-10-03T17:00:00.000Z";

const ledgerRows = [
  {
    bot_id: "default-diverse", display_name: "Default Diverse Bot", status: "active",
    strategy_id: "paper-medium-high-v1", strategy_version: "1",
    starting_cash: "100.000000", cash: "100.000000", equity: "100.000000",
    realized_pl: "0", unrealized_pl: "0", buying_power: "100",
    peak_equity: "100", current_drawdown_pct: "0",
    open_planned_risk_pct: "0", correlated_risk_pct: "0",
    daily_realized_loss_pct: "0", weekly_drawdown_pct: "0",
    last_synced_at: stamp, source: "virtual-ledger", metadata: { secret: "private-value" },
  },
  {
    bot_id: "penny-volatility-day-100", display_name: "$100 Penny Volatility Day Bot", status: "planned",
    strategy_id: null, strategy_version: null,
    starting_cash: "100", cash: "100", equity: "100", realized_pl: "0", unrealized_pl: "0",
    buying_power: "100", peak_equity: "100", current_drawdown_pct: "0",
    open_planned_risk_pct: "0", correlated_risk_pct: "0",
    daily_realized_loss_pct: "0", weekly_drawdown_pct: "0",
    last_synced_at: null, source: "virtual-ledger",
  },
];

function api(fetcher, env = { SUPABASE_SECRET_KEY: "database-secret" }) {
  return module("../src/app/api/paper-trading/bots/route.ts", {
    "next/server": { NextResponse: Response },
    "zod": { z },
    "@/lib/paper-bot-ledger": ledger,
  }, { process: { env }, fetch: fetcher });
}

test("paper bot ledger projection keeps $100 challenge equity separate from broker data", async () => {
  const requested = [];
  const route = api(url => {
    requested.push(url);
    if (url.includes("paper_bot_ledgers")) return Response.json(ledgerRows);
    if (url.includes("paper_bot_equity_history")) return Response.json([
      { bot_id: "default-diverse", collected_at: stamp, equity: "100" },
      { bot_id: "penny-volatility-day-100", collected_at: stamp, equity: "100" },
    ]);
    if (url.includes("paper_bot_positions")) return Response.json([]);
    if (url.includes("paper_bot_journal")) return Response.json([]);
    throw new Error("Unexpected request");
  });
  const response = await route.GET();
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.accountingModel.challengeStartingCash, 100);
  assert.equal(body.accountingModel.virtualLedgerIsAuthority, true);
  assert.equal(body.accountingModel.brokerAccountIsExecutionVenueOnly, true);
  assert.equal(body.bots[0].equity, 100);
  assert.equal(body.bots[0].buyingPower, 100);
  assert.equal(body.bots[0].positionCount, 0);
  assert.equal(body.bots[0].journalCount, 0);
  assert.equal(body.history["default-diverse"][0].equity, 100);
  assert.equal(requested.length, 4);
  assert.doesNotMatch(JSON.stringify(body), /private-value|database-secret|metadata/);
});

test("paper bot ledger endpoint requires server-side storage credentials", async () => {
  let calls = 0;
  const route = api(() => { calls++; throw new Error("Must not fetch"); }, {});
  const response = await route.GET();
  assert.equal(response.status, 503);
  assert.equal(calls, 0);
});
