import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const src=readFileSync(new URL("../src/lib/historical-pattern-intelligence.ts",import.meta.url),"utf8");
const code=ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const loaded={exports:{}};
vm.runInNewContext(code,{exports:loaded.exports,Math,Number,Date,Map,Set,Object,Error});
const engine=loaded.exports;

const day=86_400_000;
function bars(n=320){
  return Array.from({length:n},(_,i)=>{
    const price=100+i*.03;
    return {t:new Date(Date.UTC(2024,0,1)+i*day).toISOString(),
      o:price,h:price*1.005,l:price*.995,c:price,v:1000+(i%7)*20};
  });
}

test("requires 12-month completed context; never labels unresolved future horizons",()=>{
  assert.equal(engine.extractHistoryExamples("XYZ","stock",bars(200)).length,0);
  const rows=engine.extractHistoryExamples("XYZ","stock",bars(280));
  assert.ok(rows.length>0);
  const last=Date.parse(bars(280).at(-1).t)+day;
  assert.ok(rows.every(r=>Date.parse(r.outcomeEndAt)<=last));
  assert.ok(rows.every(r=>new Date(r.decisionAt)<new Date(r.entryAt)));
});

test("past-only features cannot be changed by subsequent large price moves",()=>{
  const original=bars(310);
  const before=engine.historicalFeatures(original,290);
  original[298]={...original[298],o:350,h:375,l:300,c:330,v:100000};
  assert.deepEqual({...engine.historicalFeatures(original,290)},{...before});
});

test("records losing and timeout cases instead of selecting winners only",()=>{
  const rows=engine.extractHistoryExamples("XYZ","stock",bars());
  assert.ok(rows.some(r=>r.status==="timeout"));
  assert.equal(rows.some(r=>r.status==="target"),false);
});

test("same-candle target and stop is ambiguous, never an automatic win",()=>{
  const data=bars(260);
  data[253]={...data[253],o:105,h:114,l:99,c:106};
  const rows=engine.extractHistoryExamples("XYZ","stock",data);
  const e=rows.find(r=>r.horizon==="same-day" && r.targetPct===4 && r.entryAt===data[253].t);
  assert.equal(e?.status,"ambiguous");
});

test("future outcomes cannot join historical nearest neighbors",()=>{
  const data=bars(340);
  const examples=engine.extractHistoryExamples("X","crypto",data);
  const f=engine.historicalFeatures(data,300);
  const asOf=data[253].t;
  const matched=engine.matchHistoricalPattern(examples,f,"3-day",4,asOf,"crypto");
  assert.equal(matched.status,"insufficient-evidence");
  assert.equal(matched.score,null);
  assert.equal(matched.matchedCount,0);
});

test("matching is research-only, distinct from buy eligibility",()=>{
  const data=bars(360);
  const r=engine.researchSummary("ETH/USD","crypto",data);
  assert.equal(r.rows.length,15);
  assert.equal(r.note.includes("Research only"),true);
  assert.ok(r.rows.every(row=>row.match.status==="research-only" || row.match.status==="insufficient-evidence"));
  assert.ok(r.rows.every(row=>row.advisoryOnly===true));
  assert.ok(r.rows.every(row=>row.successes+row.stops+row.timeouts+row.ambiguous===row.total));
});

test("reject malformed OHLC bars from the research set",()=>{
  const series=bars(300);
  series[50]={...series[50],h:0};
  assert.equal(engine.normalizeHistoryBars(series).length,299);
});
