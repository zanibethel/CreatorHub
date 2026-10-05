import { SQUEEZE_BREAKOUT_STRATEGY_V1 as strategy } from "./paper-squeeze-breakout-strategy-config";

export type SqueezeDailyBar = {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
};

export type SqueezeScannerInput = {
  symbol: string;
  bars: SqueezeDailyBar[];
  currentPrice: number | null;
  previousClose: number | null;
  currentVolume: number | null;
  sessionElapsedFraction: number;
  spreadPct: number | null;
};

export type SqueezeScannerResult = {
  score: number;
  status: "candidate" | "watchlist" | "review-ready";
  watchlistEligible: boolean;
  botReviewEligible: boolean;
  metrics: {
    baseDays: number;
    baseHigh: number | null;
    baseLow: number | null;
    baseRangePct: number | null;
    preIgnitionPositionPct: number | null;
    volumeDryRatio: number | null;
    relativeVolumePace: number | null;
    breakoutDistancePct: number | null;
    sessionChangePct: number | null;
    averageDollarVolume: number | null;
  };
  components: {
    compression: number;
    baseLocation: number;
    volumeDryness: number;
    volumeIgnition: number;
    breakoutStructure: number;
    liquidity: number;
  };
  reasons: string[];
};

const finitePositive = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;
const avg = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const round = (value: number | null, places = 2) => value == null ? null : Number(value.toFixed(places));

function compressionPoints(rangePct: number | null) {
  if (rangePct == null) return 0;
  if (rangePct <= 8) return 25;
  if (rangePct <= 12) return 22;
  if (rangePct <= 16) return 16;
  if (rangePct <= 20) return 10;
  return 0;
}

function baseLocationPoints(positionPct: number | null) {
  if (positionPct == null) return 0;
  if (positionPct <= 35) return 20;
  if (positionPct <= 50) return 15;
  if (positionPct <= 65) return 8;
  if (positionPct <= 80) return 3;
  return 0;
}

function drynessPoints(ratio: number | null) {
  if (ratio == null) return 0;
  if (ratio <= 0.5) return 15;
  if (ratio <= 0.7) return 12;
  if (ratio <= 0.85) return 8;
  if (ratio <= 1.0) return 4;
  return 0;
}

function ignitionPoints(ratio: number | null) {
  if (ratio == null) return 0;
  if (ratio >= 4) return 20;
  if (ratio >= 3) return 18;
  if (ratio >= 2) return 15;
  if (ratio >= 1.5) return 10;
  if (ratio >= 1.2) return 5;
  return 0;
}

function breakoutPoints(distancePct: number | null) {
  if (distancePct == null) return 0;
  if (distancePct <= 0 && distancePct >= -5) return 15;
  if (distancePct > 0 && distancePct <= 3) return 15;
  if (distancePct <= 6) return 10;
  if (distancePct <= 10) return 5;
  return 0;
}

function liquidityPoints(spreadPct: number | null, averageDollarVolume: number | null) {
  if (spreadPct == null || averageDollarVolume == null) return 0;
  if (spreadPct <= 0.4 && averageDollarVolume >= 5_000_000) return 5;
  if (spreadPct <= 0.75 && averageDollarVolume >= 2_000_000) return 4;
  if (spreadPct <= strategy.scanner.maximumSpreadPct && averageDollarVolume >= strategy.scanner.minimumAverageDollarVolume) return 2;
  return 0;
}

export function scoreSqueezeProspect(input: SqueezeScannerInput): SqueezeScannerResult {
  const bars = [...input.bars]
    .filter(bar => finitePositive(bar.c) && finitePositive(bar.h) && finitePositive(bar.l) && Number.isFinite(bar.v) && bar.v >= 0)
    .sort((a,b) => Date.parse(a.t) - Date.parse(b.t));
  const base = bars.slice(-strategy.scanner.baseLookbackBars);
  const baseHigh = base.length ? Math.max(...base.map(bar => bar.h)) : null;
  const baseLow = base.length ? Math.min(...base.map(bar => bar.l)) : null;
  const baseRangePct = finitePositive(baseHigh) && finitePositive(baseLow)
    ? (baseHigh / baseLow - 1) * 100
    : null;

  const historicalClose = input.previousClose ?? base.at(-1)?.c ?? null;
  const preIgnitionPositionPct = finitePositive(historicalClose) && finitePositive(baseHigh) && finitePositive(baseLow) && baseHigh > baseLow
    ? (historicalClose - baseLow) / (baseHigh - baseLow) * 100
    : null;

  const recentVolume = avg(base.slice(-strategy.scanner.dryVolumeRecentBars).map(bar => bar.v).filter(value => Number.isFinite(value) && value >= 0));
  const priorVolume = avg(base.slice(
    -(strategy.scanner.dryVolumeRecentBars + strategy.scanner.dryVolumePriorBars),
    -strategy.scanner.dryVolumeRecentBars,
  ).map(bar => bar.v).filter(value => Number.isFinite(value) && value >= 0));
  const volumeDryRatio = recentVolume != null && priorVolume != null && priorVolume > 0 ? recentVolume / priorVolume : null;

  const averageDailyVolume = avg(base.slice(-20).map(bar => bar.v).filter(value => Number.isFinite(value) && value >= 0));
  const elapsed = clamp(input.sessionElapsedFraction, 0.10, 1);
  const relativeVolumePace = finitePositive(input.currentVolume) && averageDailyVolume != null && averageDailyVolume > 0
    ? input.currentVolume / (averageDailyVolume * elapsed)
    : null;

  const breakoutDistancePct = finitePositive(input.currentPrice) && finitePositive(baseHigh)
    ? (baseHigh - input.currentPrice) / baseHigh * 100
    : null;
  const sessionChangePct = finitePositive(input.currentPrice) && finitePositive(input.previousClose)
    ? (input.currentPrice / input.previousClose - 1) * 100
    : null;
  const averageDollarVolume = avg(base.slice(-20).map(bar => bar.c * bar.v).filter(value => Number.isFinite(value) && value >= 0));

  const components = {
    compression: compressionPoints(baseRangePct),
    baseLocation: baseLocationPoints(preIgnitionPositionPct),
    volumeDryness: drynessPoints(volumeDryRatio),
    volumeIgnition: ignitionPoints(relativeVolumePace),
    breakoutStructure: breakoutPoints(breakoutDistancePct),
    liquidity: liquidityPoints(input.spreadPct, averageDollarVolume),
  };
  const score = clamp(Object.values(components).reduce((sum, value) => sum + value, 0), 0, 100);
  const watchlistEligible = score >= strategy.scanner.thresholds.watchlistScore;
  const botReviewEligible = score >= strategy.scanner.thresholds.botReviewScore;
  const status = botReviewEligible ? "review-ready" : watchlistEligible ? "watchlist" : "candidate";

  const reasons: string[] = [];
  if (baseRangePct != null) reasons.push(`${base.length}-day base range ${baseRangePct.toFixed(1)}%`);
  if (preIgnitionPositionPct != null) reasons.push(`pre-ignition price at ${preIgnitionPositionPct.toFixed(0)}% of base range`);
  if (volumeDryRatio != null) reasons.push(`base volume ${volumeDryRatio.toFixed(2)}× prior volume`);
  if (relativeVolumePace != null) reasons.push(`current volume pace ${relativeVolumePace.toFixed(2)}× normal`);
  if (breakoutDistancePct != null) reasons.push(breakoutDistancePct <= 0
    ? `${Math.abs(breakoutDistancePct).toFixed(2)}% above base high`
    : `${breakoutDistancePct.toFixed(2)}% below base high`);
  if (sessionChangePct != null) reasons.push(`${sessionChangePct >= 0 ? "+" : ""}${sessionChangePct.toFixed(2)}% session move`);
  if (input.spreadPct != null) reasons.push(`${input.spreadPct.toFixed(2)}% spread`);

  return {
    score: Number(score.toFixed(2)),
    status,
    watchlistEligible,
    botReviewEligible,
    metrics: {
      baseDays: base.length,
      baseHigh: round(baseHigh),
      baseLow: round(baseLow),
      baseRangePct: round(baseRangePct),
      preIgnitionPositionPct: round(preIgnitionPositionPct),
      volumeDryRatio: round(volumeDryRatio),
      relativeVolumePace: round(relativeVolumePace),
      breakoutDistancePct: round(breakoutDistancePct),
      sessionChangePct: round(sessionChangePct),
      averageDollarVolume: round(averageDollarVolume, 0),
    },
    components,
    reasons,
  };
}
