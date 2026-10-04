export const PAPER_PROSPECT_SCANNER_V1 = {
  id: "paper-prospect-scanner-v1",
  version: 1,
  mode: "paper-research-only",
  cadenceMinutes: 10,
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
    minimumPriceUsd: 0.25,
    maximumSpreadPct: 1.00,
  },
  crypto: {
    quoteCurrency: "USD",
    maximumSpreadPct: 1.00,
  },
  assignment: {
    pennyPriceCeilingUsd: 5,
  },
} as const;

export type PaperProspectScannerConfig = typeof PAPER_PROSPECT_SCANNER_V1;
