import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function load(path,imports={}) { const exports={}; const code=ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText; vm.runInNewContext(code,{exports,require:name=>imports[name]});return exports; }
const monitor=load('../src/lib/market-monitor.ts');
const {qualificationEvidence:evaluate}=load('../src/lib/paper-qualification.ts',{'./market-monitor':monitor});
const list=JSON.parse(readFileSync(new URL('../research/paper-watchlist/selection.json',import.meta.url),'utf8'));
const now=Date.parse('2026-10-03T15:00:00Z');
const quote={bid:100,ask:101};const time=new Date(now-1000).toISOString();
const candles=[{time:'2026-10-01',close:100},{time:'2026-10-02',close:110}];
test('fresh quotes never authorize orders and every funded research pool remains possible',()=>{
 for(const item of [...list.stocks,...list.crypto].filter(x=>!['SH','PSQ'].includes(x.symbol))) {
  const r=evaluate(item,quote,time,candles,now);
  assert.equal(r.status,'Awaiting validated rules');assert.equal(r.valid,true);assert.equal(r.fresh,true);
  assert.deepEqual(Array.from(r.pools,p=>p.cap),[20,40,40]);assert.ok(r.blockers.some(x=>x.includes('not validated')));
 }
});
test('inverse candidates are watched with no funded pools',()=>{
 for(const symbol of ['SH','PSQ']) { const r=evaluate(list.stocks.find(x=>x.symbol===symbol),quote,time,candles,now);assert.equal(r.pools.length,0);assert.match(r.status,/no allocation/); }
});
test('crossed, missing and nonfinite quotes cannot pass data checks',()=>{
 for(const q of [null,{bid:100,ask:99},{bid:NaN,ask:101},{bid:0,ask:1},{bid:100,ask:Infinity}]) { const r=evaluate(list.stocks[0],q,time,candles,now);assert.equal(r.valid,false);assert.equal(r.spread,null); }
});
test('stale and future timestamps remain flagged; missing history has no change',()=>{
 for(const t of [null,'invalid',new Date(now-60000).toISOString(),new Date(now+61000).toISOString()])assert.equal(evaluate(list.stocks[0],quote,t,[],now).fresh,false);
 const r=evaluate(list.stocks[0],quote,time,[{time:'invalid',close:2},{time:'2026-10-04',close:200}],now);assert.equal(r.change,null);assert.equal(r.historyCount,0);
});
test('descriptive changes sort observations and do not mutate input',()=>{
 const input=[...candles].reverse();const r=evaluate(list.stocks[0],quote,time,input,now);assert.ok(Math.abs(r.change-10)<1e-9);assert.equal(input[0].close,110);assert.ok(Math.abs(r.spread-100/100.5)<1e-9);
});
