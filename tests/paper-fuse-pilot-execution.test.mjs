import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import {z} from "zod";

const bot="penny-volatility-day-100";
const orderId="chb-pny-v1-pilot12-abcdef123456";
const cfg={FUSE_PENNY_STRATEGY_V1:{botProfileId:bot,id:"penny-volatility-day-v1",
  version:1,scoring:{readyScore:80},risk:{riskPerTradePct:0.5,maximumAllocationPct:20}}};
function mount(path,fetch){
  const source=readFileSync(new URL(path,import.meta.url),"utf8");
  const js=ts.transpileModule(source,{compilerOptions:{
    module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,
  }}).outputText;
  const exports={};
  vm.runInNewContext(js,{exports,fetch,URL,Response,AbortSignal,encodeURIComponent,
    process:{env:{CRON_SECRET:"test-cron",SUPABASE_SECRET_KEY:"service",
      ALPACA_API_KEY_ID:"test-paper-key",ALPACA_API_SECRET_KEY:"test-paper-secret"}},
    Date,Intl,Math,Number,Object,Array,Set,RegExp,Error,JSON,
    require:name=>{
      if(name==="next/server")return {NextResponse:{json:(b,init={})=>
        Response.json(b,{status:init.status??200})}};
      if(name==="zod")return {z};
      if(name==="@/lib/paper-fuse-strategy-config")return cfg;
      if(name==="@/lib/paper-order-attribution")
        return {createPaperClientOrderId:(id,v)=>{assert.equal(id,bot);assert.equal(v,1);return orderId;}};
      throw Error("Unexpected import "+name);
    }});
  return exports;
}
function scenario({enabled=true,pilot=true,eligible=true,manager=true,collision=false,
  reserve=true,brokerReject=false,brokerTimeout=false,wrongBroker=false,
  previewArmed=true}={}){
  const counts={entryPosts:0,reservations:0,patches:0,preview:0,manager:0};
  const positions=collision?[{symbol:"NVD",qty:"4"}]:[];
  const reply=(x,status=200)=>Response.json(x,{status});
  const fetch=async(address,options={})=>{
    const u=new URL(address),method=options.method??"GET";
    if(u.pathname.endsWith("/paper_bot_ledgers"))return reply([{
      bot_id:bot,status:"active",equity:100,buying_power:100,
      metadata:{executionEnabled:enabled,fusePilotEnabled:pilot},
    }]);
    if(u.pathname.endsWith("/paper_bot_positions"))return reply([]);
    if(u.pathname.endsWith("/fuse-execution-preview")){
      counts.preview++;
      return reply({paperOnly:true,researchOnly:true,
        brokerOrdersSubmitted:false,executionEnabled:previewArmed,pilotEnabled:previewArmed,
        pilotClaimed:false,pilotArmed:previewArmed,submissionReady:false,
        plans:[{symbol:"NVD",fuseScore:84,readiness:eligible?"research-ready":"waiting",
          eligible,order:eligible?{symbol:"NVD",qty:5,limitPrice:3.50,
            stopPrice:3.43,takeProfitPrice:3.54,plannedNotional:17.5,plannedLoss:0.35}:null}]});
    }
    if(u.pathname.endsWith("/fuse-manage")){
      counts.manager++;
      return reply({ok:manager,paperOnly:true,marketOpen:true,flattenDue:false,managedEntries:0},
        manager?200:503);
    }
    if(u.pathname.endsWith("/rpc/paper_fuse_claim_pilot_entry")){
      counts.reservations++;
      const v=JSON.parse(options.body);
      assert.equal(v.p_client_order_id,orderId);
      assert.equal(v.p_qty,5);assert.equal(v.p_stop_price,3.43);
      assert.equal(v.p_target_price,3.54);
      return reply(reserve);
    }
    if(u.pathname.endsWith("/paper_bot_orders")&&method==="PATCH"){
      counts.patches++;
      return new Response(null,{status:204});
    }
    if(u.hostname==="paper-api.alpaca.markets"){
      if(u.pathname==="/v2/clock")return reply({is_open:true});
      if(u.pathname==="/v2/assets/NVD")return reply({status:"active",tradable:true});
      if(u.pathname==="/v2/positions")return reply(positions);
      if(u.pathname==="/v2/orders"&&method==="GET")return reply([]);
      if(u.pathname==="/v2/orders"&&method==="POST"){
        counts.entryPosts++;
        const v=JSON.parse(options.body);
        assert.equal(v.order_class,"bracket");assert.equal(v.side,"buy");
        assert.equal(v.type,"limit");assert.equal(v.qty,"5");
        assert.equal(v.limit_price,"3.5");assert.equal(v.stop_loss.stop_price,"3.43");
        assert.equal(v.take_profit.limit_price,"3.54");
        assert.equal(v.client_order_id,orderId);
        if(brokerTimeout)throw Error("Simulated Alpaca network timeout");
        if(brokerReject)return reply({message:"paper order rejected"},422);
        return reply({id:"ORDER1",client_order_id:wrongBroker?"foreign":orderId,
          symbol:"NVD",side:"buy",type:"limit",order_class:"bracket",status:"new",qty:"5"});
      }
      if(u.pathname==="/v2/orders:by_client_order_id")return reply({message:"not found"},404);
      if(u.pathname==="/v2/orders/ORDER1")return reply({
        id:"ORDER1",client_order_id:orderId,symbol:"NVD",
        side:"buy",type:"limit",order_class:"bracket",status:"new",qty:"5",
        legs:[{id:"S1",side:"sell",type:"stop"},{id:"T1",side:"sell",type:"limit"}],
      });
    }
    throw Error("Unexpected URL "+method+" "+u);
  };
  const exe=mount("../src/app/api/paper-trading/bots/fuse-execute/route.ts",fetch);
  const run=async(authorization="Bearer test-cron")=>{
    const response=await exe.POST({url:"https://creatorhub-gray.vercel.app/api/paper-trading/bots/fuse-execute",
      headers:{get:k=>k==="authorization"?authorization:null},json:async()=>({symbol:"NVD"})});
    return {status:response.status,body:await response.json()};
  };
  return {run,counts,fetch};
}
test("Fuse execution requires cron authentication before any broker reads",async()=>{
  const x=scenario(),r=await x.run("invalid");
  assert.equal(r.status,401);assert.equal(x.counts.entryPosts,0);
  assert.equal(x.counts.preview,0);
});
test("Fuse two inactive ledger switches prevent all entry side effects",async()=>{
  for(const flags of [{enabled:false,pilot:false},{enabled:true,pilot:false},{enabled:false,pilot:true}]){
    const x=scenario(flags),r=await x.run();
    assert.equal(r.status,423);assert.equal(x.counts.preview,0);
    assert.equal(x.counts.reservations,0);assert.equal(x.counts.entryPosts,0);
  }
});
test("Fuse rejects unqualified signal, shared symbol and unhealthy manager",async()=>{
  for(const flags of [{eligible:false},{collision:true},{manager:false}]){
    const x=scenario(flags),r=await x.run();
    assert.ok(r.status>=400);
    assert.equal(x.counts.reservations,0);
    assert.equal(x.counts.entryPosts,0);
  }
});
test("Fuse one-shot SQL refusal blocks broker entry",async()=>{
  const x=scenario({reserve:false}),r=await x.run();
  assert.equal(r.status,423);assert.equal(x.counts.reservations,1);
  assert.equal(x.counts.entryPosts,0);
});
test("Fuse broker accepted bracket is attributed but never called filled/protected",async()=>{
  const x=scenario(),r=await x.run();
  assert.equal(r.status,202,JSON.stringify(r.body));
  assert.equal(r.body.brokerOrderId,"ORDER1");
  assert.equal(r.body.status,"submitted");
  assert.equal(r.body.protectionPending,true);
  assert.equal(x.counts.reservations,1);
  assert.equal(x.counts.entryPosts,1);
  assert.equal(x.counts.patches,1);
});
test("Fuse broker timeout or reject is not retried; pilot claim consumed",async()=>{
  for(const flags of [{brokerReject:true},{brokerTimeout:true},{wrongBroker:true}]){
    const x=scenario(flags),r=await x.run();
    assert.equal(r.status,503,JSON.stringify(r.body));
    assert.equal(r.body.action,"broker-outcome-ambiguous");
    assert.equal(x.counts.entryPosts,1);
    assert.equal(x.counts.reservations,1);
  }
});
test("Fuse pilot SQL enforces one-shot, risk ceiling, role restriction and attribution",()=>{
  const sql=readFileSync(new URL("../supabase/migrations/20261009013200_fuse_atomic_paper_pilot.sql",import.meta.url),"utf8");
  assert.match(sql,/for update;/);
  assert.match(sql,/metadata->>'fusePilotEnabled' <> 'true'/);
  assert.match(sql,/metadata->>'executionEnabled' <> 'true'/);
  assert.match(sql,/metadata \? 'fusePilotClientOrderId'/);
  assert.match(sql,/v_loss > v_ledger.equity\*0\.005/);
  assert.match(sql,/v_notional > least\(v_ledger.equity\*0\.20/);
  assert.match(sql,/insert into public.paper_bot_orders/);
  assert.match(sql,/grant execute on function public.paper_fuse_claim_pilot_entry.+to service_role;/);
  assert.match(sql,/revoke all.+from authenticated;/);
});
test("Fuse auto-run is dormant until both switches and never submits direct Alpaca orders",()=>{
  const runner=readFileSync(new URL("../src/app/api/paper-trading/bots/fuse-run/route.ts",import.meta.url),"utf8");
  assert.match(runner,/metadata\.executionEnabled!==true/);
  assert.match(runner,/metadata\.fusePilotEnabled!==true/);
  assert.match(runner,/no-broker-eligible-setup/);
  assert.doesNotMatch(runner,/paper-api\.alpaca\.markets|method:"DELETE"/);
  const cfg=JSON.parse(readFileSync(new URL("../vercel.json",import.meta.url),"utf8"));
  assert.ok(cfg.crons.some(x=>x.path==="/api/paper-trading/bots/fuse-run"&&x.schedule==="*/5 * * * 1-5"));
});

test("Fuse executor refuses when ledger pilot becomes disarmed between first and second reads",async()=>{
  const x=scenario({previewArmed:false});
  const r=await x.run();
  assert.equal(r.status,423);
  assert.equal(r.body.action,"pilot-no-longer-armed");
  assert.equal(x.counts.reservations,0);
  assert.equal(x.counts.entryPosts,0);
});
