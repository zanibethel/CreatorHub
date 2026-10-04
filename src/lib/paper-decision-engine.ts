import { ACTIVE_PAPER_STRATEGY, type PaperStrategyConfig } from "./paper-strategy-config";
import type { PaperWatchlist } from "./paper-watchlist";

export type DecisionCandle = {
  time: string;
  close: number;
  high?: number;
  low?: number;
  volume?: number;
};

export type DecisionQuote = {
  bid: number | null;
  ask: number | null;
  timestamp: string | null;
};

export type PortfolioRiskContext = {
  accountEquity?: number | null;
  openRiskPct?: number | null;
  correlatedRiskPct?: number | null;
  dailyRealizedLossPct?: number | null;
  weeklyDrawdownPct?: number | null;
};

export type DecisionCandidate = PaperWatchlist["stocks"][number] | PaperWatchlist["crypto"][number];

type ComponentName = keyof typeof ACTIVE_PAPER_STRATEGY.score.weights;
type ComponentScore = { points: number; maximum: number; evidence: string[] };

export type PaperDecision = {
  strategyId: string;
  strategyVersion: number;
  botProfileId: string;
  strategyName: string;
  mode: "paper-only";
  symbol: string;
  assetClass: "stock" | "crypto";
  direction: "long";
  score: number;
  qualification: "unqualified" | "watch" | "qualified" | "trade-ready";
  regime: "bullish" | "neutral" | "bearish" | "unknown";
  components: Record<ComponentName, ComponentScore>;
  metrics: {
    entry: number | null;
    spreadPct: number | null;
    fastReturnPct: number | null;
    slowReturnPct: number | null;
    benchmarkReturnPct: number | null;
    relativeStrengthPct: number | null;
    relativeVolume: number | null;
    atr: number | null;
    atrPct: number | null;
    fastAverage: number | null;
    slowAverage: number | null;
  };
  riskPlan: {
    riskPct: number;
    riskDollars: number | null;
    structureStop: number | null;
    atrStop: number | null;
    chosenStop: number | null;
    stopDistancePct: number | null;
    projectedTwoR: number | null;
    uncappedPositionValue: number | null;
  };
  referencePlan: {
    entryTrigger: number | null;
    stopPrice: number | null;
    stopDistancePct: number | null;
    exitPrice: number | null;
    riskDollars: number | null;
    uncappedPositionValue: number | null;
  };
  blockers: string[];
  warnings: string[];
  eligibleUnderAvailableRules: boolean;
  orderSubmission: false;
};

const finitePositive = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const round = (value: number, places = 4) => Number(value.toFixed(places));
const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : NaN;

function validCandles(candles: DecisionCandle[], now: number) {
  return candles
    .filter(candle => finitePositive(candle.close) && Number.isFinite(Date.parse(candle.time)) && Date.parse(candle.time) <= now)
    .sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
}

function pctChange(values: number[], lookback: number) {
  if (values.length <= lookback) return null;
  const latest = values.at(-1)!;
  const earlier = values.at(-(lookback + 1))!;
  return finitePositive(earlier) ? (latest / earlier - 1) * 100 : null;
}

function movingAverage(values: number[], period: number, offset = 0) {
  const end = values.length - offset;
  const start = end - period;
  if (start < 0 || end <= 0) return null;
  const value = average(values.slice(start, end));
  return Number.isFinite(value) ? value : null;
}

function trueRangeAverage(candles: DecisionCandle[], period: number) {
  if (candles.length < period + 1) return null;
  const ranges: number[] = [];
  for (let index = Math.max(1, candles.length - period); index < candles.length; index++) {
    const current = candles[index];
    const previous = candles[index - 1];
    const high = finitePositive(current.high) ? current.high : current.close;
    const low = finitePositive(current.low) ? current.low : current.close;
    const range = Math.max(high - low, Math.abs(high - previous.close), Math.abs(low - previous.close));
    if (Number.isFinite(range) && range >= 0) ranges.push(range);
  }
  const value = average(ranges);
  return Number.isFinite(value) ? value : null;
}

function classifyRegime(closes: number[], config: PaperStrategyConfig) {
  const fast = movingAverage(closes, config.regime.fastPeriod);
  const slow = movingAverage(closes, config.regime.slowPeriod);
  const priorSlow = movingAverage(closes, config.regime.slowPeriod, Math.min(5, Math.max(1, closes.length - config.regime.slowPeriod)));
  const latest = closes.at(-1) ?? null;
  if (latest === null || fast === null || slow === null || priorSlow === null) {
    return { regime: "unknown" as const, fast, slow };
  }
  if (latest > slow && fast > slow && slow >= priorSlow) return { regime: "bullish" as const, fast, slow };
  if (latest < slow && fast < slow && slow < priorSlow) return { regime: "bearish" as const, fast, slow };
  return { regime: "neutral" as const, fast, slow };
}

function scoreTrend(closes: number[], config: PaperStrategyConfig): ComponentScore {
  const latest = closes.at(-1);
  const fast = movingAverage(closes, config.regime.fastPeriod);
  const slow = movingAverage(closes, config.regime.slowPeriod);
  const priorSlow = movingAverage(closes, config.regime.slowPeriod, Math.min(5, Math.max(1, closes.length - config.regime.slowPeriod)));
  let points = 0;
  const evidence: string[] = [];
  if (latest && slow !== null && latest > slow) { points += 10; evidence.push("Price is above the slow moving average."); }
  else evidence.push("Price is not above the slow moving average.");
  if (fast !== null && slow !== null && fast > slow) { points += 8; evidence.push("Fast moving average is above the slow average."); }
  else evidence.push("Fast moving average is not above the slow average.");
  if (slow !== null && priorSlow !== null && slow >= priorSlow) { points += 7; evidence.push("Slow moving average slope is non-negative."); }
  else evidence.push("Slow moving average slope is negative or unavailable.");
  return { points, maximum: config.score.weights.trend, evidence };
}

function scoreMomentum(closes: number[], config: PaperStrategyConfig): ComponentScore {
  const fast = pctChange(closes, config.momentum.fastLookback);
  const slow = pctChange(closes, config.momentum.slowLookback);
  let points = 0;
  const evidence: string[] = [];
  if (fast !== null && fast > 0) { points += fast >= 2 ? 13 : 10; evidence.push(`Fast momentum is positive (${fast.toFixed(2)}%).`); }
  else evidence.push("Fast momentum is not positive or is unavailable.");
  if (slow !== null && slow > 0) { points += slow >= 4 ? 9 : 7; evidence.push(`Slow momentum is positive (${slow.toFixed(2)}%).`); }
  else evidence.push("Slow momentum is not positive or is unavailable.");
  if (fast !== null && slow !== null && fast > slow / 4) { points += 3; evidence.push("Recent momentum is not materially lagging the longer lookback."); }
  return { points: Math.min(points, config.score.weights.momentum), maximum: config.score.weights.momentum, evidence };
}

function scoreRelativeStrength(closes: number[], benchmarkCloses: number[], config: PaperStrategyConfig): ComponentScore {
  const candidate = pctChange(closes, config.momentum.slowLookback);
  const benchmark = pctChange(benchmarkCloses, config.momentum.slowLookback);
  if (candidate === null || benchmark === null) {
    return { points: 7.5, maximum: config.score.weights.relativeStrength, evidence: ["Benchmark comparison is incomplete; neutral score applied."] };
  }
  const edge = candidate - benchmark;
  const points = edge >= 5 ? 15 : edge >= 2 ? 12 : edge > 0 ? 9 : edge >= -2 ? 6 : 2;
  return { points, maximum: config.score.weights.relativeStrength, evidence: [`20-bar relative return is ${edge.toFixed(2)} percentage points versus the benchmark.`] };
}

function scoreSetup(candles: DecisionCandle[], config: PaperStrategyConfig): ComponentScore {
  const closes = candles.map(candle => candle.close);
  const latest = closes.at(-1);
  const slow = movingAverage(closes, config.regime.slowPeriod);
  if (!latest || slow === null) return { points: 0, maximum: config.score.weights.setupQuality, evidence: ["Insufficient history for setup structure."] };
  const prior = candles.slice(-(config.setup.breakoutLookback + 1), -1);
  const priorHigh = Math.max(...prior.map(candle => finitePositive(candle.high) ? candle.high : candle.close));
  const fastReturn = pctChange(closes, config.setup.pullbackLookback);
  if (Number.isFinite(priorHigh) && latest >= priorHigh * 0.995) {
    return { points: 15, maximum: config.score.weights.setupQuality, evidence: ["Price is testing or clearing the recent breakout range."] };
  }
  if (latest > slow && fastReturn !== null && fastReturn >= -3 && fastReturn <= 2) {
    return { points: 12, maximum: config.score.weights.setupQuality, evidence: ["Price is holding above trend support during a controlled pullback/consolidation."] };
  }
  if (latest > slow) return { points: 8, maximum: config.score.weights.setupQuality, evidence: ["Price remains above slow trend support but no stronger entry structure is detected."] };
  return { points: 2, maximum: config.score.weights.setupQuality, evidence: ["No long setup structure is confirmed."] };
}

function scoreVolume(candles: DecisionCandle[], config: PaperStrategyConfig): ComponentScore {
  const latest = candles.at(-1)?.volume;
  const history = candles.slice(-(config.volume.lookback + 1), -1).map(candle => candle.volume).filter(finitePositive);
  if (!finitePositive(latest) || !history.length) {
    return { points: 5, maximum: config.score.weights.volumeConfirmation, evidence: ["Volume history is unavailable; neutral half-weight score applied."] };
  }
  const baseline = average(history);
  const relative = latest / baseline;
  const points = relative >= config.volume.fullScoreRelativeVolume ? 10 : relative >= 1 ? 8 : relative >= 0.8 ? 5 : 2;
  return { points, maximum: config.score.weights.volumeConfirmation, evidence: [`Latest volume is ${relative.toFixed(2)}× the recent average.`] };
}

function scoreVolatility(candles: DecisionCandle[], config: PaperStrategyConfig): ComponentScore {
  const atr = trueRangeAverage(candles, config.volatility.atrPeriod);
  const latest = candles.at(-1)?.close;
  if (atr === null || !latest) return { points: 0, maximum: config.score.weights.volatilityQuality, evidence: ["ATR is unavailable."] };
  const atrPct = atr / latest * 100;
  const preferred = config.volatility.preferredAtrPct;
  const points = atrPct >= preferred.min && atrPct <= preferred.max ? 10
    : atrPct < preferred.min ? 6
    : atrPct <= config.volatility.hardMaximumAtrPct ? 4 : 0;
  return { points, maximum: config.score.weights.volatilityQuality, evidence: [`ATR is ${atrPct.toFixed(2)}% of price.`] };
}

function qualification(score: number, config: PaperStrategyConfig): PaperDecision["qualification"] {
  if (score >= config.score.thresholds.tradeReady) return "trade-ready";
  if (score >= config.score.thresholds.qualified) return "qualified";
  if (score >= config.score.thresholds.watch) return "watch";
  return "unqualified";
}

export function evaluatePaperCandidate(input: {
  candidate: DecisionCandidate;
  assetClass: "stock" | "crypto";
  quote: DecisionQuote;
  candles: DecisionCandle[];
  benchmarkCandles: DecisionCandle[];
  now?: number;
  risk?: PortfolioRiskContext;
  config?: PaperStrategyConfig;
}): PaperDecision {
  const config = input.config ?? ACTIVE_PAPER_STRATEGY;
  const now = input.now ?? Date.now();
  const candles = validCandles(input.candles, now);
  const benchmark = validCandles(input.benchmarkCandles, now);
  const closes = candles.map(candle => candle.close);
  const benchmarkCloses = benchmark.map(candle => candle.close);
  const components = {
    trend: scoreTrend(closes, config),
    momentum: scoreMomentum(closes, config),
    relativeStrength: scoreRelativeStrength(closes, benchmarkCloses, config),
    setupQuality: scoreSetup(candles, config),
    volumeConfirmation: scoreVolume(candles, config),
    volatilityQuality: scoreVolatility(candles, config),
  };
  const score = round(Object.values(components).reduce((sum, component) => sum + component.points, 0), 2);
  const state = qualification(score, config);
  const regimeResult = classifyRegime(benchmarkCloses, config);
  const blockers: string[] = [];
  const warnings: string[] = [];

  const validQuote = finitePositive(input.quote.bid) && finitePositive(input.quote.ask) && input.quote.ask >= input.quote.bid;
  const quoteTime = input.quote.timestamp ? Date.parse(input.quote.timestamp) : NaN;
  const quoteAge = Number.isFinite(quoteTime) ? now - quoteTime : Infinity;
  const freshQuote = quoteAge >= -config.marketData.maxQuoteAgeMs && quoteAge < config.marketData.maxQuoteAgeMs;
  const entry = validQuote ? (input.quote.bid! + input.quote.ask!) / 2 : null;
  const spreadPct = validQuote && entry ? (input.quote.ask! - input.quote.bid!) / entry * 100 : null;
  const maxSpread = config.marketData.maximumSpreadPct[input.assetClass];

  if (input.candidate.symbol === "SH" || input.candidate.symbol === "PSQ" || input.candidate.pools.length === 0) blockers.push("Candidate is monitor-only with no funded pool.");
  if (!input.candidate.tradable) blockers.push("Candidate is not marked tradable in the persisted watchlist.");
  if (!validQuote) blockers.push("Positive, non-crossed bid and ask are required.");
  if (!freshQuote) blockers.push("A fresh quote is required.");
  if (spreadPct === null || spreadPct > maxSpread) blockers.push(`Quoted spread must be at or below ${maxSpread.toFixed(2)}%.`);
  if (candles.length < config.marketData.minimumHistoryBars) blockers.push(`At least ${config.marketData.minimumHistoryBars} valid history bars are required.`);
  if (regimeResult.regime === "bearish") blockers.push("Broad market regime is bearish for the current long-only engine.");
  if (regimeResult.regime === "unknown") blockers.push("Broad market regime cannot be established from the supplied benchmark history.");
  if (state !== "trade-ready") blockers.push(`Qualification score is below the ${config.score.thresholds.tradeReady}-point trade-ready threshold.`);

  const atr = trueRangeAverage(candles, config.volatility.atrPeriod);
  const atrPct = atr !== null && entry ? atr / entry * 100 : null;
  if (atrPct === null) blockers.push("ATR cannot be calculated.");
  else if (atrPct > config.volatility.hardMaximumAtrPct) blockers.push(`ATR exceeds the ${config.volatility.hardMaximumAtrPct.toFixed(2)}% hard volatility ceiling.`);

  const supportBars = candles.slice(-config.setup.supportLookback);
  const support = supportBars.length ? Math.min(...supportBars.map(candle => finitePositive(candle.low) ? candle.low : candle.close)) : null;
  const structureStop = entry && atr !== null && support !== null ? support - atr * config.risk.structureBufferAtr : null;
  const atrStop = entry && atr !== null ? entry - atr * config.risk.atrStopMultiplier : null;
  const chosenStop = structureStop !== null && atrStop !== null ? Math.min(structureStop, atrStop) : null;
  const stopDistancePct = entry && chosenStop !== null && chosenStop > 0 && chosenStop < entry ? (entry - chosenStop) / entry * 100 : null;
  if (stopDistancePct === null) blockers.push("A valid protective stop cannot be derived before entry.");
  else if (stopDistancePct > config.risk.maximumStopDistancePct) blockers.push(`Required stop distance exceeds the ${config.risk.maximumStopDistancePct.toFixed(2)}% maximum.`);

  const riskPct = score >= config.risk.highConvictionScore ? config.risk.highConvictionRiskPct : config.risk.standardRiskPct;
  const equity = input.risk?.accountEquity;
  const riskDollars = finitePositive(equity) ? equity * riskPct / 100 : null;
  const uncappedPositionValue = riskDollars !== null && stopDistancePct !== null && stopDistancePct > 0 ? riskDollars / (stopDistancePct / 100) : null;
  const projectedTwoR = entry !== null && chosenStop !== null && chosenStop < entry
    ? entry + (entry - chosenStop) * config.risk.minimumRewardR : null;

  const referenceBars = candles.slice(-(config.setup.breakoutLookback + 1), -1);
  const referenceHigh = referenceBars.length
    ? Math.max(...referenceBars.map(candle => finitePositive(candle.high) ? candle.high : candle.close))
    : null;
  const referenceEntry = finitePositive(referenceHigh)
    ? referenceHigh * (1 + config.setup.breakoutBufferPct / 100)
    : null;
  const referenceStructureStop = referenceEntry !== null && atr !== null && support !== null
    ? support - atr * config.risk.structureBufferAtr
    : null;
  const referenceAtrStop = referenceEntry !== null && atr !== null
    ? referenceEntry - atr * config.risk.atrStopMultiplier
    : null;
  const referenceStop = referenceStructureStop !== null && referenceAtrStop !== null
    ? Math.min(referenceStructureStop, referenceAtrStop)
    : null;
  const referenceStopDistancePct = referenceEntry !== null && referenceStop !== null && referenceStop > 0 && referenceStop < referenceEntry
    ? (referenceEntry - referenceStop) / referenceEntry * 100
    : null;
  const referencePositionValue = riskDollars !== null && referenceStopDistancePct !== null && referenceStopDistancePct > 0
    ? riskDollars / (referenceStopDistancePct / 100)
    : null;
  const referenceExit = referenceEntry !== null && referenceStop !== null && referenceStop < referenceEntry
    ? referenceEntry + (referenceEntry - referenceStop) * config.risk.minimumRewardR
    : null;

  if (!finitePositive(equity)) blockers.push("Account equity is required for risk-based position sizing.");
  const openRisk = input.risk?.openRiskPct;
  const correlatedRisk = input.risk?.correlatedRiskPct;
  const dailyLoss = input.risk?.dailyRealizedLossPct;
  const weeklyDrawdown = input.risk?.weeklyDrawdownPct;
  if (openRisk == null || !Number.isFinite(openRisk)) blockers.push("Current total open planned risk is required.");
  else if (openRisk + riskPct > config.risk.maxOpenRiskPct) blockers.push("New trade would exceed the total open-risk ceiling.");
  if (correlatedRisk == null || !Number.isFinite(correlatedRisk)) blockers.push("Current correlated exposure risk is required.");
  else if (correlatedRisk + riskPct > config.risk.maxCorrelatedRiskPct) blockers.push("New trade would exceed the correlated-risk ceiling.");
  if (dailyLoss == null || !Number.isFinite(dailyLoss)) blockers.push("Daily realized-loss state is required.");
  else if (dailyLoss >= config.risk.dailyRealizedLossLimitPct) blockers.push("Daily loss kill switch is active.");
  if (weeklyDrawdown == null || !Number.isFinite(weeklyDrawdown)) blockers.push("Weekly drawdown state is required.");
  else if (weeklyDrawdown >= config.risk.weeklyDrawdownLimitPct) blockers.push("Weekly drawdown kill switch is active.");

  // Pools are portfolio allocation ceilings (20/40/40), not fixed position sizes.
  // Until current pool usage is supplied, final authorization remains blocked.
  blockers.push("Current pool allocation capacity must be checked before order authorization.");

  if (regimeResult.regime === "neutral") warnings.push("Market regime is neutral; the engine has not applied a bearish veto but conviction is reduced.");
  if (components.volumeConfirmation.points === 5 && components.volumeConfirmation.evidence[0]?.includes("unavailable")) warnings.push("Volume confirmation is neutral because volume history is unavailable.");

  const fastReturnPct = pctChange(closes, config.momentum.fastLookback);
  const slowReturnPct = pctChange(closes, config.momentum.slowLookback);
  const benchmarkReturnPct = pctChange(benchmarkCloses, config.momentum.slowLookback);

  return {
    strategyId: config.id,
    strategyVersion: config.version,
    botProfileId: config.botProfileId,
    strategyName: config.displayName,
    mode: "paper-only",
    symbol: input.candidate.symbol,
    assetClass: input.assetClass,
    direction: "long",
    score,
    qualification: state,
    regime: regimeResult.regime,
    components,
    metrics: {
      entry: entry === null ? null : round(entry),
      spreadPct: spreadPct === null ? null : round(spreadPct),
      fastReturnPct: fastReturnPct === null ? null : round(fastReturnPct),
      slowReturnPct: slowReturnPct === null ? null : round(slowReturnPct),
      benchmarkReturnPct: benchmarkReturnPct === null ? null : round(benchmarkReturnPct),
      relativeStrengthPct: slowReturnPct === null || benchmarkReturnPct === null ? null : round(slowReturnPct - benchmarkReturnPct),
      relativeVolume: (() => {
        const latest = candles.at(-1)?.volume;
        const values = candles.slice(-(config.volume.lookback + 1), -1).map(candle => candle.volume).filter(finitePositive);
        const baseline = average(values);
        return finitePositive(latest) && Number.isFinite(baseline) && baseline > 0 ? round(latest / baseline) : null;
      })(),
      atr: atr === null ? null : round(atr),
      atrPct: atrPct === null ? null : round(atrPct),
      fastAverage: regimeResult.fast === null ? null : round(regimeResult.fast),
      slowAverage: regimeResult.slow === null ? null : round(regimeResult.slow),
    },
    riskPlan: {
      riskPct,
      riskDollars: riskDollars === null ? null : round(riskDollars, 2),
      structureStop: structureStop !== null && structureStop > 0 ? round(structureStop) : null,
      atrStop: atrStop !== null && atrStop > 0 ? round(atrStop) : null,
      chosenStop: chosenStop !== null && chosenStop > 0 ? round(chosenStop) : null,
      stopDistancePct: stopDistancePct === null ? null : round(stopDistancePct),
      projectedTwoR: projectedTwoR === null ? null : round(projectedTwoR),
      uncappedPositionValue: uncappedPositionValue === null ? null : round(uncappedPositionValue, 2),
    },
    referencePlan: {
      entryTrigger: referenceEntry === null ? null : round(referenceEntry),
      stopPrice: referenceStop !== null && referenceStop > 0 ? round(referenceStop) : null,
      stopDistancePct: referenceStopDistancePct === null ? null : round(referenceStopDistancePct),
      exitPrice: referenceExit === null ? null : round(referenceExit),
      riskDollars: riskDollars === null ? null : round(riskDollars, 2),
      uncappedPositionValue: referencePositionValue === null ? null : round(referencePositionValue, 2),
    },
    blockers: [...new Set(blockers)],
    warnings: [...new Set(warnings)],
    eligibleUnderAvailableRules: blockers.length === 0,
    orderSubmission: false,
  };
}
