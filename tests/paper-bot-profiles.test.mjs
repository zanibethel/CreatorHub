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

const strategy = module("../src/lib/paper-strategy-config.ts");
const profiles = module("../src/lib/paper-bot-profiles.ts", { "./paper-strategy-config": strategy });

test("Default Diverse Bot is the only active default profile", () => {
  assert.equal(profiles.DEFAULT_DIVERSE_BOT.id, "default-diverse");
  assert.equal(profiles.DEFAULT_DIVERSE_BOT.status, "active");
  assert.equal(profiles.DEFAULT_DIVERSE_BOT.challengeStartingCash, 1000);
  assert.equal(profiles.DEFAULT_DIVERSE_BOT.strategyId, strategy.PAPER_STRATEGY_V1.id);
  assert.equal(profiles.ACTIVE_DEFAULT_PAPER_BOT.id, "default-diverse");
  assert.equal(profiles.PAPER_BOT_PROFILES.filter(profile => profile.status === "active").length, 1);
});

test("planned $100 experiments stay isolated and disabled", () => {
  const penny = profiles.PENNY_VOLATILITY_DAY_BOT;
  const swing = profiles.THREE_TRADE_SWING_BOT;

  assert.equal(penny.status, "planned");
  assert.equal(penny.challengeStartingCash, 100);
  assert.equal(penny.universe.maximumPriceUsd, 5);
  assert.equal(penny.cadence.intradayOnly, true);
  assert.equal(penny.strategyId, null);

  assert.equal(swing.status, "planned");
  assert.equal(swing.challengeStartingCash, 100);
  assert.equal(swing.cadence.maximumNewTradesPerWeek, 3);
  assert.equal(swing.cadence.swingOnly, true);
  assert.equal(swing.strategyId, null);

  for (const profile of [penny, swing]) {
    assert.equal(profile.isolation.separateVirtualLedger, true);
    assert.equal(profile.isolation.sharePositionsWithOtherBots, false);
    assert.equal(profile.isolation.shareRiskBudgetWithOtherBots, false);
  }
});
