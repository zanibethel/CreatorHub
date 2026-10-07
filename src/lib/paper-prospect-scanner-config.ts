export const PAPER_PROSPECT_SCANNER_V2 = {
  id: "paper-prospect-scanner-v3",
  version: 3,
  mode: "paper-research-only",
  cadenceMinutes: 5,
  thresholds: {
    observationScore: 40,
    watchlistScore: 65,
    botReviewScore: 80,
  },
  freshness: {
    stockSourceMinutes: 90,
    cryptoQuoteMinutes: 10,
  },
  stock: {
    topMovers: 50,
    mostActive: 100,
    minimumPriceUsd: 0.08,
    maximumSpreadPct: 1.00,
    newsDiscoveryLookbackMinutes: 360,
    newsDiscoveryMaxSymbols: 120,
    recentBarLookbackMinutes: 65,
    recentBarBatchSize: 35,
  },
  timing: {
    maxAccelerationPoints: 25,
    maxCatalystPoints: 10,
    maxChasePenaltyPoints: 24,
    catalystFreshMinutes: 180,
  },
  crypto: {
    quoteCurrency: "USD",
    maximumSpreadPct: 1.00,
  },
  news: {
    minimumConfidenceScore: 60,
    maxSignalsPerSymbol: 8,
    maxScannerImpactPoints: 8,
    maxBotImpactPoints: 6,
  },
  assignment: {
    pennyPriceCeilingUsd: 5,
  },
} as const;

export type PaperProspectScannerConfig = typeof PAPER_PROSPECT_SCANNER_V2;
