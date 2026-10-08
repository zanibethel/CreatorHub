import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const code = ts.transpileModule(readFileSync(new URL("../src/lib/paper-flash-audit.ts", import.meta.url), "utf8"), {
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
}).outputText;
const exports = {};
vm.runInNewContext(code,{exports,Set,Array,String});
const {flashDecisionClassification,flashEvidenceCounts} = exports;
const shadow = {decision_state:"waiting",score:65,warnings:["Score below 80"],blockers:[],first_outcome:"two-r-before-stop",metadata:{}};
const contemporaneous = {decision_state:"waiting",score:65,warnings:["Score below 80"],blockers:[],metadata:{
  state:"waiting",selectedForSubmission:false,submissionReady:false,executionEnabled:true
}};
test("a +2R shadow does not turn an explicitly waiting decision into a missed executable trade",()=>{
  const result=flashDecisionClassification(shadow,contemporaneous);
  assert.equal(result.label,"Valid rejection at decision time");
  assert.equal(result.verifiedMissedTrade,false);
});
test("missing contemporaneous evidence fails closed",()=>{
  const result=flashDecisionClassification(shadow,null);
  assert.match(result.label,/Unresolved/);
  assert.equal(result.verifiedMissedTrade,false);
});
test("selected candidate without broker evidence remains unresolved rather than implementation failure",()=>{
  const result=flashDecisionClassification(shadow,{...contemporaneous,metadata:{
    ...contemporaneous.metadata,state:"ready",selectedForSubmission:true,submissionReady:true
  }});
  assert.match(result.label,/Unresolved/);
  assert.equal(result.verifiedMissedTrade,false);
});
test("shadow aggregate does not imply realized trading profits or count repeated checks",()=>{
  const s=[
    {setup_key:"a",status:"completed",first_outcome:"two-r-before-stop"},
    {setup_key:"b",status:"completed",first_outcome:"stop-before-one-r"},
    {setup_key:"c",status:"watching",first_outcome:null},
  ];
  assert.deepEqual({...flashEvidenceCounts(s)},{trackedSetupKeys:3,settled:2,twoR:1,stopBeforeOneR:1,stopAfterOneR:0});
});
