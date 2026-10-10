/**
 * STEP-1 OBSERVATION CONTRACT ONLY. No strategy engines or broker routes import
 * this module. These types describe the proposed multi-challenge boundary.
 *
 * Challenge owns capital; bot instance owns state; strategy owns signal logic;
 * allocator (future Step 2+) owns spending rights. Research has NO spend rights.
 */
export const LEGACY_CHALLENGE_ID="legacy-paper-100-v1";
export const FIRST_SHARED_CHALLENGE_ID="shared-paper-v1";
export const TRADING_STRATEGIES=Object.freeze([
  {legacyBotId:"default-diverse",strategyId:"paper-medium-high-v1",codename:"Atlas"},
  {legacyBotId:"penny-volatility-day-100",strategyId:"penny-volatility-day-v1",codename:"Fuse"},
  {legacyBotId:"three-trade-weekly-swing-100",strategyId:"three-trade-weekly-swing-v1",codename:"Harbor"},
  {legacyBotId:"weekend-crypto-day-100",strategyId:"daily-crypto-day-v5",codename:"Flash"},
  {legacyBotId:"momentum-breakout-100",strategyId:"stock-momentum-breakout-v1",codename:"Pulse"},
  {legacyBotId:"crypto-ignition-100",strategyId:"crypto-ignition-v1",codename:"Spark"},
  {legacyBotId:"crypto-swing-100",strategyId:"crypto-swing-v1",codename:"Orbit"},
  {legacyBotId:"squeeze-breakout-100",strategyId:"squeeze-breakout-v1",codename:"Coil"},
] as const);
export type TradingBotId=typeof TRADING_STRATEGIES[number]["legacyBotId"];
export type ResearchContributor="catalog"|"midas";
export type ChallengeParticipant={
  botInstanceId:string;strategyId:string;strategyVersion:number;
  legacyBotId:TradingBotId;role:"trading";
};
export type ChallengeResearch={
  contributorId:ResearchContributor;role:"research";canSubmitOrders:false;
};
export type ChallengeAuditContext={
  challengeId:string;startingCapitalUsd:number;equityUsd:number;
  settledCashUsd:number;reservedCashUsd:number;buyingPowerUsd:number;
  botInstances:ChallengeParticipant[];researchContributors:ChallengeResearch[];
  riskPolicyId:string;brokerAccountRef:string|null;
  mode:"shadow"|"broker-paper";
  // Must be independently established, not inferred from a virtual challenge ID.
  brokerIsolationVerified:false;
};
export const CAPITAL_DEPENDENCIES=Object.freeze([
  {source:"src/lib/paper-trading-config.ts",assumption:"$1,000 virtual program; $100 pools",impact:"legacy display/research",parameter:"challengeId,startingCapitalUsd,participantPoolPolicy",adapter:"legacy-program read model",risk:"low"},
  {source:"src/lib/paper-bot-profiles.ts",assumption:"challengeStartingCash=100 in each profile",impact:"strategy metadata and display fallback",parameter:"challengeId,botInstanceId,capitalSnapshot",adapter:"strategy registry + legacy profile overlay",risk:"medium"},
  {source:"src/app/api/paper-trading/bots/route.ts",assumption:"plan_id=main; fallback 100/1000; grouped by bot_id",impact:"capital reporting and history",parameter:"challengeId,botInstanceId",adapter:"challenge-filtered read endpoint",risk:"high"},
  {source:"src/components/PaperBotLab.tsx",assumption:"program $1,000, per-bot $100 fallbacks",impact:"dashboard and preview sizing",parameter:"selectedChallengeId,botInstanceId,capitalSnapshot",adapter:"read-only scoped UI projection",risk:"medium"},
  {source:"src/lib/paper-shared-capital-manager.ts",assumption:"policy startingEquityUsd=5000; candidate botId only",impact:"advisory sizing and batch dedupe",parameter:"challengeId,botInstanceId,policy,snapshot",adapter:"pure challenge allocator wrapper",risk:"medium"},
  {source:"src/app/api/paper-trading/bots/shared-capital/preview/route.ts",assumption:"unscoped supplied portfolio; fixed global policy",impact:"preview sizing only",parameter:"challengeId,policyId,portfolioSnapshotVersion",adapter:"scenario-scoped authenticated preview",risk:"medium"},
  {source:"src/lib/paper-upcoming-trades.ts",assumption:"single shared policy; botId:symbol dedupe",impact:"read-only upcoming trades",parameter:"challengeId,botInstanceId",adapter:"scope lead selection and snapshot",risk:"medium"},
  {source:"src/app/api/paper-trading/bots/fuse-execute/route.ts",assumption:"isolated ledger bot_id; Fuse equity risk and pilot claim",impact:"broker authorization",parameter:"challengeId,botInstanceId,allocatorGrant",adapter:"future isolated executor with original strategy caps",risk:"critical"},
  {source:"src/app/api/paper-trading/bots/crypto-ignition-execute/route.ts",assumption:"Spark bot ID and ledger budget claim",impact:"broker authorization",parameter:"challengeId,botInstanceId,allocatorGrant",adapter:"future isolated executor with independent stop management",risk:"critical"},
  {source:"src/app/api/paper-trading/bots/atlas-crypto-run/route.ts",assumption:"Atlas bot_id, starting_cash and crypto flags",impact:"execution and risk",parameter:"challengeId,botInstanceId,capitalSnapshot",adapter:"separate strategy evaluation from execution",risk:"critical"},
  {source:"src/app/api/paper-trading/bots/momentum-breakout-execute/route.ts",assumption:"single Pulse virtual ledger",impact:"broker authorization",parameter:"challengeId,botInstanceId,allocatorGrant",adapter:"future broker-isolated submission adapter",risk:"critical"},
  {source:"src/app/api/paper-trading/bots/swing-execute/route.ts",assumption:"one Harbor ledger and physical symbol ownership",impact:"broker authorization",parameter:"challengeId,botInstanceId,allocatorGrant",adapter:"whole/fractional protective order adapter",risk:"critical"},
  {source:"supabase/migrations/20261010010000_paper_shared_preview_atomic_reservations.sql",assumption:"scenario_id exists; SQL 0.5% trade risk and no broker exposure",impact:"preview reservation only",parameter:"challenge policy + broker reconciliation + risk exceptions",adapter:"forward-only policy-aware future RPC migration",risk:"high"},
  {source:"paper_bot_ledgers, paper_bot_positions, paper_bot_journal, paper_bot_broker_orders, paper_bot_broker_fills",assumption:"legacy PK/FK attribution by bot_id, no instance identity",impact:"cash, fills, positions, ownership",parameter:"challengeId,botInstanceId,brokerAccountRef",adapter:"versioned challenge-specific projections / dual-read legacy",risk:"critical"},
  {source:"paper_shared_portfolio_scenarios, paper_shared_capital_decisions, paper_shared_capital_reservations, paper_shared_shadow_studies",assumption:"scenario_id already scopes preview state",impact:"preview capital, decisions and shadow studies",parameter:"scenarioId as challengeId, plus botInstanceId",adapter:"backward-compatible scenario wrapper",risk:"medium"},
  {source:"src/components/PaperTradingLab.tsx, src/components/PaperTradingChartsDashboard.tsx",assumption:"$100 title and fixed challenge fallback",impact:"legacy visual reporting",parameter:"selectedChallengeId",adapter:"label legacy challenge explicitly",risk:"low"},
] as const);
const identity=(s:string)=>/^[a-z0-9][a-z0-9_-]{1,95}$/.test(s);
const cents=(v:number)=>Math.round(v*100)/100;
export function createObservationChallenge(input:Omit<ChallengeAuditContext,"brokerIsolationVerified">):ChallengeAuditContext{
  if(!identity(input.challengeId)||!identity(input.riskPolicyId))throw Error("Invalid challenge ID/policy.");
  if(!Number.isFinite(input.startingCapitalUsd)||input.startingCapitalUsd<=0||
    ![input.equityUsd,input.settledCashUsd,input.reservedCashUsd,input.buyingPowerUsd]
      .every(v=>Number.isFinite(v)&&v>=0))throw Error("Invalid simulated capital.");
  if(input.mode!=="shadow")throw Error("Audit challenge prototypes must be shadow-only.");
  if(input.botInstances.length===0)throw Error("Challenge must include trading participants.");
  const instances=new Set<string>();
  for(const bot of input.botInstances){
    if(!identity(bot.botInstanceId)||instances.has(bot.botInstanceId)||
      !TRADING_STRATEGIES.some(s=>s.legacyBotId===bot.legacyBotId&&s.strategyId===bot.strategyId)||
      !Number.isSafeInteger(bot.strategyVersion)||bot.strategyVersion<=0||bot.role!=="trading")
      throw Error("Invalid or duplicate challenge bot instance.");
    instances.add(bot.botInstanceId);
  }
  const research=new Set<string>();
  for(const contributor of input.researchContributors){
    if(!["catalog","midas"].includes(contributor.contributorId)||
      contributor.role!=="research"||contributor.canSubmitOrders!==false||
      research.has(contributor.contributorId))throw Error("Invalid research contributor.");
    research.add(contributor.contributorId);
  }
  return {...input,brokerIsolationVerified:false};
}
export function plannedObservationLimits(ctx:ChallengeAuditContext,riskPct:number,positionPct:number){
  if(!(riskPct>0&&riskPct<=1&&positionPct>0&&positionPct<=25))
    throw Error("Unsafe preview parameters.");
  return {challengeId:ctx.challengeId,spendAuthorized:false,
    maxRiskUsd:cents(ctx.equityUsd*riskPct/100),
    maxPositionUsd:cents(Math.min(
      Math.max(0,ctx.settledCashUsd-ctx.reservedCashUsd),
      ctx.buyingPowerUsd,
      ctx.equityUsd*positionPct/100)),
  };
}
export function namespacedAuditKey(ctx:ChallengeAuditContext,botInstanceId:string,decisionKey:string){
  if(!ctx.botInstances.some(x=>x.botInstanceId===botInstanceId)||
    !identity(decisionKey))throw Error("Decision key must belong to an instance.");
  return [ctx.challengeId,botInstanceId,decisionKey].map(x=>x.length+":"+x).join("|");
}
export function assessChallengeBrokerIsolation(contexts:readonly ChallengeAuditContext[]){
  const issues:string[]=[];
  const ids=new Set<string>();
  const accounts=new Map<string,string>();
  for(const ctx of contexts){
    if(ids.has(ctx.challengeId))issues.push("Duplicate challenge ID: "+ctx.challengeId);
    ids.add(ctx.challengeId);
    if(ctx.mode==="broker-paper"){
      if(!ctx.brokerAccountRef)issues.push("Broker account binding absent: "+ctx.challengeId);
      else if(accounts.has(ctx.brokerAccountRef))
        issues.push("Physical PAPER account shared across challenges: "+
          accounts.get(ctx.brokerAccountRef)+" and "+ctx.challengeId);
      else accounts.set(ctx.brokerAccountRef,ctx.challengeId);
      if(!ctx.brokerIsolationVerified)
        issues.push("Physical broker isolation unverified: "+ctx.challengeId);
    }
  }
  return {independentShadowAllowed:issues.length===0,
    brokerExecutionAuthorized:false,
    concurrentBrokerExecutionSafe:false,issues};
}
