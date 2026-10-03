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

const config = module("../src/lib/paper-swing-strategy-config.ts");
const engine = module("../src/lib/paper-swing-revalidation.ts", {
  "./paper-swing-strategy-config": config,
});

const now = Date.parse("2026-10-05T14:00:00Z");
const plans = [
  { symbol:"QQQ", requestedNotional:26.6, entryTrigger:755, maxEntryPrice:760, protectiveStop:727, plannedRiskDollars:1, expiresAt:"2026-10-06T00:00:00Z" },
  { symbol:"NVDA", requestedNotional:13.64, entryTrigger:238, maxEntryPrice:241, protectiveStop:221, plannedRiskDollars:1, expiresAt:"2026-10-06T00:00:00Z" },
  { symbol:"MSFT", requestedNotional:15.89, entryTrigger:523, maxEntryPrice:529, protectiveStop:490, plannedRiskDollars:1, expiresAt:"2026-10-06T00:00:00Z" },
];

function input(overrides = {}) {
  return {
    now,
    marketOpen:true,
    minutesSinceOpen:30,
    broadMarketSupportive:true,
    trendValid:{QQQ:true,NVDA:true,MSFT:true},
    ledger:{
      active:true,equity:100,buyingPower:100,openRiskPct:0,
      dailyRealizedLossPct:0,weeklyDrawdownPct:0,openPositions:0,weeklyNewEntries:0,
    },
    currentRisk:[],
    plans,
    quotes:{
      QQQ:{bid:755.4,ask:755.5,timestamp:new Date(now-5_000).toISOString()},
      NVDA:{bid:238.3,ask:238.4,timestamp:new Date(now-5_000).toISOString()},
      MSFT:{bid:523.3,ask:523.4,timestamp:new Date(now-5_000).toISOString()},
    },
    ...overrides,
  };
}

test("closed market keeps valid staged plans waiting", () => {
  const result = engine.evaluateSwingReadiness(input({marketOpen:false,minutesSinceOpen:null}));
  assert.equal(result.readyCount,0);
  assert.ok(result.plans.every(plan => plan.state === "waiting"));
  assert.ok(result.plans.every(plan => plan.waitingOn.some(reason => /market is closed/i.test(reason))));
});

test("simultaneous tech triggers respect the 2% correlated-risk cap", () => {
  const result = engine.evaluateSwingReadiness(input());
  assert.equal(result.readyCount,2);
  assert.equal(result.plans.find(plan => plan.symbol==="QQQ").selectedForSubmission,true);
  assert.equal(result.plans.find(plan => plan.symbol==="NVDA").selectedForSubmission,true);
  const msft = result.plans.find(plan => plan.symbol==="MSFT");
  assert.equal(msft.selectedForSubmission,false);
  assert.equal(msft.state,"blocked");
  assert.ok(msft.blockers.some(reason => /correlated-risk cap/i.test(reason)));
});

test("a gap above max chase is blocked", () => {
  const data=input();
  data.quotes.QQQ={bid:761,ask:761.1,timestamp:new Date(now-3_000).toISOString()};
  const result=engine.evaluateSwingReadiness(data);
  const qqq=result.plans.find(plan=>plan.symbol==="QQQ");
  assert.equal(qqq.state,"blocked");
  assert.ok(qqq.blockers.some(reason=>/maximum chase/i.test(reason)));
});

test("weekly entry limit blocks every new entry", () => {
  const result=engine.evaluateSwingReadiness(input({
    ledger:{active:true,equity:100,buyingPower:100,openRiskPct:0,dailyRealizedLossPct:0,weeklyDrawdownPct:0,openPositions:2,weeklyNewEntries:3},
  }));
  assert.equal(result.readyCount,0);
  assert.ok(result.plans.every(plan=>plan.blockers.some(reason=>/weekly entry limit/i.test(reason))));
});

test("daily and weekly loss guards block new risk", () => {
  const result=engine.evaluateSwingReadiness(input({
    ledger:{active:true,equity:96,buyingPower:96,openRiskPct:0,dailyRealizedLossPct:2.5,weeklyDrawdownPct:5,openPositions:0,weeklyNewEntries:0},
  }));
  assert.equal(result.readyCount,0);
  assert.ok(result.plans.every(plan=>plan.blockers.some(reason=>/daily loss kill/i.test(reason))));
  assert.ok(result.plans.every(plan=>plan.blockers.some(reason=>/weekly drawdown kill/i.test(reason))));
});
