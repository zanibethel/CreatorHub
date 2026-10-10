import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const sql=readFileSync(new URL("../supabase/migrations/20261010040000_paper_shadow_challenge_lifecycle_v1.sql",import.meta.url),"utf8");
const route=readFileSync(new URL("../src/app/api/paper-trading/bots/challenges/manage/route.ts",import.meta.url),"utf8");
const get=readFileSync(new URL("../src/app/api/paper-trading/bots/challenges/route.ts",import.meta.url),"utf8");
const code=readFileSync(new URL("../src/lib/paper-challenge-registry.ts",import.meta.url),"utf8");
const exp={};
vm.runInNewContext(ts.transpileModule(code,{compilerOptions:{
  target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,
}}).outputText,{exports:exp,Number,Math,Set,Map});
const fixture=()=>({
  observedAt:"2026-10-10T02:35:00Z",
  challenges:[{challenge_id:"spark-shadow",display_name:"Spark trial",
    legacy_scenario_id:null,policy_id:"shared-paper-capital-v1",
    starting_capital:500,broker_execution_enabled:false,paper_only:true,
    broker_account_ref:null,lifecycle:"preview"}],
  accounts:[{challenge_id:"spark-shadow",source_kind:"standalone-shadow",source_scenario_id:null,
    starting_capital:500,cash:500,settled_cash:500,buying_power:500,equity:500,reserved_cash:0,
    version:1,observation_only:true,broker_execution_enabled:false}],
  instances:[{challenge_id:"spark-shadow",bot_instance_id:"spark-01",
    strategy_id:"crypto-ignition-v1",strategy_version:1,legacy_source_bot_id:"crypto-ignition-100",
    display_name:"Spark",role:"trading",lifecycle:"preview",execution_enabled:false}],
  research:[],funding:[],postings:[],linkedScenarios:[],
});
test("Step 4 creates privately callable, service-only atomic RPC functions",()=>{
  for(const fn of ["paper_challenge_create_shadow","paper_challenge_configure_shadow",
    "paper_challenge_post_shadow_funding"]){
    assert.match(sql,new RegExp("CREATE OR REPLACE FUNCTION public\\."+fn));
    assert.match(sql,new RegExp("REVOKE ALL ON FUNCTION public\\."+fn));
    assert.match(sql,new RegExp("GRANT EXECUTE ON FUNCTION public\\."+fn));
  }
  assert.match(sql,/CREATE SCHEMA IF NOT EXISTS bigorders_private/);
  assert.match(sql,/SECURITY INVOKER SET search_path=''/);
  assert.match(sql,/REVOKE ALL ON SCHEMA bigorders_private FROM PUBLIC,anon,authenticated/);
  assert.doesNotMatch(sql,/SECURITY DEFINER/);
  assert.doesNotMatch(sql,/ALPACA|paper-api\.alpaca/);
  assert.doesNotMatch(sql,/UPDATE public\.paper_bot_ledgers/);
  assert.doesNotMatch(sql,/UPDATE public\.paper_shared_portfolio_scenarios/);
});
test("Step 4 never creates an executing broker challenge",()=>{
  assert.match(sql,/v_c\.broker_execution_enabled/);
  assert.match(sql,/v_a\.broker_execution_enabled/);
  assert.match(sql,/brokerOrderAuthorized',false/);
  assert.match(sql,/source_kind<>'standalone-shadow'/);
  assert.match(sql,/legacy_scenario_id IS NOT NULL/);
  assert.match(sql,/broker_account_ref/);
  assert.doesNotMatch(route,/ALPACA_API_KEY_ID|ALPACA_API_SECRET_KEY/);
  assert.match(route,/X-Paper-Execution/);
  assert.match(route,/CRON_SECRET/);
});
test("cannot duplicate physical scenario or legacy challenge capital",()=>{
  assert.match(sql,/shared-paper-v1/);
  assert.match(sql,/legacy-paper-100-v1/);
  assert.match(sql,/Cannot duplicate or replace an existing scenario/);
  assert.match(route,/Existing\/legacy scenario management/);
});
test("multiple Spark strategy instances may independently exist in one shadow challenge",()=>{
  assert.match(sql,/jsonb_array_length\(p_bots\) NOT BETWEEN 1 AND 16/);
  assert.match(sql,/botInstanceId/);
  assert.match(sql,/PRIMARY KEY/);
  assert.match(sql,/INSERT INTO public.paper_challenge_bot_instances/);
});
test("funding records and immutable postings reconcile without double counting",()=>{
  const input=fixture();
  input.accounts[0].cash=575;
  input.accounts[0].settled_cash=575;
  input.accounts[0].buying_power=575;
  input.accounts[0].equity=575;
  input.accounts[0].version=2;
  input.funding.push({challenge_id:"spark-shadow",event_key:"deposit-001",
    event_type:"deposit",amount_delta:75,posting_state:"recorded-unposted",
    effective_at:"2026-10-10T02:30:00Z"});
  input.postings.push({challenge_id:"spark-shadow",event_key:"deposit-001",
    amount_delta:75,account_version_before:1,account_version_after:2,
    cash_after:575,equity_after:575,paper_only:true,broker_order_authorized:false});
  const output=exp.buildPaperChallengeRegistry(input).challenges[0];
  assert.equal(output.postedFundingEventCount,1);
  assert.equal(output.unpostedFundingEventCount,0);
  assert.equal(output.capital.cashUsd,575);
  assert.equal(output.capitalAccountVersion,2);
  assert.equal(output.blockers.length,0);
  assert.equal(output.brokerOrderAuthorized,false);
});
test("unposted deposit never increases the reported shadow balance",()=>{
  const s=fixture();
  s.funding.push({challenge_id:"spark-shadow",event_key:"pending-001",event_type:"deposit",
    amount_delta:75,posting_state:"recorded-unposted",effective_at:"2026-10-10T02:30:00Z"});
  const r=exp.buildPaperChallengeRegistry(s).challenges[0];
  assert.equal(r.capital.equityUsd,500);
  assert.equal(r.postedFundingEventCount,0);
  assert.equal(r.unpostedFundingEventCount,1);
});
test("mismatched posted virtual amount or broken ledger balance is rejected",()=>{
  const s=fixture();
  s.accounts[0].cash=570;
  s.postings.push({challenge_id:"spark-shadow",event_key:"deposit-001",amount_delta:75,
    account_version_before:1,account_version_after:2,cash_after:575,equity_after:575,
    paper_only:true,broker_order_authorized:false});
  const r=exp.buildPaperChallengeRegistry(s).challenges[0];
  assert.ok(r.blockers.some(x=>x.includes("lacks matching")));
  assert.ok(r.blockers.some(x=>x.includes("opening capital")));
});
test("protected API only invokes atomic shadow RPCs",()=>{
  assert.match(route,/z\.discriminatedUnion/);
  assert.match(route,/paper_challenge_create_shadow/);
  assert.match(route,/paper_challenge_configure_shadow/);
  assert.match(route,/paper_challenge_post_shadow_funding/);
  assert.match(route,/input\.challengeId==="shared-paper-v1"/);
  assert.doesNotMatch(route,/\.from\(/);
  assert.doesNotMatch(route,/export async function GET/);
  assert.match(get,/paper_challenge_funding_postings/);
});
test("posting is idempotent, version checked, and cannot overdraw",()=>{
  assert.match(sql,/Idempotent retry returns the original receipt/);
  assert.match(sql,/Stale challenge capital account version/);
  assert.match(sql,/Insufficient shadow balance for withdrawal/);
  assert.match(sql,/paper_challenge_postings_immutable/);
  assert.match(sql,/PRIMARY KEY\(challenge_id,event_key\)/);
  assert.match(sql,/GRANT SELECT,INSERT ON public\.paper_challenge_funding_postings TO service_role/);
});
