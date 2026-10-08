import { PAPER_STRATEGY_V1 } from "./paper-strategy-config";
import { THREE_TRADE_SWING_STRATEGY_V1 } from "./paper-swing-strategy-config";
import { ACTIVE_DAILY_CRYPTO_DAY_STRATEGY } from "./paper-weekend-crypto-strategy-config";
import { CRYPTO_SWING_STRATEGY_V1 } from "./paper-crypto-swing-strategy-config";
import { SQUEEZE_BREAKOUT_STRATEGY_V1 } from "./paper-squeeze-breakout-strategy-config";
import { MOMENTUM_BREAKOUT_STRATEGY_V1 } from "./paper-momentum-breakout-strategy-config";
import { CRYPTO_IGNITION_STRATEGY_V1 } from "./paper-crypto-ignition-strategy-config";
import { PAPER_BOT_TRADE_PLAN_CONTRACT_VERSION } from "./paper-bot-trade-plan";
import { FUSE_PENNY_STRATEGY_V1 } from "./paper-fuse-strategy-config";

export type PaperBotStatus = "active" | "planned" | "paused";
export type PaperBotPlanSource = "decision-engine" | "swing-readiness" | "crypto-readiness" | "crypto-swing-readiness" | "squeeze-breakout-readiness" | "momentum-breakout-readiness" | "crypto-ignition-readiness" | "fuse-readiness" | "not-configured";

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
  codename?: string;
  role?: string;
  holdingPeriod?: string;
  mission?: string;
  entrySignals?: string[];
  refusesWhen?: string[];
  executionState?: "automatic" | "research" | "planned";
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
  codename: "Atlas",
  role: "Diversified Generalist",
  holdingPeriod: "Intraday to multi-week",
  mission: "Route a broad mix of opportunities through the original diversified decision engine.",
  entrySignals: ["Cross-asset opportunity score", "Portfolio/risk fit", "Strategy-specific decision-engine approval"],
  refusesWhen: ["Risk veto fires", "Position or pool limits are reached", "Signal is not trade-ready"],
  executionState: "automatic",
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
    "This is the default profile for the current decision engine and uses the same $100 challenge baseline as every comparison bot.",
    "Current strategy logic remains PAPER_STRATEGY_V1 and is not duplicated here.",
    "The profile is simulation-only; a trade-ready score is not itself order permission.",
  ],
};

export const PENNY_VOLATILITY_DAY_BOT: PaperBotProfile = {
  id: "penny-volatility-day-100",
  name: "$100 Penny Volatility Day Bot",
  codename: "Fuse",
  role: "Penny-Stock Volatility",
  holdingPeriod: "Intraday only",
  mission: "Study early $0.08–$5 penny-stock momentum and reject thin, stale or already exhausted moves before simulated entries.",
  entrySignals: ["Assigned fresh Scanner v3 stock prospects", "5-minute relative volume and momentum ignition", "Fresh two-sided quote and 4-bar breakout", "Position sized to isolated $100 capital"],
  refusesWhen: ["Price outside $0.08–$5.00", "Spread, stale quote, thin liquidity, halt-like missing bars", "12%+ session gains or breakout chase above 1.25%", "Insufficient buying power, duplicate exposure or daily 1.5% loss limit"],
  executionState: "research",
  status: "active",
  challengeStartingCash: 100,
  brokerTag: "pny",
  strategyId: FUSE_PENNY_STRATEGY_V1.id,
  tradePlan: { contractVersion: PAPER_BOT_TRADE_PLAN_CONTRACT_VERSION, source: "fuse-readiness" },
  style: "Higher-volatility intraday penny-stock experiment",
  universe: {
    assetClasses: ["stock"],
    description: "Scanner-assigned $0.08–$5 stocks evaluated under Fuse v1 5m liquidity, spread, ignition and risk controls.",
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
    "Fuse v1 is research-only, with read-only readiness and auditable decisions per 5-minute bucket.",
    "0.5% equity risk per idea, 20% allocation cap, 1.5% daily loss cutoff, at most one open position and three entries per day.",
    "Submissions are not implemented or enabled. Close-before-overnight needs a separately verified exit manager and brokerage halt safety controls.",
  ],
};

export const THREE_TRADE_SWING_BOT: PaperBotProfile = {
  id: "three-trade-weekly-swing-100",
  name: "$100 Three-Trade Weekly Swing Bot",
  codename: "Harbor",
  role: "Selective Trend Swing",
  holdingPeriod: "Multi-day",
  mission: "Take only higher-quality trend continuation and breakout setups with low weekly trade frequency.",
  entrySignals: ["Price above 10/20-day trend", "Positive multi-day momentum", "Fresh same-session revalidation"],
  refusesWhen: ["Daily trend is not aligned", "Spread/quote/chase gates fail", "Weekly or risk limits are full"],
  executionState: "automatic",
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
    "Strategy v1 stages at most three fresh swing entries per week, sizes from a 1% planned-loss ceiling, and requires same-session revalidation before any simulated submission."
  ],
};


export const CRYPTO_SWING_BOT: PaperBotProfile = {
  id: "crypto-swing-100",
  name: "$100 Crypto Swing Bot",
  codename: "Orbit",
  role: "Multi-Day Crypto Swing",
  holdingPeriod: "1–7 days",
  mission: "Convert scanner-qualified crypto ideas into selective multi-hour/multi-day trend trades.",
  entrySignals: ["Scanner promotion", "Multi-hour trend/momentum", "Structure, spread and risk confirmation"],
  refusesWhen: ["Trend or structure is weak", "Risk budget is occupied", "Evidence has not reached the strategy ladder"],
  executionState: "research",
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
    description: "Multi-day crypto swings; up to three new entries per week and at most two open positions once automated execution is armed.",
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
    "Crypto Swing v1 is active for simulation research and reference-plan tracking, while broker execution remains intentionally disabled until enough evidence is collected.",
    "A scanner assignment is not trade authorization; the swing strategy has its own 70 watch / 80 qualified / 85 ready scoring ladder.",
  ],
};

export const SQUEEZE_BREAKOUT_BOT: PaperBotProfile = {
  id: "squeeze-breakout-100",
  name: "$100 Squeeze Breakout Bot",
  codename: "Coil",
  role: "Compression / Squeeze Breakout",
  holdingPeriod: "Intraday to several sessions",
  mission: "Find compressed bases where renewed volume may create asymmetric upside.",
  entrySignals: ["Extended price compression", "Volume re-expansion", "Breakout proximity and tradable spread"],
  refusesWhen: ["Base is too loose", "Volume ignition is missing", "Move is already too extended"],
  executionState: "research",
  status: "active",
  challengeStartingCash: 100,
  brokerTag: "sqz",
  strategyId: SQUEEZE_BREAKOUT_STRATEGY_V1.id,
  tradePlan: { contractVersion: PAPER_BOT_TRADE_PLAN_CONTRACT_VERSION, source: "squeeze-breakout-readiness" },
  style: "Base-compression and volume-ignition stock breakout strategy targeting asymmetric 20–30% opportunity zones",
  universe: {
    assetClasses: ["stock"],
    description: "Dynamic stock candidates discovered by the dedicated Squeeze Scanner after an extended compressed base and renewed volume activity.",
    maximumPriceUsd: SQUEEZE_BREAKOUT_STRATEGY_V1.scanner.maximumPriceUsd,
  },
  cadence: {
    description: "Short-horizon breakout trades held intraday to several sessions; maximum two new entries per day and two open positions once automated execution is armed.",
  },
  isolation: {
    separateVirtualLedger: true,
    sharePositionsWithOtherBots: false,
    shareRiskBudgetWithOtherBots: false,
  },
  notes: [
    "The scanner looks for roughly 20–60 trading days of price compression, historical volume contraction, and renewed relative-volume pace near a base-high breakout.",
    "The 20–30% range is an opportunity zone, not an expected or guaranteed return. Strategy v1 uses a 25% reference target with a 15% partial-profit reference and trailing remainder.",
    "Squeeze Breakout v1 is active for simulation research and reference-plan tracking. Broker execution remains intentionally disabled until signal quality is validated.",
    "A candidate is not assumed to be a true short squeeze unless future data adds actual short-interest/borrow evidence.",
  ],
};

export const DAILY_CRYPTO_DAY_BOT: PaperBotProfile = {
  id: "weekend-crypto-day-100",
  name: "$100 Daily Crypto Day Bot",
  codename: "Flash",
  role: "Confirmed Crypto Momentum",
  holdingPeriod: "Short horizon / 24×7",
  mission: "Trade higher-confidence crypto momentum after both fast and slower confirmation align.",
  entrySignals: ["80+ readiness score", "5m + 15m trend/momentum", "Breakout, spread, volatility and fee coverage"],
  refusesWhen: ["Slow confirmation is missing", "Score is below 80", "Spread/chase/risk gates fail"],
  executionState: "automatic",
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

export const MOMENTUM_BREAKOUT_BOT: PaperBotProfile = {
  id: "momentum-breakout-100",
  name: "Pulse — $100 Stock Momentum Breakout Bot",
  codename: "Pulse",
  role: "Intraday Stock Momentum Breakout",
  status: "active",
  challengeStartingCash: 100,
  brokerTag: "pls",
  strategyId: MOMENTUM_BREAKOUT_STRATEGY_V1.id,
  tradePlan: { contractVersion: PAPER_BOT_TRADE_PLAN_CONTRACT_VERSION, source: "momentum-breakout-readiness" },
  style: "Fast intraday continuation/reversal breakout strategy for scanner-qualified stocks that do not need multi-day trend alignment",
  holdingPeriod: "Intraday only",
  mission: "Own SNXX/MUU-type opportunities: strong live acceleration and breakout behavior that Weekly Swing correctly rejects for lacking a multi-day trend.",
  entrySignals: [
    "Prospect Scanner v3 score 80+",
    "Acceleration 15+ with a fresh prospect",
    "Tight live spread and fresh quote",
    "5-minute breakout + momentum + relative-volume ignition",
  ],
  refusesWhen: [
    "Price is below $5 and belongs in Fuse",
    "Spread is above 0.35%",
    "Acceleration fades or the prospect becomes stale",
    "Entry is beyond the ATR-based chase limit",
  ],
  executionState: "automatic",
  universe: {
    assetClasses: ["stock"],
    description: "Scanner-qualified US stocks above $5 with short-horizon acceleration, executable spreads, and live breakout confirmation.",
  },
  cadence: {
    description: "Intraday only; up to three new entries per day and two open positions.",
    intradayOnly: true,
  },
  isolation: {
    separateVirtualLedger: true,
    sharePositionsWithOtherBots: false,
    shareRiskBudgetWithOtherBots: false,
  },
  notes: [
    "Pulse intentionally does not require positive 10/20-day trend alignment; that remains Harbor's job.",
    "Risk is smaller than Weekly Swing: 0.5% planned equity loss per trade and 25% maximum allocation.",
    "Orders use simulated broker-hosted bracket protection once all same-session gates pass.",
  ],
};

export const CRYPTO_IGNITION_BOT: PaperBotProfile = {
  id: "crypto-ignition-100",
  name: "Spark — $100 Crypto Ignition Bot",
  codename: "Spark",
  role: "Early Crypto Momentum",
  status: "active",
  challengeStartingCash: 100,
  brokerTag: "spk",
  strategyId: CRYPTO_IGNITION_STRATEGY_V1.id,
  tradePlan: { contractVersion: PAPER_BOT_TRADE_PLAN_CONTRACT_VERSION, source: "crypto-ignition-readiness" },
  style: "Evidence-first early crypto momentum strategy for strong fast signals that have not yet earned Flash's slower confirmation",
  holdingPeriod: "Short horizon / 24×7",
  mission: "Study and eventually trade the 60–79 readiness tier when fast momentum, breakout, relative volume, spread and risk all agree before 15-minute confirmation catches up.",
  entrySignals: [
    "Flash source score 60–79",
    "Fresh quote and tight spread",
    "5-minute momentum + breakout",
    "Fast relative-volume ignition",
  ],
  refusesWhen: [
    "Score is below 60",
    "Score reaches 80+ and graduates to Flash",
    "Spread/chase/volatility gates fail",
    "Fast confirmation, spread, volatility or risk gates are not aligned",
  ],
  executionState: "automatic",
  universe: {
    assetClasses: ["crypto"],
    description: "BTC, ETH, SOL, LINK and DOT versus USD, evaluated specifically before slower 15-minute confirmation.",
  },
  cadence: {
    description: "24/7 evidence collection; maximum three entries per accounting day and one open position once automated execution is armed.",
  },
  isolation: {
    separateVirtualLedger: true,
    sharePositionsWithOtherBots: false,
    shareRiskBudgetWithOtherBots: false,
  },
  notes: [
    "Spark is deliberately separate from Flash so we can compare early entry evidence against the confirmed 80+ strategy without changing Flash.",
    "Automatic simulation uses a dedicated Spark entry, protective-stop, partial-profit, and trailing manager.",
    "Spark uses a smaller 0.35% planned risk budget and 20% allocation cap.",
  ],
};

export const PAPER_BOT_PROFILES = [
  DEFAULT_DIVERSE_BOT,
  PENNY_VOLATILITY_DAY_BOT,
  THREE_TRADE_SWING_BOT,
  CRYPTO_SWING_BOT,
  SQUEEZE_BREAKOUT_BOT,
  MOMENTUM_BREAKOUT_BOT,
  CRYPTO_IGNITION_BOT,
  DAILY_CRYPTO_DAY_BOT,
] as const;

export const WEEKEND_CRYPTO_DAY_BOT = DAILY_CRYPTO_DAY_BOT;

export const ACTIVE_DEFAULT_PAPER_BOT = DEFAULT_DIVERSE_BOT;
