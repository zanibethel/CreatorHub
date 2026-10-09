import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import ts from "typescript";
function load(path,imports={}){
  const exports={};
  const source=readFileSync(new URL(path,import.meta.url),"utf8");
  vm.runInNewContext(ts.transpileModule(source,{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
  }).outputText,{exports,require:n=>{if(n in imports)return imports[n];throw new Error("Import "+n);}});
  return exports;
}
const capital=load("../src/lib/paper-shared-capital-manager.ts");
const upcoming=load("../src/lib/paper-upcoming-trades.ts",{
  "./paper-shared-capital-manager":capital,
});
const now="2026-10-09T23:45:00Z";
const portfolio={
  equityUsd:5000,settledCashUsd:5000,buyingPowerUsd:5000,reservedCashUsd:0,
  dayStartEquityUsd:5000,weekStartEquityUsd:5000,
  dayProfitLossUsd:0,weekProfitLossUsd:0,holdings:[],pendingEntries:[],
};
const prospects=[
 {symbol:"NIO",status:"watchlist",score:70,watchlist_eligible:true,
 assigned_bot_ids:["default-diverse","penny-volatility-day-100"],spread_pct:0.2,
 last_seen_at:"2026-10-09T23:40:30Z",metadata:{marketSession:"after-hours",quoteAt:"2026-10-09T20:01:00Z"}},
 {symbol:"XPEV",status:"watchlist",score:67,watchlist_eligible:true,
 assigned_bot_ids:["momentum-breakout-100","default-diverse"],spread_pct:0.15,
 last_seen_at:"2026-10-09T23:40:30Z",metadata:{marketSession:"after-hours",quoteAt:"2026-10-09T20:01:00Z"}},
];
const journal=(overrides={})=>({
 bot_id:"default-diverse",symbol:"NIO",event_type:"candidate",
 qualification:"watch",occurred_at:"2026-10-09T23:42:00Z",
 blockers:["A fresh quote is required."],warnings:[],
 metadata:{referencePlan:{entryTrigger:3.7919,stopPrice:3.3424,exitPrice:4.6909,uncappedPositionValue:6.31},
 inputProvenance:{quoteAt:"2026-10-09T20:01:00Z"}},...overrides,
});
const run=(overrides={})=>upcoming.buildUpcomingStockWatch({
 prospects,journals:[journal()],stagedOrders:[],positions:[],portfolio,now,...overrides,
});
test("upcoming NIO card is a genuine watched stock with actual Atlas reference numbers",()=>{
 const list=run();
 assert.equal(list.length,2);
 const row=list[0];
 assert.equal(row.symbol,"NIO");
 assert.equal(row.assignedBotName,"Atlas");
 assert.equal(row.entryPrice,3.7919);
 assert.equal(row.stopPrice,3.3424);
 assert.equal(row.targetPrice,4.6909);
 assert.equal(row.planSource,"strategy-reference");
 assert.equal(row.paperOrderAuthorized,false);
 assert.equal(row.quoteFresh,false);
 assert.notEqual(row.allocatorState,"allocatable");
 assert.ok(row.reviewingBots.includes("Fuse"));
});
test("watchlist assignment without a bot strategy plan does not invent entry or exit",()=>{
 const item=run().find(x=>x.symbol==="XPEV");
 assert.equal(item.entryPrice,null);
 assert.equal(item.targetPrice,null);
 assert.equal(item.planSource,"awaiting-plan");
 assert.equal(item.paperOrderAuthorized,false);
});
test("prepared plan from an unexpired bot staged order takes priority, but is not labeled ready",()=>{
 const list=run({stagedOrders:[{
  bot_id:"momentum-breakout-100",symbol:"XPEV",side:"buy",status:"prepared",
  entry_trigger:18.52,protective_stop:17.93,take_profit_price:20.4,
  requested_notional:120,created_at:"2026-10-09T23:42:00Z",
  expires_at:"2026-10-10T02:00:00Z",
 }]});
 assert.equal(list[0].symbol,"XPEV");
 assert.equal(list[0].assignedBotName,"Pulse");
 assert.equal(list[0].planSource,"prepared-order");
 assert.equal(list[0].planState,"prepared");
 assert.equal(list[0].entryPrice,18.52);
 assert.equal(list[0].targetPrice,20.4);
 assert.equal(list[0].paperOrderAuthorized,false);
});
test("submitted/expired orders do not become new upcoming prepared plans",()=>{
 const output=run({stagedOrders:[{
  bot_id:"momentum-breakout-100",symbol:"XPEV",side:"buy",status:"submitted",
  entry_trigger:18.52,protective_stop:17.93,take_profit_price:20.4,
  requested_notional:120,created_at:"2026-10-09T23:42:00Z",
  expires_at:"2026-10-09T23:44:00Z",
 }]});
 assert.equal(output.find(x=>x.symbol==="XPEV").entryPrice,null);
});
test("even trade-ready decision and fresh quote cannot authorize shared PAPER execution",()=>{
 const clear=journal({qualification:"trade-ready",blockers:[],
 metadata:{referencePlan:{entryTrigger:3.7919,stopPrice:3.3424,exitPrice:4.6909,uncappedPositionValue:6.31},
 inputProvenance:{quoteAt:"2026-10-09T23:44:30Z"}}});
 const row=run({
  prospects:[{...prospects[0],metadata:{...prospects[0].metadata,marketSession:"regular"}}],
  journals:[clear],
 })[0];
 assert.equal(row.quoteFresh,true);
 assert.equal(row.paperOrderAuthorized,false);
 assert.equal(row.allocatorState,"rejected");
 assert.ok(row.allocatorReasons.some(x=>x.includes("Protective")));
});
test("owned, stale, non-watchlist, and unassigned symbols are excluded",()=>{
 const output=run({positions:[{bot_id:"default-diverse",symbol:"NIO",quantity:2}],
 prospects:[...prospects,{
 symbol:"SPY",status:"candidate",score:90,watchlist_eligible:false,
 assigned_bot_ids:["default-diverse"],spread_pct:0.1,last_seen_at:now,metadata:{},
 }]});
 assert.equal(output.length,1);
 assert.equal(output[0].symbol,"XPEV");
});
test("the UI is on both the first Trading Report and Bot Portfolio view",()=>{
 const homepage=readFileSync(new URL("../src/components/PaperTradingLab.tsx",import.meta.url),"utf8");
 const botlab=readFileSync(new URL("../src/components/PaperBotLab.tsx",import.meta.url),"utf8");
 const route=readFileSync(new URL("../src/app/api/paper-trading/bots/upcoming-trades/route.ts",import.meta.url),"utf8");
 assert.match(homepage,/view === "portfolio" \? <UpcomingTradesCard compact/);
 assert.match(botlab,/<UpcomingTradesCard \/>/);
 assert.match(route,/executionMode:"observation-only"/);
 assert.doesNotMatch(route,/export async function POST|submitOrder|placeOrder/);
});
