import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const source=readFileSync(new URL("../src/lib/paper-pulse-fractional.ts",import.meta.url),"utf8");
const {outputText}=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}});
const e={};
vm.runInNewContext(outputText,{exports:e,Math,Number,Date,RegExp});
test("Pulse fractional sizing floors at nine decimals without exceeding either cap",()=>{
  assert.equal(e.pulseFractionalQuantity(3,0.74999999999,33.5),0.749999999);
  const q=e.pulseFractionalQuantity(5,25/33.625,33.625);
  assert.ok(q>0&&q<1&&q*33.625<=25.000000001);
  assert.equal(e.pulseEntryOrderMode(q),"fractional-simple-protected");
  assert.equal(e.pulseEntryOrderMode(3),"bracket");
});
test("Pulse fractional min-notional and invalid quote fail closed",()=>{
  for(const args of [[0,1,10],[1,0,10],[1,1,0],[NaN,2,40],[Infinity,1,40],[0.001,0.001,20]]) {
    assert.equal(e.pulseFractionalQuantity(...args),null);
  }
  for(const value of [null,0,-1,NaN,Infinity,1.12345678998]){
    assert.equal(e.pulseEntryOrderMode(value),null);
  }
});
test("Pulse stop and flatten IDs are deterministic and distinct from parent",()=>{
  const entry="chb-pls-v1-muztbl5e-7067a59cc7444711be620d3a";
  const stop=e.pulseCompanionClientOrderId(entry,"stop");
  const flatten=e.pulseCompanionClientOrderId(entry,"flatten");
  assert.ok(stop&&flatten&&stop!==flatten&&stop!==entry&&flatten!==entry);
  assert.match(stop,/^chb-pls-v1-muztbl5e-[a-z0-9]{6,24}$/);
  assert.equal(e.pulseCompanionClientOrderId(entry,"stop"),stop);
  assert.equal(e.pulseCompanionClientOrderId("chb-spk-v1-muztbl5e-7067a59cc7444711be620d3a","stop"),null);
});
test("Pulse manager has no access to non-Pulse order cancellations",()=>{
  const manager=readFileSync(new URL("../src/app/api/paper-trading/bots/momentum-breakout-manage/route.ts",import.meta.url),"utf8");
  assert.match(manager,/paper_bot_orders\?bot_id=eq\.\$\{strategy.botProfileId\}/);
  assert.match(manager,/purpose:purpose==="stop"\?"protective-stop":"session-flatten"/);
  assert.match(manager,/const currentStop=await byClient\(stopId\)/);
  assert.match(manager,/broker\(`orders\/\$\{encodeURIComponent\(currentStop.id!\)\}`,\s*"DELETE"\)/);
  assert.match(manager,/const flattenDue=marketOpen&&minute>=15\*60\+40/);
  assert.doesNotMatch(manager,/ALPACA_LIVE/i);
});
