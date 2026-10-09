import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const path=new URL("../src/lib/paper-cron-health.ts",import.meta.url);
const src=readFileSync(path,"utf8");
const compiled=ts.transpileModule(src,{compilerOptions:{
  module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,
}}).outputText;
function harness({token="secret",service="key",db="https://db.example.com"}={}){
  const calls=[];
  const fetch=async(url,opts)=>{
    calls.push({url:String(url),body:JSON.parse(opts.body),headers:opts.headers});
    return Response.json(true,{status:200});
  };
  const exports={};
  vm.runInNewContext(compiled,{exports,fetch,Request,Response,AbortSignal,
    URL,Date,Math,Number,Object,Array,RegExp,JSON,Error,String,
    console:{error:()=>{}},process:{env:{CRON_SECRET:token,
      SUPABASE_SECRET_KEY:service,NEXT_PUBLIC_SUPABASE_URL:db}}});
  return {wrap:exports.withPaperCronHeartbeat,calls};
}
const INFO={job:"fuse-run",botId:"penny-volatility-day-100",expectedMinutes:5};
const request=(auth="Bearer secret",ua="vercel-cron/1.0")=>
  new Request("https://creatorhub-gray.vercel.app/api/paper-trading/bots/fuse-run",{
    headers:{authorization:auth,"user-agent":ua},
  });
test("cron wrapper preserves original response and records valid auth once",async()=>{
  const h=harness();let runs=0;
  const wrapped=h.wrap(INFO,async()=>{runs++;return Response.json({ok:true,action:"none",reason:"not-ready"},{status:200});});
  const r=await wrapped(request());
  assert.equal(r.status,200);
  assert.deepEqual(await r.json(),{ok:true,action:"none",reason:"not-ready"});
  assert.equal(runs,1);assert.equal(h.calls.length,1);
  const b=h.calls[0].body;
  assert.equal(b.p_job_key,"fuse-run");
  assert.equal(b.p_source,"vercel-cron-agent");
  assert.equal(b.p_http_status,200);
  assert.equal(b.p_action,"none");
});
test("unauthorized calls do not write telemetry or invoke a second handler",async()=>{
  const h=harness();let runs=0;
  const wrapped=h.wrap(INFO,async()=>{runs++;return Response.json({error:"Unauthorized."},{status:401});});
  assert.equal((await wrapped(request("wrong"))).status,401);
  assert.equal(runs,1);assert.equal(h.calls.length,0);
});
test("failure response is preserved and error body is never persisted",async()=>{
  const h=harness();
  const wrapped=h.wrap(INFO,async()=>Response.json({error:"SECRET=sensitive123"},{status:503}));
  const r=await wrapped(request("Bearer secret","health-check-manual"));
  assert.equal(r.status,503);
  assert.equal(h.calls.length,1);
  const b=h.calls[0].body;
  assert.equal(b.p_source,"authenticated-other");
  assert.equal(b.p_http_status,503);
  assert.equal(b.p_error,"runner-http-503");
  assert.ok(!JSON.stringify(b).includes("sensitive123"));
});
test("auth runner never repeats broker operation if monitoring cannot write",async()=>{
  const h=harness({service:"",db:""});let runs=0;
  const wrapped=h.wrap(INFO,async()=>{runs++;return Response.json({action:"entry-requested"},{status:202});});
  const r=await wrapped(request());
  assert.equal(r.status,202);assert.equal(runs,1);
  assert.equal(h.calls.length,0);
});
test("runner throws before creating reply: one failure heartbeat, fail-closed 503",async()=>{
  const h=harness();let runs=0;
  const wrapped=h.wrap(INFO,async()=>{runs++;throw Error("internal secret");});
  const r=await wrapped(request());
  assert.equal(r.status,503);assert.equal(runs,1);
  assert.equal(h.calls.length,1);
  assert.equal(h.calls[0].body.p_action,"runner-exception");
  assert.ok(!JSON.stringify(h.calls[0].body).includes("internal secret"));
});
test("all six PAPER stock bot cron handlers are instrumented with exact expected cadence",()=>{
  const cases=[
    ["momentum-breakout-run","pulse-run",5],
    ["momentum-breakout-manage","pulse-manage",1],
    ["fuse-run","fuse-run",5],
    ["fuse-manage","fuse-manage",1],
    ["atlas-run","atlas-run",1],
    ["swing-run","harbor-run",5],
  ];
  const vercel=JSON.parse(readFileSync(new URL("../vercel.json",import.meta.url),"utf8"));
  for(const [route,job,minutes] of cases){
    const code=readFileSync(new URL("../src/app/api/paper-trading/bots/"+route+"/route.ts",import.meta.url),"utf8");
    assert.match(code,/withPaperCronHeartbeat/);
    assert.match(code,new RegExp('job:"'+job+'"'));
    assert.match(code,new RegExp('expectedMinutes:'+minutes));
    const scheduled=vercel.crons.find(x=>x.path==="/api/paper-trading/bots/"+route);
    assert.ok(scheduled,route+" is not scheduled");
  }
});
test("heartbeat RPC is service-role only; does not touch order or position tables",()=>{
  const s=readFileSync(new URL("../supabase/migrations/20261009134000_paper_stock_cron_health.sql",import.meta.url),"utf8");
  assert.match(s,/create table if not exists public.paper_bot_cron_health/);
  assert.match(s,/revoke all on public.paper_bot_cron_health from public,anon,authenticated/);
  assert.match(s,/grant execute on function public.paper_bot_record_cron_health.+ to service_role/);
  assert.doesNotMatch(s,/update public.paper_bot_orders|update public.paper_bot_positions|insert into public.paper_bot_orders/i);
});
