import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function module(path, imports = {}, globals = {}) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, {
    exports, ...globals,
    require: name => {
      if (name in imports) return imports[name];
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  return exports;
}

const profiles = module("../src/lib/paper-bot-profiles.ts", {
  "./paper-strategy-config": { PAPER_STRATEGY_V1: { id: "paper-medium-high-v1" } },
});
const attribution = module("../src/lib/paper-broker-attribution.ts", {
  "./paper-bot-profiles": profiles,
});

test("paper order IDs encode the bot tag and strategy version", () => {
  const value = attribution.makePaperBotClientOrderId("div", 1, "fixture-12345678");
  assert.equal(value, "ch-div-v1-fixture-12345678");
  assert.deepEqual(
    attribution.parsePaperBotClientOrderId(value),
    { botId: "default-diverse", brokerTag: "div", strategyVersion: 1, nonce: "fixture-12345678" },
  );
});

test("unknown or malformed client order IDs are never attributed to a challenge", () => {
  assert.equal(attribution.parsePaperBotClientOrderId("manual-order-1"), null);
  assert.equal(attribution.parsePaperBotClientOrderId("ch-zzz-v1-fixture-12345678"), null);
  assert.throws(() => attribution.makePaperBotClientOrderId("BAD TAG", 1, "fixture-12345678"));
  assert.throws(() => attribution.makePaperBotClientOrderId("div", 0, "fixture-12345678"));
});
