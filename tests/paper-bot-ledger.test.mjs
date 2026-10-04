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
    last_synced_at: stamp, source: "virtual-ledger", pool_usage: { day: 0, "multi-day": 0, "multi-week": 0 }, metadata: { secret: "private-value" },
  },
  {
    bot_id: "penny-volatility-day-100", display_name: "$100 Penny Volatility Day Bot", status: "planned",
    strategy_id: null, strategy_version: null,
    starting_cash: "100", cash: "100", equity: "100", realized_pl: "0", unrealized_pl: "0",
    buying_power: "100", peak_equity: "100", current_drawdown_pct: "0",
    open_planned_risk_pct: "0", correlated_risk_pct: "0",
    daily_realized_loss_pct: "0", weekly_drawdown_pct: "0",
    last_synced_at: null, source: "virtual-ledger", pool_usage: { day: 0, "multi-day": 0, "multi-week": 0 },
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
    if (url.includes("paper_bot_positions")) return Response.json([{
      bot_id:"default-diverse", symbol:"SOL/USD", quantity:"0.16", average_entry:"120",
      protective_stop:"119", initial_protective_stop:"119", planned_risk_dollars:"0.2",
      take_profit_price:"122", take_profit_fraction:"0.25", take_profit_r:"1.75",
      protect_winner_at_r:"1", trail_remainder:true, last_exit_manager_at:stamp,
      exit_manager_state:{version:"paper-exit-v1",mode:"staged-action",plannedAction:"hold",rMultiple:-0.1,markPrice:119.9,evaluatedAt:stamp,hasActiveStop:true,reason:"No exit-management threshold is active."}
    }]);
    if (url.includes("paper_bot_journal")) return Response.json([]);
    if (url.includes("paper_bot_broker_orders")) return Response.json([{ bot_id: "default-diverse", broker_order_id: "private-order" }]);
    if (url.includes("paper_bot_broker_fills")) return Response.json([{ bot_id: "default-diverse", fill_activity_id: "private-fill", transaction_time: stamp, ledger_applied_at: stamp }]);
    if (url.includes("paper_bot_orders")) return Response.json([{ bot_id: "default-diverse", symbol: "QQQ", asset_class: "etf", status: "prepared", requested_notional: "10", requested_quantity: null, pool_id: "multi-day", entry_trigger: "750", max_entry_price: "755", protective_stop: "730", planned_risk_dollars: "1", expires_at: stamp, stage_reason: "fixture", take_profit_price: "790", take_profit_fraction: "0.5", take_profit_r: "2", protect_winner_at_r: "1", trail_remainder: true }]);
    if (url.includes("paper_bot_trade_metrics")) return Response.json([{ bot_id:"default-diverse", symbol:"SOL/USD", status:"open", opened_at:stamp, closed_at:null, entry_price:"120", initial_protective_stop:"119", initial_risk_dollars:"0.2", peak_mark_price:"121", trough_mark_price:"119.5", last_mark_price:"119.9", last_mark_at:stamp, mark_count:"4", mfe_r:"1", mae_r:"-0.5", exit_price:null, realized_pl:null, r_multiple:null, estimated_fees:null, exit_reason:null }]);
    if (url.includes("paper_bot_counterfactuals")) return Response.json([{ bot_id:"default-diverse", symbol:"QQQ", status:"completed", source_event_type:"rejected", decision_state:"blocked", decision_at:stamp, session_key:"2026-10-03", score:"75", trigger_price:"750", max_entry_price:"755", protective_stop:"730", assumed_entry_price:"750", one_r_price:"770", two_r_price:"790", triggered_at:stamp, stop_hit_at:null, one_r_hit_at:stamp, two_r_hit_at:stamp, first_outcome:"two-r-before-stop", mark_count:"3", mfe_r:"2.1", mae_r:"-0.2" }]);
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
  assert.equal(body.bots[0].positionCount, 1);
  assert.equal(body.bots[0].journalCount, 0);
  assert.equal(body.bots[0].brokerOrderCount, 1);
  assert.equal(body.bots[0].brokerFillCount, 1);
  assert.equal(body.bots[0].lastBrokerFillAt, stamp);
  assert.equal(body.history["default-diverse"][0].equity, 100);
  assert.equal(body.bots[0].poolUsage["multi-day"], 0);
  assert.equal(body.stagedOrders["default-diverse"][0].symbol, "QQQ");
  assert.equal(body.positionPlans["default-diverse"][0].exit_manager_state.plannedAction, "hold");
  assert.equal(body.positionPlans["default-diverse"][0].initial_protective_stop, 119);
  assert.equal(body.tradeMetrics["default-diverse"][0].mfe_r, 1);
  assert.equal(body.tradeMetrics["default-diverse"][0].mae_r, -0.5);
  assert.equal(body.tradeMetrics["default-diverse"][0].mark_count, 4);
  assert.equal(body.counterfactuals["default-diverse"][0].first_outcome, "two-r-before-stop");
  assert.equal(body.counterfactuals["default-diverse"][0].mfe_r, 2.1);
  assert.equal(requested.length, 9);
  assert.doesNotMatch(JSON.stringify(body), /private-value|database-secret|metadata|private-order|private-fill/);
});

test("paper bot ledger endpoint requires server-side storage credentials", async () => {
  let calls = 0;
  const route = api(() => { calls++; throw new Error("Must not fetch"); }, {});
  const response = await route.GET();
  assert.equal(response.status, 503);
  assert.equal(calls, 0);
});
