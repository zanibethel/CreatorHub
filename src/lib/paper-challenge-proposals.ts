/**
 * BigOrders Step 2: normalized, CHALLENGE-SCOPED PAPER TRADE OBSERVATIONS.
 * Pure and read-only. No Supabase, brokerage calls, execution switches, claims,
 * order intents, or side effects. A normalized proposal is NOT a spend grant.
 *
 * Concrete source types are the existing evaluator returns; a scanner score
 * alone never means strategy approval. Source values from a $100 legacy ledger
 * are historical references and cannot confer capital authority on a new
 * challenge. Prices/timestamps and policy evidence remain explicitly scoped.
 */
import {TRADING_STRATEGIES,namespacedAuditKey,type ChallengeAuditContext,type TradingBotId} from "./paper-challenge-portability-audit";
import {PAPER_SHARED_CAPITAL_POLICY_V1 as POLICY} from "./paper-shared-capital-manager";
import {PAPER_STRATEGY_V1} from "./paper-strategy-config";
import {FUSE_PENNY_STRATEGY_V1} from "./paper-fuse-strategy-config";
import {THREE_TRADE_SWING_STRATEGY_V1} from "./paper-swing-strategy-config";
import {ACTIVE_DAILY_CRYPTO_DAY_STRATEGY} from "./paper-weekend-crypto-strategy-config";
import {MOMENTUM_BREAKOUT_STRATEGY_V1} from "./paper-momentum-breakout-strategy-config";
import {CRYPTO_IGNITION_STRATEGY_V1} from "./paper-crypto-ignition-strategy-config";
import {CRYPTO_SWING_STRATEGY_V1} from "./paper-crypto-swing-strategy-config";
import {SQUEEZE_BREAKOUT_STRATEGY_V1} from "./paper-squeeze-breakout-strategy-config";
import type {PaperBotTradePlan} from "./paper-bot-trade-plan";
import type {FuseReadiness} from "./paper-fuse-readiness";
import type {SwingPreparedPlan,SwingPlanReadiness} from "./paper-swing-revalidation";
import type {WeekendCryptoCandidate} from "./paper-weekend-crypto-readiness";
import type {evaluateMomentumBreakoutCandidate} from "./paper-momentum-breakout-readiness";
import type {evaluateCryptoIgnitionCandidate} from "./paper-crypto-ignition-readiness";

export const CHALLENGE_PROPOSAL_VERSION=2 as const;
export type AssetClass="stock"|"etf"|"crypto";
export type SourcePlan =
 | {botId:"default-diverse";adapter:"atlas";plan:PaperBotTradePlan;maxEntryPrice:number|null}
 | {botId:"penny-volatility-day-100";adapter:"fuse";result:FuseReadiness}
 | {botId:"three-trade-weekly-swing-100";adapter:"harbor";plan:SwingPreparedPlan;result:SwingPlanReadiness;targetPrice:number|null}
 | {botId:"weekend-crypto-day-100";adapter:"flash";result:WeekendCryptoCandidate}
 | {botId:"momentum-breakout-100";adapter:"pulse";result:ReturnType<typeof evaluateMomentumBreakoutCandidate>}
 | {botId:"crypto-ignition-100";adapter:"spark";result:ReturnType<typeof evaluateCryptoIgnitionCandidate>}
 | {botId:"crypto-swing-100";adapter:"orbit";plan:PaperBotTradePlan;maximumEntryPrice:number|null}
 | {botId:"squeeze-breakout-100";adapter:"coil";plan:PaperBotTradePlan;maximumEntryPrice:number|null};

export type Provenance={
  sourceRecordKey:string;
  sourceObservedAt:string;
  quoteTimestamp:string|null;
  quoteSource:string|null;
  completedCandleTimestamp:string|null;
  sourceEvidenceIds:string[];
  /** Caller-provided evidence; unknown is NOT a pass. */
  marketSessionEligible:boolean|null;
  spreadPct:number|null;
  /** Explicit combined fees + slippage + spread round-trip estimate. */
  roundTripCostPct:number|null;
  concentrationGroup:string|null;
  expiresAt:string|null;
  researchEvidence:readonly {contributorId:"catalog"|"midas";evidenceId:string;observedAt:string}[];
};
export type ChallengeProposalInput={
  challenge:ChallengeAuditContext;
  botInstanceId:string;
  source:SourcePlan;
  evidence:Provenance;
  observedAt:string;
  /** Read-only attestations; no physical broker ownership is implied. */
  currentSymbols:readonly string[]|null;
  pendingSymbols:readonly string[]|null;
  riskBreakersClear:boolean|null;
  /** Can only tighten, never increase, policy/strategy caps. */
  requestedMaximumRiskPct?:number|null;
  requestedMaximumPositionPct?:number|null;
  fractionalStockEligibilityVerified?:boolean;
};
export type ChallengeProposal={
  contractVersion:2;paperOnly:true;brokerOrderAuthorized:false;
  challengeId:string;botInstanceId:string;botId:TradingBotId;
  strategyId:string;strategyVersion:number;decisionKey:string;
  sourceAdapter:SourcePlan["adapter"];sourceRecordKey:string;
  symbol:string;assetClass:AssetClass|"unknown";
  strategyApproved:boolean;qualifiedByStrategy:boolean;
  observationState:"reference"|"qualified-observation"|"blocked"|"insufficient-evidence";
  entryPrice:number|null;maximumEntryPrice:number|null;
  protectiveStop:number|null;finalTargetPrice:number|null;
  partialTargets:readonly {price:number;fraction:number|null}[];
  requestedQuantity:number|null;requestedNotionalUsd:number|null;
  plannedDollarLoss:number|null;estimatedRoundTripCostsUsd:number|null;
  expectedNetRewardRisk:number|null;
  evidence:Provenance;observedAt:string;
  quoteFresh:boolean;sessionEligible:boolean|null;
  blockers:string[];warnings:string[];
  sizingBasis:"challenge-observation-only";brokerIsolationVerified:false;
  sharedCapitalCompatible:false;
};
const positive=(n:unknown):n is number=>typeof n==="number"&&Number.isFinite(n)&&n>0;
const num=(n:unknown):number|null=>positive(n)?n:null;
const validTime=(s:string|null):number|null=>{
  if(!s)return null;const d=Date.parse(s);return Number.isFinite(d)?d:null;
};
const norm=(s:string)=>s.replace(/[\\/\s-]/g,"").toUpperCase();
const uniq=(a:string[])=>[...new Set(a)];
const floor=(x:number,precision:number)=>Math.floor((x+Number.EPSILON)*precision)/precision;
const rounded=(x:number)=>Number(x.toFixed(8));
const strategyRules:Record<TradingBotId,{id:string;version:number;riskPct:number;positionPct:number;minNotional:number;marketAgeMs:number}>={
  "default-diverse":{id:PAPER_STRATEGY_V1.id,version:PAPER_STRATEGY_V1.version,riskPct:PAPER_STRATEGY_V1.risk.standardRiskPct,positionPct:20,minNotional:1,marketAgeMs:PAPER_STRATEGY_V1.marketData.maxQuoteAgeMs},
  "penny-volatility-day-100":{id:FUSE_PENNY_STRATEGY_V1.id,version:FUSE_PENNY_STRATEGY_V1.version,riskPct:FUSE_PENNY_STRATEGY_V1.risk.riskPerTradePct,positionPct:FUSE_PENNY_STRATEGY_V1.risk.maximumAllocationPct,minNotional:1,marketAgeMs:FUSE_PENNY_STRATEGY_V1.market.maximumQuoteAgeSeconds*1000},
  "three-trade-weekly-swing-100":{id:THREE_TRADE_SWING_STRATEGY_V1.id,version:THREE_TRADE_SWING_STRATEGY_V1.version,riskPct:THREE_TRADE_SWING_STRATEGY_V1.risk.riskPerTradePct,positionPct:THREE_TRADE_SWING_STRATEGY_V1.risk.maximumPositionAllocationPct,minNotional:1,marketAgeMs:THREE_TRADE_SWING_STRATEGY_V1.execution.maximumQuoteAgeSeconds*1000},
  "weekend-crypto-day-100":{id:ACTIVE_DAILY_CRYPTO_DAY_STRATEGY.id,version:ACTIVE_DAILY_CRYPTO_DAY_STRATEGY.version,riskPct:ACTIVE_DAILY_CRYPTO_DAY_STRATEGY.risk.riskPerTradePct,positionPct:ACTIVE_DAILY_CRYPTO_DAY_STRATEGY.risk.maximumPositionAllocationPct,minNotional:ACTIVE_DAILY_CRYPTO_DAY_STRATEGY.execution.minimumOrderNotionalUsd,marketAgeMs:ACTIVE_DAILY_CRYPTO_DAY_STRATEGY.marketData.quoteFreshnessSeconds*1000},
  "momentum-breakout-100":{id:MOMENTUM_BREAKOUT_STRATEGY_V1.id,version:MOMENTUM_BREAKOUT_STRATEGY_V1.version,riskPct:MOMENTUM_BREAKOUT_STRATEGY_V1.risk.riskPerTradePct,positionPct:MOMENTUM_BREAKOUT_STRATEGY_V1.risk.maximumPositionAllocationPct,minNotional:1,marketAgeMs:MOMENTUM_BREAKOUT_STRATEGY_V1.marketData.maximumQuoteAgeSeconds*1000},
  "crypto-ignition-100":{id:CRYPTO_IGNITION_STRATEGY_V1.id,version:CRYPTO_IGNITION_STRATEGY_V1.version,riskPct:CRYPTO_IGNITION_STRATEGY_V1.risk.riskPerTradePct,positionPct:CRYPTO_IGNITION_STRATEGY_V1.risk.maximumPositionAllocationPct,minNotional:CRYPTO_IGNITION_STRATEGY_V1.execution.minimumOrderNotionalUsd,marketAgeMs:CRYPTO_IGNITION_STRATEGY_V1.marketData.maximumQuoteAgeSeconds*1000},
  "crypto-swing-100":{id:CRYPTO_SWING_STRATEGY_V1.id,version:CRYPTO_SWING_STRATEGY_V1.version,riskPct:CRYPTO_SWING_STRATEGY_V1.risk.riskPerTradePct,positionPct:CRYPTO_SWING_STRATEGY_V1.risk.maximumPositionAllocationPct,minNotional:1,marketAgeMs:60_000},
  "squeeze-breakout-100":{id:SQUEEZE_BREAKOUT_STRATEGY_V1.id,version:SQUEEZE_BREAKOUT_STRATEGY_V1.version,riskPct:SQUEEZE_BREAKOUT_STRATEGY_V1.risk.riskPerTradePct,positionPct:SQUEEZE_BREAKOUT_STRATEGY_V1.risk.maximumPositionAllocationPct,minNotional:1,marketAgeMs:120_000},
};
export const CHALLENGE_SOURCE_ADAPTERS=Object.freeze(
  TRADING_STRATEGIES.map(s=>({botId:s.legacyBotId,strategyId:s.strategyId,
    strategyVersion:strategyRules[s.legacyBotId].version,adapter:s.codename.toLowerCase(),
    riskRuleSource:"strategy-config",paperOnly:true as const})),
);
type Extracted={
  symbol:string;assetClass:AssetClass|null;
  entry:number|null;maxEntry:number|null;stop:number|null;target:number|null;
  partial:{price:number;fraction:number|null}[];
  selected:boolean;qualified:boolean;blockers:string[];warnings:string[];
};
const fromTradePlan=(p:PaperBotTradePlan,maxEntry:number|null):Extracted=>({
  symbol:p.symbol,assetClass:p.assetClass==="unknown"?null:p.assetClass,
  entry:num(p.plan.entryPrice),maxEntry:num(maxEntry),stop:num(p.plan.stopPrice),
  target:num(p.plan.exitPrice),partial:[],
  selected:p.selectedForSubmission,
  qualified:p.executionEligible&&p.selectedForSubmission&&p.plan.phase==="ready"&&p.blockers.length===0,
  blockers:[...p.blockers],warnings:[...p.warnings],
});
export function extractLegacyStrategyPlan(s:SourcePlan):Extracted{
  switch(s.adapter){
    case "atlas":return fromTradePlan(s.plan,s.maxEntryPrice);
    case "fuse":{const r=s.result;return {...fromTradePlan(r,r.maximumEntry),
      qualified:r.executionEligible&&r.selectedForSubmission&&r.plan.phase==="ready"&&!r.researchOnly};}
    case "harbor":{const r=s.result,p=s.plan;return{
      symbol:p.symbol,assetClass:"stock",entry:num(p.entryTrigger),maxEntry:num(p.maxEntryPrice),
      stop:num(p.protectiveStop),target:num(s.targetPrice),partial:[],
      selected:r.selectedForSubmission,qualified:r.state==="ready"&&r.selectedForSubmission&&r.blockers.length===0&&r.waitingOn.length===0,
      blockers:[...r.blockers],warnings:[...r.waitingOn],
    };}
    case "flash":{const r=s.result;return{
      symbol:r.symbol,assetClass:"crypto",entry:num(r.trigger),maxEntry:num(r.maxEntry),
      stop:num(r.protectiveStop),target:num(r.takeProfit),
      partial:num(r.firstTakeProfitPrice)?[{price:r.firstTakeProfitPrice!,fraction:ACTIVE_DAILY_CRYPTO_DAY_STRATEGY.risk.firstTakeProfitFraction}]:[],
      selected:r.selectedForSubmission,qualified:r.state==="ready"&&r.executionEligible&&r.selectedForSubmission&&r.blockers.length===0&&r.waitingOn.length===0,
      blockers:[...r.blockers],warnings:[...r.waitingOn],
    };}
    case "pulse":{const r=s.result;return{
      symbol:r.symbol,assetClass:"stock",entry:num(r.trigger),maxEntry:num(r.maxEntry),
      stop:num(r.protectiveStop),target:num(r.takeProfit),partial:[],
      selected:r.selectedForSubmission,qualified:r.state==="ready"&&r.selectedForSubmission&&r.blockers.length===0&&r.waitingOn.length===0,
      blockers:[...r.blockers],warnings:[...r.waitingOn],
    };}
    case "spark":{const r=s.result;return{
      symbol:r.symbol,assetClass:"crypto",entry:num(r.trigger),maxEntry:num(r.maxEntry),
      stop:num(r.protectiveStop),target:num(r.takeProfit),partial:[],
      selected:r.selectedForSubmission,qualified:r.state==="ready"&&r.selectedForSubmission&&r.blockers.length===0&&r.waitingOn.length===0,
      blockers:[...r.blockers],warnings:[...r.waitingOn],
    };}
    case "orbit":return {...fromTradePlan(s.plan,s.maximumEntryPrice),selected:false,qualified:false};
    case "coil":return {...fromTradePlan(s.plan,s.maximumEntryPrice),selected:false,qualified:false};
  }
}
export function normalizeChallengeTradeProposal(input:ChallengeProposalInput):ChallengeProposal{
  const {challenge,source,evidence}=input;
  const participant=challenge.botInstances.find(x=>x.botInstanceId===input.botInstanceId);
  if(!participant||participant.legacyBotId!==source.botId)
    throw Error("Bot instance does not belong to the supplied challenge.");
  const rules=strategyRules[source.botId];
  if(participant.strategyId!==rules.id||participant.strategyVersion!==rules.version)
    throw Error("Strategy version does not match the actual source strategy.");
  if(challenge.mode!=="shadow"||challenge.brokerIsolationVerified!==false)
    throw Error("Step 2 accepts shadow-only challenge contexts.");
  if(!/^[a-z0-9][a-z0-9_-]{1,95}$/.test(evidence.sourceRecordKey))
    throw Error("Stable source record key required.");
  if(!positive(challenge.equityUsd)||!positive(challenge.startingCapitalUsd)||
    ![challenge.settledCashUsd,challenge.buyingPowerUsd,challenge.reservedCashUsd]
      .every(x=>Number.isFinite(x)&&x>=0))
    throw Error("Invalid challenge portfolio snapshot.");
  const at=validTime(input.observedAt);
  const seen=validTime(evidence.sourceObservedAt);
  if(at===null||seen===null||seen>at)throw Error("Source evidence timestamp missing or future-dated.");
  if(source.adapter==="atlas"||source.adapter==="orbit"||source.adapter==="coil"){
    if(source.plan.botId!==source.botId||source.plan.strategyId!==rules.id||source.plan.strategyVersion!==rules.version)
      throw Error("Legacy plan identity differs from bound strategy.");
  }
  if(source.adapter==="fuse" && (source.result.botId!==source.botId||
    source.result.strategyId!==rules.id||source.result.strategyVersion!==rules.version))
    throw Error("Fuse readiness identity differs from bound strategy.");
  const extracted=extractLegacyStrategyPlan(source);
  if(!/^[A-Z0-9./-]{1,24}$/i.test(extracted.symbol))
    throw Error("Invalid or unsafe symbol.");
  const blockers=[...extracted.blockers],warnings=[...extracted.warnings];
  if(!extracted.assetClass)blockers.push("Asset class is unknown.");
  const candle=validTime(evidence.completedCandleTimestamp);
  if(candle===null||candle>at)blockers.push("Completed candle provenance missing or future-dated.");
  if(at-seen>86_400_000)blockers.push("Strategy observation is more than 24 hours old.");
  if(source.botId==="crypto-swing-100"||source.botId==="squeeze-breakout-100")
    blockers.push("Research-only strategy cannot be promoted to execution-ready.");
  const quote=validTime(evidence.quoteTimestamp);
  const fresh=quote!==null&&quote<=at&&at-quote<=rules.marketAgeMs&&
    typeof evidence.quoteSource==="string"&&evidence.quoteSource.trim().length>0;
  if(!fresh)blockers.push("Missing, future-dated, or stale source-provenanced executable quote.");
  if(evidence.marketSessionEligible!==true)blockers.push("Market-session permission missing or false.");
  if(input.riskBreakersClear!==true)blockers.push("Challenge loss-breaker state unavailable or active.");
  if(input.currentSymbols===null||input.pendingSymbols===null)
    blockers.push("Challenge holdings or pending orders are not fully known.");
  else if([...input.currentSymbols,...input.pendingSymbols].some(x=>norm(x)===norm(extracted.symbol)))
    blockers.push("Challenge already has a holding or pending entry in this symbol.");
  if(!evidence.concentrationGroup?.trim())blockers.push("Concentration group missing.");
  if(!positive(extracted.entry)||!positive(extracted.maxEntry)||!positive(extracted.stop)||
    !positive(extracted.target)||extracted.stop>=extracted.entry||
    extracted.stop>=extracted.maxEntry||extracted.target<=extracted.maxEntry||
    extracted.maxEntry<extracted.entry)
    blockers.push("Entry, maximum entry, protective stop, or final target incomplete/invalid.");
  if(!positive(evidence.roundTripCostPct)||evidence.roundTripCostPct>10)
    blockers.push("Explicit valid estimated round-trip fee/slippage/spread evidence required.");
  const until=validTime(evidence.expiresAt);
  if(until===null||until<=at)blockers.push("Proposal missing a future expiration.");
  if(evidence.sourceEvidenceIds.length===0)
    blockers.push("Strategy decision provenance ID missing.");
  const researchIds=new Set<string>();
  for(const research of evidence.researchEvidence){
    const registered=challenge.researchContributors.find(r=>r.contributorId===research.contributorId&&r.canSubmitOrders===false);
    if(!registered||!research.evidenceId||validTime(research.observedAt)===null||
      validTime(research.observedAt)!>at)
      blockers.push("Research evidence must be timestamped and permitted by challenge.");
    if(researchIds.has(research.contributorId+":"+research.evidenceId))
      blockers.push("Duplicated research provenance ID.");
    researchIds.add(research.contributorId+":"+research.evidenceId);
  }
  if(!extracted.qualified)blockers.push("No explicitly selected strategy-qualified proposal.");
  // An observation calculation does NOT waive missing broker account ownership,
  // physical position netting, stop/exits, or allocator spending permission.
  const completePrice=positive(extracted.entry)&&positive(extracted.maxEntry)&&
    positive(extracted.stop)&&positive(extracted.target)&&extracted.stop<extracted.entry&&
    extracted.target>extracted.maxEntry&&positive(evidence.roundTripCostPct)&&evidence.roundTripCostPct<=10;
  let requestedQuantity:number|null=null,requestedNotionalUsd:number|null=null;
  let plannedDollarLoss:number|null=null,estimatedRoundTripCostsUsd:number|null=null;
  let expectedNetRewardRisk:number|null=null;
  if(completePrice){
    const entry=extracted.maxEntry!,stop=extracted.stop!,target=extracted.target!;
    const feeRate=evidence.roundTripCostPct!/100;
    const lossPerUnit=(entry-stop)+entry*feeRate;
    const gainPerUnit=(target-entry)-entry*feeRate;
    expectedNetRewardRisk=rounded(gainPerUnit/lossPerUnit);
    if(expectedNetRewardRisk<POLICY.minimumNetRewardRisk)
      blockers.push("Estimated net reward/risk is below challenge policy minimum.");
    const tighterRisk=input.requestedMaximumRiskPct;
    const tighterPosition=input.requestedMaximumPositionPct;
    if(tighterRisk!==undefined&&tighterRisk!==null&&(!positive(tighterRisk)||tighterRisk>rules.riskPct))
      blockers.push("Requested strategy risk override is invalid or looser than its strategy cap.");
    if(tighterPosition!==undefined&&tighterPosition!==null&&(!positive(tighterPosition)||tighterPosition>rules.positionPct))
      blockers.push("Requested position override is invalid or looser than its strategy cap.");
    const riskPct=Math.min(POLICY.standardTradeRiskPct,rules.riskPct,
      positive(tighterRisk)&&tighterRisk<=rules.riskPct?tighterRisk:POLICY.standardTradeRiskPct);
    const positionPct=Math.min(POLICY.maximumPositionPct,rules.positionPct,
      positive(tighterPosition)&&tighterPosition<=rules.positionPct?tighterPosition:POLICY.maximumPositionPct,
      entry<=5?POLICY.speculativePositionPct:POLICY.maximumPositionPct);
    const reserve=challenge.equityUsd*POLICY.cashReservePct/100;
    const cash=Math.max(0,Math.min(challenge.settledCashUsd,challenge.buyingPowerUsd)-
      challenge.reservedCashUsd-reserve);
    const notionalCap=Math.min(cash,challenge.equityUsd*positionPct/100);
    const maxQty=Math.min(notionalCap/(entry*(1+feeRate)),challenge.equityUsd*riskPct/100/lossPerUnit);
    const qty=floor(maxQty,extracted.assetClass==="crypto"?1_000_000_000:
      input.fractionalStockEligibilityVerified===true?1_000_000_000:1);
    if(qty>0 && qty*entry>=rules.minNotional){
      requestedQuantity=qty;requestedNotionalUsd=rounded(qty*entry);
      plannedDollarLoss=rounded(qty*lossPerUnit);
      estimatedRoundTripCostsUsd=rounded(qty*entry*feeRate);
    }else blockers.push("Challenge capital insufficient for protected minimum position.");
  }
  if(!challenge.brokerAccountRef)
    warnings.push("No physically isolated PAPER broker account assigned.");
  warnings.push("Observation only; challenge allocator and protective execution are not authorized.");
  const observationState:ChallengeProposal["observationState"]=
    !completePrice?"insufficient-evidence":
    blockers.length?"blocked":extracted.qualified?"qualified-observation":"reference";
  return {
    contractVersion:CHALLENGE_PROPOSAL_VERSION,paperOnly:true,brokerOrderAuthorized:false,
    challengeId:challenge.challengeId,botInstanceId:input.botInstanceId,botId:source.botId,
    strategyId:rules.id,strategyVersion:rules.version,
    decisionKey:namespacedAuditKey(challenge,input.botInstanceId,evidence.sourceRecordKey),
    sourceAdapter:source.adapter,sourceRecordKey:evidence.sourceRecordKey,
    symbol:extracted.symbol,assetClass:extracted.assetClass??"unknown",
    strategyApproved:extracted.qualified,qualifiedByStrategy:extracted.qualified,
    observationState,entryPrice:extracted.entry,maximumEntryPrice:extracted.maxEntry,
    protectiveStop:extracted.stop,finalTargetPrice:extracted.target,
    partialTargets:extracted.partial,
    requestedQuantity,requestedNotionalUsd,plannedDollarLoss,estimatedRoundTripCostsUsd,
    expectedNetRewardRisk,evidence,observedAt:input.observedAt,quoteFresh:fresh,
    sessionEligible:evidence.marketSessionEligible,blockers:uniq(blockers),warnings:uniq(warnings),
    sizingBasis:"challenge-observation-only",brokerIsolationVerified:false,sharedCapitalCompatible:false,
  };
}
