import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const read=p=>readFileSync(path.join(root,p),"utf8");
const ids=[
  ["default-diverse","Atlas","div","automatic"],
  ["penny-volatility-day-100","Fuse","pny","research"],
  ["three-trade-weekly-swing-100","Harbor","sw3","automatic"],
  ["weekend-crypto-day-100","Flash","wkd","automatic"],
  ["momentum-breakout-100","Pulse","pls","automatic"],
  ["crypto-ignition-100","Spark","spk","automatic"],
  ["crypto-swing-100","Orbit","csw","research"],
  ["squeeze-breakout-100","Coil","sqz","research"],
];
const profiles=ids.map(([id,codename,brokerTag,executionState])=>({
  id,codename,brokerTag,executionState,strategyId:id+"-v1",
}));
const exports={};
vm.runInNewContext(ts.transpileModule(read("src/lib/paper-execution-audit.ts"),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText,{
  exports,require:(name)=>{
    assert.equal(name,"./paper-bot-profiles");
    return {PAPER_BOT_PROFILES:profiles};
  },
});
const collect=exports.buildPaperEightBotAudit;
function fixture(){
  return {
    asOf:"2026-10-10T00:45:00Z",
    windowStart:"2026-10-03T00:45:00Z",
    ledgers:ids.map(([id])=>({
      bot_id:id,strategy_id:id+"-v1",strategy_version:1,status:"active",
      starting_cash:100,cash:100,equity:100,
      metadata:{executionEnabled:!["crypto-swing-100","squeeze-breakout-100"].includes(id)},
    })),
    performance:ids.map(([id])=>({
      bot_id:id,candidate_checks_7d:5,broker_buy_orders:0,
      filled_buy_orders:0,closed_trades:0,latest_candidate_at:"2026-10-09T22:00:00Z",
      authorizations_7d:0,
    })),
    cron:[],virtualPositions:[],dbBrokerOrders:[],
    brokerOrders:[],brokerPositions:[],fillsUnapplied:0,
  };
}
const report=input=>collect(input).bots;
const row=(rows,id)=>rows.find(r=>r.botId===id);

test("all eight bot IDs are unique, match strategy-backed profiles and retain $100 histories",()=>{
  const f=fixture();
  const r=report(f);
  assert.equal(r.length,8);
  assert.deepEqual(Array.from(r,x=>x.botId),ids.map(x=>x[0]));
  assert.ok(r.every(x=>x.strategyId&&x.strategyVersion===1));
  assert.ok(f.ledgers.every(x=>x.starting_cash===100));
});
test("configured research state cannot substitute for effective execution permission",()=>{
  const f=fixture();
  const fuse=f.ledgers.find(x=>x.bot_id==="penny-volatility-day-100");
  fuse.metadata.fusePilotClientOrderId="historic-one-shot-consumed";
  const r=report(f);
  assert.equal(row(r,"penny-volatility-day-100").configuredMode,"research");
  assert.equal(row(r,"penny-volatility-day-100").effectiveExecutionPermission,"pilot-consumed");
  assert.notEqual(row(r,"penny-volatility-day-100").executionReadiness,"PAPER execution operational");
  assert.equal(row(r,"crypto-swing-100").executionReadiness,"Research-only");
  assert.equal(row(r,"squeeze-breakout-100").executionReadiness,"Research-only");
});
test("missing broker evidence remains unknown, never false reconciliation or successful protection",()=>{
  const f=fixture();f.brokerOrders=null;f.brokerPositions=null;
  const r=report(f);
  assert.equal(r[0].brokerAttributionVerified,null);
  assert.equal(r[0].ledgerReconciled,null);
  assert.equal(r[0].stopProtectionVerified,null);
  assert.equal(r[0].submittedOrderCount,null);
  assert.ok(r.every(x=>x.executionReadiness!=="PAPER execution operational"));
});
test("unprotected physical Spark shares fail closed even when historic closes exist",()=>{
  const f=fixture(),id="crypto-ignition-100";
  f.performance.find(x=>x.bot_id===id).closed_trades=3;
  f.virtualPositions.push({bot_id:id,symbol:"BTC/USD",quantity:0.000213223,protective_stop:82173});
  f.brokerPositions.push({symbol:"BTCUSD",qty:"0.000213223"});
  const r=row(report(f),id);
  assert.equal(r.stopProtectionVerified,false);
  assert.notEqual(r.executionReadiness,"PAPER execution operational");
  assert.ok(r.blockers.some(x=>x.includes("P0: Current PAPER position")));
});
test("current valid broker protective stop requires broker ID attribution and shares",()=>{
  const f=fixture(),id="crypto-ignition-100";
  f.performance.find(x=>x.bot_id===id).closed_trades=3;
  f.virtualPositions.push({bot_id:id,symbol:"BTC/USD",quantity:0.000213223,protective_stop:82173});
  f.brokerPositions.push({symbol:"BTCUSD",qty:"0.000213223"});
  f.dbBrokerOrders.push({bot_id:id,broker_order_id:"o-1",client_order_id:"chb-spk-v1-aa-bbbbbbbb",symbol:"BTC/USD",side:"sell",status:"new"});
  f.brokerOrders.push({id:"o-1",client_order_id:"chb-spk-v1-aa-bbbbbbbb",symbol:"BTC/USD",side:"sell",status:"new",type:"stop_limit",stop_price:"82173",qty:"0.000213223"});
  const r=row(report(f),id);
  assert.equal(r.stopProtectionVerified,true);
  assert.equal(r.brokerAttributionVerified,true);
  assert.equal(r.executionReadiness,"PAPER execution implemented but currently blocked");
  assert.equal(r.evidence.freshQuoteVerified,null);
  assert.ok(r.warnings.some(x=>x.includes("quote freshness")));
});
test("partial stop quantity detects an underprotected broker position",()=>{
  const f=fixture(),id="crypto-ignition-100";
  f.virtualPositions.push({bot_id:id,symbol:"BTC/USD",quantity:0.000213223,protective_stop:82173});
  f.brokerPositions.push({symbol:"BTC/USD",qty:"0.000213223"});
  f.dbBrokerOrders.push({bot_id:id,broker_order_id:"stop",client_order_id:"chb-spk-v1-aa-abcdefgh",symbol:"BTC/USD",side:"sell",status:"new"});
  f.brokerOrders.push({id:"stop",client_order_id:"chb-spk-v1-aa-abcdefgh",symbol:"BTC/USD",side:"sell",status:"new",type:"stop_limit",stop_price:"82173",qty:"0.0001"});
  assert.equal(row(report(f),id).stopProtectionVerified,false);
});
test("foreign physical-symbol entry collision fails closed",()=>{
  const f=fixture(),id="crypto-ignition-100";
  f.virtualPositions.push({bot_id:id,symbol:"BTC/USD",quantity:0.000213223,protective_stop:82173});
  f.brokerPositions.push({symbol:"BTCUSD",qty:"0.000213223"});
  f.dbBrokerOrders.push({bot_id:id,broker_order_id:"stop",client_order_id:"chb-spk-v1-aa-abcdefgh",symbol:"BTC/USD",side:"sell",status:"new"});
  f.brokerOrders.push({id:"stop",client_order_id:"chb-spk-v1-aa-abcdefgh",symbol:"BTC/USD",side:"sell",status:"new",type:"stop_limit",stop_price:"82173",qty:"0.000213223"});
  f.brokerOrders.push({id:"foreign-buy",client_order_id:"external",symbol:"BTCUSD",side:"buy",status:"new",qty:"0.1"});
  assert.equal(row(report(f),id).stopProtectionVerified,false);
});
test("unmatched tagged PAPER orders are flagged for attribution review",()=>{
  const f=fixture(),id="crypto-ignition-100";
  f.brokerOrders.push({id:"unrecorded",client_order_id:"chb-spk-v1-abc-12345678",symbol:"SOL/USD",side:"buy",status:"filled",qty:"0.1"});
  assert.equal(row(report(f),id).brokerAttributionVerified,false);
  assert.ok(row(report(f),id).blockers.some(x=>x.includes("attribution")));
});
test("external/manual PAPER probes are isolated, never mistaken for attributable bot trades",()=>{
  const f=fixture();
  f.brokerOrders.push({id:"probe",client_order_id:"atlas-probe-afterhours-20261008",symbol:"F",side:"buy",status:"filled"});
  const r=collect(f);
  assert.equal(r.unattributedBrokerOrders.length,1);
  assert.equal(r.unattributedBrokerOrders[0].needsManualClassification,true);
  assert.equal(row(r.bots,"default-diverse").filledOrderCount,0);
});
test("capital-only outcomes remain unknown without mutually exclusive strategy evidence",()=>{
  const r=report(fixture());
  assert.ok(r.every(x=>x.capitalBlockedCount===null&&x.readyCount===null&&x.strategyQualifiedCount===null));
  assert.equal(r[0].candidateCount,5);
});
test("missing ledger never counts as an operational bot",()=>{
  const f=fixture();f.ledgers=f.ledgers.filter(x=>x.bot_id!=="default-diverse");
  const r=row(report(f),"default-diverse");
  assert.equal(r.effectiveExecutionPermission,"unavailable");
  assert.equal(r.executionReadiness,"Broken / requires repair");
});
test("Harbor's verified fractional bracket broker rejection is not misclassified ready",()=>{
  const r=row(report(fixture()),"three-trade-weekly-swing-100");
  assert.equal(r.executionReadiness,"PAPER execution partially implemented");
  assert.ok(r.blockers.some(x=>x.includes("SNAP")));
});
test("audit is deterministic, read-only, and does not modify the $5K model or PAPER ledgers",()=>{
  const f=fixture(),before=JSON.stringify(f);
  const a=collect(f);const b=collect(f);
  assert.equal(JSON.stringify(a),JSON.stringify(b));
  assert.equal(JSON.stringify(f),before);
  assert.equal(a.sharedCapitalExecutionAuthorized,false);
  assert.equal(a.readOnly,true);
  assert.equal(a.paperOnly,true);
  const route=read("src/app/api/paper-trading/bots/execution-audit/route.ts");
  assert.match(route,/CRON_SECRET/);
  assert.match(route,/paper-api\.alpaca\.markets/);
  assert.doesNotMatch(route,/https:\/\/api\.alpaca\.markets\/v2/);
  assert.doesNotMatch(route,/method:\s*["'](?:POST|PATCH|DELETE)["']/);
  assert.doesNotMatch(route,/paper_shared_preview_claim|paper_shared_preview_release/);
});

test("missing current quote evidence never certifies historic fills as execution-ready",()=>{
  const f=fixture(),id="crypto-ignition-100";
  f.performance.find(x=>x.bot_id===id).closed_trades=3;
  const r=row(report(f),id);
  assert.equal(r.evidence.freshQuoteVerified,null);
  assert.notEqual(r.executionReadiness,"PAPER execution operational");
});

test("broker target limit sell is not mistaken for an active protective stop",()=>{
 const f=fixture(),id="crypto-ignition-100";
 f.virtualPositions.push({bot_id:id,symbol:"BTC/USD",quantity:0.000213223,protective_stop:82173});
 f.brokerPositions.push({symbol:"BTCUSD",qty:"0.000213223"});
 f.dbBrokerOrders.push({bot_id:id,broker_order_id:"target",client_order_id:"chb-spk-v1-aa-abcdefgh",symbol:"BTC/USD",side:"sell",status:"new"});
 f.brokerOrders.push({id:"target",client_order_id:"chb-spk-v1-aa-abcdefgh",symbol:"BTC/USD",side:"sell",status:"new",type:"limit",qty:"0.000213223"});
 assert.equal(row(report(f),id).stopProtectionVerified,false);
});
test("applied fill counts cannot alone certify reconciled ledger cash",()=>{
 const f=fixture(),id="crypto-ignition-100";
 f.dbBrokerOrders.push({bot_id:id,broker_order_id:"entry",client_order_id:"chb-spk-v1-aa-abcdefgh",symbol:"SOL/USD",side:"buy",status:"filled"});
 f.brokerOrders.push({id:"entry",client_order_id:"chb-spk-v1-aa-abcdefgh",symbol:"SOL/USD",side:"buy",status:"filled",submitted_at:f.asOf});
 assert.equal(row(report(f),id).ledgerReconciled,null);
});
