import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import {z} from "zod";
const ID="11111111-1111-4111-8111-111111111111";
const CLIENT="chb-pls-v1-test123-12345678";
const routeSource=readFileSync(new URL("../src/app/api/paper-trading/bots/stock-reservation-release/route.ts",import.meta.url),"utf8");
const sql=readFileSync(new URL("../supabase/migrations/20261009083000_coil_lock_and_paper_stock_release.sql",import.meta.url),"utf8");
const server=ts.transpileModule(routeSource,{compilerOptions:{
  module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,
}}).outputText;

function runFixture({position=false,openOrder=false,localPending=false,parentPending=false,
  brokerMarketOpen=false,operatorToken="",reportDenied=false}={}){
  const calls={rpc:0,broker:0};
  const json=(x,status=200)=>Response.json(x,{status});
  const fetch=async(raw,init={})=>{
    const u=new URL(raw),path=u.pathname,method=init.method??"GET";
    if(u.hostname.includes("supabase")){
      if(path.endsWith("/paper_stock_symbol_reservations"))return json([{
        reservation_id:ID,client_order_id:CLIENT,bot_id:"momentum-breakout-100",
        symbol:"SOXS",status:"active",
      }]);
      if(path.endsWith("/paper_bot_orders"))return json([{
        bot_id:"momentum-breakout-100",client_order_id:CLIENT,symbol:"SOXS",
        asset_class:"stock",status:localPending?"submitted":"filled",side:"buy",
      }]);
      if(path.endsWith("/paper_bot_positions"))return json([]);
      if(path.endsWith("/rpc/paper_stock_symbol_release_verified")){
        assert.equal(method,"POST");
        const body=JSON.parse(init.body);
        assert.equal(body.p_reservation_id,ID);
        assert.equal(body.p_client_order_id,CLIENT);
        assert.equal(body.p_proof.brokerHost,"paper-api.alpaca.markets");
        assert.equal(body.p_proof.brokerOpenOrdersClear,true);
        calls.rpc++;
        return json(!reportDenied);
      }
      throw Error("Unknown Supabase request "+path);
    }
    if(u.hostname!=="paper-api.alpaca.markets")throw Error("Unexpected broker host "+u.hostname);
    calls.broker++;
    if(path==="/v2/clock")return json({is_open:brokerMarketOpen});
    if(path==="/v2/positions")return json(position?[{symbol:"SOXS"}]:[]);
    if(path==="/v2/orders")return json(openOrder?[{symbol:"SOXS"}]:[]);
    if(path==="/v2/orders:by_client_order_id")return json({
      client_order_id:CLIENT,symbol:"SOXS",side:"buy",
      status:parentPending?"new":"filled",
    });
    throw Error("Unknown Alpaca request "+path);
  };
  const exports={};
  const env={CRON_SECRET:"audit-cron-secret",PAPER_STOCK_RELEASE_TOKEN:operatorToken,
    SUPABASE_SECRET_KEY:"db-service",ALPACA_API_KEY_ID:"paper-key",
    ALPACA_API_SECRET_KEY:"paper-secret"};
  vm.runInNewContext(server,{exports,fetch,process:{env},
    require:name=>{
      if(name==="next/server")return {NextResponse:{json:(body,opts={})=>
        Response.json(body,{status:opts.status??200})}};
      if(name==="zod")return {z};
      throw Error("Unexpected import "+name);
    },Request,Response,URL,AbortSignal,encodeURIComponent,
    Date,Math,Number,Object,Array,Set,RegExp,Error,JSON});
  const base="https://localhost/api/paper-trading/bots/stock-reservation-release";
  const audit=async(auth="Bearer audit-cron-secret")=>{
    const r=await exports.GET(new Request(base+"?reservation_id="+ID,{
      headers:{authorization:auth}}));
    return {status:r.status,body:await r.json()};
  };
  const release=async(auth="Bearer audit-cron-secret",token=operatorToken)=>{
    const r=await exports.POST(new Request(base,{method:"POST",
      headers:{authorization:auth,"x-paper-stock-release-token":token,
        "content-type":"application/json"},
      body:JSON.stringify({reservationId:ID,clientOrderId:CLIENT,
        confirm:"RELEASE VERIFIED PAPER STOCK RESERVATION"})}));
    return {status:r.status,body:await r.json()};
  };
  return {audit,release,calls};
}
test("PAPER reservation audit does not query any data without cron secret",async()=>{
  const f=runFixture();
  const x=await f.audit("bad");
  assert.equal(x.status,401);
  assert.equal(f.calls.broker,0);assert.equal(f.calls.rpc,0);
});
test("Manual release is disabled by default without its second operator token",async()=>{
  const f=runFixture();
  assert.equal((await f.release()).status,403);
  assert.equal(f.calls.rpc,0);assert.equal(f.calls.broker,0);
});
test("Read-only broker audit reports eligible but never releases the physical symbol",async()=>{
  const f=runFixture();
  const r=await f.audit();
  assert.equal(r.status,200,JSON.stringify(r.body));
  assert.equal(r.body.readOnly,true);
  assert.equal(r.body.releaseEligibleForOperatorReview,true);
  assert.equal(f.calls.rpc,0);
});
test("Manual release demands explicit token and confirmed PAPER market closure",async()=>{
  const token="operator-token-32-characters-minimum-abcdef";
  const f=runFixture({operatorToken:token});
  assert.equal((await f.release("Bearer audit-cron-secret","invalid")).status,403);
  assert.equal(f.calls.rpc,0);
  const result=await f.release();
  assert.equal(result.status,200,JSON.stringify(result.body));
  assert.equal(result.body.action,"released");
  assert.equal(f.calls.rpc,1);
});
test("Market open, broker order/position, local pending and parent pending all fail closed",async()=>{
  const token="operator-token-32-characters-minimum-abcdef";
  for(const opts of [{brokerMarketOpen:true},{position:true},{openOrder:true},
    {localPending:true},{parentPending:true}]){
    const f=runFixture({...opts,operatorToken:token});
    const result=await f.release();
    assert.equal(result.status,409,JSON.stringify({opts,result}));
    assert.equal(f.calls.rpc,0);
  }
});
test("DB reconciliation refusal is never called success by manual release endpoint",async()=>{
  const f=runFixture({operatorToken:"operator-token-32-characters-minimum-abcdef",reportDenied:true});
  const result=await f.release();
  assert.equal(result.status,409);
  assert.equal(result.body.action,"release-denied-by-db");
  assert.equal(f.calls.rpc,1);
});
test("SQL release serializes and requires audit, settled fills and fresh report sync",()=>{
  assert.match(sql,/squeeze-breakout-100/);
  assert.match(sql,/auth\.role\(\) IS DISTINCT FROM 'service_role'/);
  assert.match(sql,/paper_stock_symbol_release_audit/);
  assert.match(sql,/ledger_applied_at IS NULL/);
  assert.match(sql,/r\.last_attempt_at>pg_catalog\.now\(\)-interval '2 minutes'/);
  assert.match(sql,/hashtextextended\('paper-stock:'\|\|v_owner\.symbol,0\)/);
  assert.match(sql,/released_at=pg_catalog\.now\(\)/);
  assert.match(sql,/INSERT INTO public\.paper_stock_symbol_release_audit/);
  assert.match(sql,/REVOKE ALL ON FUNCTION public\.paper_stock_symbol_release_verified/);
  assert.match(sql,/GRANT EXECUTE ON FUNCTION public\.paper_stock_symbol_release_verified[\s\S]*?TO service_role/);
});
