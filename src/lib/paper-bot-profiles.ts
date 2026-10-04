import { PAPER_STRATEGY_V1 } from "./paper-strategy-config";
import { THREE_TRADE_SWING_STRATEGY_V1 } from "./paper-swing-strategy-config";
import { DAILY_CRYPTO_DAY_STRATEGY_V2 } from "./paper-weekend-crypto-strategy-config";

export type PaperBotStatus = "active" | "planned" | "paused";

export type PaperBotProfile = {
  id: string;
  name: string;
  status: PaperBotStatus;
  challengeStartingCash: number;
  brokerTag: string;
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
  brokerTag: "div",
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
  brokerTag: "pny",
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
  status: "active",
  challengeStartingCash: 100,
  brokerTag: "sw3",
  strategyId: THREE_TRADE_SWING_STRATEGY_V1.id,
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
    "Strategy v1 stages at most three fresh swing entries per week, sizes from a 1% planned-loss ceiling, and requires same-session revalidation before any paper submission."
  ],
};


export const DAILY_CRYPTO_DAY_BOT: PaperBotProfile = {
  id: "weekend-crypto-day-100",
  name: "$100 Daily Crypto Day Bot",
  status: "active",
  challengeStartingCash: 100,
  brokerTag: "wkd",
  strategyId: DAILY_CRYPTO_DAY_STRATEGY_V2.id,
  style: "Daily short-horizon crypto momentum proof of concept with fee-aware risk controls",
  universe: {
    assetClasses: ["crypto"],
    description: "BTC/USD, ETH/USD, and SOL/USD only for the initial daily PAPER proof of concept.",
  },
  cadence: {
    description: "Seven-day intraday crypto session; maximum three new entries per local day and one open position at a time.",
    intradayOnly: true,
  },
  isolation: {
    separateVirtualLedger: true,
    sharePositionsWithOtherBots: false,
    shareRiskBudgetWithOtherBots: false,
  },
  notes: [
    "Initial universe is intentionally limited to BTC/USD, ETH/USD, and SOL/USD.",
    "The strategy is fee-aware and requires a gross target materially larger than estimated round-trip crypto fees.",
    "No new position is allowed in a symbol already held by another bot during the proof of concept.",
    "The stable bot ID and wkd broker tag are retained from v1 so strategy history remains continuous across the daily v2 revision.",
  ],
};

export const PAPER_BOT_PROFILES = [
  DEFAULT_DIVERSE_BOT,
  PENNY_VOLATILITY_DAY_BOT,
  THREE_TRADE_SWING_BOT,
  DAILY_CRYPTO_DAY_BOT,
] as const;

export const WEEKEND_CRYPTO_DAY_BOT = DAILY_CRYPTO_DAY_BOT;

export const ACTIVE_DEFAULT_PAPER_BOT = DEFAULT_DIVERSE_BOT;
