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
    require: name => {
      if (name in imports) return imports[name];
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  return exports;
}

const config = load("../src/lib/paper-swing-strategy-config.ts");
const execution = load("../src/lib/paper-swing-execution.ts", {
  "./paper-swing-strategy-config": config,
});

test("swing execution sizing respects the 1% planned-loss ceiling", () => {
  const preview = execution.buildSwingExecutionPreview({
    symbol: "QQQ",
    ask: 755.5,
    protectiveStop: 726.87,
    equity: 100,
    buyingPower: 100,
  });
  assert.equal(preview.paperOnly, true);
  assert.ok(preview.plannedRiskDollars <= 1.000001);
  assert.ok(preview.plannedRiskPct <= 1.000001);
  assert.ok(preview.allocationPct <= 30.000001);
  assert.ok(preview.takeProfit > preview.entryReference);
  assert.ok(preview.stopLoss < preview.entryReference);
});

test("allocation cap can become the tighter sizing constraint", () => {
  const preview = execution.buildSwingExecutionPreview({
    symbol: "MSFT",
    ask: 500,
    protectiveStop: 499,
    equity: 100,
    buyingPower: 100,
  });
  assert.ok(preview.estimatedNotional <= 30.000001);
  assert.ok(preview.allocationPct <= 30.000001);
  assert.ok(preview.plannedRiskDollars < 1);
});

test("paper execution guard rejects a disabled kill switch", () => {
  assert.throws(() => execution.assertSwingPaperExecutionAllowed({
    executionEnabled: false,
    readinessSelected: true,
    marketOpen: true,
    quoteFresh: true,
  }), /kill switch is disabled/i);
});

test("paper execution guard rejects live-money mode", () => {
  assert.throws(() => execution.assertSwingPaperExecutionAllowed({
    executionEnabled: true,
    readinessSelected: true,
    marketOpen: true,
    quoteFresh: true,
    paperOnly: false,
  }), /live-money/i);
});

test("paper execution guard requires same-session selection and a fresh open market", () => {
  assert.throws(() => execution.assertSwingPaperExecutionAllowed({
    executionEnabled: true,
    readinessSelected: false,
    marketOpen: true,
    quoteFresh: true,
  }), /not selected/i);
  assert.throws(() => execution.assertSwingPaperExecutionAllowed({
    executionEnabled: true,
    readinessSelected: true,
    marketOpen: false,
    quoteFresh: true,
  }), /market is not open/i);
  assert.throws(() => execution.assertSwingPaperExecutionAllowed({
    executionEnabled: true,
    readinessSelected: true,
    marketOpen: true,
    quoteFresh: false,
  }), /quote is stale/i);
});

test("broker request is a day market bracket with hosted stop and target", () => {
  const preview = execution.buildSwingExecutionPreview({
    symbol: "NVDA",
    ask: 238.4,
    protectiveStop: 220.62,
    equity: 100,
    buyingPower: 100,
  });
  const request = execution.buildAlpacaSwingBracketRequest(
    preview,
    "chb-sw3-v1-test123-fixture01",
  );
  assert.equal(request.order_class, "bracket");
  assert.equal(request.type, "market");
  assert.equal(request.time_in_force, "day");
  assert.equal(request.extended_hours, false);
  assert.equal(request.side, "buy");
  assert.ok(Number(request.qty) > 0);
  assert.ok(Number(request.take_profit_limit_price) > preview.entryReference);
  assert.ok(Number(request.stop_loss_stop_price) < preview.entryReference);
  assert.equal(execution.SWING_PAPER_BROKER_HOST, "https://paper-api.alpaca.markets");
});
