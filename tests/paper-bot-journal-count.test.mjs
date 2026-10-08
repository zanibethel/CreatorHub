import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const exports={};
const js=ts.transpileModule(readFileSync(new URL("../src/lib/paper-bot-journal-count.ts",import.meta.url),"utf8"),{
 compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText;
vm.runInNewContext(js,{exports});
test("exact journal count parses non-empty and empty per-bot HEAD totals",()=>{
 assert.equal(exports.parsePostgrestExactCount("0-0/18750"),18750);
 assert.equal(exports.parsePostgrestExactCount("*/0"),0);
 assert.equal(exports.parsePostgrestExactCount("0-0/5"),5);
});
test("journal count fails closed rather than displaying fake zero",()=>{
 assert.throws(()=>exports.parsePostgrestExactCount(null),/missing/);
 assert.throws(()=>exports.parsePostgrestExactCount("0-0/*"),/missing/);
});
test("Bot Lab uses per-bot HEAD counts instead of truncated 10K-row journal data",()=>{
 const source=readFileSync(new URL("../src/app/api/paper-trading/bots/route.ts",import.meta.url),"utf8");
 assert.match(source,/method:\s*"HEAD"/);
 assert.match(source,/Prefer:\s*"count=exact"/);
 assert.doesNotMatch(source,/paper_bot_journal\?select=id,bot_id&limit=10000/);
});
