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
const squeezeStrategy = module("../src/lib/paper-squeeze-breakout-strategy-config.ts");
const momentumStrategy = module("../src/lib/paper-momentum-breakout-strategy-config.ts");
const ignitionStrategy = module("../src/lib/paper-crypto-ignition-strategy-config.ts");
const tradePlan = module("../src/lib/paper-bot-trade-plan.ts");
const fuseStrategy = module("../src/lib/paper-fuse-strategy-config.ts");
const profiles = module("../src/lib/paper-bot-profiles.ts", {
  "./paper-strategy-config": strategy,
  "./paper-swing-strategy-config": swingStrategy,
  "./paper-weekend-crypto-strategy-config": weekendStrategy,
  "./paper-crypto-swing-strategy-config": cryptoSwingStrategy,
  "./paper-squeeze-breakout-strategy-config": squeezeStrategy,
  "./paper-momentum-breakout-strategy-config": momentumStrategy,
  "./paper-crypto-ignition-strategy-config": ignitionStrategy,
  "./paper-bot-trade-plan": tradePlan,
  "./paper-fuse-strategy-config": fuseStrategy,
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
  const squeeze = profiles.SQUEEZE_BREAKOUT_BOT;

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

  assert.equal(squeeze.status, "active");
  assert.equal(squeeze.challengeStartingCash, 100);
  assert.deepEqual(Array.from(squeeze.universe.assetClasses), ["stock"]);
  assert.equal(squeeze.strategyId, squeezeStrategy.SQUEEZE_BREAKOUT_STRATEGY_V1.id);
  assert.equal(squeeze.tradePlan.source, "squeeze-breakout-readiness");

  for (const profile of [swing, dailyCrypto, cryptoSwing, squeeze]) {
    assert.equal(profile.isolation.separateVirtualLedger, true);
    assert.equal(profile.isolation.sharePositionsWithOtherBots, false);
    assert.equal(profile.isolation.shareRiskBudgetWithOtherBots, false);
  }
});

test("Fuse has an independent strategy with a disabled-by-default one-shot PAPER pilot", () => {
  const penny = profiles.PENNY_VOLATILITY_DAY_BOT;
  assert.equal(penny.status, "active");
  assert.equal(penny.executionState, "research");
  assert.equal(penny.tradePlan.source, "fuse-readiness");
  assert.equal(penny.challengeStartingCash, 100);
  assert.equal(penny.universe.maximumPriceUsd, 5);
  assert.equal(penny.cadence.intradayOnly, true);
  assert.equal(penny.strategyId, fuseStrategy.FUSE_PENNY_STRATEGY_V1.id);
  assert.equal(fuseStrategy.FUSE_PENNY_STRATEGY_V1.execution.submissionsImplemented, true);
  assert.equal(fuseStrategy.FUSE_PENNY_STRATEGY_V1.execution.executionEnabledByDefault, false);
  assert.equal(fuseStrategy.FUSE_PENNY_STRATEGY_V1.execution.paperOnly, true);
});

test("registry includes eight separate $100 research or active challenges", () => {
  assert.equal(profiles.PAPER_BOT_PROFILES.length, 8);
  assert.equal(profiles.PAPER_BOT_PROFILES.filter(profile => profile.status === "active").length, 8);
  assert.equal(profiles.PAPER_BOT_PROFILES.filter(profile => profile.status === "planned").length, 0);
  assert.ok(profiles.PAPER_BOT_PROFILES.every(profile => profile.challengeStartingCash === 100));
  assert.equal(profiles.MOMENTUM_BREAKOUT_BOT.strategyId, momentumStrategy.MOMENTUM_BREAKOUT_STRATEGY_V1.id);
  assert.equal(profiles.CRYPTO_IGNITION_BOT.strategyId, ignitionStrategy.CRYPTO_IGNITION_STRATEGY_V1.id);
  assert.equal(profiles.MOMENTUM_BREAKOUT_BOT.tradePlan.source, "momentum-breakout-readiness");
  assert.equal(profiles.CRYPTO_IGNITION_BOT.tradePlan.source, "crypto-ignition-readiness");
});
