import { PAPER_BOT_TRADE_PLAN_CONTRACT_VERSION, type PaperBotTradePlan } from "./paper-bot-trade-plan";
import { SQUEEZE_BREAKOUT_STRATEGY_V1 as strategy } from "./paper-squeeze-breakout-strategy-config";

export type SqueezeStoredProspect = {
  symbol: string;
  scannerScore: number;
  baseHigh: number | null;
  baseLow: number | null;
  baseRangePct: number | null;
  relativeVolumePace: number | null;
  sessionChangePct: number | null;
  spreadPct: number | null;
  averageDollarVolume: number | null;
  reasons: string[];
};

export type SqueezeQuote = {
  bid: number | null;
  ask: number | null;
  timestamp: string | null;
};

export type SqueezeLedger = {
  active: boolean;
  equity: number;
  buyingPower: number;
  openRiskPct: number;
  openPositions: number;
  executionEnabled: boolean;
};

const finitePositive = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function quoteSpreadPct(quote: SqueezeQuote) {
  if (!finitePositive(quote.bid) || !finitePositive(quote.ask) || quote.ask < quote.bid) return null;
  const mid = (quote.bid + quote.ask) / 2;
  return mid > 0 ? (quote.ask - quote.bid) / mid * 100 : null;
}

function quoteAgeSeconds(quote: SqueezeQuote, now: number) {
  const parsed = quote.timestamp ? Date.parse(quote.timestamp) : NaN;
  return Number.isFinite(parsed) ? Math.max(0, (now - parsed) / 1000) : null;
}

function scannerPoints(score: number) {
  if (score >= 95) return 35;
  if (score >= 90) return 32;
  if (score >= 85) return 30;
  if (score >= 80) return 27;
  if (score >= 75) return 22;
  if (score >= 70) return 18;
  return 12;
}

function volumePoints(ratio: number | null) {
  if (ratio == null) return 0;
  if (ratio >= 4) return 25;
  if (ratio >= 3) return 22;
  if (ratio >= 2) return 18;
  if (ratio >= 1.5) return 12;
  if (ratio >= 1.2) return 6;
  return 0;
}

function breakoutPoints(current: number | null, baseHigh: number | null) {
  if (!finitePositive(current) || !finitePositive(baseHigh)) return 0;
  const distance = (current / baseHigh - 1) * 100;
  if (distance >= strategy.setup.breakoutBufferPct && distance <= 2) return 20;
  if (distance >= 0 && distance <= strategy.setup.breakoutBufferPct) return 17;
  if (distance >= -1) return 14;
  if (distance >= -3) return 9;
  if (distance >= -5) return 4;
  return 0;
}

function momentumPoints(change: number | null) {
  if (change == null) return 0;
  if (change >= 2 && change <= 8) return 10;
  if (change >= 1 && change <= 12) return 8;
  if (change >= 0.5 && change <= 15) return 5;
  if (change > 15) return 1;
  return 0;
}

function liquidityPoints(spread: number | null, dollarVolume: number | null) {
  if (spread == null || dollarVolume == null) return 0;
  if (spread <= 0.4 && dollarVolume >= 5_000_000) return 10;
  if (spread <= 0.75 && dollarVolume >= 2_000_000) return 8;
  if (spread <= strategy.scanner.maximumSpreadPct && dollarVolume >= strategy.scanner.minimumAverageDollarVolume) return 5;
  return 0;
}

export function evaluateSqueezeBreakoutCandidate(input: {
  now: number;
  prospect: SqueezeStoredProspect;
  quote: SqueezeQuote;
  ledger: SqueezeLedger;
}): PaperBotTradePlan {
  const { prospect, quote, ledger } = input;
  const blockers: string[] = [];
  const warnings: string[] = [];
  const quoteAge = quoteAgeSeconds(quote, input.now);
  const spread = quoteSpreadPct(quote) ?? prospect.spreadPct;
  const currentPrice = finitePositive(quote.bid) && finitePositive(quote.ask)
    ? (quote.bid + quote.ask) / 2
    : quote.ask ?? quote.bid ?? null;

  const score = clamp(
    scannerPoints(prospect.scannerScore)
      + volumePoints(prospect.relativeVolumePace)
      + breakoutPoints(currentPrice, prospect.baseHigh)
      + momentumPoints(prospect.sessionChangePct)
      + liquidityPoints(spread, prospect.averageDollarVolume),
    0,
    100,
  );

  if (!ledger.active) blockers.push("Squeeze Breakout ledger is not active.");
  if (!(ledger.equity > 0) || !(ledger.buyingPower > 0)) blockers.push("Virtual buying power is unavailable.");
  if (ledger.openPositions >= strategy.cadence.maximumOpenPositions) blockers.push("Maximum squeeze positions are already open.");
  if (ledger.openRiskPct >= strategy.risk.maximumOpenRiskPct) blockers.push("Squeeze bot open-risk ceiling is already reached.");
  if (!finitePositive(prospect.baseHigh) || !finitePositive(prospect.baseLow)) blockers.push("A valid compressed base is required.");
  if (prospect.baseRangePct == null || prospect.baseRangePct > strategy.scanner.maximumBaseRangePct) blockers.push("Base range is too wide for v1.");
  if (prospect.averageDollarVolume == null || prospect.averageDollarVolume < strategy.scanner.minimumAverageDollarVolume) blockers.push("Average dollar volume is below the tradability floor.");
  if (quoteAge == null || quoteAge > 120) warnings.push("Waiting for a fresh quote.");
  if (spread == null) warnings.push("Waiting for a valid spread.");
  else if (spread > strategy.scanner.maximumSpreadPct) blockers.push(`Spread ${spread.toFixed(2)}% exceeds the squeeze-entry limit.`);

  let entryPrice: number | null = null;
  let stopPrice: number | null = null;
  let exitPrice: number | null = null;
  let purchaseAmount: number | null = null;
  let maxLossDollars: number | null = null;
  let projectedProfitDollars: number | null = null;

  if (finitePositive(prospect.baseHigh) && ledger.equity > 0 && ledger.buyingPower > 0) {
    entryPrice = prospect.baseHigh * (1 + strategy.setup.breakoutBufferPct / 100);
    const baseDerivedStop = prospect.baseRangePct == null
      ? strategy.risk.defaultStopPct
      : clamp(prospect.baseRangePct * 0.35, strategy.risk.minimumStopPct, strategy.risk.maximumStopPct);
    stopPrice = entryPrice * (1 - baseDerivedStop / 100);
    exitPrice = entryPrice * (1 + strategy.opportunity.primaryTargetPct / 100);
    const riskBudget = ledger.equity * strategy.risk.riskPerTradePct / 100;
    const riskSizedNotional = riskBudget / (baseDerivedStop / 100);
    const allocationCap = ledger.equity * strategy.risk.maximumPositionAllocationPct / 100;
    purchaseAmount = Math.min(riskSizedNotional, allocationCap, ledger.buyingPower);
    maxLossDollars = purchaseAmount * baseDerivedStop / 100;
    projectedProfitDollars = purchaseAmount * strategy.opportunity.primaryTargetPct / 100;
  }

  const breakoutPct = finitePositive(currentPrice) && finitePositive(prospect.baseHigh)
    ? (currentPrice / prospect.baseHigh - 1) * 100
    : null;
  const breakoutConfirmed = breakoutPct != null && breakoutPct >= strategy.setup.breakoutBufferPct;
  const notOverChased = breakoutPct != null && breakoutPct <= strategy.setup.maximumChasePct;
  const volumeReady = prospect.relativeVolumePace != null && prospect.relativeVolumePace >= strategy.setup.readyRelativeVolumePace;
  const momentumReady = prospect.sessionChangePct != null
    && prospect.sessionChangePct >= strategy.setup.minimumSessionChangePct
    && prospect.sessionChangePct <= strategy.setup.maximumReadySessionChangePct;
  const quoteReady = quoteAge != null && quoteAge <= 120;
  const spreadReady = spread != null && spread <= strategy.scanner.maximumSpreadPct;
  const strategyReady = score >= strategy.setup.readyScore
    && blockers.length === 0
    && breakoutConfirmed
    && notOverChased
    && volumeReady
    && momentumReady
    && quoteReady
    && spreadReady;

  if (score < strategy.setup.watchScore) warnings.push(`Squeeze score ${score.toFixed(0)} is below the ${strategy.setup.watchScore} watch threshold.`);
  else if (score < strategy.setup.qualifiedScore) warnings.push("Compression/ignition setup is watch-quality but not yet qualified.");
  else if (score < strategy.setup.readyScore) warnings.push("Compression/ignition setup is qualified but below READY.");
  if (score >= strategy.setup.readyScore && !volumeReady) warnings.push("High setup score, but relative-volume ignition has not reached the READY threshold.");
  if (score >= strategy.setup.readyScore && !breakoutConfirmed) warnings.push("High setup score, but price has not confirmed the base-high breakout.");
  if (breakoutPct != null && !notOverChased) warnings.push("Price is already beyond the v1 maximum chase distance.");
  if (strategyReady && !ledger.executionEnabled) warnings.push("Strategy gates pass, but Squeeze Breakout automated execution is intentionally not armed yet.");

  const state = strategyReady
    ? ledger.executionEnabled ? "READY" : "QUALIFIED"
    : score >= strategy.setup.qualifiedScore ? "QUALIFIED"
      : score >= strategy.setup.watchScore ? "WATCHING"
        : "DEVELOPING";

  return {
    contractVersion: PAPER_BOT_TRADE_PLAN_CONTRACT_VERSION,
    botId: strategy.botProfileId,
    strategyId: strategy.id,
    strategyVersion: strategy.version,
    symbol: prospect.symbol,
    label: "Compression / squeeze breakout",
    assetClass: "stock",
    currentPrice,
    score,
    state,
    detail: blockers[0] ?? warnings[0] ?? prospect.reasons[0] ?? "Compressed base with increasing volume under review.",
    horizons: ["day", "swing"],
    executionEligible: strategyReady && ledger.executionEnabled,
    selectedForSubmission: false,
    blockers,
    warnings,
    plan: {
      phase: entryPrice != null && stopPrice != null && exitPrice != null ? "reference" : "awaiting-data",
      entryPrice,
      purchaseAmount,
      stopPrice,
      maxLossDollars,
      exitPrice,
      projectedProfitDollars,
      projectedProfitPct: entryPrice != null ? strategy.opportunity.primaryTargetPct : null,
    },
  };
}
