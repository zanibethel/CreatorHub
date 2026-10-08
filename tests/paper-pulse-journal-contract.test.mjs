import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../src/lib/paper-pulse-journal-contract.ts", import.meta.url), "utf8");
const exports = {};
const transpiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
vm.runInNewContext(transpiled, { exports });
const classify = exports.classifyPulseJournalPlan;

test("Pulse audit contract uses only DB-permitted statuses", () => {
  assert.deepEqual({ ...classify({ state: "waiting", selectedForSubmission: false }) }, {
    eventType: "candidate", qualification: "watch",
  });
  assert.deepEqual({ ...classify({ state: "blocked", selectedForSubmission: false }) }, {
    eventType: "rejected", qualification: "unqualified",
  });
  assert.deepEqual({ ...classify({ state: "ready", selectedForSubmission: false }) }, {
    eventType: "candidate", qualification: "qualified",
  });
  assert.deepEqual({ ...classify({ state: "ready", selectedForSubmission: true }) }, {
    eventType: "authorized", qualification: "trade-ready",
  });
});

test("Pulse runner fails closed on counterfactual persistence failure", () => {
  const code = readFileSync(new URL("../src/app/api/paper-trading/bots/momentum-breakout-run/route.ts", import.meta.url), "utf8");
  assert.match(code, /action:"counterfactual-error"/);
  assert.doesNotMatch(code, /catch\{\}/);
});

test("Pulse readiness journals heartbeat even when no setup is assigned", () => {
  const code = readFileSync(new URL("../src/app/api/paper-trading/bots/momentum-breakout-readiness/route.ts", import.meta.url), "utf8");
  assert.match(code, /event_type:"system"/);
  assert.match(code, /if\(isCron\)\{/);
  assert.doesNotMatch(code, /event_type:"prospect-intake"/);
});


test("Pulse readiness applies assignment predicate before row limit", () => {
  const path = exports.pulseProspectIntakePath("momentum-breakout-100");
  const url = new URL(`https://example.invalid/rest/v1/${path}`);
  assert.equal(url.searchParams.get("assigned_bot_ids"), "cs.{momentum-breakout-100}");
  assert.equal(url.searchParams.get("limit"), "30");
  assert.equal(url.searchParams.get("status"), "eq.review-ready");
  assert.equal(url.searchParams.get("bot_review_eligible"), "eq.true");
  const readiness = readFileSync(new URL("../src/app/api/paper-trading/bots/momentum-breakout-readiness/route.ts", import.meta.url), "utf8");
  assert.match(readiness, /db\(pulseProspectIntakePath\(strategy\.botProfileId\)\)/);
});

test("Pulse handoff evidence differentiates no opportunity from assignment defects", () => {
  const now = Date.parse("2026-10-08T14:00:00.000Z");
  const botId = "momentum-breakout-100";
  const make = (symbol, attrs = {}) => ({
    symbol,score:90,price:18,status:"review-ready",botReviewEligible:true,
    suggestedBotIds:[botId],assignedBotIds:[botId],reasons:[],
    lastSeenAt:new Date(now-60_000).toISOString(),...attrs,
  });
  const result = exports.summarizePulseHandoff([
    make("READY"),
    make("LOW",{score:78,suggestedBotIds:[],assignedBotIds:[]}),
    make("VALIDATION",{status:"candidate",botReviewEligible:false,suggestedBotIds:[],assignedBotIds:[]}),
    make("PENNY",{price:2.50,suggestedBotIds:[],assignedBotIds:[]}),
    make("STALE",{lastSeenAt:new Date(now-25*60_000).toISOString(),assignedBotIds:[]}),
    make("ROUTE",{suggestedBotIds:[],assignedBotIds:[]}),
    make("ASSIGN",{assignedBotIds:[]}),
  ],now,botId,80,5,20);
  assert.deepEqual({...result.counts},{
    belowScannerThreshold:1,scannerRejected:1,pennyLane:1,stale:1,
    scannerRoutingMismatch:1,assignmentMismatch:1,assigned:1,
  });
  assert.equal(result.paperOnly,true);
  assert.equal(result.sampledStocksScore65Plus,7);
});
