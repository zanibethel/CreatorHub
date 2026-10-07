import { THREE_TRADE_SWING_STRATEGY_V1 as strategy } from "./paper-swing-strategy-config";

export type SwingProspectBar = {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
};

export type SwingProspectInput = {
  symbol: string;
  scannerId: string;
  scannerVersion: number;
  scannerScore: number;
  lastSeenAt: string;
  assignedBotIds: string[];
  price: number | null;
  percentChange: number | null;
  spreadPct: number | null;
  scoreComponents: {
    momentum?: number;
    activity?: number;
    liquidity?: number;
    volumeExpansion?: number;
    structure?: number;
    news?: number;
    acceleration?: number;
    catalyst?: number;
    chasePenalty?: number;
  };
  currentAsk: number | null;
  currentBid: number | null;
  quoteAt: string | null;
  dailyBars: SwingProspectBar[];
  equity: number;
  buyingPower: number;
  now: number;
  expiresAt: string;
  existingExposure: boolean;
};

export type SwingProspectDisposition = {
  symbol: string;
  eligible: boolean;
  blockers: string[];
  warnings: string[];
  metrics: {
    prospectAgeMinutes: number | null;
    sma10: number | null;
    sma20: number | null;
    atr14: number | null;
    momentum5Pct: number | null;
    breakoutHigh20: number | null;
    structureLow10: number | null;
  };
  plan: null | {
    requestedNotional: number;
    entryTrigger: number;
    maxEntryPrice: number;
    protectiveStop: number;
    plannedRiskDollars: number;
    takeProfitPrice: number;
    takeProfitFraction: number;
    takeProfitR: number;
    protectWinnerAtR: number;
    trailRemainder: boolean;
    expiresAt: string;
    stageReason: string;
  };
};

const BOT_ID = strategy.botProfileId;
const MAX_PROSPECT_AGE_MINUTES = 20;
const MAX_CHASE_PENALTY = 8;
const MIN_SCANNER_SCORE = 80;

const finitePositive = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

const round = (value: number, decimals = 6) => Number(value.toFixed(decimals));
const average = (values: number[]) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

function atr14(bars: SwingProspectBar[]) {
  if (bars.length < 15) return null;
  const values: number[] = [];
  for (let index = bars.length - 14; index < bars.length; index += 1) {
    const bar = bars[index];
    const previousClose = bars[index - 1]?.c;
    if (!bar || !finitePositive(previousClose)) continue;
    values.push(Math.max(
      bar.h - bar.l,
      Math.abs(bar.h - previousClose),
      Math.abs(bar.l - previousClose),
    ));
  }
  return average(values);
}

function ageMinutes(timestamp: string, now: number) {
  const stamp = Date.parse(timestamp);
  return Number.isFinite(stamp) ? Math.max(0, (now - stamp) / 60_000) : null;
}

export function evaluateSwingProspectIntake(input: SwingProspectInput): SwingProspectDisposition {
  const bars = input.dailyBars
    .filter(bar => finitePositive(bar.o) && finitePositive(bar.h) && finitePositive(bar.l) && finitePositive(bar.c))
    .sort((a,b) => Date.parse(a.t) - Date.parse(b.t));
  const closes = bars.map(bar => bar.c);
  const recent20 = bars.slice(-20);
  const recent10 = bars.slice(-10);
  const lastClose = closes.at(-1) ?? null;
  const sma10 = average(closes.slice(-10));
  const sma20 = average(closes.slice(-20));
  const atr = atr14(bars);
  const breakoutHigh20 = recent20.length ? Math.max(...recent20.map(bar => bar.h)) : null;
  const structureLow10 = recent10.length ? Math.min(...recent10.map(bar => bar.l)) : null;
  const momentumAnchor = closes.length >= 6 ? closes.at(-6) ?? null : null;
  const momentum5Pct = finitePositive(lastClose) && finitePositive(momentumAnchor)
    ? (lastClose / momentumAnchor - 1) * 100
    : null;
  const prospectAgeMinutes = ageMinutes(input.lastSeenAt, input.now);
  const blockers: string[] = [];
  const warnings: string[] = [];
  const chasePenalty = Number(input.scoreComponents.chasePenalty ?? 0);
  const acceleration = Number(input.scoreComponents.acceleration ?? 0);
  const catalyst = Number(input.scoreComponents.catalyst ?? 0);

  if (input.scannerVersion < 3) blockers.push("Prospect predates the v3 early-move timing model.");
  if (input.scannerScore < MIN_SCANNER_SCORE) blockers.push("Prospect score is below Bot Review Ready.");
  if (!input.assignedBotIds.includes(BOT_ID)) blockers.push("Prospect is not assigned to the Weekly Swing bot.");
  if (prospectAgeMinutes === null || prospectAgeMinutes > MAX_PROSPECT_AGE_MINUTES) blockers.push("Prospect evidence is stale.");
  if (input.existingExposure) blockers.push("Existing position or active order already owns this symbol.");
  if (!finitePositive(input.currentAsk) || !finitePositive(input.currentBid) || input.currentAsk < input.currentBid) blockers.push("A valid live bid/ask is required.");
  if (input.spreadPct === null || !Number.isFinite(input.spreadPct) || input.spreadPct > strategy.execution.maximumSpreadPct) blockers.push("Spread exceeds the Swing entry limit.");
  if (bars.length < 20 || !finitePositive(sma10) || !finitePositive(sma20) || !finitePositive(lastClose)) blockers.push("At least 20 completed daily bars are required.");
  if (finitePositive(lastClose) && finitePositive(sma10) && finitePositive(sma20) && (lastClose < sma10 || lastClose < sma20)) blockers.push("Completed-day trend is not above both 10/20-day averages.");
  if (momentum5Pct === null || momentum5Pct <= 0) blockers.push("Five-day momentum is not positive.");
  if (!finitePositive(atr)) blockers.push("ATR risk distance is unavailable.");
  if (Number.isFinite(chasePenalty) && chasePenalty > MAX_CHASE_PENALTY) blockers.push("Scanner chase-risk is too high for staging.");
  if ((input.percentChange ?? 0) >= 20 && acceleration < 10 && catalyst < 6) blockers.push("Large session move lacks fresh continuation evidence.");
  if (input.scannerScore >= 90) warnings.push("High scanner score still requires same-session execution revalidation.");

  if (blockers.length || !finitePositive(input.currentAsk) || !finitePositive(atr) || !finitePositive(structureLow10) || !finitePositive(breakoutHigh20)) {
    return {
      symbol: input.symbol,
      eligible: false,
      blockers,
      warnings,
      metrics: {
        prospectAgeMinutes,
        sma10,
        sma20,
        atr14: atr,
        momentum5Pct,
        breakoutHigh20,
        structureLow10,
      },
      plan: null,
    };
  }

  const breakoutTrigger = breakoutHigh20 * (1 + strategy.setup.entryBufferPct / 100);
  const entryTrigger = Math.max(input.currentAsk, breakoutTrigger);
  const atrStop = entryTrigger - strategy.risk.atrStopMultiplier * atr;
  const structureStop = structureLow10 - strategy.risk.structureBufferAtr * atr;
  let protectiveStop = Math.max(atrStop, structureStop);
  if (!(protectiveStop > 0 && protectiveStop < entryTrigger * 0.995)) protectiveStop = atrStop;
  if (!(protectiveStop > 0 && protectiveStop < entryTrigger)) {
    blockers.push("Protective stop could not be placed below the entry trigger.");
    return {
      symbol: input.symbol,
      eligible: false,
      blockers,
      warnings,
      metrics: {
        prospectAgeMinutes,
        sma10,
        sma20,
        atr14: atr,
        momentum5Pct,
        breakoutHigh20,
        structureLow10,
      },
      plan: null,
    };
  }

  const stopDistance = entryTrigger - protectiveStop;
  const riskBudget = input.equity * strategy.risk.riskPerTradePct / 100;
  const allocationBudget = Math.min(
    input.equity * strategy.risk.maximumPositionAllocationPct / 100,
    Math.max(0, input.buyingPower),
  );
  const quantityByRisk = riskBudget / stopDistance;
  const quantityByAllocation = allocationBudget / entryTrigger;
  const quantity = Math.min(quantityByRisk, quantityByAllocation);
  const requestedNotional = quantity * entryTrigger;
  const plannedRiskDollars = quantity * stopDistance;

  if (!(quantity > 0 && requestedNotional > 0 && plannedRiskDollars > 0)) {
    blockers.push("Virtual risk budget cannot support a positive position size.");
    return {
      symbol: input.symbol,
      eligible: false,
      blockers,
      warnings,
      metrics: {
        prospectAgeMinutes,
        sma10,
        sma20,
        atr14: atr,
        momentum5Pct,
        breakoutHigh20,
        structureLow10,
      },
      plan: null,
    };
  }

  const maxEntryPrice = entryTrigger + strategy.setup.maximumChaseAtr * atr;
  const takeProfitPrice = entryTrigger + strategy.risk.firstTakeProfitR * stopDistance;

  return {
    symbol: input.symbol,
    eligible: true,
    blockers,
    warnings,
    metrics: {
      prospectAgeMinutes,
      sma10,
      sma20,
      atr14: atr,
      momentum5Pct,
      breakoutHigh20,
      structureLow10,
    },
    plan: {
      requestedNotional: round(requestedNotional),
      entryTrigger: round(entryTrigger),
      maxEntryPrice: round(maxEntryPrice),
      protectiveStop: round(protectiveStop),
      plannedRiskDollars: round(plannedRiskDollars),
      takeProfitPrice: round(takeProfitPrice),
      takeProfitFraction: strategy.risk.firstTakeProfitFraction,
      takeProfitR: strategy.risk.firstTakeProfitR,
      protectWinnerAtR: strategy.risk.protectWinnerAtR,
      trailRemainder: strategy.risk.trailRemainder,
      expiresAt: input.expiresAt,
      stageReason: `Prospect Scanner v${input.scannerVersion} score ${input.scannerScore.toFixed(0)}; acceleration ${acceleration.toFixed(0)}, catalyst ${catalyst.toFixed(0)}, chase penalty ${chasePenalty.toFixed(0)}.`,
    },
  };
}

export const SWING_PROSPECT_INTAKE = {
  botId: BOT_ID,
  minimumScannerScore: MIN_SCANNER_SCORE,
  maximumProspectAgeMinutes: MAX_PROSPECT_AGE_MINUTES,
  maximumChasePenalty: MAX_CHASE_PENALTY,
} as const;
