/** Journal evidence for every scheduled Spark readiness cycle.
 * Values intentionally match public.paper_bot_journal check constraints.
 * The source Prospect Score is not a Spark qualification or execution approval.
 */
export type SparkScanCandidate = {
  symbol:string; sourceScore:number; state:"ready"|"waiting"|"blocked"; selectedForSubmission:boolean;
  bid:number|null; ask:number|null; spreadPct:number|null;
  fastMomentumPct:number|null; slowMomentumPct:number|null; relativeVolume:number|null;
  trigger:number|null; maxEntry:number|null; protectiveStop:number|null; takeProfit:number|null;
  plannedNotional:number|null; plannedRiskDollars:number|null;
  blockers:string[]; waitingOn:string[];
};
export type SparkScanSnapshot = {
  collectedAt:string; strategyId:string; strategyVersion:number; executionEnabled:boolean;
  candidates:SparkScanCandidate[];
};
export function buildSparkScanJournalRows(botId:string,snapshot:SparkScanSnapshot){
  const common={bot_id:botId,strategy_id:snapshot.strategyId,strategy_version:snapshot.strategyVersion,
    asset_class:"crypto",occurred_at:snapshot.collectedAt,regime:"unknown"};
  if(!snapshot.candidates.length)return [{
    ...common,event_type:"system",symbol:null,qualification:"watch",score:null,
    component_scores:{},market_snapshot:{},risk_plan:{},blockers:[],warnings:[],
    metadata:{source:"spark-early-crypto-readiness",paperOnly:true,phase:"scan-completed",
      candidateCount:0,executionEnabled:snapshot.executionEnabled},
  }];
  return snapshot.candidates.map(candidate=>({
    ...common,
    // event_type and qualification must match the database's allowed values.
    event_type:candidate.state==="blocked"?"rejected":"candidate",
    symbol:candidate.symbol,score:candidate.sourceScore,
    qualification:candidate.state==="ready"?"trade-ready":candidate.state==="blocked"?"unqualified":"watch",
    component_scores:{sourceScore:candidate.sourceScore,fastMomentumPct:candidate.fastMomentumPct,
      slowMomentumPct:candidate.slowMomentumPct,relativeVolume:candidate.relativeVolume},
    market_snapshot:{bid:candidate.bid,ask:candidate.ask,spreadPct:candidate.spreadPct},
    risk_plan:{entryTrigger:candidate.trigger,maxEntryPrice:candidate.maxEntry,
      protectiveStop:candidate.protectiveStop,takeProfitPrice:candidate.takeProfit,
      plannedNotional:candidate.plannedNotional,plannedRiskDollars:candidate.plannedRiskDollars},
    blockers:candidate.blockers,warnings:candidate.waitingOn,
    metadata:{source:"spark-early-crypto-readiness",paperOnly:true,candidateCount:snapshot.candidates.length,
      sourceScore:candidate.sourceScore,sparkQualification:candidate.state,
      selectedForSubmission:candidate.selectedForSubmission,executionEnabled:snapshot.executionEnabled,
      graduationRule:"80+ belongs to Flash"},
  }));
}
