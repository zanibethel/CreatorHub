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

test("cron heartbeat uses the configured project Supabase fallback if public URL env is absent",async()=>{
  const h=harness({db:""});
  const wrapped=h.wrap(INFO,async()=>Response.json({ok:true,action:"none"},{status:200}));
  assert.equal((await wrapped(request())).status,200);
  assert.equal(h.calls.length,1);
  assert.ok(h.calls[0].url.startsWith("https://yufptpfiwdbzzrvhkvux.supabase.co/rest/v1/rpc/"),
    "must write operational heartbeat to the same configured database as the trading routes");
});


test("Flash and Spark cron health uses one authenticated wrapper each and 24/7 five-minute schedules",()=>{
  const cases=[
    ["weekend-crypto-run","flash-run","weekend-crypto-day-100"],
    ["crypto-ignition-run","spark-run","crypto-ignition-100"],
  ];
  const vercel=JSON.parse(readFileSync(new URL("../vercel.json",import.meta.url),"utf8"));
  const shared=readFileSync(new URL("../src/lib/paper-cron-health.ts",import.meta.url),"utf8");
  const migration=readFileSync(new URL("../supabase/migrations/20261009151100_paper_crypto_cron_health.sql",import.meta.url),"utf8");
  for(const [route,job,bot] of cases){
    const code=readFileSync(new URL("../src/app/api/paper-trading/bots/"+route+"/route.ts",import.meta.url),"utf8");
    assert.match(code,new RegExp('export const GET=withPaperCronHeartbeat\\(\\{job:"'+job+'",botId:"'+bot+'",expectedMinutes:5\\},runPaperCron\\)'));
    assert.match(code,/async function runPaperCron/);
    assert.match(code,/request\.headers\.get\("authorization"\)/);
    assert.equal(vercel.crons.find(x=>x.path==="/api/paper-trading/bots/"+route)?.schedule,"*/5 * * * *");
    assert.ok(shared.includes('"'+job+'"'));
    assert.ok(migration.includes("'"+job+"'"));
    assert.ok(migration.includes("('"+job+"','"+bot+"',5)"));
  }
  assert.match(migration,/drop constraint paper_bot_cron_health_job_key_check/);
  assert.match(migration,/add constraint paper_bot_cron_health_job_key_check/);
  assert.match(migration,/revoke all on function public\.paper_bot_record_cron_health/);
  assert.match(migration,/grant execute on function public\.paper_bot_record_cron_health.+ to service_role/);
  assert.doesNotMatch(migration,/update public\.paper_bot_orders|update public\.paper_bot_positions|insert into public\.paper_bot_orders/i);
});
test("crypto cron wrapper keeps actions, errors and no-duplicate failure semantics",async()=>{
  for(const [job,bot] of [["flash-run","weekend-crypto-day-100"],["spark-run","crypto-ignition-100"]]){
    const h=harness();let invoked=0;
    const info={job,botId:bot,expectedMinutes:5};
    const wrapped=h.wrap(info,async()=>{invoked++;return Response.json({
      ok:false,action:"manager-error",result:{credential:"sensitive"},
    },{status:502});});
    const result=await wrapped(request());
    assert.equal(result.status,502);
    assert.equal(invoked,1);
    assert.equal(h.calls.length,1);
    assert.equal(h.calls[0].body.p_job_key,job);
    assert.equal(h.calls[0].body.p_bot_id,bot);
    assert.equal(h.calls[0].body.p_source,"vercel-cron-agent");
    assert.equal(h.calls[0].body.p_action,"manager-error");
    assert.equal(h.calls[0].body.p_error,"runner-http-502");
    assert.ok(!JSON.stringify(h.calls[0]).includes("sensitive"));
  }
});
