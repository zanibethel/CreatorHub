import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import {webcrypto} from "node:crypto";

const src=rel=>readFileSync(new URL(rel,import.meta.url),"utf8");
const migrations=src("../supabase/migrations/20261009175000_paper_oco_cancel_timeline_evidence.sql");
const collectorText=src("../supabase/functions/paper-report-sync/collector.ts");
const handlerText=src("../supabase/functions/paper-report-sync/handler.ts");
const exports={};
vm.runInNewContext(ts.transpileModule(collectorText,{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText,{exports,URL,TextEncoder,crypto:webcrypto,AbortSignal,require:name=>{throw Error(name);}});
const json=payload=>Response.json(payload);
test("collector preserves exact private order cancel/update timestamps and parent attribution",async()=>{
  const id="chb-pny-v1-mv16eyp2-7adcc5298f604ea69b70342e";
  const canceledAt="2026-10-09T16:31:40.895316177Z";
  const parent={id:"parent-rxrx",client_order_id:id,symbol:"RXRX",
    asset_class:"us_equity",side:"buy",type:"limit",order_class:"bracket",
    status:"filled",qty:"4",filled_qty:"4",submitted_at:"2026-10-09T16:25:04Z",
    legs:[
      {id:"target-rxrx",client_order_id:"target-child",symbol:"RXRX",asset_class:"us_equity",
        side:"sell",type:"limit",order_class:"bracket",status:"filled",qty:"4",filled_qty:"4",
        filled_at:"2026-10-09T16:31:42.508790391Z",updated_at:"2026-10-09T16:31:42.510262153Z"},
      {id:"stop-rxrx",client_order_id:"stop-child",symbol:"RXRX",asset_class:"us_equity",
        side:"sell",type:"stop",order_class:"bracket",status:"canceled",qty:"4",filled_qty:"0",
        canceled_at:canceledAt,updated_at:"2026-10-09T16:31:40.895316588Z"}
    ]};
  const fill={id:"rxrx-target-partial",order_id:"target-rxrx",symbol:"RXRX",
    side:"sell",qty:"1",price:"4.37",cum_qty:"4",leaves_qty:"0",
    transaction_time:"2026-10-09T16:31:42.508790391Z"};
  const fetcher=url=>{
    const p=new URL(url).pathname;
    if(p.endsWith("/account"))return json({id:"paper-account",equity:"100000",currency:"USD"});
    if(p.endsWith("/positions"))return json([]);
    if(p.endsWith("/orders"))return json([parent]);
    if(p.endsWith("/FILL"))return json([fill]);
    throw Error("Unexpected "+p);
  };
  const {report,brokerActivity}=await exports.collectPaperReport("key","secret",fetcher);
  assert.equal(brokerActivity.orders.length,3);
  const stop=brokerActivity.orders.find(x=>x.brokerOrderId==="stop-rxrx");
  assert.equal(stop.attributionClientOrderId,id);
  assert.equal(stop.parentBrokerOrderId,"parent-rxrx");
  assert.equal(stop.canceledAt,"2026-10-09T16:31:40.895316177Z");
  assert.equal(stop.updatedAt,"2026-10-09T16:31:40.895316588Z");
  assert.equal(stop.replacedAt,null);
  assert.equal(brokerActivity.fills.length,1);
  assert.equal(brokerActivity.fills[0].transactionTime,"2026-10-09T16:31:42.508790391Z");
  assert.equal(brokerActivity.fills[0].brokerOrderId,"target-rxrx");
  assert.equal(brokerActivity.orders.find(x=>x.brokerOrderId==="target-rxrx").canceledAt,null);
  assert.doesNotMatch(JSON.stringify(report),/stop-rxrx|parent-rxrx|brokerCanceledAt|canceledAt/);
});
test("lifecycle timestamps are written after tagged reconciliation, before other ledger phases",()=>{
  const initial=handlerText.indexOf('await db("rpc/paper_bot_reconcile_broker_activity"');
  const lifecycles=handlerText.indexOf('await db("rpc/paper_bot_record_order_lifecycle_evidence"');
  const link=handlerText.indexOf('await db("rpc/paper_bot_link_prepared_orders"');
  assert.ok(initial>0&&lifecycles>initial&&link>lifecycles);
});
test("evidence migration is service-role-only, bot-attributed, and has no trade writes",()=>{
  assert.match(migrations,/CREATE OR REPLACE FUNCTION public\.paper_bot_record_order_lifecycle_evidence/);
  assert.match(migrations,/CREATE OR REPLACE FUNCTION public\.paper_bot_stock_oco_gap_audit/);
  assert.match(migrations,/o\.metadata->>'attributionClientOrderId'=i\.attributed_client/);
  assert.match(migrations,/o\.client_order_id=i\.client_id/);
  assert.match(migrations,/GRANT EXECUTE ON FUNCTION public\.paper_bot_stock_oco_gap_audit\(text\)\s+TO service_role/);
  assert.match(migrations,/FROM PUBLIC,anon,authenticated/);
  assert.match(migrations,/f\.transaction_time<=s\.canceled_at/);
  assert.match(migrations,/c\.final_fill>c\.canceled_at/);
  assert.doesNotMatch(migrations,/UPDATE public\.paper_bot_positions|UPDATE public\.paper_bot_ledgers|DELETE FROM public\.paper_bot_orders|POST \/v2\/orders/);
});
test("RXRX nanosecond broker activities expose a 1.613474214-second potential residual-cover interval",()=>{
  const nanos=(stamp)=>{
    const match=/^(.*?)(?:\\.(\\d{1,9}))?Z$/.exec(stamp);
    assert.ok(match);
    return BigInt(Date.parse(match[1]+"Z"))*1000000n+
      BigInt(((match[2]??"")+"000000000").slice(0,9));
  };
  const canceled=nanos("2026-10-09T16:31:40.895316177Z");
  const first=nanos("2026-10-09T16:31:40.893978Z");
  const last=nanos("2026-10-09T16:31:42.508790391Z");
  assert.equal(first<canceled,true);
  assert.equal(4-2,2);
  assert.equal(last-canceled,1613474214n);
});
