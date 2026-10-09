import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const helper=readFileSync(new URL("../src/lib/paper-pulse-bracket-evidence.ts",import.meta.url),"utf8");
const execute=readFileSync(new URL("../src/app/api/paper-trading/bots/momentum-breakout-execute/route.ts",import.meta.url),"utf8");
const compiled=ts.transpileModule(helper,{compilerOptions:{
  module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,
}}).outputText;
const exports={};
vm.runInNewContext(compiled,{exports,Number,Math,Set});
const audit=exports.auditPulseBrokerBracket;
const parent=()=>({
  id:"broker-parent",client_order_id:"chb-pls-v1-abc-12345678",
  symbol:"SOXS",side:"buy",type:"market",order_class:"bracket",
  legs:[
    {id:"broker-stop",client_order_id:"alpaca-stop",symbol:"SOXS",side:"sell",
      type:"stop",status:"held",qty:"2",filled_qty:"0",stop_price:"12.50"},
    {id:"broker-target",client_order_id:"alpaca-target",symbol:"SOXS",side:"sell",
      type:"limit",status:"held",qty:"2",filled_qty:"0",limit_price:"15.20"},
  ],
});
const check=p=>audit({parent:p,brokerOrderId:"broker-parent",clientOrderId:"chb-pls-v1-abc-12345678",
  symbol:"SOXS",quantity:2,authorizedStop:12.5,authorizedTarget:15.2});

test("Pulse verifies a whole-share Alpaca bracket only with exact broker parent and live full-size exit legs",()=>{
  const result=check(parent());
  assert.equal(result.verified,true);
  assert.equal(result.stopLegObserved,true);
  assert.equal(result.targetLegObserved,true);
});

test("leg IDs exist but canceled, pending-cancel, or undercovered stops are NOT proof of protection",()=>{
  for(const bad of [
    p=>{p.legs[0].status="canceled";},
    p=>{p.legs[0].status="pending_cancel";},
    p=>{p.legs[0].status="partially_filled";p.legs[0].filled_qty="1";},
    p=>{p.legs[0].filled_qty="unknown";},
    p=>{delete p.legs[0].filled_qty;},
    p=>{p.legs[0].qty="1";},
    p=>{p.legs[0].stop_price="12.00";},
    p=>{p.legs[1].limit_price="14.00";},
    p=>{p.legs[1].symbol="SQQQ";},
    p=>{p.legs[1].id="broker-stop";},
    p=>{p.order_class="simple";},
    p=>{p.client_order_id="wrong-parent";},
  ]){
    const p=parent();bad(p);
    assert.equal(check(p).verified,false,JSON.stringify(p));
  }
});

test("Pulse executor never stamps protectionValidatedAt before independently checking broker status, quantity and prices",()=>{
  const proof=execute.indexOf("const brokerProof=auditPulseBrokerBracket(");
  const patch=execute.indexOf("protectionValidatedAt:!fractional&&brokerProof.verified?");
  const reject=execute.indexOf("if(!protectionVerified)");
  assert.ok(proof>0&&patch>proof&&reject>patch);
  assert.match(execute,/const protectionVerified=brokerProof\.verified/);
});
