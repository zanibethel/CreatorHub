import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const exports={};
const code=ts.transpileModule(readFileSync(new URL("../src/lib/paper-crypto-ignition-scan-journal.ts",import.meta.url),"utf8"),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText;
vm.runInNewContext(code,{exports});
const {buildSparkScanJournalRows}=exports;
const candidate={
  symbol:"SOL/USD",sourceScore:73,state:"ready",selectedForSubmission:true,
  bid:102,ask:102.08,spreadPct:0.078,fastMomentumPct:0.4,slowMomentumPct:null,
  relativeVolume:1.5,trigger:102,maxEntry:102.12,protectiveStop:100.5,
  takeProfit:105.2,plannedNotional:20,plannedRiskDollars:0.31,blockers:[],waitingOn:[],
};
const base={collectedAt:"2026-10-08T07:20:00Z",strategyId:"crypto-ignition-v1",
  strategyVersion:1,executionEnabled:true,candidates:[]};
test("Spark journal rows satisfy public journal enum constraints and retain source vs strategy qualification",()=>{
  const rows=buildSparkScanJournalRows("crypto-ignition-100",{...base,candidates:[
    candidate,{...candidate,symbol:"LINK/USD",state:"waiting",selectedForSubmission:false,sourceScore:67,waitingOn:["spread"]},
    {...candidate,symbol:"DOT/USD",state:"blocked",selectedForSubmission:false,sourceScore:75,blockers:["occupied"]},
  ]});
  assert.deepEqual(Array.from(rows.map(row=>row.event_type)),["candidate","candidate","rejected"]);
  assert.deepEqual(Array.from(rows.map(row=>row.qualification)),["trade-ready","watch","unqualified"]);
  assert.equal(rows[0].score,73);
  assert.equal(rows[0].metadata.sparkQualification,"ready");
  assert.equal(rows[0].metadata.selectedForSubmission,true);
  assert.equal(rows[1].warnings[0],"spread");
  assert.equal(rows[2].blockers[0],"occupied");
  assert.ok(rows.every(row=>Object.keys(row).every(key=>!["broker_order_id","client_order_id"].includes(key))));
});
test("Spark journals empty scans without inventing a trade",()=>{
  const [row]=buildSparkScanJournalRows("crypto-ignition-100",base);
  assert.equal(row.event_type,"system");
  assert.equal(row.qualification,"watch");
  assert.equal(row.score,null);
  assert.equal(row.metadata.candidateCount,0);
  assert.equal(row.symbol,null);
});
