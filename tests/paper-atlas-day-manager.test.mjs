import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import ts from "typescript";
import vm from "node:vm";

const code=ts.transpileModule(
  readFileSync(new URL("../src/lib/paper-atlas-day-manager.ts",import.meta.url),"utf8"),
  {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}
).outputText;
const mod={};
vm.runInNewContext(code,{exports:mod,require:()=>{throw new Error("Unexpected dependency");}});

test("Atlas only opens day entries with at least 60 minutes to close",()=>{
  const now=Date.parse("2026-10-08T18:00:00Z");
  assert.equal(mod.atlasDaySession({marketOpen:true,nowMs:now,nextCloseMs:now+61*60_000}).entriesOpen,true);
  assert.equal(mod.atlasDaySession({marketOpen:true,nowMs:now,nextCloseMs:now+59*60_000}).entriesOpen,false);
});

test("Atlas starts forced flatten window 30 minutes before close",()=>{
  const now=Date.parse("2026-10-08T18:00:00Z");
  assert.equal(mod.atlasDaySession({marketOpen:true,nowMs:now,nextCloseMs:now+30*60_000}).flattenDue,true);
  assert.equal(mod.atlasDaySession({marketOpen:true,nowMs:now,nextCloseMs:now+31*60_000}).flattenDue,false);
});

test("Atlas protects winner at +1R and trims 25 percent at +1.75R",()=>{
  const base={averageEntry:100,initialStop:95,currentStop:95,partialCompleted:false,partialFraction:.25};
  const breakEven=mod.atlasDayPositionAction({...base,mark:105});
  assert.equal(breakEven.action,"break-even");
  assert.equal(breakEven.desiredStop,100);
  const partial=mod.atlasDayPositionAction({...base,mark:108.75});
  assert.equal(partial.action,"partial-profit");
  assert.equal(partial.partialFraction,.25);
  assert.equal(partial.desiredStop,100);
});

test("Atlas trails remainder one initial R behind mark after partial",()=>{
  const action=mod.atlasDayPositionAction({
    mark:115,averageEntry:100,initialStop:95,currentStop:100,
    partialCompleted:true,partialFraction:.25,
  });
  assert.equal(action.action,"trail");
  assert.equal(action.desiredStop,110);
});
