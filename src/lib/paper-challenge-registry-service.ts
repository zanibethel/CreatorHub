import {createAdminSupabaseClient} from "@/lib/supabase-admin";
import {buildPaperChallengeRegistry,
  type AccountRow,type ChallengeRow,type InstanceRow,type ResearchRow,
  type FundingRow,type PostingRow,type ScenarioRow} from "@/lib/paper-challenge-registry";

/** Shared server-only reader; no auth bypass. Route MUST authorize before calling.
 * All DB access uses service role; never imported by client components.
 */
export async function loadPaperChallengeRegistry(){
 const db=createAdminSupabaseClient();
 const [challenges,accounts,instances,research,funding,postings,scenarios]=await Promise.all([
   db.from("paper_challenges").select(
     "challenge_id,display_name,legacy_scenario_id,policy_id,lifecycle,starting_capital,paper_only,broker_execution_enabled,broker_account_ref").limit(100),
   db.from("paper_challenge_capital_accounts").select(
     "challenge_id,source_kind,source_scenario_id,starting_capital,equity,cash,settled_cash,buying_power,reserved_cash,version,observation_only,broker_execution_enabled").limit(100),
   db.from("paper_challenge_bot_instances").select(
     "challenge_id,bot_instance_id,strategy_id,strategy_version,legacy_source_bot_id,display_name,role,execution_enabled,lifecycle").limit(1000),
   db.from("paper_challenge_research_contributors").select(
     "challenge_id,contributor_id,role,can_submit_orders").limit(200),
   db.from("paper_challenge_funding_events").select(
     "challenge_id,event_key,event_type,amount_delta,posting_state,effective_at").limit(1000),
   db.from("paper_challenge_funding_postings").select(
     "challenge_id,event_key,amount_delta,account_version_before,account_version_after,cash_after,equity_after,paper_only,broker_order_authorized").limit(1000),
   db.from("paper_shared_portfolio_scenarios").select(
     "scenario_id,policy_id,state,initial_equity,equity,cash,settled_cash,buying_power,reserved_cash,paper_only,broker_execution_enabled").limit(100),
 ]);
 const all=[challenges,accounts,instances,research,funding,postings,scenarios];
 if(all.some(x=>x.error||x.data===null)||
   challenges.data!.length>=100||accounts.data!.length>=100||
   instances.data!.length>=1000||research.data!.length>=200||
   funding.data!.length>=1000||postings.data!.length>=1000||scenarios.data!.length>=100)
    throw new Error("Registry evidence unavailable or incomplete.");
 return buildPaperChallengeRegistry({
   observedAt:new Date().toISOString(),challenges:challenges.data as ChallengeRow[],
   accounts:accounts.data as AccountRow[],instances:instances.data as InstanceRow[],
   research:research.data as ResearchRow[],funding:funding.data as FundingRow[],
   linkedScenarios:scenarios.data as ScenarioRow[],
   postings:postings.data as PostingRow[],
 });
}
