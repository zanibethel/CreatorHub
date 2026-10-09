import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source=readFileSync(new URL("../src/lib/paper-swing-journal-classification.ts",import.meta.url),"utf8");
const compiled=ts.transpileModule(source,{compilerOptions:{
 module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,
}}).outputText;
const exports={};vm.runInNewContext(compiled,{exports});
const classify=exports.swingJournalClassification;
test("Harbor journal events conform to the production PAPER journal event and qualification CHECK constraints",()=>{
 const allowedEvents=new Set(["candidate","rejected","authorized","submitted","filled",
   "position_update","stop_update","partial_exit","closed","risk_event","system",
   "canceled","expired","replaced","execution_error","scanner_observed","scanner_assigned"]);
 const allowedQualifications=new Set(["unqualified","watch","qualified","trade-ready"]);
 const expected={
   staged:["candidate","qualified"],
   eligible:["candidate","qualified"],
   deferred:["candidate","watch"],
   rejected:["rejected","unqualified"],
 };
 for(const [disposition,[eventType,qualification]] of Object.entries(expected)){
   const actual=classify(disposition);
   assert.equal(actual.eventType,eventType);
   assert.equal(actual.qualification,qualification);
   assert.ok(allowedEvents.has(actual.eventType));
   assert.ok(allowedQualifications.has(actual.qualification));
 }
});
test("Harbor records original staging disposition only as metadata and not invalid enums",()=>{
 const path="../src/app/api/paper-trading/bots/swing-prospect-intake/route.ts";
 const route=readFileSync(new URL(path,import.meta.url),"utf8");
 assert.match(route,/const journalType=swingJournalClassification\(qualification\)/);
 assert.match(route,/event_type:journalType\.eventType/);
 assert.match(route,/qualification:journalType\.qualification/);
 assert.match(route,/intakeDisposition:qualification/);
 assert.doesNotMatch(route,/event_type:"prospect-intake"/);
 assert.match(route,/if\(journalRows\.length\) await writeDb\("paper_bot_journal",journalRows\)/);
});
