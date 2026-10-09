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
const {buildFuseShadowSeeds,buildFuseArchivedShadowSeeds}=load("../src/lib/paper-fuse-counterfactual.ts",{
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

test("Fuse readiness only mutates shadow rows in authenticated scheduler path",()=>{
  const source=readFileSync(new URL("../src/app/api/paper-trading/bots/fuse-readiness/route.ts",import.meta.url),"utf8");
  assert.match(source,/if\(isCron\)\{/);
  assert.match(source,/buildFuseShadowSeeds\(plans,/);
  assert.match(source,/activeShadow\.map\(row=>row\.symbol\)/);
  assert.match(source,/advancePaperCounterfactual/);
  assert.match(source,/shadowTracking/);
  assert.match(source,/researchOnly:true,executionEnabled:false,submissionReady:false/);
});

function observed(overrides={}) {
  return {symbol:"NVD",strategyVersion:1,readiness:"research-ready",fuseScore:84,
    evaluatedAt:"2026-10-08T16:55:14.290Z",
    lastCompletedBarAt:"2026-10-08T16:45:00Z",blockers:[],warnings:[],
    plan:{entryPrice:3.46346,stopPrice:3.428825,exitPrice:3.53273},
    quoteAgeSeconds:14,spreadPct:0.42,...overrides};
}
test("Fuse replays archived original research decision, not later prices or signals",()=>{
  const rows=[
    observed({evaluatedAt:"2026-10-08T17:20:14.500Z",plan:{entryPrice:3.52352,stopPrice:3.488285,exitPrice:3.59399}}),
    observed(),
    observed({symbol:"HTZ",evaluatedAt:"2026-10-08T15:50:14.416Z",
      lastCompletedBarAt:"2026-10-08T15:45:00Z",
      plan:{entryPrice:1.93193,stopPrice:1.912611,exitPrice:1.970568}}),
  ];
  const seeds=buildFuseArchivedShadowSeeds(rows,"2026-10-09T00:35:00Z","2026-10-08");
  assert.equal(seeds.length,2);
  const nvd=seeds.find(row=>row.symbol==="NVD");
  assert.equal(nvd.decision_at,"2026-10-08T16:55:14.290Z");
  assert.equal(nvd.trigger_price,3.46346);
  assert.equal(nvd.protective_stop,3.428825);
  assert.equal(nvd.last_bar_at,"2026-10-08T16:55:00.000Z");
  assert.equal(nvd.metadata.originalLastCompletedBarAt,"2026-10-08T16:45:00Z");
  assert.equal(nvd.metadata.decisionBucketExcluded,true);
  assert.equal(nvd.metadata.replayedObservation,true);
  assert.equal(nvd.metadata.executedTrade,false);
  assert.equal(nvd.metadata.brokerOrderPlaced,false);
  assert.equal(nvd.setup_key,"fuse:penny-volatility-day-v1:v1:2026-10-08:NVD");
});
test("Fuse archived replay excludes wrong date/version, future decisions, stale bars and altered risk",()=>{
  const now="2026-10-09T00:35:00Z";
  const bad=[
    observed({strategyVersion:2}),
    observed({evaluatedAt:"2026-10-09T15:20:00Z"}),
    observed({evaluatedAt:"2026-10-07T16:55:14Z"}),
    observed({lastCompletedBarAt:"2026-10-08T16:55:00Z"}),
    observed({lastCompletedBarAt:null}),
    observed({blockers:["halt"]}),
    observed({fuseScore:75}),
    observed({plan:{entryPrice:3.5,stopPrice:3.51,exitPrice:3.7}}),
    observed({symbol:"NVD;DROP"}),
  ];
  for(const candidate of bad) assert.equal(buildFuseArchivedShadowSeeds([candidate],now,"2026-10-08").length,0,
    JSON.stringify(candidate));
});
test("Fuse authenticated cron recovers original signals but public GET has no archival side effects",()=>{
  const source=readFileSync(new URL("../src/app/api/paper-trading/bots/fuse-readiness/route.ts",import.meta.url),"utf8");
  assert.match(source,/const \[activeShadowRaw, archivedRaw\]=isCron\?/);
  assert.match(source,/buildFuseArchivedShadowSeeds/);
  assert.match(source,/archivedSeeds,\.\.\.freshSeeds/);
  assert.match(source,/start:new Date\(now-16\*3600_000\)/);
  assert.match(source,/if\(isCron\)\{/);
});
