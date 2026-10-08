import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import ts from "typescript";
import vm from "node:vm";

const text = path => readFileSync(new URL(path,import.meta.url),"utf8");
function transpile(path,imports={}) {
  const exports={};
  const code=ts.transpileModule(text(path),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(code,{exports,require:name=>{
    if (name in imports) return imports[name];
    throw new Error("Unexpected dependency "+name);
  }});
  return exports;
}
const config=transpile("../src/lib/paper-strategy-config.ts");
const engine=transpile("../src/lib/paper-decision-engine.ts",{"./paper-strategy-config":config});
const audit=transpile("../src/lib/paper-atlas-decision-audit.ts");
const now=Date.parse("2026-10-08T13:30:00.000Z");
const candidate={
  symbol:"AAPL",label:"Apple",role:"Individual",pools:["day","multi-day"],
  rationale:"fixture",return1y:20,volatility:30,maxDrawdown:-15,
  fractionable:true,tradable:true,tier:"initial",
};
const candles=Array.from({length:35},(_,i)=>{
  const close=100+i*.3;
  return {time:new Date(now-(34-i)*86400000).toISOString(),
    close,high:close*1.006,low:close*.994,volume:1000+i*60};
});
const decision=engine.evaluatePaperCandidate({candidate,assetClass:"stock",
  quote:{bid:110.15,ask:110.2,timestamp:new Date(now-8000).toISOString()},
  candles,benchmarkCandles:candles.map(c=>({...c,close:c.close-.5})),now,
  risk:{accountEquity:99.755227,openRiskPct:.189595,correlatedRiskPct:0,dailyRealizedLossPct:0,weeklyDrawdownPct:.436524},
});
test("repeat same five-minute decision uses identical id while separate scan differs",()=>{
  const first=audit.atlasEvaluationIds({assetClass:"stock",symbol:"AAPL",scanBucketUtc:"2026-10-08T13:30:00.000Z"});
  const again=audit.atlasEvaluationIds({assetClass:"stock",symbol:"AAPL",scanBucketUtc:"2026-10-08T13:30:00.000Z"});
  const next=audit.atlasEvaluationIds({assetClass:"stock",symbol:"AAPL",scanBucketUtc:"2026-10-08T13:35:00.000Z"});
  assert.equal(first.decisionId,again.decisionId);
  assert.notEqual(first.decisionId,next.decisionId);
  assert.equal(first.symbolSessionKey,next.symbolSessionKey);
});
test("actual decision engine evidence is serialized without an order",()=>{
  const ids=audit.atlasEvaluationIds({assetClass:"stock",symbol:"AAPL",scanBucketUtc:"2026-10-08T13:30:00.000Z"});
  const row=audit.atlasJournalPayload({decision,ids,evaluatedAt:new Date(now).toISOString(),
    scanBucketUtc:"2026-10-08T13:30:00.000Z",
    inputProvenance:{candidateSource:"persisted-paper-watchlist",quoteAt:new Date(now-8000).toISOString()}});
  assert.equal(row.strategyId,config.PAPER_STRATEGY_V1.id);
  assert.equal(row.strategyVersion,1);
  assert.equal(row.orderSubmission,false);
  assert.equal(decision.eligibleUnderAvailableRules,false);
  assert.ok(decision.blockers.some(x=>x.includes("pool allocation capacity")));
  assert.equal(row.score,decision.score);
  assert.deepEqual(Object.keys(row.components).sort(),Object.keys(decision.components).sort());
  assert.equal(row.entryPrice,decision.referencePlan.entryTrigger);
  assert.equal(row.riskPlan.riskDollars,decision.riskPlan.riskDollars);
  assert.equal(row.inputProvenance.candidateSource,"persisted-paper-watchlist");
});
test("scheduled Atlas audit route is cron-secret gated and never imports broker execution",()=>{
  const route=text("../src/app/api/paper-trading/bots/atlas-decision-audit/route.ts");
  assert.match(route,/authorization/);
  assert.match(route,/CRON_SECRET/);
  assert.match(route,/readOnlyMarketSnapshot/);
  assert.match(route,/evaluatePaperCandidate/);
  assert.doesNotMatch(route,/paper-api\.alpaca\.markets|submitOrder|placeOrder|createBrokerOrder/);
  const configJson=JSON.parse(text("../vercel.json"));
  assert.ok(configJson.crons.some(x=>x.path==="/api/paper-trading/bots/atlas-decision-audit"&&x.schedule==="*/5 * * * *"));
});
test("SQL ensures repeat scanner/retry event uniqueness without changing fills",()=>{
  const migration=text("../supabase/migrations/20261008134118_atlas_decision_journal.sql");
  assert.match(migration,/CREATE UNIQUE INDEX IF NOT EXISTS paper_bot_journal_atlas_decision_uidx/);
  assert.match(migration,/ON CONFLICT DO NOTHING/g);
  assert.match(migration,/scanner_assigned/);
  assert.match(migration,/AFTER INSERT ON public\.paper_prospect_observations/);
  assert.match(migration,/REVOKE ALL ON FUNCTION public\.paper_atlas_record_candidate\(jsonb\) FROM PUBLIC,anon,authenticated/);
  assert.doesNotMatch(migration,/UPDATE public\.paper_bot_ledgers|INSERT INTO public\.paper_bot_broker_fills|DELETE FROM public\.paper_bot_orders/i);
});

test("assigned scanner candidates are evaluated but never silently authorized for trading",()=>{
  const route=text("../src/app/api/paper-trading/bots/atlas-decision-audit/route.ts");
  assert.match(route,/contains\("assigned_bot_ids", \["default-diverse"\]\)/);
  assert.match(route,/\.\.\.dynamicCandidates/);
  assert.match(route,/scanner-assigned-unapproved/);
  assert.match(route,/dynamicExecutionAuthorized:false/);
  assert.match(route,/tradable:false/);
  assert.match(route,/pools:\[\]/);
  assert.match(route,/extraStocks\.length < 20 - savedStocks\.size/);
  assert.match(route,/extraCrypto\.length < 10 - savedCrypto\.size/);
  assert.doesNotMatch(route,/paper-api\.alpaca\.markets|submitOrder|placeOrder|createBrokerOrder/);
});

const preflight=transpile("../src/lib/paper-atlas-execution-preflight.ts",{"./paper-strategy-config":config});
test("Atlas execution preflight refuses read-only strategy decisions",()=>{
  const result=preflight.atlasExecutionPreflight({
    decision,brokerAsset:{symbol:"AAPL",asset_class:"us_equity",tradable:true,fractionable:true,status:"active"},
    approvedPools:["day"],pool:"day",poolLimitDollars:20,poolCommittedDollars:0,
    ledgerCashDollars:99.755227,positionNotionalDollars:9,
    fractionalRequested:true,marketOpen:true,
  });
  assert.equal(result.preflightPassed,false);
  assert.equal(result.executionAuthorized,false);
  assert.equal(result.requiresAtomicReservation,true);
  assert.ok(result.blockers.some(x=>x.includes("pool allocation capacity")));
});
test("Atlas preflight fails closed on missing broker verification and capacity",()=>{
  const result=preflight.atlasExecutionPreflight({
    decision,brokerAsset:null,approvedPools:[],pool:null,poolLimitDollars:null,
    poolCommittedDollars:null,ledgerCashDollars:null,positionNotionalDollars:9,
    fractionalRequested:true,marketOpen:null,
  });
  assert.equal(result.preflightPassed,false);
  assert.ok(result.blockers.some(x=>x.includes("broker asset")));
  assert.ok(result.blockers.some(x=>x.includes("pool capacity")));
});
