export const DAILY_CRYPTO_DAY_STRATEGY_V4 = {
  id: "daily-crypto-day-v4",
  botProfileId: "weekend-crypto-day-100",
  displayName: "$100 Daily Crypto Day Bot",
  version: 4,
  mode: "paper-only",
  timezone: "America/Chicago",
  executionUniverse: ["BTC/USD", "ETH/USD", "SOL/USD", "LINK/USD", "DOT/USD"],
  monitorOnlyUniverse: [
    "XRP/USD",
    "LTC/USD",
    "AVAX/USD",
    "DOGE/USD",
    "ADA/USD",
    "BCH/USD",
    "AAVE/USD",
    "HYPE/USD",
    "RENDER/USD",
  ],
  universe: [
    "BTC/USD",
    "ETH/USD",
    "SOL/USD",
    "LINK/USD",
    "DOT/USD",
    "XRP/USD",
    "LTC/USD",
    "AVAX/USD",
    "DOGE/USD",
    "ADA/USD",
    "BCH/USD",
    "AAVE/USD",
    "HYPE/USD",
    "RENDER/USD",
  ],
  session: {
    tradingDays: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
    continuousEntries: true,
    routineSessionFlatten: false,
    dailyAccountingTimezone: "America/Chicago",
  },
  cadence: {
    maximumNewEntriesPerDay: 3,
    maximumOpenPositions: 1,
  },
  marketData: {
    quoteFreshnessSeconds: 60,
    maximumSpreadPct: 0.15,
    fastTimeframeMinutes: 5,
    slowTimeframeMinutes: 15,
    fastBarsRequired: 24,
    slowBarsRequired: 16,
  },
  setup: {
    fastSmaPeriod: 9,
    slowFastSmaPeriod: 4,
    slowSmaPeriod: 12,
    momentumBars: 3,
    breakoutLookbackBars: 6,
    breakoutBufferPct: 0.03,
    maximumChaseAtr: 0.50,
    minimumAtrPct: 0.08,
    maximumAtrPct: 1.50,
    minimumScore: 80,
  },
  risk: {
    riskPerTradePct: 0.50,
    maximumPositionAllocationPct: 30,
    maximumOpenRiskPct: 0.75,
    dailyRealizedLossLimitPct: 1.50,
    minimumStopPct: 0.80,
    maximumStopPct: 2.50,
    atrStopMultiplier: 1.50,
    firstTakeProfitR: 2.00,
    firstTakeProfitFraction: 0.50,
    protectWinnerAtR: 1.00,
    trailRemainder: true,
  },
  fees: {
    estimatedTakerFeeBpsPerSide: 25,
    requiredGrossTargetToRoundTripFeeMultiple: 2.50,
  },
  execution: {
    paperOnly: true,
    executionEnabledByDefault: false,
    oneSymbolPerBrokerAccountAcrossBots: true,
    minimumOrderNotionalUsd: 12,
  },
} as const;

// Historical v3 is retained as an immutable reference for replay/review.
// Runtime routes import V4 explicitly.
export const DAILY_CRYPTO_DAY_STRATEGY_V3 = {
  ...DAILY_CRYPTO_DAY_STRATEGY_V4,
  id: "daily-crypto-day-v3",
  version: 3,
  session: {
    tradingDays: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
    stopNewEntriesLocal: "22:30",
    flatByLocal: "23:45",
  },
} as const;

// Older compatibility exports remain historical aliases rather than runtime defaults.
export const DAILY_CRYPTO_DAY_STRATEGY_V2 = DAILY_CRYPTO_DAY_STRATEGY_V3;
export const WEEKEND_CRYPTO_DAY_STRATEGY_V1 = DAILY_CRYPTO_DAY_STRATEGY_V3;
