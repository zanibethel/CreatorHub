import { PAPER_STRATEGY_V1 } from "./paper-strategy-config";

export type PaperBotStatus = "active" | "planned" | "paused";

export type PaperBotProfile = {
  id: string;
  name: string;
  status: PaperBotStatus;
  challengeStartingCash: number;
  strategyId: string | null;
  style: string;
  universe: {
    assetClasses: Array<"stock" | "etf" | "crypto">;
    description: string;
    maximumPriceUsd?: number;
  };
  cadence: {
    description: string;
    maximumNewTradesPerWeek?: number;
    intradayOnly?: boolean;
    swingOnly?: boolean;
  };
  isolation: {
    separateVirtualLedger: true;
    sharePositionsWithOtherBots: false;
    shareRiskBudgetWithOtherBots: false;
  };
  notes: string[];
};

export const DEFAULT_DIVERSE_BOT: PaperBotProfile = {
  id: "default-diverse",
  name: "Default Diverse Bot",
  status: "active",
  challengeStartingCash: 100,
  strategyId: PAPER_STRATEGY_V1.id,
  style: "Diversified medium-to-high opportunity strategy with deterministic downside controls",
  universe: {
    assetClasses: ["stock", "etf", "crypto"],
    description: "Persisted diversified watchlist spanning broad-market, sector, individual-stock, diversifier, and crypto candidates.",
  },
  cadence: {
    description: "Opportunity-driven across day, multi-day, and multi-week pools; entries still require the shared decision-engine and risk vetoes.",
  },
  isolation: {
    separateVirtualLedger: true,
    sharePositionsWithOtherBots: false,
    shareRiskBudgetWithOtherBots: false,
  },
  notes: [
    "This is the default profile for the current paper decision engine and uses the same $100 challenge baseline as every comparison bot.",
    "Current strategy logic remains PAPER_STRATEGY_V1 and is not duplicated here.",
    "The profile is paper-only; a trade-ready score is not itself order permission.",
  ],
};

export const PENNY_VOLATILITY_DAY_BOT: PaperBotProfile = {
  id: "penny-volatility-day-100",
  name: "$100 Penny Volatility Day Bot",
  status: "planned",
  challengeStartingCash: 100,
  strategyId: null,
  style: "Higher-volatility intraday penny-stock experiment",
  universe: {
    assetClasses: ["stock"],
    description: "Low-priced, sufficiently liquid stocks selected under a dedicated future liquidity/spread/volatility policy.",
    maximumPriceUsd: 5,
  },
  cadence: {
    description: "Day-trading only; positions must not intentionally carry overnight.",
    intradayOnly: true,
  },
  isolation: {
    separateVirtualLedger: true,
    sharePositionsWithOtherBots: false,
    shareRiskBudgetWithOtherBots: false,
  },
  notes: [
    "Higher volatility does not remove stop-loss, liquidity, spread, daily-loss, or kill-switch requirements.",
    "Exact scoring, sizing, stop, trade-frequency, and liquidity thresholds are intentionally not approved yet.",
    "This profile remains disabled until its own strategy version is designed and paper-validated.",
  ],
};

export const THREE_TRADE_SWING_BOT: PaperBotProfile = {
  id: "three-trade-weekly-swing-100",
  name: "$100 Three-Trade Weekly Swing Bot",
  status: "planned",
  challengeStartingCash: 100,
  strategyId: null,
  style: "Selective swing-trading experiment with intentionally low trade frequency",
  universe: {
    assetClasses: ["stock", "etf"],
    description: "Liquid stocks and ETFs selected for multi-session swing setups.",
  },
  cadence: {
    description: "Swing trades only with at most three new entries per calendar week.",
    maximumNewTradesPerWeek: 3,
    swingOnly: true,
  },
  isolation: {
    separateVirtualLedger: true,
    sharePositionsWithOtherBots: false,
    shareRiskBudgetWithOtherBots: false,
  },
  notes: [
    "The three-trade limit applies to new entries, not protective exits or risk-reducing actions.",
    "Unused weekly trade slots do not create pressure to enter marginal setups.",
    "Exact scoring, holding-period, sizing, and exit parameters are intentionally not approved yet.",
  ],
};

export const PAPER_BOT_PROFILES = [
  DEFAULT_DIVERSE_BOT,
  PENNY_VOLATILITY_DAY_BOT,
  THREE_TRADE_SWING_BOT,
] as const;

export const ACTIVE_DEFAULT_PAPER_BOT = DEFAULT_DIVERSE_BOT;
