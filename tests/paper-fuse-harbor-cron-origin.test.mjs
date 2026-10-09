import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import {z} from "zod";

function mount(name,fetch){
  const path="../src/app/api/paper-trading/bots/"+name+"/route.ts";
  const code=readFileSync(new URL(path,import.meta.url),"utf8");
  const compiled=ts.transpileModule(code,{compilerOptions:{
    module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,
  }}).outputText;
  const exports={};
  vm.runInNewContext(compiled,{
    exports,fetch,Request,Response,URL,Date,Math,Number,JSON,Error,
    AbortSignal,encodeURIComponent,
    process:{env:{
      CRON_SECRET:"cron-readonly-test",
      PAPER_SWING_EXECUTION_TOKEN:"h".repeat(40),
      SUPABASE_SECRET_KEY:"service-key",
    }},
    require:name=>{
      if(name==="next/server")return {NextResponse:{json:(b,opts={})=>
        Response.json(b,{status:opts.status??200})}};
      if(name==="zod")return {z};
      if(name==="@/lib/paper-cron-health")
        return {withPaperCronHeartbeat:(_info,handler)=>handler};
      if(name==="@/lib/paper-fuse-strategy-config")
        return {FUSE_PENNY_STRATEGY_V1:{botProfileId:"penny-volatility-day-100",
          scoring:{readyScore:80}}};
      throw Error("Unexpected import "+name);
    }
  });
  return exports;
}
test("Fuse runner resolves self-calls to stable public alias not protected cron deployment host",async()=>{
  const calls=[];
  const fetch=async(raw,options={})=>{
    const url=new URL(raw);calls.push(url.href);
    if(url.hostname==="yufptpfiwdbzzrvhkvux.supabase.co")
      return Response.json([{status:"active",metadata:{executionEnabled:true,fusePilotEnabled:true}}]);
    assert.equal(url.hostname,"creatorhub-gray.vercel.app");
    if(url.pathname.endsWith("/fuse-execution-preview"))
      return Response.json({paperOnly:true,researchOnly:true,plans:[]});
    throw Error("Unexpected broker or order request "+url.href);
  };
  const runner=mount("fuse-run",fetch);
  const r=await runner.GET(new Request(
    "https://creatorhub-deployment-protected.vercel.app/api/paper-trading/bots/fuse-run",{
      headers:{authorization:"Bearer cron-readonly-test"},
    }));
  assert.equal(r.status,200,await r.text());
  assert.equal(calls.filter(x=>x.includes("fuse-execute")).length,0);
  assert.equal(calls.filter(x=>x.includes("fuse-execution-preview")).length,1);
});
test("Harbor runner returns safe dependency stage on intake failure, sends no buy",async()=>{
  let intake=0,execute=0;
  const fetch=async(raw)=>{
    const url=new URL(raw);
    if(url.pathname.endsWith("/swing-prospect-intake")){
      intake++;
      return Response.json({error:"private external provider error",
        failedStage:"daily-bars"},{status:503});
    }
    if(url.pathname.endsWith("/swing-execute"))execute++;
    throw Error("Unexpected Harbor URL "+url.href);
  };
  const runner=mount("swing-run",fetch);
  const r=await runner.GET(new Request(
    "https://creatorhub-gray.vercel.app/api/paper-trading/bots/swing-run",{
      headers:{authorization:"Bearer cron-readonly-test"},
    }));
  assert.equal(r.status,502);
  const body=await r.json();
  assert.equal(body.action,"intake-daily-bars-error");
  assert.equal(body.intakeStatus,503);
  assert.equal(intake,1);
  assert.equal(execute,0);
});
test("Harbor route only returns stage codes from explicit allowlist",()=>{
  const runner=readFileSync(new URL("../src/app/api/paper-trading/bots/swing-run/route.ts",import.meta.url),"utf8");
  const intake=readFileSync(new URL("../src/app/api/paper-trading/bots/swing-prospect-intake/route.ts",import.meta.url),"utf8");
  assert.match(runner,/failedStage:z\.enum/);
  assert.match(intake,/failedStage="daily-bars"/);
  assert.match(intake,/failedStage="quotes"/);
  assert.match(intake,/failedStage="journaling"/);
  assert.doesNotMatch(runner,/console\.log\(intakeResult/);
});
