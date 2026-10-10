import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import ts from "typescript";
import vm from "node:vm";

const src=readFileSync(new URL("../src/lib/paper-challenge-proposal-batch.ts",import.meta.url),"utf8");
const mod={};
vm.runInNewContext(ts.transpileModule(src,{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText,{
  exports:mod,
  require:()=>({normalizeChallengeTradeProposal:x=>({...x,blockers:[],observationState:"qualified-observation"})}),
});
const item=(id,bot,symbol,key)=>({challengeId:id,botInstanceId:bot,symbol,decisionKey:key});
test("duplicate physical symbol in one challenge blocks both bots",()=>{
 const b=mod.normalizeChallengeProposalBatch([item("a","flash","BTC/USD","one"),item("a","spark","BTCUSD","two")]);
 assert.equal(b.executionReadyCount,0);
 assert.equal(b.brokerOrderAuthorized,false);
 assert.ok(b.proposals.every(p=>p.observationState==="blocked"));
});
test("same symbol in separate shadow challenges stays independent",()=>{
 const b=mod.normalizeChallengeProposalBatch([item("a","spark","BTCUSD","one"),item("b","spark","BTCUSD","two")]);
 assert.ok(b.proposals.every(p=>p.observationState==="qualified-observation"));
 assert.equal(b.brokerOrderAuthorized,false);
});
test("same idempotency key in one instance gets flagged",()=>{
 const b=mod.normalizeChallengeProposalBatch([item("a","spark","BTC","one"),item("a","spark","ETH","one")]);
 assert.ok(b.proposals.every(p=>p.blockers.some(x=>x.includes("idempotency"))));
});
test("internal endpoint is secret protected and never calls the broker",()=>{
 const code=readFileSync(new URL("../src/app/api/paper-trading/bots/challenge-proposals/route.ts",import.meta.url),"utf8");
 assert.match(code,/CRON_SECRET/);
 assert.match(code,/unverifiedCallerSuppliedEvidence:true/);
 assert.doesNotMatch(code,/ALPACA_API_KEY_ID|SUPABASE_SECRET_KEY|paper_shared_preview_claim/);
});
