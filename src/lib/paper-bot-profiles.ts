import { PAPER_STRATEGY_V1 } from "./paper-strategy-config";
import { THREE_TRADE_SWING_STRATEGY_V1 } from "./paper-swing-strategy-config";
import { ACTIVE_DAILY_CRYPTO_DAY_STRATEGY } from "./paper-weekend-crypto-strategy-config";
import { CRYPTO_SWING_STRATEGY_V1 } from "./paper-crypto-swing-strategy-config";
import { PAPER_BOT_TRADE_PLAN_CONTRACT_VERSION } from "./paper-bot-trade-plan";

export type PaperBotStatus = "active" | "planned" | "paused";
export type PaperBotPlanSource = "decision-engine" | "swing-readiness" | "crypto-readiness" | "crypto-swing-readiness" | "not-configured";

export type PaperBotProfile = {
  id: string;
  name: string;
  status: PaperBotStatus;
  challengeStartingCash: number;
  brokerTag: string;
  strategyId: string | null;
  tradePlan: {
    contractVersion: typeof PAPER_BOT_TRADE_PLAN_CONTRACT_VERSION;
    source: PaperBotPlanSource;
  };
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
  tradePlan: { contractVersion: PAPER_BOT_TRADE_PLAN_CONTRACT_VERSION, source: "decision-engine" },
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
  tradePlan: { contractVersion: PAPER_BOT_TRADE_PLAN_CONTRACT_VERSION, source: "not-configured" },
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
  tradePlan: { contractVersion: PAPER_BOT_TRADE_PLAN_CONTRACT_VERSION, source: "swing-readiness" },
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


export const CRYPTO_SWING_BOT: PaperBotProfile = {
  id: "crypto-swing-100",
  name: "$100 Crypto Swing Bot",
  status: "active",
  challengeStartingCash: 100,
  brokerTag: "csw",
  strategyId: CRYPTO_SWING_STRATEGY_V1.id,
  tradePlan: { contractVersion: PAPER_BOT_TRADE_PLAN_CONTRACT_VERSION, source: "crypto-swing-readiness" },
  style: "Selective 1-7 day crypto swing strategy fed by the separate Prospect Scanner",
  universe: {
    assetClasses: ["crypto"],
    description: "Dynamic crypto prospects promoted by the market Prospect Scanner rather than a fixed execution list.",
  },
  cadence: {
    description: "Multi-day crypto swings; up to three new entries per week and at most two open positions once PAPER execution is armed.",
    maximumNewTradesPerWeek: 3,
    swingOnly: true,
  },
  isolation: {
    separateVirtualLedger: true,
    sharePositionsWithOtherBots: false,
    shareRiskBudgetWithOtherBots: false,
  },
  notes: [
    "The bot receives review-ready crypto prospects from the separate scanner and applies its own multi-hour trend, momentum, volume, structure, spread and risk gates.",
    "Crypto Swing v1 is active for PAPER research and reference-plan tracking, while broker execution remains intentionally disabled until enough evidence is collected.",
    "A scanner assignment is not trade authorization; the swing strategy has its own 70 watch / 80 qualified / 85 ready scoring ladder.",
  ],
};

export const DAILY_CRYPTO_DAY_BOT: PaperBotProfile = {
  id: "weekend-crypto-day-100",
  name: "$100 Daily Crypto Day Bot",
  status: "active",
  challengeStartingCash: 100,
  brokerTag: "wkd",
  strategyId: ACTIVE_DAILY_CRYPTO_DAY_STRATEGY.id,
  tradePlan: { contractVersion: PAPER_BOT_TRADE_PLAN_CONTRACT_VERSION, source: "crypto-readiness" },
  style: "Continuous 24/7 short-horizon crypto momentum proof of concept with fee-aware risk controls",
  universe: {
    assetClasses: ["crypto"],
    description: "Execution pool: BTC/USD, ETH/USD, SOL/USD, LINK/USD, DOT/USD. Extended monitor-only pool: XRP, LTC, AVAX, DOGE, ADA, BCH, AAVE, HYPE, RENDER versus USD."
  },
  cadence: {
    description: "Continuous 24/7 crypto scanning and entries; maximum three new entries per America/Chicago accounting day and one open position at a time.",
    intradayOnly: false,
  },
  isolation: {
    separateVirtualLedger: true,
    sharePositionsWithOtherBots: false,
    shareRiskBudgetWithOtherBots: false,
  },
  notes: [
    "LINK/USD and DOT/USD remain execution-eligible in v4; the extended altcoin pool is monitored but cannot submit orders yet.",
    "The strategy is fee-aware and requires a gross target materially larger than estimated round-trip crypto fees.",
    "No new position is allowed in a symbol already held by another bot during the proof of concept.",
    "The stable bot ID and wkd broker tag are retained so history remains continuous across v1-v4; v4 removes the artificial nightly cutoff while preserving all risk/quality gates.",
  ],
};

export const PAPER_BOT_PROFILES = [
  DEFAULT_DIVERSE_BOT,
  PENNY_VOLATILITY_DAY_BOT,
  THREE_TRADE_SWING_BOT,
  CRYPTO_SWING_BOT,
  DAILY_CRYPTO_DAY_BOT,
] as const;

export const WEEKEND_CRYPTO_DAY_BOT = DAILY_CRYPTO_DAY_BOT;

export const ACTIVE_DEFAULT_PAPER_BOT = DEFAULT_DIVERSE_BOT;
