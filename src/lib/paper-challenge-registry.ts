/** Challenge-owned PAPER persistence read model (Step 3).
 * No writes, no broker calls, no funding event application.
 * A linked scenario's live capital is authoritative; its copied snapshot must
 * NEVER be summed with the legacy scenario or the legacy bot ledgers.
 */
export type ChallengeRow={
  challenge_id:string;display_name:string;legacy_scenario_id:string|null;
  policy_id:string;lifecycle:string;starting_capital:number|string;
  paper_only:boolean;broker_execution_enabled:boolean;broker_account_ref:string|null;
};
export type AccountRow={
  challenge_id:string;source_kind:"linked-scenario-mirror"|"standalone-shadow";
  source_scenario_id:string|null;starting_capital:number|string;equity:number|string;
  cash:number|string;settled_cash:number|string;buying_power:number|string;
  reserved_cash:number|string;observation_only:boolean;broker_execution_enabled:boolean;
};
export type InstanceRow={
  challenge_id:string;bot_instance_id:string;strategy_id:string;strategy_version:number;
  legacy_source_bot_id:string|null;display_name:string;role:string;execution_enabled:boolean;
  lifecycle:string;
};
export type ResearchRow={
  challenge_id:string;contributor_id:string;role:string;can_submit_orders:boolean;
};
export type FundingRow={
  challenge_id:string;event_key:string;event_type:string;amount_delta:number|string;
  posting_state:string;effective_at:string;
};
export type ScenarioRow={
  scenario_id:string;policy_id:string;state:string;initial_equity:number|string;
  equity:number|string;cash:number|string;settled_cash:number|string;
  buying_power:number|string;reserved_cash:number|string;paper_only:boolean;
  broker_execution_enabled:boolean;
};
export type RegistrySnapshot={
  observedAt:string;challenges:ChallengeRow[];accounts:AccountRow[];
  instances:InstanceRow[];research:ResearchRow[];funding:FundingRow[];
  linkedScenarios:ScenarioRow[];
};
const numeric=(v:unknown):number|null=>{
  if(v===null||v===undefined||v==="")return null;
  const n=Number(v);return Number.isFinite(n)?n:null;
};
const near=(a:number|null,b:number|null)=>
  a!==null&&b!==null&&Math.abs(a-b)<=0.000001;
const unique=(a:string[])=>[...new Set(a)];
export function buildPaperChallengeRegistry(snapshot:RegistrySnapshot){
  const reports=snapshot.challenges.map(challenge=>{
    const blockers:string[]=[];
    const warnings:string[]=[];
    const accounts=snapshot.accounts.filter(a=>a.challenge_id===challenge.challenge_id);
    const account=accounts.length===1?accounts[0]:null;
    const participants=snapshot.instances.filter(x=>x.challenge_id===challenge.challenge_id);
    const researchers=snapshot.research.filter(x=>x.challenge_id===challenge.challenge_id);
    const funding=snapshot.funding.filter(x=>x.challenge_id===challenge.challenge_id);
    const linked=challenge.legacy_scenario_id?
      snapshot.linkedScenarios.find(x=>x.scenario_id===challenge.legacy_scenario_id):null;
    if(!account)blockers.push("Missing or duplicated challenge capital-account snapshot.");
    if(!challenge.paper_only||challenge.broker_execution_enabled||challenge.broker_account_ref)
      blockers.push("Challenge broker execution is not demonstrably disabled.");
    if(account&&(!account.observation_only||account.broker_execution_enabled))
      blockers.push("Challenge capital account is not marked observation-only.");
    if(challenge.legacy_scenario_id&&(!linked||account?.source_kind!=="linked-scenario-mirror"||
      account.source_scenario_id!==challenge.legacy_scenario_id))
      blockers.push("Linked scenario or mirror identity missing/mismatched.");
    if(linked&&(!linked.paper_only||linked.broker_execution_enabled))
      blockers.push("Linked scenario could execute broker orders.");
    if(linked&&!near(numeric(linked.initial_equity),numeric(challenge.starting_capital)))
      blockers.push("Challenge starting capital differs from immutable linked scenario baseline.");
    if(!near(numeric(challenge.starting_capital),numeric(account?.starting_capital)))
      blockers.push("Challenge capital account opening balance differs.");
    if(linked&&account){
      for(const key of ["equity","cash","settled_cash","buying_power","reserved_cash"] as const){
        if(!near(numeric(account[key]),numeric(linked[key])))
          warnings.push("Challenge mirror is stale: "+key+"; linked scenario remains authoritative.");
      }
    }
    const hasDuplicateInstances=participants.length!==
      new Set(participants.map(x=>x.bot_instance_id)).size;
    if(!participants.length||hasDuplicateInstances)
      blockers.push("Missing or duplicate challenge bot-instance registry.");
    if(participants.some(x=>x.role!=="trading"||x.execution_enabled||
      x.strategy_version<=0||!x.strategy_id.trim()))
      blockers.push("A trading instance has invalid identity or execution flag.");
    if(researchers.some(x=>x.role!=="research"||x.can_submit_orders||
      !["catalog","midas"].includes(x.contributor_id)))
      blockers.push("Research contributor must not have order permissions.");
    if(funding.some(x=>x.posting_state!=="recorded-unposted"))
      blockers.push("Funding applied without verified ledger posting evidence.");
    if(funding.length)
      warnings.push("Recorded funding changes remain unposted; exclude them from available capital.");
    if(challenge.legacy_scenario_id&&snapshot.challenges.some(c=>c.challenge_id!==challenge.challenge_id&&
      c.legacy_scenario_id===challenge.legacy_scenario_id))
      blockers.push("Two challenges reference one authoritative legacy capital scenario.");
    const capital=linked??account;
    const fundingPending=funding.length;
    return {
      challengeId:challenge.challenge_id,
      displayName:challenge.display_name,
      lifecycle:challenge.lifecycle,policyId:challenge.policy_id,
      startingCapitalUsd:numeric(challenge.starting_capital),
      capitalSource:linked?"legacy-scenario-authoritative":account?.source_kind??"unavailable",
      capital:{
        equityUsd:numeric(capital?.equity),cashUsd:numeric(capital?.cash),
        settledCashUsd:numeric(capital?.settled_cash),
        buyingPowerUsd:numeric(capital?.buying_power),
        reservedCashUsd:numeric(capital?.reserved_cash),
      },
      participantCount:participants.length,
      participants:participants.map(x=>({
        botInstanceId:x.bot_instance_id,strategyId:x.strategy_id,
        strategyVersion:x.strategy_version,legacySourceBotId:x.legacy_source_bot_id,
        executionEnabled:x.execution_enabled,
      })),
      researchContributors:researchers.map(x=>({
        contributorId:x.contributor_id,role:x.role,canSubmitOrders:x.can_submit_orders,
      })),
      unpostedFundingEventCount:fundingPending,
      paperOnly:true as const,brokerOrderAuthorized:false as const,
      challengeExecutionPermitted:false as const,
      brokerIsolationVerified:false as const,
      blockers:unique(blockers),warnings:unique(warnings),
    };
  });
  return {version:"paper-challenge-registry-v1",observedAt:snapshot.observedAt,
    observationOnly:true as const,paperOnly:true as const,
    capitalNotDuplicated:true as const,brokerExecutionPermitted:false as const,
    challenges:reports,
  };
}
