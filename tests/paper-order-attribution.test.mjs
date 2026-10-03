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
const attribution = module("../src/lib/paper-order-attribution.ts", { "./paper-bot-profiles": profiles });

test("paper bot broker tags are short and unique", () => {
  const tags = profiles.PAPER_BOT_PROFILES.map(profile => profile.brokerTag);
  assert.equal(new Set(tags).size, tags.length);
  assert.deepEqual(tags, ["div", "pny", "sw3"]);
});

test("client order ids encode bot ownership and strategy version", () => {
  const id = attribution.createPaperClientOrderId("default-diverse", 1, "ABCDEF123456");
  assert.match(id, /^chb-div-v1-[a-z0-9]+-abcdef123456$/);
  assert.ok(id.length <= 128);
  assert.deepEqual(
    JSON.parse(JSON.stringify(attribution.parsePaperClientOrderId(id))),
    { clientOrderId: id, botId: "default-diverse", brokerTag: "div", strategyVersion: 1 },
  );
});

test("unrecognized or malformed broker activity is not attributed to a bot", () => {
  assert.equal(attribution.parsePaperClientOrderId("manual-order-123"), null);
  assert.equal(attribution.parsePaperClientOrderId("chb-zzz-v1-abc-abcdef"), null);
  assert.equal(attribution.parsePaperClientOrderId("chb-div-v0-abc-abcdef"), null);
  assert.equal(attribution.isBotAttributedPaperOrder("manual-order-123"), false);
});

test("planned bot tags are parseable but do not activate execution", () => {
  const id = attribution.createPaperClientOrderId("three-trade-weekly-swing-100", 1, "abcdef654321");
  const parsed = attribution.parsePaperClientOrderId(id);
  assert.equal(parsed.botId, "three-trade-weekly-swing-100");
  assert.equal(profiles.THREE_TRADE_SWING_BOT.status, "planned");
});
