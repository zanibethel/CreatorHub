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
const swingStrategy = module("../src/lib/paper-swing-strategy-config.ts");
const weekendStrategy = module("../src/lib/paper-weekend-crypto-strategy-config.ts");
const cryptoSwingStrategy = module("../src/lib/paper-crypto-swing-strategy-config.ts");
const tradePlan = module("../src/lib/paper-bot-trade-plan.ts");
const profiles = module("../src/lib/paper-bot-profiles.ts", {
  "./paper-strategy-config": strategy,
  "./paper-swing-strategy-config": swingStrategy,
  "./paper-weekend-crypto-strategy-config": weekendStrategy,
  "./paper-crypto-swing-strategy-config": cryptoSwingStrategy,
  "./paper-bot-trade-plan": tradePlan,
});

test("Default Diverse remains the default active profile", () => {
  assert.equal(profiles.DEFAULT_DIVERSE_BOT.id, "default-diverse");
  assert.equal(profiles.DEFAULT_DIVERSE_BOT.status, "active");
  assert.equal(profiles.DEFAULT_DIVERSE_BOT.challengeStartingCash, 100);
  assert.equal(profiles.DEFAULT_DIVERSE_BOT.strategyId, strategy.PAPER_STRATEGY_V1.id);
  assert.equal(profiles.ACTIVE_DEFAULT_PAPER_BOT.id, "default-diverse");
});

test("active $100 comparison bots stay isolated", () => {
  const swing = profiles.THREE_TRADE_SWING_BOT;
  const dailyCrypto = profiles.DAILY_CRYPTO_DAY_BOT;
  const cryptoSwing = profiles.CRYPTO_SWING_BOT;

  assert.equal(swing.status, "active");
  assert.equal(swing.challengeStartingCash, 100);
  assert.equal(swing.cadence.maximumNewTradesPerWeek, 3);
  assert.equal(swing.cadence.swingOnly, true);
  assert.equal(swing.strategyId, swingStrategy.THREE_TRADE_SWING_STRATEGY_V1.id);

  assert.equal(dailyCrypto.status, "active");
  assert.equal(dailyCrypto.name, "$100 Daily Crypto Day Bot");
  assert.equal(dailyCrypto.challengeStartingCash, 100);
  assert.deepEqual(Array.from(dailyCrypto.universe.assetClasses), ["crypto"]);
  assert.equal(dailyCrypto.cadence.intradayOnly, false);
  assert.equal(dailyCrypto.strategyId, weekendStrategy.ACTIVE_DAILY_CRYPTO_DAY_STRATEGY.id);

  assert.equal(cryptoSwing.status, "active");
  assert.equal(cryptoSwing.challengeStartingCash, 100);
  assert.deepEqual(Array.from(cryptoSwing.universe.assetClasses), ["crypto"]);
  assert.equal(cryptoSwing.cadence.swingOnly, true);
  assert.equal(cryptoSwing.strategyId, cryptoSwingStrategy.CRYPTO_SWING_STRATEGY_V1.id);

  for (const profile of [swing, dailyCrypto, cryptoSwing]) {
    assert.equal(profile.isolation.separateVirtualLedger, true);
    assert.equal(profile.isolation.sharePositionsWithOtherBots, false);
    assert.equal(profile.isolation.shareRiskBudgetWithOtherBots, false);
  }
});

test("penny experiment remains planned and disabled", () => {
  const penny = profiles.PENNY_VOLATILITY_DAY_BOT;
  assert.equal(penny.status, "planned");
  assert.equal(penny.challengeStartingCash, 100);
  assert.equal(penny.universe.maximumPriceUsd, 5);
  assert.equal(penny.cadence.intradayOnly, true);
  assert.equal(penny.strategyId, null);
});

test("registry includes four active challenges and one planned experiment", () => {
  assert.equal(profiles.PAPER_BOT_PROFILES.filter(profile => profile.status === "active").length, 4);
  assert.equal(profiles.PAPER_BOT_PROFILES.filter(profile => profile.status === "planned").length, 1);
});
