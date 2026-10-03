export const PAPER_STRATEGY_V1 = {
  id: "paper-medium-high-v1",
  version: 1,
  mode: "paper-only",
  objective: "medium-high opportunity aggressiveness with deterministic downside controls",
  score: {
    weights: {
      trend: 25,
      momentum: 25,
      relativeStrength: 15,
      setupQuality: 15,
      volumeConfirmation: 10,
      volatilityQuality: 10,
    },
    thresholds: { watch: 60, qualified: 75, tradeReady: 85 },
  },
  marketData: {
    maxQuoteAgeMs: 60_000,
    minimumHistoryBars: 20,
    maximumSpreadPct: { stock: 0.60, crypto: 1.00 },
  },
  regime: {
    fastPeriod: 10,
    slowPeriod: 20,
  },
  momentum: {
    fastLookback: 5,
    slowLookback: 20,
  },
  setup: {
    breakoutLookback: 20,
    pullbackLookback: 5,
    supportLookback: 10,
  },
  volume: {
    lookback: 20,
    fullScoreRelativeVolume: 1.20,
  },
  volatility: {
    atrPeriod: 14,
    preferredAtrPct: { min: 0.35, max: 5.00 },
    hardMaximumAtrPct: 10.00,
  },
  risk: {
    standardRiskPct: 0.75,
    highConvictionRiskPct: 1.00,
    highConvictionScore: 92,
    maxOpenRiskPct: 4.00,
    maxCorrelatedRiskPct: 2.00,
    dailyRealizedLossLimitPct: 2.50,
    weeklyDrawdownLimitPct: 6.00,
    atrStopMultiplier: 1.75,
    structureBufferAtr: 0.15,
    maximumStopDistancePct: 8.00,
    minimumRewardR: 2.00,
    partialProfit: { triggerR: 1.75, fraction: 0.25 },
    protectWinnerAtR: 1.00,
  },
} as const;

export type PaperStrategyConfig = typeof PAPER_STRATEGY_V1;
export const ACTIVE_PAPER_STRATEGY = PAPER_STRATEGY_V1;
