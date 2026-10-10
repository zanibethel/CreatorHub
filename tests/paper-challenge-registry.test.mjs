import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const source=readFileSync(new URL("../src/lib/paper-challenge-registry.ts",import.meta.url),"utf8");
const output={};
vm.runInNewContext(ts.transpileModule(source,{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},
}).outputText,{exports:output,Set,Map});
const build=output.buildPaperChallengeRegistry;
const challenge=(id,capital,scenario=null)=>({
  challenge_id:id,display_name:id,legacy_scenario_id:scenario,
  policy_id:"shared-paper-capital-v1",lifecycle:"preview",
  starting_capital:capital,paper_only:true,broker_execution_enabled:false,
  broker_account_ref:null,
});
const account=(id,capital,scenario=null)=>({
  challenge_id:id,source_kind:scenario?"linked-scenario-mirror":"standalone-shadow",
  source_scenario_id:scenario,starting_capital:capital,equity:capital,cash:capital,
  settled_cash:capital,buying_power:capital,reserved_cash:0,
  observation_only:true,broker_execution_enabled:false,
});
const bot=(id,botInstanceId,strategyId)=>({
 challenge_id:id,bot_instance_id:botInstanceId,strategy_id:strategyId,
 strategy_version:1,legacy_source_bot_id:"default-diverse",display_name:botInstanceId,
 role:"trading",execution_enabled:false,lifecycle:"preview",
});
const snapshot=()=>({
 observedAt:"2026-10-10T02:00:00Z",
 challenges:[challenge("shared-paper-v1",5000,"shared-paper-v1")],
 accounts:[account("shared-paper-v1",5000,"shared-paper-v1")],
 instances:[bot("shared-paper-v1","atlas-01","paper-medium-high-v1")],
 research:[],funding:[],
 linkedScenarios:[{
  scenario_id:"shared-paper-v1",policy_id:"shared-paper-capital-v1",state:"preview",
  initial_equity:5000,equity:5000,cash:5000,settled_cash:5000,
  buying_power:5000,reserved_cash:0,paper_only:true,broker_execution_enabled:false,
 }],
});
test("linked $5000 challenge uses authoritative scenario exactly once",()=>{
 const r=build(snapshot());
 assert.equal(r.challenges.length,1);
 assert.equal(r.challenges[0].capitalSource,"legacy-scenario-authoritative");
 assert.equal(r.challenges[0].capital.equityUsd,5000);
 assert.equal(r.challenges[0].startingCapitalUsd,5000);
 assert.equal(r.capitalNotDuplicated,true);
 assert.equal(r.brokerExecutionPermitted,false);
 assert.equal(r.challenges[0].blockers.length,0);
});
test("standalone $500 and linked $5000 capital stay separated",()=>{
 const s=snapshot();
 s.challenges.push(challenge("fuse-vs-pulse",500));
 s.accounts.push(account("fuse-vs-pulse",500));
 s.instances.push(bot("fuse-vs-pulse","fuse-01","penny-volatility-day-v1"));
 const r=build(s),a=r.challenges[0],b=r.challenges[1];
 assert.equal(a.capital.equityUsd,5000);
 assert.equal(b.capital.equityUsd,500);
 assert.equal(b.participants[0].botInstanceId,"fuse-01");
 assert.equal(b.capitalSource,"standalone-shadow");
 assert.equal(a.brokerOrderAuthorized,false);
 assert.equal(b.brokerOrderAuthorized,false);
});
test("same bot instance id can participate independently in two different challenges",()=>{
 const s=snapshot();
 s.challenges.push(challenge("spark-intelligence",500));
 s.accounts.push(account("spark-intelligence",500));
 s.instances.push(bot("spark-intelligence","atlas-01","paper-medium-high-v1"));
 const r=build(s);
 assert.equal(r.challenges[0].participants[0].botInstanceId,"atlas-01");
 assert.equal(r.challenges[1].participants[0].botInstanceId,"atlas-01");
 assert.equal(r.challenges[1].blockers.length,0);
});
test("same historical scenario cannot authorize two independent challenge capital ledgers",()=>{
 const s=snapshot();
 s.challenges.push(challenge("duplicate-shadow",5000,"shared-paper-v1"));
 s.accounts.push(account("duplicate-shadow",5000,"shared-paper-v1"));
 s.instances.push(bot("duplicate-shadow","atlas-02","paper-medium-high-v1"));
 const r=build(s);
 assert.ok(r.challenges[0].blockers.some(x=>x.includes("Two challenges")));
 assert.ok(r.challenges[1].blockers.some(x=>x.includes("Two challenges")));
});
test("stale mirrored $5K cash is not used for authoritative sizing",()=>{
 const s=snapshot();s.accounts[0].cash=4999;
 const r=build(s).challenges[0];
 assert.equal(r.capital.cashUsd,5000);
 assert.ok(r.warnings.some(x=>x.includes("stale: cash")));
});
test("unposted funding events never silently increase available cash",()=>{
 const s=snapshot();s.funding.push({
  challenge_id:"shared-paper-v1",event_key:"future-credit",
  event_type:"deposit",amount_delta:100,effective_at:"2026-10-11T00:00:00Z",
  posting_state:"recorded-unposted",
 });
 const r=build(s).challenges[0];
 assert.equal(r.capital.cashUsd,5000);
 assert.equal(r.unpostedFundingEventCount,1);
 assert.ok(r.warnings.some(x=>x.includes("unposted")));
});
test("research Catalog and Midas never grant order rights",()=>{
 const s=snapshot();s.research.push({
  challenge_id:"shared-paper-v1",contributor_id:"catalog",role:"research",can_submit_orders:false,
 });
 const r=build(s).challenges[0];
 assert.equal(r.researchContributors[0].canSubmitOrders,false);
 assert.equal(r.brokerOrderAuthorized,false);
 s.research[0].can_submit_orders=true;
 assert.ok(build(s).challenges[0].blockers.some(x=>x.includes("Research")));
});
test("execution flag or missing instance fails closed",()=>{
 const s=snapshot();s.instances[0].execution_enabled=true;
 assert.ok(build(s).challenges[0].blockers.some(x=>x.includes("execution flag")));
 s.instances=[];s.challenges[0].broker_execution_enabled=true;
 assert.ok(build(s).challenges[0].blockers.length>=2);
});
test("read-only account reconciliation does not mutate input records",()=>{
 const s=snapshot(),before=JSON.stringify(s);
 build(s);build(s);
 assert.equal(JSON.stringify(s),before);
});
test("migration has six RLS-denied tables, cannot enable PAPER brokers, and preserves legacy ledgers",()=>{
 const sql=readFileSync(new URL("../supabase/migrations/20261010030000_paper_challenge_registry_shadow_v1.sql",import.meta.url),"utf8");
 for(const table of ["paper_challenges","paper_challenge_bot_instances","paper_challenge_research_contributors",
    "paper_challenge_capital_accounts","paper_challenge_funding_events","paper_challenge_proposal_journal"]){
  assert.match(sql,new RegExp("ALTER TABLE public\\."+table+" ENABLE ROW LEVEL SECURITY"));
 }
 assert.match(sql,/broker_execution_enabled=false/);
 assert.match(sql,/paper_challenge_funding_immutable/);
 assert.match(sql,/paper_challenge_proposal_immutable/);
 assert.match(sql,/ON CONFLICT \(challenge_id\) DO NOTHING/);
 assert.doesNotMatch(sql,/UPDATE public\.paper_bot_ledgers|DELETE FROM public\.paper_bot_ledgers/);
 assert.doesNotMatch(sql,/paper_shared_preview_claim\(/);
 assert.match(sql,/REVOKE ALL ON TABLE/);
});
test("API is secret protected, read-only, and does not count mirrors as money",()=>{
 const route=readFileSync(new URL("../src/app/api/paper-trading/bots/challenges/route.ts",import.meta.url),"utf8");
 assert.match(route,/CRON_SECRET/);
 const service=readFileSync(new URL("../src/lib/paper-challenge-registry-service.ts",import.meta.url),"utf8");
 assert.match(route+service,/brokerOrderAuthorized|brokerExecutionPermitted|buildPaperChallengeRegistry/);
 assert.doesNotMatch(route,/export async function POST|export async function PATCH|export async function DELETE/);
 assert.doesNotMatch(route,/ALPACA_API_KEY_ID|paper_shared_preview_claim/);
});
