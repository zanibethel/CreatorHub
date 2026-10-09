import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function load(path,imports={}) {
  const exports={};
  const tsText=readFileSync(new URL(path,import.meta.url),"utf8");
  const js=ts.transpileModule(tsText,{compilerOptions:{
    module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,
  }}).outputText;
  vm.runInNewContext(js,{exports,require:name=>{
    if(name in imports)return imports[name];
    throw Error("Unexpected import "+name);
  },Number,Math,Date,RegExp,Set,Array,Object,Map});
  return exports;
}
const cfg={FUSE_PENNY_STRATEGY_V1:{botProfileId:"penny-volatility-day-100",version:1}};
const attribution={
  parsePaperClientOrderId:id=>id==="chb-pny-v1-mvzpxd60-aabcdef123456789"?
    {botId:"penny-volatility-day-100",strategyVersion:1}:null,
};
const {auditFuseBrokerBracket:audit}=load("../src/lib/paper-fuse-protection-audit.ts",{
  "./paper-fuse-strategy-config":cfg,"./paper-order-attribution":attribution,
});
const ID="chb-pny-v1-mvzpxd60-aabcdef123456789";
function scenario(){
  const entry={client_order_id:ID,symbol:"NVD",side:"buy",status:"filled",
    broker_order_id:"P1",requested_quantity:5,entry_trigger:3.46,max_entry_price:3.51,
    protective_stop:3.428825,take_profit_price:3.53273};
  const stop={id:"S1",client_order_id:"broker-stop-1",symbol:"NVD",side:"sell",
    type:"stop",status:"new",qty:"5",filled_qty:"0",stop_price:"3.43"};
  const target={id:"T1",client_order_id:"broker-target-1",symbol:"NVD",side:"sell",
    type:"limit",status:"new",qty:"5",filled_qty:"0",limit_price:"3.54"};
  const parent={id:"P1",client_order_id:ID,symbol:"NVD",side:"buy",
    order_class:"bracket",type:"limit",time_in_force:"day",
    status:"filled",qty:"5",filled_qty:"5",legs:[stop,target]};
  return {entry,parent,brokerPosition:{symbol:"NVD",qty:"5",qty_available:"0"},
    otherBotOwnsSymbol:false,liveSellOrders:[stop,target]};
}
test("Fuse verifies independently matching PAPER bracket and exact sell share cover",()=>{
  const r=audit(scenario());assert.equal(r.state,"protected",JSON.stringify(r.issues));
  assert.equal(r.stopAt,3.43);assert.equal(r.targetAt,3.54);
});
test("Fuse refuses phantom or canceled stop and does not claim a protected position",()=>{
  const missing=scenario();missing.parent.legs=missing.parent.legs.filter(x=>x.type!=="stop");
  assert.equal(audit(missing).state,"unprotected");
  const cancel=scenario();cancel.parent.legs[0].status="canceled";
  assert.equal(audit(cancel).state,"unprotected");
});
test("Fuse does not infer zero filled shares from missing broker child fill information",()=>{
  for(const missing of [undefined,"unknown","6"]){
    const s=scenario();
    s.parent.legs[0].filled_qty=missing;
    assert.equal(audit(s).state,"unprotected");
  }
  const absentFromVenue=scenario();
  absentFromVenue.liveSellOrders=[absentFromVenue.parent.legs[1]];
  assert.equal(audit(absentFromVenue).state,"unprotected");
});
test("Fuse rejects under-covered or too-low sell stop and low target",()=>{
  const small=scenario();small.parent.legs[0].qty="4";
  assert.equal(audit(small).state,"unprotected");
  const low=scenario();low.parent.legs[0].stop_price="3.40";
  assert.equal(audit(low).state,"unprotected");
  const target=scenario();target.parent.legs[1].limit_price="3.50";
  assert.equal(audit(target).state,"unprotected");
});
test("Fuse fails closed on foreign broker order, other-bot position and mismatched parent",()=>{
  const collision=scenario();collision.otherBotOwnsSymbol=true;
  assert.equal(audit(collision).state,"ownership-collision");
  const stray=scenario();stray.liveSellOrders.push({id:"OTHER",client_order_id:"foreign",symbol:"NVD",side:"sell",type:"stop",status:"new"});
  assert.equal(audit(stray).state,"unprotected");
  const spoof=scenario();spoof.parent.client_order_id="another-bot";
  assert.equal(audit(spoof).state,"unconfirmed");
});
test("Fuse separates pending entry, unconfirmed filled holding, and broker flat",()=>{
  const pending=scenario();pending.parent.filled_qty="0";pending.brokerPosition=null;
  assert.equal(audit(pending).state,"awaiting-entry");
  const unconfirmed=scenario();unconfirmed.parent.filled_qty="0";
  assert.equal(audit(unconfirmed).state,"unconfirmed");
  const flat=scenario();flat.brokerPosition=null;
  assert.equal(audit(flat).state,"broker-flat");
});
test("Fuse bracket auditing endpoint is cron-authenticated, PAPER-only and read-only",()=>{
  const route=readFileSync(new URL("../src/app/api/paper-trading/bots/fuse-bracket-audit/route.ts",import.meta.url),"utf8");
  assert.match(route,/export async function GET/);
  assert.match(route,/request\.headers\.get\("authorization"\)/);
  assert.match(route,/paper-api\.alpaca\.markets/);
  assert.match(route,/protectiveManagementImplemented:false/);
  assert.doesNotMatch(route,/export async function POST|method:"POST"|method:"PATCH"|method:"DELETE"/);
  assert.match(route,/broker\("orders\/"\+encodeURIComponent\(id\)\)/);
});
