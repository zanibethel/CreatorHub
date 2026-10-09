import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import {z} from "zod";

function load(rel,imports,extra={}){
  const src=readFileSync(new URL(rel,import.meta.url),"utf8");
  const js=ts.transpileModule(src,{compilerOptions:{
    module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,
  }}).outputText;
  const exports={};
  vm.runInNewContext(js,{exports,require:name=>{
    if(name in imports)return imports[name];
    throw Error("Unknown imported module "+name);
  },Intl,Date,Math,Number,Object,Array,Map,Set,RegExp,...extra});
  return exports;
}
const CLIENT="chb-pny-v1-mvzpxd60-aabcdef123456789";
const cfg={FUSE_PENNY_STRATEGY_V1:{
  botProfileId:"penny-volatility-day-100",id:"penny-volatility-day-v1",version:1,
}};
const attribution={parsePaperClientOrderId:id=>id===CLIENT?
  {botId:"penny-volatility-day-100",strategyVersion:1}:null};
const exit=load("../src/lib/paper-fuse-exit-manager.ts",{});
const audit=load("../src/lib/paper-fuse-protection-audit.ts",{
  "./paper-fuse-strategy-config":cfg,
  "./paper-order-attribution":attribution,
});
const source=readFileSync(new URL("../src/app/api/paper-trading/bots/fuse-manage/route.ts",import.meta.url),"utf8");
const js=ts.transpileModule(source,{compilerOptions:{
  module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,
}}).outputText;
const fixedTime=Date.parse("2026-10-08T19:45:00Z");
class FixedDate extends Date {static now(){return fixedTime;}}
function setup({foreign=false,wrongVirtual=false,parentPending=false,noEntry=false,ambiguousPost=false,unavailable=false,pnyChildren=false,pnyOrphan=false}={}){
  const events=[],orders=new Map();
  let canceled=false,flattenCount=0,parentCanceled=false;
  const entry={client_order_id:CLIENT,symbol:"NVD",side:"buy",
    status:"filled",broker_order_id:"P1",requested_quantity:5,entry_trigger:3.46,
    max_entry_price:3.51,protective_stop:3.428825,take_profit_price:3.53273};
  const stop=()=>({id:"S1",client_order_id:pnyChildren?CLIENT+"-stop":"exit-stop",symbol:"NVD",side:"sell",
    status:canceled?"canceled":"new",type:"stop",qty:"5",filled_qty:"0",stop_price:"3.43"});
  const target=()=>({id:"T1",client_order_id:pnyChildren?CLIENT+"-target":"exit-target",symbol:"NVD",side:"sell",
    status:canceled?"canceled":"new",type:"limit",qty:"5",filled_qty:"0",limit_price:"3.54"});
  const parent=()=>({id:"P1",client_order_id:CLIENT,symbol:"NVD",side:"buy",
    status:parentCanceled?"canceled":parentPending?"partially_filled":"filled",
    type:"limit",order_class:"bracket",time_in_force:"day",
    qty:"5",filled_qty:parentPending?"0":"5",
    legs:[stop(),target()]});
  const sellId=exit.fuseFlattenOrderId(CLIENT);
  const asJson=(data,status=200)=>Response.json(data,{status});
  const fetch=async(input,opt={})=>{
    const url=new URL(input),method=opt.method??"GET";
    events.push({method,path:url.pathname,query:url.search});
    if(url.hostname.includes("supabase")){
      if(url.pathname.endsWith("paper_bot_positions"))
        return asJson(parentPending?[]:[{bot_id:"penny-volatility-day-100",
          symbol:"NVD",quantity:wrongVirtual?4:5}]);
      if(url.pathname.endsWith("paper_bot_orders")){
        const id=url.searchParams.get("client_order_id");
        if(method==="GET"){
          if(id)return asJson(orders.has(sellId)?[orders.get(sellId)]:[]);
          return asJson(noEntry?[]:[entry]);
        }
        if(method==="POST"){
          const body=JSON.parse(opt.body);orders.set(body.client_order_id,body);
          return asJson(null);
        }
        if(method==="PATCH"){
          const body=JSON.parse(opt.body),v=orders.get(sellId);
          if(!v)throw Error("Cannot claim missing sell order");
          if(url.searchParams.get("status")==="eq.prepared"&&v.status!=="prepared")
            return asJson([]);
          const next={...v,...body};orders.set(sellId,next);
          return asJson(opt.headers.Prefer==="return=representation"?[next]:null);
        }
      }
      throw Error("Unexpected database request "+url.pathname);
    }
    if(url.hostname!=="paper-api.alpaca.markets")throw Error("Unexpected host");
    if(url.pathname==="/v2/clock")return asJson({is_open:true});
    if(url.pathname==="/v2/positions")return asJson(parentPending?[]:
      [{symbol:"NVD",qty:"5",qty_available:canceled&&!unavailable?"5":"0"}]);
    if(url.pathname==="/v2/orders"&&method==="GET"){
      const pending=[...(canceled?[]:[stop(),target()]),
        ...(pnyOrphan?[{id:"ORPHAN",client_order_id:CLIENT+"-unknown",
          symbol:"NVD",side:"sell",type:"stop",status:"new"}]:[]),
        ...(foreign?[{id:"OTHER",client_order_id:"foreign",symbol:"NVD",
          side:"sell",type:"limit",status:"new"}]:[])];
      if(flattenCount&&!ambiguousPost)pending.push({id:"FX1",client_order_id:sellId,
        symbol:"NVD",side:"sell",type:"market",status:"new"});
      return asJson(pending);
    }
    if(url.pathname==="/v2/orders/P1"){
      if(method==="DELETE"){parentCanceled=true;return new Response(null,{status:204});}
      return asJson(parent());
    }
    if(url.pathname==="/v2/orders/S1"){
      if(method==="DELETE"){canceled=true;return new Response(null,{status:204});}
      return asJson(stop());
    }
    if(url.pathname==="/v2/orders/T1")return asJson(target());
    if(url.pathname==="/v2/orders:by_client_order_id"){
      if(!flattenCount||ambiguousPost)return asJson({message:"not found"},404);
      return asJson({id:"FX1",client_order_id:sellId,symbol:"NVD",side:"sell",
        status:"new",type:"market"});
    }
    if(url.pathname==="/v2/orders"&&method==="POST"){
      const body=JSON.parse(opt.body);
      assert.equal(body.symbol,"NVD");assert.equal(body.side,"sell");
      assert.equal(body.qty,"5");assert.equal(body.time_in_force,"day");
      assert.equal(body.client_order_id,sellId);flattenCount++;
      if(ambiguousPost)throw Error("Simulated broker network timeout.");
      return asJson({id:"FX1",client_order_id:sellId,symbol:"NVD",side:"sell",
        status:"new",type:"market"});
    }
    throw Error("Unexpected broker request "+method+" "+url.pathname);
  };
  const route={exports:{}};
  vm.runInNewContext(js,{exports:route.exports,fetch,URL,Response,AbortSignal,
    Error,Number,Math,Date:FixedDate,Intl,encodeURIComponent,Array,Set,Object,process:{
      env:{CRON_SECRET:"fuse-test-secret",SUPABASE_SECRET_KEY:"service",
        ALPACA_API_KEY_ID:"key",ALPACA_API_SECRET_KEY:"secret"},
    },require:name=>{
      if(name==="next/server")return {NextResponse:{json:(body,init={})=>
        Response.json(body,{status:init.status??200})}};
      if(name==="zod")return {z};
      if(name==="@/lib/paper-fuse-strategy-config")return cfg;
      if(name==="@/lib/paper-order-attribution")return attribution;
      if(name==="@/lib/paper-fuse-protection-audit")return audit;
      if(name==="@/lib/paper-fuse-exit-manager")return exit;
      throw Error("Unexpected import "+name);
    }});
  const run=async(auth="Bearer fuse-test-secret")=>{
    const r=await route.exports.GET({headers:{get:k=>k==="authorization"?auth:null}});
    return {status:r.status,body:await r.json()};
  };
  return {run,events,getFlattenCount:()=>flattenCount,getCanceled:()=>canceled};
}
test("Fuse manager is cron-private and does not touch broker on bad authentication",async()=>{
  const a=setup(),out=await a.run(null);
  assert.equal(out.status,401);assert.equal(a.events.length,0);
});
test("Fuse cancels linked broker exits in one cron; submits a SINGLE tagged PAPER exit only after second recheck",async()=>{
  const a=setup(),first=await a.run();
  assert.equal(first.status,200,JSON.stringify(first.body));
  assert.equal(first.body.decisions[0].action,"oco-cancel-requested");
  assert.equal(a.getCanceled(),true);assert.equal(a.getFlattenCount(),0);
  const second=await a.run();
  assert.equal(second.status,200,JSON.stringify(second.body));
  assert.equal(second.body.decisions[0].action,"flatten-new");
  assert.equal(a.getFlattenCount(),1);
  const third=await a.run();
  assert.equal(third.status,503);
  assert.equal(a.getFlattenCount(),1);
});
test("Fuse never cancels or creates an exit while another PAPER owner has an open order",async()=>{
  const a=setup({foreign:true});
  const x=await a.run();assert.equal(x.status,503);
  assert.equal(x.body.decisions[0].action,"manual-reconciliation");
  assert.equal(a.getCanceled(),false);assert.equal(a.getFlattenCount(),0);
});
test("Fuse refuses broker-to-ledger mismatch without issuing independent sells",async()=>{
  const a=setup({wrongVirtual:true});const x=await a.run();
  assert.equal(x.status,503);assert.equal(a.getCanceled(),false);
  assert.equal(a.getFlattenCount(),0);
});
test("Fuse only cancels an unfilled buy near the close, never issues a market sell",async()=>{
  const a=setup({parentPending:true}),x=await a.run();
  assert.equal(x.status,200,JSON.stringify(x.body));
  assert.equal(x.body.decisions[0].action,"entry-cancel-requested");
  assert.equal(a.getFlattenCount(),0);
});

test("Fuse halts the manager when a virtual position has no attributable active parent",async()=>{
  const a=setup({noEntry:true}),x=await a.run();
  assert.equal(x.status,503);
  assert.match(x.body.error,/virtual shares without an active attributable broker parent/i);
  assert.equal(a.getCanceled(),false);
  assert.equal(a.getFlattenCount(),0);
});
test("Fuse broker POST timeout uses one submission attempt then refuses any replay",async()=>{
  const a=setup({ambiguousPost:true});
  assert.equal((await a.run()).body.decisions[0].action,"oco-cancel-requested");
  const first=await a.run();
  assert.equal(first.status,503);
  assert.equal(first.body.decisions[0].action,"flatten-outcome-ambiguous-no-retry");
  assert.equal(a.getFlattenCount(),1);
  const second=await a.run();
  assert.equal(second.status,503);
  assert.equal(second.body.decisions[0].action,"flatten-unconfirmed-no-retry");
  assert.equal(a.getFlattenCount(),1);
});

test("Fuse refuses market flatten until all remaining shares are broker-sellable",async()=>{
  const a=setup({unavailable:true});
  assert.equal((await a.run()).body.decisions[0].action,"oco-cancel-requested");
  const outcome=await a.run();
  assert.equal(outcome.status,503);
  assert.equal(outcome.body.decisions[0].action,"manual-reconciliation");
  assert.equal(a.getFlattenCount(),0);
});

test("Fuse recognizes broker-generated PNY child stop orders as owned bracket protection",async()=>{
  const a=setup({pnyChildren:true});
  const first=await a.run();
  assert.equal(first.status,200,JSON.stringify(first.body));
  assert.equal(first.body.decisions[0].action,"oco-cancel-requested");
  assert.equal(a.getCanceled(),true);
  assert.equal(a.getFlattenCount(),0);
});
test("Fuse blocks all exit writes for a stray PNY-tagged broker order",async()=>{
  const a=setup({pnyChildren:true,pnyOrphan:true});
  const first=await a.run();
  assert.equal(first.status,503);
  assert.match(first.body.error,/unrecognized active Fuse-tagged/i);
  assert.equal(a.getCanceled(),false);
  assert.equal(a.getFlattenCount(),0);
});
