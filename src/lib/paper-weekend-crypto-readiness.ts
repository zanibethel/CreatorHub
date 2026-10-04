import { DAILY_CRYPTO_DAY_STRATEGY_V4 as strategy } from "./paper-weekend-crypto-strategy-config";

export type CryptoBar = {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v?: number;
};

export type CryptoQuote = {
  bid: number | null;
  ask: number | null;
  timestamp: string | null;
};

export type WeekendCryptoLedgerState = {
  active: boolean;
  equity: number;
  buyingPower: number;
  openRiskPct: number;
  dailyRealizedLossPct: number;
  openPositions: number;
  dailyNewEntries: number;
  executionEnabled: boolean;
};

export type WeekendCryptoCandidate = {
  symbol: string;
  tier: "execution" | "monitor";
  executionEligible: boolean;
  state: "ready" | "waiting" | "blocked";
  selectedForSubmission: boolean;
  score: number;
  bid: number | null;
  ask: number | null;
  spreadPct: number | null;
  quoteAgeSeconds: number | null;
  fastMomentumPct: number | null;
  slowMomentumPct: number | null;
  atrPct: number | null;
  trigger: number | null;
  maxEntry: number | null;
  protectiveStop: number | null;
  takeProfit: number | null;
  plannedNotional: number | null;
  plannedQuantity: number | null;
  plannedRiskDollars: number | null;
  plannedRiskPct: number | null;
  estimatedRoundTripFees: number | null;
  estimatedGrossTargetDollars: number | null;
  feeCoverageMultiple: number | null;
  waitingOn: string[];
  blockers: string[];
  trackingBars: CryptoBar[];
};

export type DailyCryptoSessionInfo = {
  localDate: string;
  localWeekday: string;
  localTime: string;
  isTradingDay: boolean;
  isWeekend: boolean;
  entriesOpen: boolean;
  flattenDue: boolean;
};

const finitePositive = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

const average = (values: number[]) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

const sma = (bars: CryptoBar[], period: number) =>
  bars.length >= period ? average(bars.slice(-period).map(bar => bar.c)) : null;

const returnPct = (bars: CryptoBar[], lookback: number) => {
  if (bars.length <= lookback) return null;
  const start = bars[bars.length - 1 - lookback]?.c;
  const end = bars.at(-1)?.c;
  return finitePositive(start) && finitePositive(end) ? (end / start - 1) * 100 : null;
};

function atr(bars: CryptoBar[], period = 14) {
  if (bars.length < period + 1) return null;
  const slice = bars.slice(-(period + 1));
  const values: number[] = [];
  for (let index = 1; index < slice.length; index++) {
    const current = slice[index];
    const previous = slice[index - 1];
    values.push(Math.max(
      current.h - current.l,
      Math.abs(current.h - previous.c),
      Math.abs(current.l - previous.c),
    ));
  }
  return average(values);
}

function spreadPct(quote: CryptoQuote | undefined) {
  if (!finitePositive(quote?.bid) || !finitePositive(quote?.ask) || quote.ask < quote.bid) return null;
  const mid = (quote.bid + quote.ask) / 2;
  return mid > 0 ? ((quote.ask - quote.bid) / mid) * 100 : null;
}

function quoteAgeSeconds(quote: CryptoQuote | undefined, now: number) {
  const stamp = quote?.timestamp ? Date.parse(quote.timestamp) : NaN;
  return Number.isFinite(stamp) ? Math.max(0, (now - stamp) / 1000) : null;
}

export function dailyCryptoSession(now: number): DailyCryptoSessionInfo {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: strategy.timezone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(now));

  const map = Object.fromEntries(parts.map(part => [part.type, part.value]));
  const localWeekday = map.weekday ?? "";
  const localTime = `${map.hour ?? "00"}:${map.minute ?? "00"}`;
  const localDate = `${map.year ?? "0000"}-${map.month ?? "00"}-${map.day ?? "00"}`;
  const isWeekend = localWeekday === "Sat" || localWeekday === "Sun";
  const isTradingDay = strategy.session.tradingDays.includes(localWeekday as typeof strategy.session.tradingDays[number]);
  const entriesOpen = isTradingDay && strategy.session.continuousEntries;
  const flattenDue = false;

  return { localDate, localWeekday, localTime, isTradingDay, isWeekend, entriesOpen, flattenDue };
}

function scoreCandidate(input: {
  slowTrend: boolean;
  fastTrend: boolean;
  fastMomentum: boolean;
  slowMomentum: boolean;
  breakout: boolean;
  volatilityOkay: boolean;
  spreadOkay: boolean;
}) {
  return (
    (input.slowTrend ? 25 : 0) +
    (input.fastTrend ? 15 : 0) +
    (input.fastMomentum ? 15 : 0) +
    (input.slowMomentum ? 10 : 0) +
    (input.breakout ? 20 : 0) +
    (input.volatilityOkay ? 10 : 0) +
    (input.spreadOkay ? 5 : 0)
  );
}

export function evaluateWeekendCryptoReadiness(input: {
  now: number;
  ledger: WeekendCryptoLedgerState;
  quotes: Record<string, CryptoQuote | undefined>;
  bars5m: Record<string, CryptoBar[] | undefined>;
  bars15m: Record<string, CryptoBar[] | undefined>;
  occupiedByOtherBots: string[];
}) {
  const session = dailyCryptoSession(input.now);
  const occupied = new Set(input.occupiedByOtherBots);
  const executable = new Set<string>(strategy.executionUniverse);
  const btc15 = input.bars15m["BTC/USD"] ?? [];
  const btcFast = sma(btc15, strategy.setup.slowFastSmaPeriod);
  const btcSlow = sma(btc15, strategy.setup.slowSmaPeriod);
  const btcClose = btc15.at(-1)?.c ?? null;
  const broadCryptoSupportive =
    finitePositive(btcFast) && finitePositive(btcSlow) && finitePositive(btcClose)
      ? btcFast > btcSlow && btcClose > btcSlow
      : false;

  const candidates: WeekendCryptoCandidate[] = strategy.universe.map(symbol => {
    const executionEligible = executable.has(symbol);
    const quote = input.quotes[symbol];
    const fastBars = input.bars5m[symbol] ?? [];
    const slowBars = input.bars15m[symbol] ?? [];
    const bid = finitePositive(quote?.bid) ? quote.bid : null;
    const ask = finitePositive(quote?.ask) ? quote.ask : null;
    const spread = spreadPct(quote);
    const age = quoteAgeSeconds(quote, input.now);
    const fastMomentum = returnPct(fastBars, strategy.setup.momentumBars);
    const slowMomentum = returnPct(slowBars, strategy.setup.momentumBars);
    const fastSma = sma(fastBars, strategy.setup.fastSmaPeriod);
    const slowFast = sma(slowBars, strategy.setup.slowFastSmaPeriod);
    const slowSma = sma(slowBars, strategy.setup.slowSmaPeriod);
    const latestFastClose = fastBars.at(-1)?.c ?? null;
    const latestSlowClose = slowBars.at(-1)?.c ?? null;
    const currentAtr = atr(fastBars);
    const atrPct = finitePositive(currentAtr) && finitePositive(ask) ? currentAtr / ask * 100 : null;
    const priorBreakoutBars = fastBars.slice(-(strategy.setup.breakoutLookbackBars + 1), -1);
    const priorHigh = priorBreakoutBars.length
      ? Math.max(...priorBreakoutBars.map(bar => bar.h))
      : null;
    const trigger = finitePositive(priorHigh)
      ? priorHigh * (1 + strategy.setup.breakoutBufferPct / 100)
      : null;
    const maxEntry = finitePositive(trigger) && finitePositive(currentAtr)
      ? trigger + currentAtr * strategy.setup.maximumChaseAtr
      : null;

    const slowTrend = finitePositive(slowFast) && finitePositive(slowSma) && finitePositive(latestSlowClose)
      ? slowFast > slowSma && latestSlowClose > slowSma
      : false;
    const fastTrend = finitePositive(fastSma) && finitePositive(latestFastClose)
      ? latestFastClose > fastSma
      : false;
    const fastMomentumOkay = fastMomentum !== null && fastMomentum >= 0.10;
    const slowMomentumOkay = slowMomentum !== null && slowMomentum >= 0.05;
    const breakout = finitePositive(ask) && finitePositive(trigger) ? ask >= trigger : false;
    const volatilityOkay = atrPct !== null
      && atrPct >= strategy.setup.minimumAtrPct
      && atrPct <= strategy.setup.maximumAtrPct;
    const spreadOkay = spread !== null && spread <= strategy.marketData.maximumSpreadPct;

    const score = scoreCandidate({
      slowTrend,
      fastTrend,
      fastMomentum: fastMomentumOkay,
      slowMomentum: slowMomentumOkay,
      breakout,
      volatilityOkay,
      spreadOkay,
    });

    const waitingOn: string[] = [];
    const blockers: string[] = [];

    if (!input.ledger.active) blockers.push("Daily crypto bot ledger is not active.");
    if (!session.isTradingDay) blockers.push("Crypto trading day is disabled by strategy configuration.");
    if (!session.entriesOpen) blockers.push("Continuous crypto entries are disabled by strategy configuration.");
    if (input.ledger.dailyNewEntries >= strategy.cadence.maximumNewEntriesPerDay) blockers.push("Daily entry limit has been reached.");
    if (input.ledger.openPositions >= strategy.cadence.maximumOpenPositions) blockers.push("One-position limit is already occupied.");
    if (input.ledger.dailyRealizedLossPct >= strategy.risk.dailyRealizedLossLimitPct) blockers.push("Daily realized-loss kill switch is active.");
    if (occupied.has(symbol)) blockers.push("Another bot already holds this symbol in the shared Alpaca paper account.");
    if (!(input.ledger.equity > 0) || !(input.ledger.buyingPower > 0)) blockers.push("Virtual equity or buying power is unavailable.");

    if (age === null || age > strategy.marketData.quoteFreshnessSeconds) waitingOn.push("Waiting for a fresh Alpaca quote.");
    if (spread === null) waitingOn.push("Waiting for a valid non-crossed quote.");
    else if (!spreadOkay) waitingOn.push("Spread is wider than the daily crypto entry limit.");
    if (fastBars.length < strategy.marketData.fastBarsRequired) waitingOn.push("Waiting for enough completed 5-minute bars.");
    if (slowBars.length < strategy.marketData.slowBarsRequired) waitingOn.push("Waiting for enough completed 15-minute bars.");
    if (!broadCryptoSupportive) waitingOn.push("BTC 15-minute regime is not supportive.");
    if (!slowTrend) waitingOn.push("15-minute trend is not aligned.");
    if (!fastTrend) waitingOn.push("5-minute price is below its fast average.");
    if (!fastMomentumOkay) waitingOn.push("5-minute momentum is below threshold.");
    if (!slowMomentumOkay) waitingOn.push("15-minute momentum is below threshold.");
    if (!breakout) waitingOn.push("Short-horizon breakout trigger has not been reached.");
    if (finitePositive(ask) && finitePositive(maxEntry) && ask > maxEntry) waitingOn.push("Price is beyond the maximum chase distance.");
    if (!volatilityOkay) waitingOn.push("5-minute ATR is outside the accepted volatility range.");
    if (score < strategy.setup.minimumScore) waitingOn.push(`Setup score ${score} is below ${strategy.setup.minimumScore}.`);

    let protectiveStop: number | null = null;
    let takeProfit: number | null = null;
    let plannedNotional: number | null = null;
    let plannedQuantity: number | null = null;
    let plannedRiskDollars: number | null = null;
    let plannedRiskPct: number | null = null;
    let estimatedRoundTripFees: number | null = null;
    let estimatedGrossTargetDollars: number | null = null;
    let feeCoverageMultiple: number | null = null;

    if (finitePositive(ask) && finitePositive(currentAtr)) {
      const recentLows = fastBars.slice(-strategy.setup.breakoutLookbackBars).map(bar => bar.l).filter(finitePositive);
      const structureDistance = recentLows.length ? ask - Math.min(...recentLows) : 0;
      const minimumDistance = ask * strategy.risk.minimumStopPct / 100;
      const atrDistance = currentAtr * strategy.risk.atrStopMultiplier;
      const stopDistance = Math.max(minimumDistance, atrDistance, structureDistance);
      const stopPct = stopDistance / ask * 100;

      if (stopPct > strategy.risk.maximumStopPct) {
        waitingOn.push(`Required stop distance ${stopPct.toFixed(2)}% is too wide.`);
      } else {
        protectiveStop = ask - stopDistance;
        takeProfit = ask + stopDistance * strategy.risk.firstTakeProfitR;

        const riskBudget = input.ledger.equity * strategy.risk.riskPerTradePct / 100;
        const notionalByRisk = riskBudget / (stopPct / 100);
        const allocationBudget = input.ledger.equity * strategy.risk.maximumPositionAllocationPct / 100;
        plannedNotional = Math.min(notionalByRisk, allocationBudget, input.ledger.buyingPower);
        plannedQuantity = plannedNotional / ask;
        plannedRiskDollars = plannedNotional * stopPct / 100;
        plannedRiskPct = plannedRiskDollars / input.ledger.equity * 100;

        const feeRate = strategy.fees.estimatedTakerFeeBpsPerSide / 10_000;
        estimatedRoundTripFees = plannedNotional * feeRate * 2;
        estimatedGrossTargetDollars = plannedNotional * ((takeProfit / ask) - 1);
        feeCoverageMultiple = estimatedRoundTripFees > 0
          ? estimatedGrossTargetDollars / estimatedRoundTripFees
          : null;

        if (
          feeCoverageMultiple !== null
          && feeCoverageMultiple < strategy.fees.requiredGrossTargetToRoundTripFeeMultiple
        ) {
          waitingOn.push(`Gross target covers estimated round-trip fees only ${feeCoverageMultiple.toFixed(2)}×.`);
        }
        if (plannedNotional < strategy.execution.minimumOrderNotionalUsd) {
          blockers.push(`Planned notional is below the ${strategy.execution.minimumOrderNotionalUsd.toFixed(0)} broker-minimum buffer.`);
        }
        if (input.ledger.openRiskPct + (plannedRiskPct ?? 0) > strategy.risk.maximumOpenRiskPct) {
          blockers.push("Planned trade would exceed the daily crypto bot open-risk ceiling.");
        }
      }
    }

    return {
      symbol,
      tier: executionEligible ? "execution" : "monitor",
      executionEligible,
      state: blockers.length ? "blocked" : waitingOn.length ? "waiting" : "ready",
      selectedForSubmission: false,
      score,
      bid,
      ask,
      spreadPct: spread,
      quoteAgeSeconds: age,
      fastMomentumPct: fastMomentum,
      slowMomentumPct: slowMomentum,
      atrPct,
      trigger,
      maxEntry,
      protectiveStop,
      takeProfit,
      plannedNotional,
      plannedQuantity,
      plannedRiskDollars,
      plannedRiskPct,
      estimatedRoundTripFees,
      estimatedGrossTargetDollars,
      feeCoverageMultiple,
      waitingOn,
      blockers,
      trackingBars: fastBars.slice(-12),
    } satisfies WeekendCryptoCandidate;
  });

  const ready = candidates
    .filter(candidate => candidate.executionEligible && candidate.state === "ready")
    .sort((a, b) =>
      b.score - a.score
      || (a.spreadPct ?? Number.POSITIVE_INFINITY) - (b.spreadPct ?? Number.POSITIVE_INFINITY)
    );

  if (ready[0] && input.ledger.openPositions === 0) ready[0].selectedForSubmission = true;

  return {
    strategyId: strategy.id,
    strategyVersion: strategy.version,
    paperOnly: strategy.execution.paperOnly,
    executionUniverse: [...strategy.executionUniverse],
    monitorOnlyUniverse: [...strategy.monitorOnlyUniverse],
    session,
    broadCryptoSupportive,
    executionEnabled: input.ledger.executionEnabled,
    submissionReady: Boolean(
      input.ledger.executionEnabled
      && ready[0]?.selectedForSubmission
      && session.entriesOpen
    ),
    dailyEntriesRemaining: Math.max(0, strategy.cadence.maximumNewEntriesPerDay - input.ledger.dailyNewEntries),
    openPositionSlotsRemaining: Math.max(0, strategy.cadence.maximumOpenPositions - input.ledger.openPositions),
    selectedSymbol: ready[0]?.symbol ?? null,
    candidates,
  };
}

export const weekendCryptoSession = dailyCryptoSession;
