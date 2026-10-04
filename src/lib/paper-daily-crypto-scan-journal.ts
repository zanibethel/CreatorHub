export type DailyCryptoScanCandidate = {
  symbol: string;
  tier: "execution" | "monitor";
  executionEligible: boolean;
  state: "ready" | "waiting" | "blocked";
  selectedForSubmission: boolean;
  score: number;
  bid: number | null;
  ask: number | null;
  spreadPct: number | null;
  quoteAgeSeconds: number | null;
  fastMomentumPct: number | null;
  slowMomentumPct: number | null;
  atrPct: number | null;
  trigger: number | null;
  maxEntry: number | null;
  protectiveStop: number | null;
  takeProfit: number | null;
  plannedNotional: number | null;
  plannedQuantity: number | null;
  plannedRiskDollars: number | null;
  plannedRiskPct: number | null;
  estimatedRoundTripFees: number | null;
  estimatedGrossTargetDollars: number | null;
  feeCoverageMultiple: number | null;
  waitingOn: string[];
  blockers: string[];
};

export type DailyCryptoScanSnapshot = {
  collectedAt: string;
  strategyId: string;
  strategyVersion: number;
  paperOnly: true;
  broadCryptoSupportive: boolean;
  executionEnabled: boolean;
  submissionReady: boolean;
  selectedSymbol: string | null;
  session: {
    localDate: string;
    localWeekday: string;
    localTime: string;
    isTradingDay: boolean;
    entriesOpen: boolean;
    flattenDue: boolean;
  };
  candidates: DailyCryptoScanCandidate[];
};

function qualification(candidate: DailyCryptoScanCandidate) {
  if (candidate.state === "ready" && candidate.executionEligible) return "trade-ready" as const;
  if (candidate.score >= 80) return "qualified" as const;
  if (candidate.score >= 60) return "watch" as const;
  return "unqualified" as const;
}

export function buildDailyCryptoScanJournalRows(
  botId: string,
  snapshot: DailyCryptoScanSnapshot,
) {
  return snapshot.candidates.map(candidate => ({
    bot_id: botId,
    strategy_id: snapshot.strategyId,
    strategy_version: snapshot.strategyVersion,
    event_type: candidate.state === "blocked" ? "rejected" : "candidate",
    symbol: candidate.symbol,
    asset_class: "crypto",
    occurred_at: snapshot.collectedAt,
    score: candidate.score,
    qualification: qualification(candidate),
    regime: snapshot.broadCryptoSupportive ? "bullish" : "neutral",
    component_scores: {
      setupScore: candidate.score,
    },
    market_snapshot: {
      bid: candidate.bid,
      ask: candidate.ask,
      spreadPct: candidate.spreadPct,
      quoteAgeSeconds: candidate.quoteAgeSeconds,
      fastMomentumPct: candidate.fastMomentumPct,
      slowMomentumPct: candidate.slowMomentumPct,
      atrPct: candidate.atrPct,
      source: "crypto-market-feed-us",
      fastTimeframe: "5Min",
      slowTimeframe: "15Min",
    },
    risk_plan: {
      trigger: candidate.trigger,
      maxEntry: candidate.maxEntry,
      protectiveStop: candidate.protectiveStop,
      takeProfit: candidate.takeProfit,
      plannedNotional: candidate.plannedNotional,
      plannedQuantity: candidate.plannedQuantity,
      plannedRiskDollars: candidate.plannedRiskDollars,
      plannedRiskPct: candidate.plannedRiskPct,
      estimatedRoundTripFees: candidate.estimatedRoundTripFees,
      estimatedGrossTargetDollars: candidate.estimatedGrossTargetDollars,
      feeCoverageMultiple: candidate.feeCoverageMultiple,
    },
    blockers: candidate.blockers,
    warnings: candidate.waitingOn,
    metadata: {
      source: "daily-crypto-5m-runner",
      paperOnly: snapshot.paperOnly,
      tier: candidate.tier,
      executionEligible: candidate.executionEligible,
      selectedForSubmission: candidate.selectedForSubmission,
      state: candidate.state,
      executionEnabled: snapshot.executionEnabled,
      submissionReady: snapshot.submissionReady,
      selectedSymbol: snapshot.selectedSymbol,
      session: snapshot.session,
    },
  }));
}
