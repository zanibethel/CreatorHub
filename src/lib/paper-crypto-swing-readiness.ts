import { PAPER_BOT_TRADE_PLAN_CONTRACT_VERSION, type PaperBotTradePlan } from "./paper-bot-trade-plan";
import { CRYPTO_SWING_STRATEGY_V1 as strategy } from "./paper-crypto-swing-strategy-config";

export type CryptoSwingBar = {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
};

export type CryptoSwingQuote = {
  bid: number | null;
  ask: number | null;
  timestamp: string | null;
};

export type CryptoSwingCandidate = {
  symbol: string;
  prospectScore: number;
  prospectReasons: string[];
  firstSeenAt: string;
  newsScore: number;
  newsBotImpact: number;
};

export type CryptoSwingLedger = {
  active: boolean;
  equity: number;
  buyingPower: number;
  openRiskPct: number;
  openPositions: number;
  executionEnabled: boolean;
};

const finitePositive = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;
const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function sma(bars: CryptoSwingBar[], period: number) {
  const closes = bars.slice(-period).map(bar => bar.c).filter(finitePositive);
  return closes.length === period ? average(closes) : null;
}

function atr(bars: CryptoSwingBar[], period = 14) {
  if (bars.length < period + 1) return null;
  const values: number[] = [];
  for (let index = bars.length - period; index < bars.length; index += 1) {
    const bar = bars[index];
    const prior = bars[index - 1];
    if (!bar || !prior) continue;
    values.push(Math.max(
      bar.h - bar.l,
      Math.abs(bar.h - prior.c),
      Math.abs(bar.l - prior.c),
    ));
  }
  return values.length === period ? average(values) : null;
}

function returnPct(bars: CryptoSwingBar[], lookback: number) {
  if (bars.length <= lookback) return null;
  const start = bars[bars.length - 1 - lookback]?.c;
  const end = bars.at(-1)?.c;
  return finitePositive(start) && finitePositive(end) ? (end / start - 1) * 100 : null;
}

function volumeRatio(bars: CryptoSwingBar[]) {
  if (bars.length < 24) return null;
  const recent = average(bars.slice(-12).map(bar => bar.v).filter(value => Number.isFinite(value) && value >= 0));
  const prior = average(bars.slice(-24, -12).map(bar => bar.v).filter(value => Number.isFinite(value) && value >= 0));
  return recent !== null && prior !== null && prior > 0 ? recent / prior : null;
}

function quoteSpreadPct(quote: CryptoSwingQuote) {
  if (!finitePositive(quote.bid) || !finitePositive(quote.ask) || quote.ask < quote.bid) return null;
  const mid = (quote.bid + quote.ask) / 2;
  return mid > 0 ? (quote.ask - quote.bid) / mid * 100 : null;
}

function quoteAgeSeconds(quote: CryptoSwingQuote, now: number) {
  const parsed = quote.timestamp ? Date.parse(quote.timestamp) : NaN;
  return Number.isFinite(parsed) ? Math.max(0, (now - parsed) / 1000) : null;
}

function momentumPoints(value: number | null) {
  if (value === null || value <= 0) return 0;
  if (value >= 8) return 25;
  if (value >= 5) return 22;
  if (value >= 3) return 18;
  if (value >= 2) return 14;
  if (value >= 1) return 9;
  return 4;
}

function structurePoints(distanceFromHighPct: number | null) {
  if (distanceFromHighPct === null || distanceFromHighPct < 0) return 0;
  if (distanceFromHighPct <= 0.5) return 20;
  if (distanceFromHighPct <= 1) return 18;
  if (distanceFromHighPct <= 2) return 15;
  if (distanceFromHighPct <= 4) return 10;
  if (distanceFromHighPct <= 7) return 5;
  return 0;
}

function volumePoints(ratio: number | null) {
  if (ratio === null) return 0;
  if (ratio >= 2) return 15;
  if (ratio >= 1.5) return 13;
  if (ratio >= 1.2) return 10;
  if (ratio >= 1) return 7;
  if (ratio >= 0.8) return 4;
  return 0;
}

function discoveryPoints(score: number) {
  if (score >= 95) return 10;
  if (score >= 90) return 8;
  if (score >= 85) return 7;
  if (score >= 80) return 6;
  return 3;
}

export function evaluateCryptoSwingCandidate(input: {
  now: number;
  candidate: CryptoSwingCandidate;
  quote: CryptoSwingQuote;
  bars: CryptoSwingBar[];
  ledger: CryptoSwingLedger;
}): PaperBotTradePlan {
  const { candidate, quote, bars, ledger } = input;
  const blockers: string[] = [];
  const warnings: string[] = [];
  const last = bars.at(-1);
  const fast = sma(bars, strategy.setup.fastAveragePeriod);
  const slow = sma(bars, strategy.setup.slowAveragePeriod);
  const currentAtr = atr(bars);
  const momentum = returnPct(bars, strategy.setup.momentumLookbackBars);
  const recentBars = bars.slice(-strategy.setup.breakoutLookbackBars);
  const recentHigh = recentBars.length ? Math.max(...recentBars.map(bar => bar.h)) : null;
  const recentLow = bars.slice(-24).length ? Math.min(...bars.slice(-24).map(bar => bar.l)) : null;
  const close = last?.c ?? null;
  const spread = quoteSpreadPct(quote);
  const age = quoteAgeSeconds(quote, input.now);
  const volumeExpansion = volumeRatio(bars);
  const distanceFromHighPct = finitePositive(close) && finitePositive(recentHigh)
    ? Math.max(0, (recentHigh - close) / recentHigh * 100)
    : null;

  let trend = 0;
  if (finitePositive(fast) && finitePositive(slow) && fast > slow) trend += 20;
  if (finitePositive(close) && finitePositive(fast) && close > fast) trend += 10;

  const newsImpact = clamp(candidate.newsBotImpact, -6, 6);

  const score = clamp(
    trend
      + momentumPoints(momentum)
      + structurePoints(distanceFromHighPct)
      + volumePoints(volumeExpansion)
      + discoveryPoints(candidate.prospectScore)
      + newsImpact,
    0,
    100,
  );

  if (!ledger.active) blockers.push("Crypto swing ledger is not active.");
  if (!(ledger.equity > 0) || !(ledger.buyingPower > 0)) blockers.push("Virtual buying power is unavailable.");
  if (ledger.openPositions >= strategy.cadence.maximumOpenPositions) blockers.push("Maximum crypto swing positions are already open.");
  if (ledger.openRiskPct >= strategy.risk.maximumOpenRiskPct) blockers.push("Crypto swing open-risk ceiling is already reached.");
  if (bars.length < strategy.marketData.requiredBars) blockers.push("Not enough completed 1-hour history is available.");
  if (age === null || age > strategy.marketData.maximumQuoteAgeSeconds) warnings.push("Waiting for a fresh crypto quote.");
  if (spread === null) warnings.push("Waiting for a valid quote spread.");
  else if (spread > strategy.marketData.maximumSpreadPct) blockers.push(`Spread ${spread.toFixed(2)}% exceeds the swing entry limit.`);
  if (!(finitePositive(fast) && finitePositive(slow) && fast > slow && finitePositive(close) && close > fast)) {
    warnings.push("Multi-hour trend alignment is not yet supportive.");
  }

  let entryPrice: number | null = null;
  let stopPrice: number | null = null;
  let exitPrice: number | null = null;
  let purchaseAmount: number | null = null;
  let maxLossDollars: number | null = null;
  let projectedProfitDollars: number | null = null;
  let projectedProfitPct: number | null = null;

  if (finitePositive(recentHigh) && finitePositive(currentAtr) && ledger.equity > 0 && ledger.buyingPower > 0) {
    entryPrice = recentHigh * (1 + strategy.setup.entryBufferPct / 100);
    const minimumStopDistance = entryPrice * strategy.risk.minimumStopPct / 100;
    const atrStopDistance = currentAtr * strategy.risk.atrStopMultiplier;
    const structureStopDistance = finitePositive(recentLow) ? Math.max(0, entryPrice - recentLow) : 0;
    const stopDistance = Math.max(minimumStopDistance, atrStopDistance, structureStopDistance);
    const stopPct = stopDistance / entryPrice * 100;

    if (stopPct > strategy.risk.maximumStopPct) {
      blockers.push(`Required swing stop ${stopPct.toFixed(2)}% is wider than the strategy limit.`);
    } else {
      stopPrice = entryPrice - stopDistance;
      const atrPct = currentAtr / entryPrice * 100;
      const rangePct = finitePositive(recentLow) ? (recentHigh - recentLow) / recentLow * 100 : 0;
      const twoR = stopPct * 2;
      const opportunity = Math.min(
        strategy.opportunity.maximumGoalProfitPct,
        Math.max(
          twoR,
          rangePct * strategy.opportunity.rangeMultiplier,
          atrPct * strategy.opportunity.atrExpansionMultiplier,
          Math.max(0, momentum ?? 0) * strategy.opportunity.momentumMultiplier,
        ),
      );
      projectedProfitPct = opportunity;
      exitPrice = entryPrice * (1 + opportunity / 100);

      if (opportunity < strategy.opportunity.minimumGoalProfitPct) {
        warnings.push(`Projected swing opportunity ${opportunity.toFixed(2)}% is below the ${strategy.opportunity.minimumGoalProfitPct.toFixed(0)}% goal floor.`);
      }

      const riskBudget = ledger.equity * strategy.risk.riskPerTradePct / 100;
      const riskSizedNotional = riskBudget / (stopPct / 100);
      const allocationCap = ledger.equity * strategy.risk.maximumPositionAllocationPct / 100;
      purchaseAmount = Math.min(riskSizedNotional, allocationCap, ledger.buyingPower);
      maxLossDollars = purchaseAmount * stopPct / 100;
      projectedProfitDollars = purchaseAmount * opportunity / 100;
    }
  }

  const quoteReady = age !== null && age <= strategy.marketData.maximumQuoteAgeSeconds;
  const spreadReady = spread !== null && spread <= strategy.marketData.maximumSpreadPct;
  const trendReady = finitePositive(fast) && finitePositive(slow) && fast > slow && finitePositive(close) && close > fast;
  const opportunityReady = projectedProfitPct !== null && projectedProfitPct >= strategy.opportunity.minimumGoalProfitPct;
  const triggerReady = finitePositive(quote.ask) && finitePositive(entryPrice)
    && quote.ask >= entryPrice
    && finitePositive(currentAtr)
    && quote.ask <= entryPrice + currentAtr * strategy.setup.maximumChaseAtr;
  const strategyReady = score >= strategy.setup.readyScore
    && blockers.length === 0
    && quoteReady
    && spreadReady
    && trendReady
    && opportunityReady
    && triggerReady;

  if (score < strategy.setup.watchScore) warnings.push(`Swing score ${score.toFixed(0)} is below the ${strategy.setup.watchScore} watch threshold.`);
  else if (score < strategy.setup.qualifiedScore) warnings.push("Swing setup is watch-quality but not yet qualified.");
  else if (score < strategy.setup.readyScore) warnings.push("Swing setup is qualified but has not reached the ready threshold.");
  if (score >= strategy.setup.readyScore && !triggerReady) warnings.push("Swing score is high, but the breakout entry trigger has not cleanly confirmed.");
  if (strategyReady && !ledger.executionEnabled) warnings.push("Strategy gates pass, but Crypto Swing automated execution is intentionally not armed yet.");

  const state = strategyReady
    ? ledger.executionEnabled ? "READY" : "QUALIFIED"
    : score >= strategy.setup.qualifiedScore ? "QUALIFIED"
      : score >= strategy.setup.watchScore ? "WATCHING"
        : "DEVELOPING";

  const detail = blockers[0]
    ?? warnings[0]
    ?? `Prospect ${candidate.prospectScore.toFixed(0)}/100 · news ${candidate.newsScore >= 0 ? "+" : ""}${candidate.newsScore.toFixed(0)}/100 (${newsImpact >= 0 ? "+" : ""}${newsImpact.toFixed(1)} bot points) · 1-7 day crypto swing review.`;

  return {
    contractVersion: PAPER_BOT_TRADE_PLAN_CONTRACT_VERSION,
    botId: strategy.botProfileId,
    strategyId: strategy.id,
    strategyVersion: strategy.version,
    symbol: candidate.symbol,
    label: "Crypto swing prospect",
    assetClass: "crypto",
    currentPrice: finitePositive(quote.bid) && finitePositive(quote.ask)
      ? (quote.bid + quote.ask) / 2
      : quote.ask ?? quote.bid ?? close,
    score,
    state,
    detail,
    horizons: ["swing"],
    executionEligible: strategyReady && ledger.executionEnabled,
    selectedForSubmission: false,
    blockers,
    warnings,
    plan: {
      phase: entryPrice !== null && stopPrice !== null && exitPrice !== null ? "reference" : "awaiting-data",
      entryPrice,
      purchaseAmount,
      stopPrice,
      maxLossDollars,
      exitPrice,
      projectedProfitDollars,
      projectedProfitPct,
    },
  };
}
