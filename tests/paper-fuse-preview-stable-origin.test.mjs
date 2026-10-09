import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import {z} from "zod";

const source=readFileSync(new URL("../src/app/api/paper-trading/bots/fuse-execution-preview/route.ts",import.meta.url),"utf8");
const js=ts.transpileModule(source,{compilerOptions:{
  module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,
}}).outputText;

test("Fuse public read-only execution preview never recurses through protected deployment host",async()=>{
  const urls=[];
  const fetch=async raw=>{
    const url=new URL(raw);urls.push(url.href);
    if(url.hostname==="creatorhub-gray.vercel.app"&&url.pathname.endsWith("/fuse-readiness"))
      return Response.json({paperOnly:true,researchOnly:true,submissionReady:false,plans:[]});
    if(url.hostname==="yufptpfiwdbzzrvhkvux.supabase.co"&&url.pathname.endsWith("/paper_bot_ledgers"))
      return Response.json([{status:"active",equity:100,buying_power:100,
        metadata:{executionEnabled:true,fusePilotEnabled:true}}]);
    throw Error("Forbidden Fuse internal or brokerage network request "+url.href);
  };
  const exports={};
  vm.runInNewContext(js,{exports,fetch,URL,Response,AbortSignal,Date,Number,Math,Error,
    process:{env:{SUPABASE_SECRET_KEY:"service"}},
    require:name=>{
      if(name==="next/server")return {NextResponse:{json:(body,init={})=>
        Response.json(body,{status:init.status??200})}};
      if(name==="zod")return {z};
      if(name==="@/lib/paper-fuse-bracket")return {fuseBracketPreview:()=>{throw Error("no plans in this fixture")}};
      if(name==="@/lib/paper-fuse-strategy-config")
        return {FUSE_PENNY_STRATEGY_V1:{botProfileId:"penny-volatility-day-100"}};
      throw Error("Unexpected import "+name);
    }});
  const result=await exports.GET(new Request(
    "https://creatorhub-protected-deployment.vercel.app/api/paper-trading/bots/fuse-execution-preview"));
  assert.equal(result.status,200);
  const body=await result.json();
  assert.equal(body.paperOnly,true);
  assert.equal(body.brokerOrdersSubmitted,false);
  assert.equal(body.submissionReady,false);
  assert.equal(body.pilotArmed,true);
  assert.equal(urls.length,2);
  assert.ok(urls.some(url=>url.startsWith("https://creatorhub-gray.vercel.app/api/paper-trading/bots/fuse-readiness")));
  assert.ok(urls.every(url=>!url.includes("protected-deployment")));
});
