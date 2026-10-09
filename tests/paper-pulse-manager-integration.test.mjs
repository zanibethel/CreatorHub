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
  };
  const getOrder=id=>{
    if(id===entryId)return {id:"PULSEBUY",client_order_id:entryId,symbol:"SOXS",side:"buy",type:"limit",status:"filled",qty:"0.5",filled_qty:"0.5"};
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
    if(u.pathname==="/v2/orders:by_client_order_id"){
      const order=getOrder(u.searchParams.get("client_order_id"));
      return order?reply(order):reply({message:"not found"},404);
    }
    if(u.pathname==="/v2/orders"&&method==="POST"){
      const body=JSON.parse(options.body);
      state.posted.push(body);
      if(body.side!=="sell"||!["stop","market"].includes(body.type))throw Error("Unexpected order type");
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
