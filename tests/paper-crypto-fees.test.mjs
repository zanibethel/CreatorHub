import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function module(path) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { exports, Number, Math });
  return exports;
}

const fees = module("../src/lib/paper-crypto-fees.ts");

test("observes Alpaca crypto entry fee from gross versus sellable quantity", () => {
  const result = fees.observeCryptoEntryFee(0.00014155, 0.000141196, 84700);
  assert.ok(result.feeQuantity > 0);
  assert.ok(result.feeBps > 24.9 && result.feeBps < 25.1);
  assert.ok(result.feeUsd > 0.029 && result.feeUsd < 0.031);
});

test("zero observed fee remains a valid exact observation", () => {
  const result = fees.observeCryptoEntryFee(0.5, 0.5, 100);
  assert.equal(result.feeQuantity, 0);
  assert.equal(result.feeBps, 0);
  assert.equal(result.feeUsd, 0);
});

test("invalid broker quantity falls back to unknown instead of inventing a fee", () => {
  const result = fees.observeCryptoEntryFee(0.1, 0.11, 100);
  assert.equal(result.feeQuantity, null);
  assert.equal(result.feeBps, null);
  assert.equal(result.feeUsd, null);
});
