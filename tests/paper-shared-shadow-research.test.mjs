import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source=readFileSync(new URL("../src/lib/paper-shared-shadow-research.ts",import.meta.url),"utf8");
const moduleExports={};
vm.runInNewContext(ts.transpileModule(source,{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText,{exports:moduleExports,Date,Math,Number});
const {advanceSharedShadowStudy:advance}=moduleExports;

const blank=(patch={})=>({
  decisionAt:"2026-10-09T13:59:59Z",status:"watching",
  referenceEntry:100,protectiveStop:97,plannedTarget:109,
  hypotheticalQuantity:6,estimatedRoundTripCostPct:0.2,
  assumedEntry:null,assumedExit:null,entryAt:null,exitAt:null,lastBarAt:null,
  markCount:0,grossPl:null,estimatedCosts:null,hypotheticalNetPl:null,
  mfeR:null,maeR:null,firstOutcome:null,...patch,
});
const bar=(t,o,h,l,c)=>({t,o,h,l,c});

test("predecision and not-yet-completed bars cannot create hypothetical entries",()=>{
 const b=[
   bar("2026-10-09T13:55:00Z",100,101,99,100),
   bar("2026-10-09T14:00:00Z",100,101,99.5,100),
 ];
 const outcome=advance(blank(),b,{completedThrough:"2026-10-09T14:03:00Z"});
 assert.equal(outcome.changed,false);
 assert.equal(outcome.study.status,"watching");
 assert.equal(outcome.study.assumedEntry,null);
});

test("entry only becomes hypothetical on a completed, observed bar",()=>{
 const first=advance(blank(),[bar("2026-10-09T14:00:00Z",100,102,98,101)],
   {completedThrough:"2026-10-09T14:05:00Z"});
 assert.equal(first.study.status,"triggered");
 assert.equal(first.study.assumedEntry,100);
 assert.equal(first.study.hypotheticalNetPl,null);
 const close=advance(first.study,[bar("2026-10-09T14:05:00Z",101,110,99,109)],
   {completedThrough:"2026-10-09T14:10:00Z"});
 assert.equal(close.study.status,"completed");
 assert.equal(close.study.assumedExit,109);
 assert.equal(close.study.grossPl,54);
 assert.equal(close.study.estimatedCosts,1.2);
 assert.equal(close.study.hypotheticalNetPl,52.8);
 assert.equal(close.study.firstOutcome,"planned-target-reached");
 assert.equal(close.study.markCount,2);
 const replay=advance(close.study,[bar("2026-10-09T14:05:00Z",101,110,99,109)],
   {completedThrough:"2026-10-09T14:30:00Z"});
 assert.equal(replay.changed,false);
 assert.equal(replay.study.hypotheticalNetPl,52.8);
});

test("post-entry gap through stop marks the worse open, not the planned stop",()=>{
 const seeded=blank({status:"triggered",assumedEntry:100,entryAt:"2026-10-09T14:00:00Z",
   lastBarAt:"2026-10-09T14:00:00Z",markCount:1,mfeR:0,maeR:0});
 const result=advance(seeded,[bar("2026-10-09T14:05:00Z",95,96,94,95)],
   {completedThrough:"2026-10-09T14:10:00Z"});
 assert.equal(result.study.firstOutcome,"stop-gap-worse-fill");
 assert.equal(result.study.assumedExit,95);
 assert.ok(result.study.hypotheticalNetPl<-30);
});

test("intrabar trigger with a stop/target in the same bar is ambiguous",()=>{
 const result=advance(blank(),[bar("2026-10-09T14:00:00Z",99,110,96,105)],
 {completedThrough:"2026-10-09T14:05:00Z"});
 assert.equal(result.study.status,"ambiguous");
 assert.equal(result.study.firstOutcome,"entry-and-exit-order-unknown");
 assert.equal(result.study.hypotheticalNetPl,null);
});
test("entry at open with simultaneous stop and target is ambiguous",()=>{
 const result=advance(blank(),[bar("2026-10-09T14:00:00Z",100,110,96,105)],
 {completedThrough:"2026-10-09T14:05:00Z"});
 assert.equal(result.study.status,"ambiguous");
 assert.equal(result.study.firstOutcome,"stop-and-target-in-same-bar");
 assert.equal(result.study.hypotheticalNetPl,null);
});
test("gap beyond reference price does not invent a market entry",()=>{
 const result=advance(blank(),[bar("2026-10-09T14:00:00Z",112,115,110,114)],
 {completedThrough:"2026-10-09T14:05:00Z"});
 assert.equal(result.study.status,"watching");
 assert.equal(result.study.assumedEntry,null);
});
test("expiration does not invent a trade close or realized profit",()=>{
 const result=advance(blank(),[],{
   completedThrough:"2026-10-10T14:00:00Z",expiresAt:"2026-10-10T00:00:00Z",verifiedCoverageThroughCutoff:true,
 });
 assert.equal(result.study.status,"expired");
 assert.equal(result.study.firstOutcome,"never-triggered");
 assert.equal(result.study.hypotheticalNetPl,null);
});
test("bad bars and invalid plans fail closed",()=>{
 assert.throws(()=>advance(blank(),[bar("2026-10-09T14:00:00Z",100,99,101,100)],
 {completedThrough:"2026-10-09T14:05:00Z"}),/Invalid completed/);
 assert.throws(()=>advance(blank({protectiveStop:101}),[],{
 completedThrough:"2026-10-09T14:05:00Z"}),/Invalid research-only/);
});

const sql=readFileSync(new URL("../supabase/migrations/20261010020000_paper_shared_shadow_studies.sql",import.meta.url),"utf8");
test("capital-only declines seed PAPER-isolated unfilled studies, not broker P&L",()=>{
 assert.match(sql,/NEW\.decision_state<>'shadow-only'/);
 assert.match(sql,/noAssumedFillAtDecision/);
 assert.match(sql,/hypothetical_net_pl IS NULL OR status='completed'/);
 assert.match(sql,/broker_order_authorized=false/);
 assert.match(sql,/REVOKE ALL ON public\.paper_shared_shadow_studies FROM PUBLIC,anon,authenticated/);
 assert.match(sql,/SECURITY INVOKER SET search_path=''/);
});

test("no market-data coverage never expires an unobserved opportunity",()=>{
 const unobserved=advance(blank(),[],{
 completedThrough:"2026-10-10T14:00:00Z",expiresAt:"2026-10-10T00:00:00Z",
 verifiedCoverageThroughCutoff:false,
 });
 assert.equal(unobserved.study.status,"watching");
 assert.equal(unobserved.changed,false);
});
test("a candle opened at the exact decision instant is not retroactively tradable",()=>{
 const state=blank({decisionAt:"2026-10-09T14:00:00Z"});
 const result=advance(state,[bar("2026-10-09T14:00:00Z",100,110,99,108)],
 {completedThrough:"2026-10-09T14:05:00Z"});
 assert.equal(result.study.assumedEntry,null);
 assert.equal(result.changed,false);
});
