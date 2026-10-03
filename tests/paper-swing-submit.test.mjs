import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";

function load(path, imports = {}, globals = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, {
    exports, Request, Response, URL, AbortSignal, TextEncoder, crypto:webcrypto, ...globals,
    require:name => {
      if (name in imports) return imports[name];
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  return exports;
}

const config=load("../src/lib/paper-swing-strategy-config.ts");
const execution=load("../src/lib/paper-swing-execution.ts",{"./paper-swing-strategy-config":config});
const token="x".repeat(64);

function route(fetcher, extraEnv={}) {
  return load("../src/app/api/paper-trading/bots/swing-execute/route.ts",{
    "next/server":{NextResponse:Response},
    "zod":{z},
    "@/lib/paper-swing-execution":execution,
  },{
    fetch:fetcher,
    process:{env:{
      NEXT_PUBLIC_SUPABASE_URL:"https://database.test",
      SUPABASE_SECRET_KEY:"db-secret",
      ALPACA_API_KEY_ID:"paper-key",
      ALPACA_API_SECRET_KEY:"paper-secret",
      PAPER_SWING_EXECUTION_TOKEN:token,
      ...extraEnv,
    }},
  });
}

const request=(body={symbol:"QQQ"},supplied=token)=>new Request("https://app.test/api/paper-trading/bots/swing-execute",{
  method:"POST",
  headers:{"content-type":"application/json","x-paper-swing-execution-token":supplied},
  body:JSON.stringify(body),
});

const preview={
  symbol:"QQQ",quantity:0.03,estimatedNotional:22.65,entryReference:755,
  stopLoss:727,takeProfit:811,plannedRiskDollars:0.84,plannedRiskPct:0.84,
  allocationPct:22.65,orderClass:"bracket",orderType:"market",timeInForce:"day",paperOnly:true,
};

const readiness=enabled=>({
  collectedAt:"2026-10-05T13:40:00Z",paperOnly:true,executionEnabled:enabled,
  submissionReady:enabled,marketClockAvailable:true,
  plans:[{symbol:"QQQ",state:"ready",selectedForSubmission:true,quoteAgeSeconds:2,executionPreview:preview}],
});

const prepared={
  client_order_id:"chb-sw3-v1-abc123-fixture09",bot_id:"three-trade-weekly-swing-100",
  strategy_id:"three-trade-weekly-swing-v1",strategy_version:1,symbol:"QQQ",
  asset_class:"etf",side:"buy",status:"prepared",broker_order_id:null,metadata:{requiresRevalidation:true},
};

test("unauthorized swing execution does not touch storage or broker", async()=>{
  let calls=0;
  const api=route(()=>{calls++;throw new Error("must not fetch");});
  const response=await api.POST(request({symbol:"QQQ"},"bad"));
  assert.equal(response.status,401);
  assert.equal(calls,0);
});

test("disabled execution kill switch blocks before order claim", async()=>{
  const calls=[];
  const api=route((url,options)=>{
    calls.push({url:String(url),method:options?.method??"GET"});
    if(String(url).includes("/swing-readiness")) return Response.json(readiness(false));
    throw new Error("kill switch must block all privileged calls");
  });
  const response=await api.POST(request());
  assert.equal(response.status,423);
  assert.equal(calls.length,1);
});

test("successful request claims once and submits a PAPER bracket", async()=>{
  const calls=[];
  const api=route((url,options={})=>{
    const target=String(url); const method=options.method??"GET";
    calls.push({target,method,body:options.body ? JSON.parse(options.body) : null});
    if(target.includes("/swing-readiness")) return Response.json(readiness(true));
    if(target.includes("database.test/rest/v1/paper_bot_orders") && method==="GET") return Response.json([prepared]);
    if(target.includes("database.test/rest/v1/paper_bot_orders") && method==="PATCH" && target.includes("status=eq.prepared")) {
      return Response.json([{...prepared,status:"submitted",requested_quantity:0.03}]);
    }
    if(target==="https://paper-api.alpaca.markets/v2/orders" && method==="POST") {
      const body=JSON.parse(options.body);
      assert.equal(body.order_class,"bracket");
      assert.equal(body.side,"buy");
      assert.equal(body.symbol,"QQQ");
      assert.equal(body.take_profit.limit_price,"811");
      assert.equal(body.stop_loss.stop_price,"727");
      return Response.json({id:"private-parent",client_order_id:prepared.client_order_id,status:"accepted",order_class:"bracket",symbol:"QQQ",side:"buy",type:"market"});
    }
    if(target.includes("/v2/orders/private-parent?nested=true")) {
      return Response.json({
        id:"private-parent",client_order_id:prepared.client_order_id,status:"accepted",order_class:"bracket",
        symbol:"QQQ",side:"buy",type:"market",
        legs:[
          {id:"private-tp",client_order_id:"auto-tp",side:"sell",type:"limit",symbol:"QQQ"},
          {id:"private-stop",client_order_id:"auto-stop",side:"sell",type:"stop",symbol:"QQQ"},
        ],
      });
    }
    if(target.includes("database.test/rest/v1/paper_bot_orders") && method==="PATCH") return new Response(null,{status:204});
    throw new Error(`Unexpected request: ${method} ${target}`);
  });

  const response=await api.POST(request());
  assert.equal(response.status,200);
  const body=await response.json();
  assert.equal(body.ok,true);
  assert.equal(body.paperOnly,true);
  assert.equal(body.bracketAccepted,true);
  assert.equal(body.takeProfitLegObserved,true);
  assert.equal(body.stopLossLegObserved,true);
  assert.doesNotMatch(JSON.stringify(body),/private-parent|private-tp|private-stop|paper-secret|db-secret/);
  assert.equal(calls.filter(call=>call.target==="https://paper-api.alpaca.markets/v2/orders" && call.method==="POST").length,1);
});

test("failed atomic claim never reaches Alpaca", async()=>{
  let alpacaPosts=0;
  const api=route((url,options={})=>{
    const target=String(url); const method=options.method??"GET";
    if(target.includes("/swing-readiness")) return Response.json(readiness(true));
    if(target.includes("database.test/rest/v1/paper_bot_orders") && method==="GET") return Response.json([prepared]);
    if(target.includes("database.test/rest/v1/paper_bot_orders") && method==="PATCH" && target.includes("status=eq.prepared")) return Response.json([]);
    if(target.startsWith("https://paper-api")) alpacaPosts++;
    throw new Error("Unexpected request");
  });
  const response=await api.POST(request());
  assert.equal(response.status,409);
  assert.equal(alpacaPosts,0);
});
