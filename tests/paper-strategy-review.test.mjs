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
  vm.runInNewContext(code, { exports, Math, Number, Map, Set });
  return exports;
}

const review = module("../src/lib/paper-strategy-review.ts");

const ledger = {
  bot_id:"weekend-crypto-day-100",
  display_name:"$100 Daily Crypto Day Bot",
  strategy_id:"daily-crypto-day-v3",
  strategy_version:3,
  status:"active",
};

test("tiny samples remain advisory and do not recommend parameter changes",()=>{
  const report=review.buildPaperStrategyReview({
    collectedAt:"2026-10-04T05:00:00Z",
    ledgers:[ledger],
    journal:[
      {bot_id:ledger.bot_id,event_type:"candidate",symbol:"DOT/USD",occurred_at:"2026-10-04T01:00:00Z",score:65,qualification:"watch",regime:"bullish",blockers:[],warnings:["Spread is wider than the entry limit."],metadata:{}},
    ],
    trades:[],
    counterfactuals:[],
  });
  const bot=report.bots[0];
  assert.equal(report.policy.automaticStrategyMutation,false);
  assert.equal(report.policy.liveMoneyChangesAllowed,false);
  assert.equal(bot.evidenceMaturity.level,"collecting");
  assert.equal(bot.recommendations[0].id,"collect-more-evidence");
  assert.equal(bot.recommendations[0].requiresNewStrategyVersion,true);
});

test("broker rejection is separated from strategy rejection",()=>{
  const report=review.buildPaperStrategyReview({
    collectedAt:"2026-10-04T05:00:00Z",
    ledgers:[ledger],
    journal:[
      {bot_id:ledger.bot_id,event_type:"rejected",symbol:"BTC/USD",occurred_at:"2026-10-04T01:00:00Z",score:70,qualification:"watch",regime:"bullish",blockers:["Score below threshold"],warnings:[],metadata:{}},
      {bot_id:ledger.bot_id,event_type:"rejected",symbol:"ETH/USD",occurred_at:"2026-10-04T01:05:00Z",score:null,qualification:null,regime:null,blockers:[],warnings:[],metadata:{lifecycleSource:"broker-reconciliation"}},
    ],
    trades:[],
    counterfactuals:[],
  });
  assert.equal(report.bots[0].decisions.strategyRejectedEvents,1);
  assert.equal(report.bots[0].decisions.brokerRejectedEvents,1);
});

test("resolved counterfactuals can support a gate-review recommendation after maturity threshold",()=>{
  const counterfactuals=Array.from({length:20},(_,i)=>({
    bot_id:ledger.bot_id,
    strategy_id:ledger.strategy_id,
    strategy_version:3,
    symbol:i%2?"DOT/USD":"LINK/USD",
    status:"completed",
    source_event_type:"rejected",
    decision_at:`2026-10-03T${String(i).padStart(2,"0")}:00:00Z`,
    score:75,
    first_outcome:i<15?"two-r-before-stop":"stop-before-one-r",
    mfe_r:i<15?2.1:0.4,
    mae_r:i<15?-0.4:-1,
  }));
  const journal=Array.from({length:40},(_,i)=>({
    bot_id:ledger.bot_id,event_type:"rejected",symbol:"DOT/USD",occurred_at:"2026-10-03T01:00:00Z",
    score:75,qualification:"watch",regime:"bullish",blockers:["Spread is wider than the entry limit."],warnings:[],metadata:{},
  }));
  const report=review.buildPaperStrategyReview({
    collectedAt:"2026-10-04T05:00:00Z",
    ledgers:[ledger],journal,trades:[],counterfactuals,
  });
  const bot=report.bots[0];
  assert.equal(bot.evidenceMaturity.level,"early");
  assert.equal(bot.counterfactual.missedOpportunities,15);
  assert.equal(bot.counterfactual.protectiveRejections,5);
  assert.ok(bot.recommendations.some(item=>item.id==="review-rejection-gates"));
  assert.ok(bot.recommendations.every(item=>item.advisoryOnly===true));
});

test("score bands and symbol summaries combine observations without treating counterfactuals as PnL",()=>{
  const report=review.buildPaperStrategyReview({
    collectedAt:"2026-10-04T05:00:00Z",
    ledgers:[ledger],
    journal:[
      {bot_id:ledger.bot_id,event_type:"candidate",symbol:"DOT/USD",occurred_at:"2026-10-04T01:00:00Z",score:65,qualification:"watch",regime:"bullish",blockers:[],warnings:[],metadata:{}},
      {bot_id:ledger.bot_id,event_type:"candidate",symbol:"DOT/USD",occurred_at:"2026-10-04T01:05:00Z",score:75,qualification:"watch",regime:"bullish",blockers:[],warnings:[],metadata:{}},
    ],
    trades:[{
      bot_id:ledger.bot_id,strategy_id:ledger.strategy_id,strategy_version:3,symbol:"BTC/USD",status:"closed",
      opened_at:"2026-10-03T01:00:00Z",closed_at:"2026-10-03T02:00:00Z",realized_pl:1.2,r_multiple:1.5,mfe_r:2,mae_r:-0.3,estimated_fees:0.1,exit_reason:"target",
    }],
    counterfactuals:[{
      bot_id:ledger.bot_id,strategy_id:ledger.strategy_id,strategy_version:3,symbol:"DOT/USD",status:"completed",
      source_event_type:"rejected",decision_at:"2026-10-03T01:00:00Z",score:75,first_outcome:"two-r-before-stop",mfe_r:2.1,mae_r:-0.2,
    }],
  });
  const bot=report.bots[0];
  assert.equal(bot.executed.totalRealizedPl,1.2);
  assert.equal(bot.counterfactual.missedOpportunities,1);
  assert.equal(report.policy.counterfactualsAreNotPnL,true);
  assert.equal(bot.symbols.find(item=>item.symbol==="DOT/USD").observations,2);
  assert.equal(bot.scoreBands.find(item=>item.band==="70-79").resolvedStudies,1);
});


test("monitor-only observations are visible but excluded from recommendation score bands and top reasons",()=>{
  const report=review.buildPaperStrategyReview({
    collectedAt:"2026-10-04T05:00:00Z",
    ledgers:[ledger],
    journal:[
      {bot_id:ledger.bot_id,event_type:"candidate",symbol:"DOT/USD",occurred_at:"2026-10-04T01:00:00Z",score:65,qualification:"watch",regime:"bullish",blockers:[],warnings:["Execution reason"],metadata:{executionEligible:true}},
      {bot_id:ledger.bot_id,event_type:"candidate",symbol:"BCH/USD",occurred_at:"2026-10-04T01:00:00Z",score:85,qualification:"qualified",regime:"bullish",blockers:[],warnings:["Monitor-only reason"],metadata:{executionEligible:false}},
    ],
    trades:[],
    counterfactuals:[],
  });
  const bot=report.bots[0];
  assert.equal(bot.decisions.observations,2);
  assert.equal(bot.decisions.executionRelevantObservations,1);
  assert.equal(bot.decisions.monitorOnlyObservations,1);
  assert.equal(bot.scoreBands.find(item=>item.band==="80-100").observations,0);
  assert.equal(bot.decisions.topReasons[0].reason,"Execution reason");
});
