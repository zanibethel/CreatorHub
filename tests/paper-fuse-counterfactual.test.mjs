import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import ts from "typescript";
function load(path, imports={}) {
  const exports={};
  const output=ts.transpileModule(readFileSync(new URL(path,import.meta.url),"utf8"),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
  }).outputText;
  vm.runInNewContext(output,{exports,require:(name)=>{
    if(name in imports)return imports[name];
    throw Error("Unexpected import "+name);
  },Intl,Date,Math,Number,Map,Object,Array,Set});
  return exports;
}
const config=load("../src/lib/paper-fuse-strategy-config.ts");
const {buildFuseShadowSeeds}=load("../src/lib/paper-fuse-counterfactual.ts",{
  "./paper-fuse-strategy-config":config,
});
function plan(overrides={}) {
  return {symbol:"NVD",readiness:"research-ready",blockers:[],warnings:[],
    fuseScore:92,entryTrigger:2.2,maximumEntry:2.23,
    lastCompletedBarAt:"2026-10-08T15:00:00Z",quoteAgeSeconds:7,spreadPct:0.8,
    relativeVolume:2,recentDollarVolume:150000,plan:{stopPrice:2.13,exitPrice:2.34},
    ...overrides};
}
const now="2026-10-08T15:05:00Z";
test("Fuse qualifying setups create idempotent research-only counterfactual keys",()=>{
  const [seed]=buildFuseShadowSeeds([plan()],now,"2026-10-08");
  assert.ok(seed);
  assert.equal(seed.setup_key,"fuse:penny-volatility-day-v1:v1:2026-10-08:NVD");
  assert.equal(seed.metadata.researchOnly,true);
  assert.equal(seed.metadata.brokerOrderPlaced,false);
  assert.equal(seed.metadata.executedTrade,false);
  assert.equal(seed.status,"watching");
  assert.equal(seed.trigger_price,2.2);
  assert.equal(seed.protective_stop,2.13);
});
test("Fuse refuses shadow seeds for blocked, waiting, or invalid stop/trigger cases",()=>{
  const bad=[
    plan({readiness:"rejected"}),plan({readiness:"prepared"}),
    plan({blockers:["spread"]}),plan({maximumEntry:2.1}),
    plan({plan:{stopPrice:2.21,exitPrice:2.34}}),
    plan({plan:{stopPrice:null,exitPrice:2.34}}),
  ];
  assert.equal(buildFuseShadowSeeds(bad,now,"2026-10-08").length,0);
});
test("Fuse rejects invalid session timestamps and retains day-scoped keys",()=>{
  assert.equal(buildFuseShadowSeeds([plan()],"invalid","2026-10-08").length,0);
  assert.equal(buildFuseShadowSeeds([plan()],now,"x").length,0);
  const [seed]=buildFuseShadowSeeds([plan()],now,"2026-10-09");
  assert.match(seed.setup_key,/2026-10-09/);
});
