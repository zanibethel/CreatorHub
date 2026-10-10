import {NextResponse} from "next/server";
import {createAdminSupabaseClient} from "@/lib/supabase-admin";
import {buildPaperChallengeRegistry,
  type AccountRow,type ChallengeRow,type InstanceRow,type ResearchRow,
  type FundingRow,type ScenarioRow} from "@/lib/paper-challenge-registry";
export const dynamic="force-dynamic";
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{
  "Cache-Control":"no-store","X-Paper-Execution":"disabled",
}});
const allowed=(request:Request)=>{
  const secret=process.env.CRON_SECRET?.trim()??"";
  return secret.length>=32&&request.headers.get("authorization")===`Bearer ${secret}`;
};
/** Internal read-only registry, always returns effective linked capital without
 * adding mirrored ledgers or unposted funding events to the scenario's cash.
 * No anonymous/public access, funding writers, or broker interactions.
 */
export async function GET(request:Request){
  if(!allowed(request))return reply({error:"Unauthorized."},401);
  if(!process.env.SUPABASE_SECRET_KEY)return reply({error:"Registry unavailable."},503);
  try{
    const db=createAdminSupabaseClient();
    const [challenges,accounts,instances,research,funding,scenarios]=await Promise.all([
      db.from("paper_challenges").select(
        "challenge_id,display_name,legacy_scenario_id,policy_id,lifecycle,starting_capital,paper_only,broker_execution_enabled,broker_account_ref").limit(100),
      db.from("paper_challenge_capital_accounts").select(
        "challenge_id,source_kind,source_scenario_id,starting_capital,equity,cash,settled_cash,buying_power,reserved_cash,observation_only,broker_execution_enabled").limit(100),
      db.from("paper_challenge_bot_instances").select(
        "challenge_id,bot_instance_id,strategy_id,strategy_version,legacy_source_bot_id,display_name,role,execution_enabled,lifecycle").limit(1000),
      db.from("paper_challenge_research_contributors").select(
        "challenge_id,contributor_id,role,can_submit_orders").limit(200),
      db.from("paper_challenge_funding_events").select(
        "challenge_id,event_key,event_type,amount_delta,posting_state,effective_at").limit(1000),
      db.from("paper_shared_portfolio_scenarios").select(
        "scenario_id,policy_id,state,initial_equity,equity,cash,settled_cash,buying_power,reserved_cash,paper_only,broker_execution_enabled").limit(100),
    ]);
    const responses=[challenges,accounts,instances,research,funding,scenarios];
    if(responses.some(x=>x.error||x.data===null)||
      challenges.data!.length>=100||accounts.data!.length>=100||
      instances.data!.length>=1000||research.data!.length>=200||
      funding.data!.length>=1000||scenarios.data!.length>=100)
      return reply({error:"Registry evidence unavailable or incomplete. No report certified."},503);
    return reply(buildPaperChallengeRegistry({
      observedAt:new Date().toISOString(),challenges:challenges.data as ChallengeRow[],
      accounts:accounts.data as AccountRow[],instances:instances.data as InstanceRow[],
      research:research.data as ResearchRow[],funding:funding.data as FundingRow[],
      linkedScenarios:scenarios.data as ScenarioRow[],
    }));
  }catch{
    return reply({error:"Read-only registry retrieval failed."},503);
  }
}
