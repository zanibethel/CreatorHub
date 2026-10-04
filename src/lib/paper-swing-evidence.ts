export type SwingEvidencePlan = {
  clientOrderId: string;
  symbol: string;
  requestedNotional: number;
  entryTrigger: number;
  maxEntryPrice: number;
  protectiveStop: number;
  plannedRiskDollars: number;
  expiresAt: string;
  createdAt: string;
  stageReason: string | null;
  takeProfitPrice: number | null;
  takeProfitFraction: number | null;
  takeProfitR: number | null;
  protectWinnerAtR: number | null;
  trailRemainder: boolean;
  metadata: Record<string, unknown>;
};

export type SwingEvidenceReadiness = {
  symbol: string;
  state: "ready" | "waiting" | "blocked";
  selectedForSubmission: boolean;
  bid: number | null;
  ask: number | null;
  spreadPct: number | null;
  quoteAgeSeconds: number | null;
  plannedRiskPct: number;
  allocationPct: number;
  correlationGroup: string | null;
  blockers: string[];
  waitingOn: string[];
};

export function buildSwingRevalidationJournalRows(input: {
  botId: string;
  strategyId: string;
  strategyVersion: number;
  collectedAt: string;
  broadMarketSupportive: boolean;
  marketOpen: boolean;
  minutesSinceOpen: number | null;
  weeklySlotsRemaining: number;
  openPositionSlotsRemaining: number;
  executionEnabled: boolean;
  plans: SwingEvidencePlan[];
  readiness: SwingEvidenceReadiness[];
}) {
  return input.plans.map(plan => {
    const readiness = input.readiness.find(item => item.symbol === plan.symbol);
    if (!readiness) throw new Error(`Missing swing readiness for ${plan.symbol}.`);
    const expired = readiness.blockers.some(reason => /prepared plan has expired/i.test(reason));

    return {
      bot_id: input.botId,
      strategy_id: input.strategyId,
      strategy_version: input.strategyVersion,
      event_type: readiness.selectedForSubmission ? "authorized" : readiness.state === "blocked" ? "rejected" : "candidate",
      symbol: plan.symbol,
      asset_class: plan.symbol === "QQQ" ? "etf" : "stock",
      occurred_at: input.collectedAt,
      score: null,
      qualification: readiness.selectedForSubmission ? "trade-ready" : readiness.state === "waiting" ? "watch" : "unqualified",
      regime: input.broadMarketSupportive ? "bullish" : "neutral",
      component_scores: {
        readinessState: readiness.state,
        selectedForSubmission: readiness.selectedForSubmission,
      },
      market_snapshot: {
        bid: readiness.bid,
        ask: readiness.ask,
        spreadPct: readiness.spreadPct,
        quoteAgeSeconds: readiness.quoteAgeSeconds,
        marketOpen: input.marketOpen,
        minutesSinceOpen: input.minutesSinceOpen,
      },
      risk_plan: {
        requestedNotional: plan.requestedNotional,
        entryTrigger: plan.entryTrigger,
        maxEntryPrice: plan.maxEntryPrice,
        protectiveStop: plan.protectiveStop,
        plannedRiskDollars: plan.plannedRiskDollars,
        plannedRiskPct: readiness.plannedRiskPct,
        allocationPct: readiness.allocationPct,
        correlationGroup: readiness.correlationGroup,
        takeProfitPrice: plan.takeProfitPrice,
        takeProfitFraction: plan.takeProfitFraction,
        takeProfitR: plan.takeProfitR,
        protectWinnerAtR: plan.protectWinnerAtR,
        trailRemainder: plan.trailRemainder,
      },
      blockers: readiness.blockers,
      warnings: readiness.waitingOn,
      client_order_id: plan.clientOrderId,
      metadata: {
        source: "swing-5m-revalidation",
        paperOnly: true,
        executionEnabled: input.executionEnabled,
        weeklySlotsRemaining: input.weeklySlotsRemaining,
        openPositionSlotsRemaining: input.openPositionSlotsRemaining,
        stageReason: plan.stageReason,
        stageCreatedAt: plan.createdAt,
        expiresAt: plan.expiresAt,
        expired,
        terminalDisposition: expired ? "expired" : null,
        setup: typeof plan.metadata.setup === "string" ? plan.metadata.setup : null,
        sourceDate: typeof plan.metadata.sourceDate === "string" ? plan.metadata.sourceDate : null,
      },
    };
  });
}
