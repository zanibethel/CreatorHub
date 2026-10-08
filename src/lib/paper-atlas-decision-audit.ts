import type { PaperDecision } from "./paper-decision-engine";

// A symbol/day grouping is not proof of a distinct trade opportunity.
// The 5m decision ID intentionally differs per evaluation, but is stable on retry.
export function atlasEvaluationIds(input:{assetClass:"stock"|"crypto";symbol:string;scanBucketUtc:string}) {
  const day=input.scanBucketUtc.slice(0,10);
  const symbolSessionKey=`atlas:${input.assetClass}:${input.symbol}:${day}`;
  const correlationId=`${symbolSessionKey}:${input.scanBucketUtc}`;
  return {decisionId:`atlas-eval:${correlationId}`,correlationId,symbolSessionKey};
}

export function atlasJournalPayload(input:{
  decision:PaperDecision;
  ids:ReturnType<typeof atlasEvaluationIds>;
  evaluatedAt:string;scanBucketUtc:string;inputProvenance:Record<string,unknown>;
}) {
  const d=input.decision;
  return {
    source:"atlas-read-only-evaluation",
    decisionId:input.ids.decisionId,correlationId:input.ids.correlationId,
    symbolSessionKey:input.ids.symbolSessionKey,
    scanBucketUtc:input.scanBucketUtc,evaluatedAt:input.evaluatedAt,
    strategyId:d.strategyId,strategyVersion:d.strategyVersion,
    symbol:d.symbol,assetClass:d.assetClass,score:d.score,
    qualification:d.qualification,regime:d.regime,components:d.components,
    blockers:d.blockers,warnings:d.warnings,
    marketSnapshot:{...d.metrics,quoteAgeSource:input.inputProvenance.quoteAt ?? null},
    riskPlan:d.riskPlan,referencePlan:d.referencePlan,
    entryPrice:d.referencePlan.entryTrigger,
    exitPrice:d.referencePlan.exitPrice,
    inputProvenance:input.inputProvenance,
    orderSubmission:false,
  };
}
