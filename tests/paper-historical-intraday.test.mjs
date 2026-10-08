import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import ts from "typescript";
import vm from "node:vm";

function load(file,imports={}){
 const target={};
 const source=readFileSync(new URL(file,import.meta.url),"utf8");
 const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(js,{exports:target,Math,Number,Date,Map,Set,Object,Error,require:name=>{
   if(Object.hasOwn(imports,name))return imports[name];
   throw Error("Unexpected import "+name);
 }});
 return target;
}
const v1=load("../src/lib/historical-pattern-intelligence.ts");
const v2=load("../src/lib/historical-intraday-intelligence.ts",{"./historical-pattern-intelligence":v1});
const universe=load("../src/lib/historical-research-universe.ts",{"./paper-watchlist":{
  DEFAULT_PAPER_WATCHLIST:{stocks:[{symbol:"AAPL"},{symbol:"AAPL"}],crypto:[{symbol:"BTC-USD"}]},
}});
const D=86400000,H=3600000,base=Date.parse("2025-01-01T00:00:00Z");
const daily=Array.from({length:535},(_,i)=>{const c=100+i*.015;return{
 t:new Date(base+(i-535)*D).toISOString(),o:c,h:c*1.009,l:c*.991,c,v:1000}});
const hours=Array.from({length:60*24},(_,i)=>{const c=100+i*.005;return{
 t:new Date(base-60*D+i*H).toISOString(),o:c,h:c*1.008,l:c*.992,c,v:100+i%17}});
const now=base;

test("24h feature window sees only the completed past and daily baseline excludes current day",()=>{
 const snapshot=v2.currentIntradaySnapshot("crypto",hours,daily,[],now);
 assert.ok(snapshot?.coverageValid);
 assert.equal(snapshot.features.observedHours24h,24);
 assert.ok(snapshot.features.dailyContext.prior1yPct>0);
 const tomorrow={...hours.at(-1),t:new Date(base+H).toISOString(),o:900,h:999,l:888,c:950,v:999999};
 const mutated=v2.currentIntradaySnapshot("crypto",[...hours,tomorrow],daily,[],now);
 assert.deepEqual({...mutated.features},{...snapshot.features});
});

test("event labels include losers/timeouts and never resolve beyond observed horizon",()=>{
 const events=v2.extractIntradayEvents("BTC/USD","crypto",hours,daily,now);
 assert.ok(events.length>500);
 assert.ok(events.some(e=>e.status==="timeout"));
 assert.ok(events.every(e=>Date.parse(e.decisionAt)<=Date.parse(e.entryAt)));
 assert.ok(events.every(e=>Date.parse(e.outcomeEndAt)<=now));
 assert.ok(events.every(e=>e.features.observedHours24h>=18));
});

test("same-hour target/stop is ambiguous and never counted as a target",()=>{
 const raw=hours.map(x=>({...x}));
 raw[29]={...raw[29],o:100,h:111,l:94,c:101};
 const events=v2.extractIntradayEvents("BTC/USD","crypto",raw,daily,now);
 const e=events.find(e=>e.decisionAt===new Date(Date.parse(raw[28].t)+H).toISOString()
   &&e.horizon==="24h"&&e.targetPct===4);
 assert.equal(e?.status,"ambiguous");
});

test("unresolved future event cannot influence earlier pattern score",()=>{
 const events=v2.extractIntradayEvents("BTC/USD","crypto",hours,daily,now);
 const at=new Date(Date.parse(hours[52].t)+H).toISOString();
 const snapshot=v2.currentIntradaySnapshot("crypto",hours.slice(0,53),daily,[],Date.parse(at));
 assert.ok(snapshot?.features);
 const match=v2.intradayMatch(events,snapshot.features,"24h",4,at,"crypto");
 assert.equal(match.comparisons,0);
 assert.equal(match.status,"insufficient-evidence");
});

test("micro five-minute bars exclude future, and sparse coverage is not presented as complete",()=>{
 const five=Array.from({length:24},(_,i)=>({
 t:new Date(base-2*H+i*5*60000).toISOString(),o:100,h:101,l:99,c:100.5,v:100}));
 five.push({t:new Date(base+5*60000).toISOString(),o:100,h:200,l:99,c:199,v:999999});
 const f=v2.microstructureFeatures(five,new Date(base).toISOString());
 assert.equal(f.complete,true);
 assert.ok((f.move60mPct??0)<10);
 const inadequate=v2.microstructureFeatures(five.slice(0,3),new Date(base).toISOString());
 assert.equal(inadequate.complete,false);
 assert.equal(inadequate.move60mPct,null);
});

test("broadened research universe deduplicates and validates scanner candidates",()=>{
 const list=universe.historicalResearchUniverse([
   {asset_class:"stock",symbol:"AAPL"},{asset_class:"crypto",symbol:"ETH-USD"},
   {asset_class:"stock",symbol:"INVALID!!"},
 ]);
 assert.ok(list.length>30);
 assert.equal(list.filter(x=>x.symbol==="AAPL").length,1);
 assert.ok(list.find(x=>x.assetClass==="crypto"&&x.symbol==="ETH/USD"));
 assert.ok(!list.some(x=>x.symbol.includes("!")));
 const choice=universe.scheduledResearchAsset(list,base);
 assert.ok(list.some(x=>x.symbol===choice.symbol&&x.assetClass===choice.assetClass));
});
