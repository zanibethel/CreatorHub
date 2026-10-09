import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import {z} from "zod";

const source=readFileSync(new URL("../src/app/api/paper-trading/bots/momentum-breakout-manage/route.ts",import.meta.url),"utf8");
const helperSource=readFileSync(new URL("../src/lib/paper-pulse-fractional.ts",import.meta.url),"utf8");
const compile=s=>ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const helper={};
vm.runInNewContext(compile(helperSource),{exports:helper,Math,Number,Date});
const entryId="chb-pls-v1-muztbl5e-7067a59cc7444711be620d3a";
const entry=()=>({
  client_order_id:entryId,broker_order_id:"PULSEBUY",symbol:"SOXS",side:"buy",
  status:"filled",requested_quantity:0.5,protective_stop:32.15,
  metadata:{executionMode:"paper-fractional-simple-v1"},
});
const reply=(data,status=200)=>data===null?new Response(null,{status}):Response.json(data,{status});
function fixture(){
  const state={
    now:"2026-10-09T15:00:00.000Z",orders:new Map(),rows:new Map(),posted:[],
    cancels:[], brokerQty:"0.5", available:"0.5",entry:entry(),
    rejectStop:false,timeoutStop:false,foreignOrder:false,
    partialEntry:false,parentCanceled:false,entryStatusOverride:null,
  };
  const getOrder=id=>{
    if(id===entryId)return {id:"PULSEBUY",client_order_id:entryId,symbol:"SOXS",side:"buy",type:"limit",
      status:state.entryStatusOverride??(state.partialEntry?(state.parentCanceled?"canceled":"partially_filled"):"filled"),
      qty:"0.5",filled_qty:state.partialEntry&&!state.parentCanceled?"0.25":"0.5"};
    return state.orders.get(id)??null;
  };
  class MockDate extends Date{
    constructor(...args){super(args.length?args[0]:Date.parse(state.now));}
    static now(){return Date.parse(state.now);}
  }
  const fakeFetch=async(url,options={})=>{
    const u=new URL(url);
    const method=options.method??"GET";
    if(u.hostname.endsWith("supabase.co")){
      if(u.pathname.endsWith("/paper_bot_positions"))return reply([]);
      if(!u.pathname.endsWith("/paper_bot_orders"))throw Error("Unexpected DB path: "+u.pathname);
      if(method==="GET"){
        if(u.searchParams.has("side"))return reply([state.entry]);
        const id=(u.searchParams.get("client_order_id")??"").replace(/^eq\./,"");
        return reply(state.rows.has(id)?[state.rows.get(id)]:[]);
      }
      const body=JSON.parse(options.body);
      if(method==="POST"){
        const row={...body,broker_order_id:null};
        if(!state.rows.has(row.client_order_id))state.rows.set(row.client_order_id,row);
        return reply(null,204);
      }
      if(method==="PATCH"){
        const id=(u.searchParams.get("client_order_id")??"").replace(/^eq\./,"");
        const row=state.rows.get(id);
        if(!row||u.searchParams.get("status")==="eq.prepared"&&row.status!=="prepared")
          return reply(options.headers?.Prefer==="return=representation"?[]:null,
            options.headers?.Prefer==="return=representation"?200:204);
        Object.assign(row,body);
        return options.headers?.Prefer==="return=representation"?reply([row]):reply(null,204);
      }
    }
    if(u.hostname!=="paper-api.alpaca.markets")throw Error("Unexpected network URL: "+url);
    if(u.pathname==="/v2/clock")return reply({is_open:true});
    if(u.pathname==="/v2/positions")return reply([{symbol:"SOXS",qty:state.brokerQty,qty_available:state.available}]);
    if(u.pathname==="/v2/orders"&&method==="GET"){
      const active=[...state.orders.values()].filter(o=>["new","accepted","held","partially_filled"].includes(o.status));
      if(state.partialEntry&&!state.parentCanceled)active.push(getOrder(entryId));
      if(state.foreignOrder)active.push({id:"OTHER-BOT-ORDER",client_order_id:"chb-hbr-v1-abc-12345678",
        symbol:"SOXS",side:"sell",status:"new"});
      return reply(active);
    }
    if(u.pathname==="/v2/orders:by_client_order_id"){
      const order=getOrder(u.searchParams.get("client_order_id"));
      return order?reply(order):reply({message:"not found"},404);
    }
    if(u.pathname==="/v2/orders"&&method==="POST"){
      const body=JSON.parse(options.body);
      state.posted.push(body);
      if(body.side!=="sell"||!["stop","market"].includes(body.type))throw Error("Unexpected order type");
      if(body.type==="stop"&&state.rejectStop)return reply({message:"stop unsupported"},422);
      if(body.type==="stop"&&state.timeoutStop)throw Error("PAPER venue timed out");
      const order={id:"BROKER-"+state.posted.length,client_order_id:body.client_order_id,
        symbol:body.symbol,side:body.side,type:body.type,stop_price:body.stop_price??null,
        status:"new",qty:body.qty,filled_qty:"0"};
      state.orders.set(body.client_order_id,order);
      if(body.type==="stop")state.available="0";
      return reply(order);
    }
    if(method==="DELETE"&&u.pathname.startsWith("/v2/orders/")){
      const id=u.pathname.split("/").pop();
      state.cancels.push(id);
      if(id==="PULSEBUY"&&state.partialEntry){
        state.parentCanceled=true;
        state.brokerQty="0.5";
        state.available="0.5";
        return reply(null,204);
      }
      const order=[...state.orders.values()].find(o=>o.id===id);
      if(!order)throw Error("Trying to cancel another bot's order");
      order.status="canceled";
      state.available="0.5";
      return reply(null,204);
    }
    throw Error("Unexpected broker path: "+method+" "+u.pathname);
  };
  const exports={};
  vm.runInNewContext(compile(source),{
    exports,fetch:fakeFetch,Date:MockDate,Intl,Number,Math,console,URL,encodeURIComponent,
    AbortSignal,Response,Uint8Array,Object,Set,
    process:{env:{CRON_SECRET:"test-cron-key",ALPACA_API_KEY_ID:"test-paper",ALPACA_API_SECRET_KEY:"fake",SUPABASE_SECRET_KEY:"test-service"}},
    require:module=>{
      if(module==="next/server")return {NextResponse:{json:(body,init={})=>Response.json(body,{status:init.status??200,headers:init.headers})}};
      if(module==="zod")return {z};
      if(module==="@/lib/paper-pulse-fractional")return helper;
      if(module==="@/lib/paper-momentum-breakout-strategy-config")
        return {MOMENTUM_BREAKOUT_STRATEGY_V1:{botProfileId:"momentum-breakout-100",id:"stock-momentum-breakout-v1",version:1}};
      if(module==="@/lib/paper-cron-health")return {withPaperCronHeartbeat:(_info,handler)=>handler};
      throw Error("Unexpected import "+module);
    },
  });
  const run=async()=>{
    const response=await exports.GET({headers:{get:name=>name==="authorization"?"Bearer test-cron-key":null}});
    return {status:response.status,body:await response.json()};
  };
  return {state,run};
}

test("Pulse PAPER manager places exactly one stop and checks broker-reported protection",async()=>{
  const {state,run}=fixture();
  const created=await run();
  assert.equal(created.status,200,JSON.stringify(created.body));
  assert.equal(created.body.outcome[0].action,"protective-stop-new");
  assert.equal(state.posted.length,1);
  assert.equal(state.posted[0].type,"stop");
  assert.equal(state.posted[0].qty,"0.5");
  assert.equal(state.posted[0].time_in_force,"day");
  const protectedRun=await run();
  assert.equal(protectedRun.body.outcome[0].action,"broker-stop-verified");
  assert.equal(state.posted.length,1,"never duplicate an accepted stop");
});

test("Pulse refuses a stop with an incorrect broker stop price and does not sell twice",async()=>{
  const {state,run}=fixture();
  await run();
  const id=helper.pulseCompanionClientOrderId(entryId,"stop");
  state.orders.get(id).stop_price="12.15";
  const result=await run();
  assert.equal(result.status,503);
  assert.equal(result.body.outcome[0].action,"manual-reconciliation");
  assert.equal(state.posted.length,1);
});

test("Pulse cancels its stop, refreshes sellable shares, then flattens at session end",async()=>{
  const {state,run}=fixture();
  await run();
  state.now="2026-10-09T19:45:00.000Z";
  const result=await run();
  assert.equal(result.status,200,JSON.stringify(result.body));
  assert.equal(result.body.flattenDue,true);
  assert.equal(state.cancels.length,1);
  assert.deepEqual(state.posted.map(o=>o.type),["stop","market"]);
  assert.equal(result.body.outcome[0].action,"session-flatten-new");
});

test("Pulse recovers a broker-rejected fractional stop by flattening without duplicate orders on retry",async()=>{
  const {state,run}=fixture();
  state.rejectStop=true;
  const initial=await run();
  assert.equal(initial.status,503);
  assert.deepEqual(state.posted.map(o=>o.type),["stop","market"]);
  assert.ok(initial.body.outcome.some(x=>x.action==="protective-stop-rejected"));
  assert.ok(initial.body.outcome.some(x=>x.action==="emergency-flatten-new"));
  const after=await run();
  assert.deepEqual(state.posted.map(o=>o.type),["stop","market"],
    "retry must reuse attributed emergency market exit");
  assert.ok(after.body.outcome.some(x=>x.action==="session-flatten-new"));
});

test("Pulse never resubmits a stop after broker network outcome becomes ambiguous",async()=>{
  const {state,run}=fixture();
  state.timeoutStop=true;
  const first=await run();
  assert.equal(first.status,503);
  assert.deepEqual(state.posted.map(o=>o.type),["stop"]);
  assert.ok(first.body.outcome.some(x=>x.action==="protective-stop-unconfirmed"));
  const second=await run();
  assert.equal(second.status,503);
  assert.deepEqual(state.posted.map(o=>o.type),["stop"]);
  assert.ok(second.body.outcome.some(x=>x.action==="stop-outcome-unconfirmed"));
});

test("Pulse refreshes final fill and shares after partial buy cancellation before stop sizing",async()=>{
  const {state,run}=fixture();
  state.partialEntry=true;
  state.brokerQty="0.25";
  state.available="0.25";
  const first=await run();
  assert.equal(first.status,200,JSON.stringify(first.body));
  assert.equal(state.parentCanceled,true);
  assert.deepEqual(state.posted.map(x=>x.type),["stop"]);
  assert.equal(state.posted[0].qty,"0.5",
    "must cover the additional 0.25 shares filled during parent cancellation");
  assert.ok(first.body.outcome.some(x=>x.action==="protective-stop-new"));
});

test("Pulse refuses to submit protection when another bot has an open order for the same physical stock",async()=>{
  const {state,run}=fixture();
  state.foreignOrder=true;
  const result=await run();
  assert.equal(result.status,503);
  assert.ok(result.body.outcome.some(x=>x.action==="manual-reconciliation"));
  assert.equal(state.posted.length,0);
  assert.equal(state.cancels.length,0);
});

test("Pulse refuses an undercovered partial-sellable position instead of claiming a partial stop is complete",async()=>{
  const {state,run}=fixture();
  state.available="0.25";
  const result=await run();
  assert.equal(result.status,503);
  assert.ok(result.body.outcome.some(x=>x.action==="manual-reconciliation"));
  assert.equal(state.posted.length,0);
});

test("Pulse waits on broker pending_cancel and pending_replace without submitting stops or duplicate cancels",async()=>{
  for(const status of ["pending_cancel","pending_replace"]){
    const {state,run}=fixture();
    state.entryStatusOverride=status;
    const result=await run();
    assert.equal(result.status,503,JSON.stringify(result.body));
    assert.equal(state.posted.length,0);
    assert.equal(state.cancels.length,0);
    assert.ok(result.body.outcome.some(x=>x.action===
      (status==="pending_cancel"?"awaiting-partial-entry-cancel":"manual-reconciliation")));
  }
});

test("Pulse never reports a stop pending broker cancellation/replacement as protected",async()=>{
  for(const status of ["pending_cancel","pending_replace"]){
    const {state,run}=fixture();
    await run(); // first authenticated invocation creates one valid PAPER stop
    const id=helper.pulseCompanionClientOrderId(entryId,"stop");
    state.orders.get(id).status=status;
    const result=await run();
    assert.equal(result.status,503,JSON.stringify(result.body));
    assert.ok(result.body.outcome.some(x=>x.action==="stop-outcome-unconfirmed"));
    assert.equal(state.posted.length,1);
    assert.equal(state.cancels.length,0);
  }
});
test("Pulse awaits unfilled pending cancellation without a duplicate broker DELETE",async()=>{
  const {state,run}=fixture();
  state.entryStatusOverride="pending_cancel";
  state.partialEntry=true;state.brokerQty="0";state.available="0";
  const result=await run();
  assert.equal(result.status,503,JSON.stringify(result.body));
  assert.ok(result.body.outcome.some(x=>x.action==="awaiting-partial-entry-cancel"));
  assert.equal(state.posted.length,0);
  assert.equal(state.cancels.length,0);
});


test("Pulse must subtract an already-filled stop before claiming full protective coverage",async()=>{
  const {state,run}=fixture();
  await run();
  const id=helper.pulseCompanionClientOrderId(entryId,"stop");
  const stop=state.orders.get(id);
  stop.status="partially_filled";
  stop.filled_qty="0.2";
  // Broker still holds more shares than the stop's remaining 0.3.
  state.brokerQty="0.5";state.available="0";
  const check=await run();
  assert.equal(check.status,503,JSON.stringify(check.body));
  assert.ok(check.body.outcome.some(x=>x.action==="manual-reconciliation"));
  assert.equal(state.posted.length,1,"Never silently place a second overlapping sell");
});

test("Pulse can verify a partially executed stop when its remaining sell quantity covers the actual shares",async()=>{
  const {state,run}=fixture();
  await run();
  const id=helper.pulseCompanionClientOrderId(entryId,"stop");
  const stop=state.orders.get(id);
  stop.status="partially_filled";
  stop.filled_qty="0.2";
  state.brokerQty="0.3";state.available="0";
  const check=await run();
  assert.equal(check.status,200,JSON.stringify(check.body));
  assert.ok(check.body.outcome.some(x=>x.action==="broker-stop-verified"));
  assert.equal(state.posted.length,1);
});

test("Pulse never infers zero filled stop shares from missing or malformed broker fill quantity",async()=>{
  for(const invalid of [undefined,"unknown","0.6"]){
    const {state,run}=fixture();
    await run();
    const id=helper.pulseCompanionClientOrderId(entryId,"stop");
    const stop=state.orders.get(id);
    stop.status="partially_filled";
    stop.filled_qty=invalid;
    const check=await run();
    assert.equal(check.status,503,JSON.stringify(check.body));
    assert.ok(check.body.outcome.some(x=>x.action==="manual-reconciliation"));
    assert.equal(state.posted.length,1);
  }
});
