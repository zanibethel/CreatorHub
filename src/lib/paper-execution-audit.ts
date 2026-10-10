/**
 * Eight-bot PAPER execution audit. Observation only: no imports from execution
 * routes, no broker mutations, no ledger writes and no shared-capital claims.
 * A configuration label, HTTP 200 or strategy score is NEVER authorization.
 */
import { PAPER_BOT_PROFILES } from "./paper-bot-profiles";

export const PAPER_AUDIT_WINDOW_DAYS = 7;
export const PAPER_AUDIT_IDS = Object.freeze([
  "default-diverse","penny-volatility-day-100","three-trade-weekly-swing-100",
  "weekend-crypto-day-100","momentum-breakout-100","crypto-ignition-100",
  "crypto-swing-100","squeeze-breakout-100",
] as const);
export type AuditReadiness =
  | "PAPER execution operational"
  | "PAPER execution implemented but currently blocked"
  | "PAPER execution partially implemented"
  | "Research-only"
  | "Broken / requires repair";
type Value = string | number | boolean | null;
export type AuditLedger = {
  bot_id:string; strategy_id:string|null;strategy_version:number|null;
  status:string; starting_cash:Value;cash:Value;equity:Value;metadata:Record<string,unknown>|null;
};
export type AuditPerformance = {
  bot_id:string;candidate_checks_7d:Value;broker_buy_orders:Value;
  filled_buy_orders:Value;closed_trades:Value;latest_candidate_at:string|null;
  authorizations_7d:Value;
};
export type AuditCron = {bot_id:string;job_key:string;last_success_at:string|null;
  last_failure_at:string|null;consecutive_failures:number|null};
export type AuditDbPosition = {bot_id:string;symbol:string;quantity:Value;
  protective_stop:Value};
export type AuditDbOrder = {bot_id:string;broker_order_id:string;
  client_order_id:string;symbol:string;side:string;status:string};
export type AuditBrokerOrder = {id:string;client_order_id:string;symbol:string;
  side:string;status:string;type?:string|null;qty?:string|null;
  stop_price?:string|null;submitted_at?:string|null};
export type AuditBrokerPosition = {symbol:string;qty:string};
export type AuditInput = {
  asOf:string;windowStart:string;ledgers:AuditLedger[];performance:AuditPerformance[];
  cron:AuditCron[];virtualPositions:AuditDbPosition[];dbBrokerOrders:AuditDbOrder[];
  brokerOrders:AuditBrokerOrder[]|null;brokerPositions:AuditBrokerPosition[]|null;
  fillsUnapplied: number|null; brokerReadError?:boolean;
};
const numeric=(v:unknown):number|null=>{
  if(v===null||v===undefined||v==="")return null;
  const n=Number(v);return Number.isFinite(n)?n:null;
};
const norm=(s:string)=>s.replace(/[\/\s-]/g,"").toUpperCase();
const isActive=(s:string)=>["new","accepted","pending_new","partially_filled","held","pending_replace"].includes(s);
const knownBotTag=(id:string)=>{
  const m=/^chb-([a-z0-9]{2,12})-v[1-9][0-9]*-/.exec(id);
  return m?m[1]:null;
};
const unique=(items:string[])=>[...new Set(items)];
/** Conservative roll-up of independent, timestamped sources; missing means null. */
export function buildPaperEightBotAudit(i:AuditInput){
  const brokerVerified=Array.isArray(i.brokerOrders)&&Array.isArray(i.brokerPositions)&&!i.brokerReadError;
  const indexedDb=new Set(i.dbBrokerOrders.map(o=>o.broker_order_id));
  const brokerOrders=i.brokerOrders??[];
  const brokerPositions=i.brokerPositions??[];
  const nonBotBrokerOrders=brokerVerified?brokerOrders.filter(o=>
    !indexedDb.has(o.id)&&!(knownBotTag(o.client_order_id)&&
      PAPER_BOT_PROFILES.some(p=>p.brokerTag===knownBotTag(o.client_order_id)))):[];
  const rows=PAPER_AUDIT_IDS.map(botId=>{
    const profile=PAPER_BOT_PROFILES.find(p=>p.id===botId);
    const ledger=i.ledgers.find(r=>r.bot_id===botId);
    const perf=i.performance.find(r=>r.bot_id===botId);
    const jobs=i.cron.filter(j=>j.bot_id===botId);
    const botDbOrders=i.dbBrokerOrders.filter(o=>o.bot_id===botId);
    const tagged=brokerOrders.filter(o=>profile&&knownBotTag(o.client_order_id)===profile.brokerTag);
    const matchedBroker=brokerOrders.filter(o=>botDbOrders.some(v=>v.broker_order_id===o.id));
    const positions=i.virtualPositions.filter(p=>p.bot_id===botId);
    const claimedPilot=botId==="penny-volatility-day-100" &&
      typeof ledger?.metadata?.fusePilotClientOrderId==="string";
    const enabled=ledger?.status==="active"&&ledger.metadata?.executionEnabled===true;
    const permission: "disabled"|"pilot-consumed"|"enabled-not-end-to-end-verified"|"unavailable"=
      !ledger?"unavailable":!enabled?"disabled":claimedPilot?"pilot-consumed":"enabled-not-end-to-end-verified";
    const blockers:string[]=[];
    const warnings:string[]=[];
    if(!ledger)blockers.push("P0: Missing bot ledger.");
    if(!perf)warnings.push("Performance view unavailable: counts remain unknown.");
    if(!brokerVerified)blockers.push("P1: Broker orders/positions could not be independently read.");
    if(jobs.length===0)warnings.push("No per-bot heartbeat recorded (not proof the schedule is absent).");
    if(jobs.some(j=>j.consecutive_failures!==null&&j.consecutive_failures>0))
      blockers.push("P1: Recent cron failure streak requires inspection.");
    const livePositions=positions.map(p=>{
      const broker=brokerPositions.find(b=>norm(b.symbol)===norm(p.symbol));
      const sells=matchedBroker.filter(o=>norm(o.symbol)===norm(p.symbol)&&o.side==="sell"&&
        isActive(o.status)&&["stop","stop_limit","trailing_stop"].includes(o.type??"")&&
        (numeric(o.stop_price)??0)>0);
      const qty=numeric(p.quantity);
      const stop=numeric(p.protective_stop);
      const physicalQty=broker?numeric(broker.qty):null;
      const protectedQty=sells.reduce((total,o)=>total+(numeric(o.qty)??0),0);
      const collision=brokerOrders.some(o=>norm(o.symbol)===norm(p.symbol)&&
        isActive(o.status)&&o.side==="buy"&&!botDbOrders.some(x=>x.broker_order_id===o.id));
      return {symbol:p.symbol,qty,physicalQty,stop,protectedQty,collision,
        verified:brokerVerified&&qty!==null&&physicalQty!==null&&stop!==null&&stop>0&&
          Math.abs(physicalQty-qty)<=Math.max(0.000001,qty*0.0001)&&
          protectedQty+0.000000001>=physicalQty&&!collision};
    });
    if(livePositions.some(p=>!p.verified))
      blockers.push("P0: Current PAPER position protection/ownership/quantity is not independently verified.");
    if(botId==="three-trade-weekly-swing-100")
      blockers.push("P1: Broker rejected SNAP fractional bracket (2026-10-09); execution adapter needs remediation.");
    if(botId==="penny-volatility-day-100"){
      blockers.push("P1: One-shot Fuse pilot is consumed; repeat entries must remain blocked.");
      warnings.push("RXRX partial target sequence had a historical 1.61-second stop-cancellation gap.");
    }
    if(botId==="momentum-breakout-100"&&(numeric(perf?.filled_buy_orders)??0)===0)
      warnings.push("No genuine Pulse filled entry/independent stop/exit lifecycle verified.");
    if(botId==="default-diverse")
      warnings.push("Older Atlas close is not a completed current v4 lifecycle.");
    if(botId==="weekend-crypto-day-100"&&(numeric(perf?.filled_buy_orders)??0)===0)
      warnings.push("No attributable Flash live PAPER fill; candidate volume is not trade proof.");
    if(botId==="crypto-ignition-100")
      warnings.push("Crypto stop-limit may trigger without filling; monitor price/quantity and repair coverage.");
    if(enabled)
      warnings.push("Current quote freshness and complete future-stop recovery are not independently certified by this snapshot.");
    if(nonBotBrokerOrders.some(o=>isActive(o.status)&&positions.some(p=>norm(p.symbol)===norm(o.symbol))))
      blockers.push("P0: Non-bot broker order may overlap this bot's physical symbol.");
    const attribution=brokerVerified&&(tagged.length+matchedBroker.length>0)
      ? tagged.every(o=>indexedDb.has(o.id))&&matchedBroker.every(o=>indexedDb.has(o.id))
      : null;
    if(attribution===false)blockers.push("P1: Bot-tagged order missing from broker attribution journal.");
    const currentStop=livePositions.length>0&&brokerVerified
      ?livePositions.every(p=>p.verified):null;
    // A count of applied fills and matched stops is NOT a cash/fee/position
    // reconciliation. Do not emit true without full account-specific proof.
    const ledgerReconciled= i.fillsUnapplied!==null && i.fillsUnapplied>0
      ? false : livePositions.some(p=>!p.verified)?false:null;
    if(ledger&&botDbOrders.length>0)
      blockers.push("P1: Ledger/broker full reconciliation not independently established.");
    let readiness:AuditReadiness="PAPER execution implemented but currently blocked";
    if(!profile||!ledger)readiness="Broken / requires repair";
    else if(!enabled&&profile.executionState==="research")readiness="Research-only";
    else if(botId==="three-trade-weekly-swing-100")readiness="PAPER execution partially implemented";
    // Historic fills, a broker stop and HTTP-200 crons establish implemented
    // execution, not current quote validity or full failure-recovery proof.
    // No audited source of fresh quote evidence is supplied here: never promote
    // a PAPER route to operational solely from order history.
    const lastSuccessfulJobAt=jobs.map(x=>x.last_success_at).filter((s):s is string=>!!s).sort().at(-1)??null;
    if(permission==="unavailable")blockers.push("P1: Effective execution permission unknown.");
    const missingProposalFields=[
      "decisionKey","quoteTimestamp","quoteSource","expiresAt",
      "concentrationGroup","estimatedSlippageAndFees","maximumEntryPrice",
      "netRewardRisk","marketSessionEligibility",
    ];
    return {
      botId,codename:profile?.codename??null,
      strategyId:ledger?.strategy_id??profile?.strategyId??null,
      strategyVersion:ledger?.strategy_version??null,
      configuredMode:profile?.executionState??null,
      effectiveExecutionPermission:permission,executionReadiness:readiness,
      lastEvaluationAt:perf?.latest_candidate_at??null,lastSuccessfulJobAt,
      candidateCount:numeric(perf?.candidate_checks_7d),
      strategyQualifiedCount:null,readyCount:null,capitalBlockedCount:null,
      submittedOrderCount:brokerVerified?matchedBroker.filter(o=>
        o.submitted_at&&Date.parse(o.submitted_at)>=Date.parse(i.windowStart)&&
        Date.parse(o.submitted_at)<=Date.parse(i.asOf)).length:null,
      filledOrderCount:brokerVerified?matchedBroker.filter(o=>o.status==="filled"&&
        o.submitted_at&&Date.parse(o.submitted_at)>=Date.parse(i.windowStart)&&
        Date.parse(o.submitted_at)<=Date.parse(i.asOf)).length:null,
      openPositionCount:brokerVerified?livePositions.length:null,
      closedTradeCount:numeric(perf?.closed_trades),
      ledgerReconciled,stopProtectionVerified:currentStop,brokerAttributionVerified:attribution,
      sharedCapitalCompatible:false,
      challengePortability:{
        role:"trading" as const,proposedStrategyId:ledger?.strategy_id??profile?.strategyId??null,
        challengeIdSupported:false,botInstanceIdSupported:false,
        externallySuppliedCapitalContextSupported:false,
        brokerAccountIsolationVerified:false,
        missingAdapters:["challenge-scoped strategy evaluation","challenge-scoped proposal",
          "instance-specific journal/ledger","challenge allocator grant",
          "physical PAPER broker account isolation","challenge-scoped exit ownership"],
      },
      blockers:unique(blockers),warnings:unique(warnings),
      evidence:{
        source:"Supabase ledgers/performance/cron/broker journals + independent Alpaca PAPER GET",
        strategyAuthorizationEvents7d:numeric(perf?.authorizations_7d),
        brokerMatchedOrderCount:brokerVerified?matchedBroker.length:null,
        currentVirtualPositionCount:positions.length,
        missingProposalFields,executionEnabledFlag:enabled,oneShotPilotConsumed:claimedPilot,
        brokerEntryOrders:brokerVerified?matchedBroker.filter(o=>o.side==="buy").length:null,
        brokerEntryFills:brokerVerified?matchedBroker.filter(o=>o.side==="buy"&&o.status==="filled").length:null,
        freshQuoteVerified:null,
      },
      recommendedNextActions:readiness==="Research-only"
        ?["Keep research-only; design protection-tested broker adapter during later steps."]
        :blockers.length?["Resolve and independently verify listed safety blockers; do not arm shared execution."]
        :["Collect repeated independent broker lifecycle proof before shared-capital cutover."],
    };
  });
  return {
    version:"paper-execution-audit-v1",paperOnly:true,readOnly:true,
    sharedCapitalExecutionAuthorized:false,
    generatedAt:i.asOf,timezone:"America/Chicago",
    reportingWindow:{from:i.windowStart,to:i.asOf,counts:"rolling-7-days where available"},
    brokerSnapshotVerified:brokerVerified,
    unattributedBrokerOrders:brokerVerified?nonBotBrokerOrders.map(o=>({
      orderId:o.id,clientOrderId:o.client_order_id,symbol:o.symbol,status:o.status,
      needsManualClassification:true,
    })):null,
    unattributedBrokerPositions:brokerVerified?brokerPositions.filter(p=>
      !i.virtualPositions.some(v=>norm(v.symbol)===norm(p.symbol))).map(p=>({
      symbol:p.symbol,qty:p.qty,requiresPhysicalOwnershipReconciliation:true,
    })):null,
    countCaveat:"CandidateCount counts rolling seven-day evaluations, not unique ideas. Order counts use broker submitted_at within the same window but depend on the broker's returned 500-order history. ClosedTradeCount is cumulative. Qualified/ready/capital-only counts are null absent verified per-decision classifications. Ledgers cannot be certified reconciled without fees and all physical-account fills.",
    bots:rows,
  };
}
