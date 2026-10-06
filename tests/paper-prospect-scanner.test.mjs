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
    Math,
    Number,
    require: name => {
      if (name in imports) return imports[name];
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  return exports;
}

const config = load("../src/lib/paper-prospect-scanner-config.ts");
const scanner = load("../src/lib/paper-prospect-scanner.ts", {
  "./paper-prospect-scanner-config": config,
});

test("strong liquid stock prospect reaches bot review threshold", () => {
  const result = scanner.scoreProspect({
    assetClass:"stock",
    symbol:"TEST",
    price:12,
    percentChange:8,
    spreadPct:0.10,
    volume:12_000_000,
    previousVolume:4_000_000,
    activityRank:8,
    nearHighPct:0.7,
    sourceFlags:["top stock gainer","most-active stock"],
  });
  assert.ok(result.score >= config.PAPER_PROSPECT_SCANNER_V2.thresholds.botReviewScore);
  assert.equal(result.status,"review-ready");
  assert.equal(result.watchlistEligible,true);
  assert.equal(result.botReviewEligible,true);
  assert.ok(result.suggestedBotIds.includes("default-diverse"));
  assert.ok(result.suggestedBotIds.includes("three-trade-weekly-swing-100"));
});

test("penny prospect is routed to penny review without authorizing a trade", () => {
  const result = scanner.scoreProspect({
    assetClass:"stock",
    symbol:"PENNY",
    price:2.4,
    percentChange:15,
    spreadPct:0.12,
    volume:20_000_000,
    previousVolume:5_000_000,
    activityRank:5,
    nearHighPct:0.5,
    sourceFlags:["top stock gainer","most-active stock"],
  });
  assert.equal(result.status,"review-ready");
  assert.ok(result.suggestedBotIds.includes("penny-volatility-day-100"));
});

test("crypto momentum and volume expansion can promote a new prospect", () => {
  const result = scanner.scoreProspect({
    assetClass:"crypto",
    symbol:"NEW/USD",
    price:1.25,
    percentChange:8,
    spreadPct:0.12,
    volume:5_000_000,
    previousVolume:1_500_000,
    activityRank:null,
    nearHighPct:1.5,
    sourceFlags:["top crypto gainer"],
  });
  assert.ok(result.score >= config.PAPER_PROSPECT_SCANNER_V2.thresholds.botReviewScore);
  assert.equal(result.status,"review-ready");
  assert.deepEqual(Array.from(result.suggestedBotIds), ["weekend-crypto-day-100","crypto-swing-100","default-diverse"]);
});

test("ordinary movement stays below prospect watchlist threshold", () => {
  const result = scanner.scoreProspect({
    assetClass:"stock",
    symbol:"QUIET",
    price:30,
    percentChange:0.4,
    spreadPct:0.25,
    volume:400_000,
    previousVolume:1_000_000,
    activityRank:null,
    nearHighPct:8,
    sourceFlags:[],
  });
  assert.ok(result.score < config.PAPER_PROSPECT_SCANNER_V2.thresholds.watchlistScore);
  assert.equal(result.watchlistEligible,false);
  assert.equal(result.botReviewEligible,false);
  assert.deepEqual(Array.from(result.suggestedBotIds), []);
});


test("verified positive news can lift a borderline prospect but remains capped", () => {
  const base = {
    assetClass:"stock",
    symbol:"NEWS",
    price:25,
    percentChange:2,
    spreadPct:0.20,
    volume:2_000_000,
    previousVolume:1_500_000,
    activityRank:60,
    nearHighPct:2.5,
    sourceFlags:["most-active stock"],
  };
  const withoutNews = scanner.scoreProspect(base);
  const withNews = scanner.scoreProspect({
    ...base,
    newsImpact: config.PAPER_PROSPECT_SCANNER_V2.news.maxScannerImpactPoints,
  });
  assert.equal(
    Number((withNews.score - withoutNews.score).toFixed(2)),
    config.PAPER_PROSPECT_SCANNER_V2.news.maxScannerImpactPoints,
  );
  assert.equal(
    withNews.components.news,
    config.PAPER_PROSPECT_SCANNER_V2.news.maxScannerImpactPoints,
  );
});

test("negative news can reduce score but does not create a new risk bypass", () => {
  const result = scanner.scoreProspect({
    assetClass:"crypto",
    symbol:"RISK/USD",
    price:2,
    percentChange:8,
    spreadPct:0.12,
    volume:4_000_000,
    previousVolume:1_000_000,
    activityRank:null,
    nearHighPct:1,
    sourceFlags:["top crypto gainer"],
    newsImpact:-999,
  });
  assert.equal(
    result.components.news,
    -config.PAPER_PROSPECT_SCANNER_V2.news.maxScannerImpactPoints,
  );
  assert.ok(result.score >= 0 && result.score <= 100);
});
