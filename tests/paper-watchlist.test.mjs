import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {z} from 'zod';
const selection=JSON.parse(readFileSync(new URL('../research/paper-watchlist/selection.json',import.meta.url),'utf8'));
function module(path,imports,globals={}) {
 const exports={};const code=ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code,{exports,Response,AbortSignal,process:{env:{}},...globals,require:name=>{if(name in imports)return imports[name];throw new Error(`Unexpected import ${name}`);}});return exports;
}
const schema=module('../src/lib/paper-watchlist.ts',{zod:{z},'../../research/paper-watchlist/selection.json':{default:selection}});
test('shared list respects quote limits and records zero inverse allocation',()=>{
 const p=schema.watchlistSchema.parse(selection);assert.equal(p.stocks.length,10);assert.equal(p.crypto.length,2);
 assert.equal(p.stocks.find(x=>x.symbol==='SH').pools.length,0);assert.ok(p.stocks.every(x=>x.fractionable));
});
test('shared list rejects invalid symbols, oversized lists and nonfinite research metrics',()=>{
 for(const bad of [{...selection,stocks:[{...selection.stocks[0],symbol:'SPY&select=secret'}]},{...selection,stocks:[...selection.stocks,selection.stocks[0]]},{...selection,crypto:[{...selection.crypto[0],volatility:Infinity}]}])assert.equal(schema.watchlistSchema.safeParse(bad).success,false);
});
test('public shared watchlist strips private fields and only reads the fixed report',async()=>{
 let requested;
 const privateConfig={...selection,token:'private-token',stocks:selection.stocks.map(x=>({...x,account_id:'private-id'}))};
 const api=module('../src/app/api/paper-trading/watchlist/route.ts',{'next/server':{NextResponse:Response},'@/lib/paper-watchlist':schema},{process:{env:{SUPABASE_SECRET_KEY:'private-database-key'}},fetch:(url,options)=>{requested={url,options};return Response.json([{config:privateConfig,report_key:'private-key'}]);}});
 const response=await api.GET();assert.equal(response.status,200);assert.match(requested.url,/report_key=eq.main&select=config/);
 assert.match(response.headers.get('cache-control'),/s-maxage=30/);assert.doesNotMatch(JSON.stringify(await response.json()),/private-|account_id|report_key|token/);
});
test('missing shared-list storage does not contact the database',async()=>{
 const api=module('../src/app/api/paper-trading/watchlist/route.ts',{'next/server':{NextResponse:Response},'@/lib/paper-watchlist':schema},{fetch:()=>{throw new Error('Must not fetch');}});
 assert.equal((await api.GET()).status,503);
});
