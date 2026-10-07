import { PAPER_PROSPECT_SCANNER_V2 as config } from "./paper-prospect-scanner-config";

export type ProspectAssetClass = "stock" | "crypto";
export type ProspectStatus = "candidate" | "watchlist" | "review-ready" | "expired";

export type ProspectScoreInput = {
  assetClass: ProspectAssetClass;
  symbol: string;
  price: number | null;
  percentChange: number | null;
  spreadPct: number | null;
  volume: number | null;
  previousVolume: number | null;
  activityRank: number | null;
  nearHighPct: number | null;
  sourceFlags: string[];
  newsImpact?: number | null;
  gapPct?: number | null;
  recent5mChangePct?: number | null;
  recent15mChangePct?: number | null;
  recent60mChangePct?: number | null;
  freshCatalystAgeMinutes?: number | null;
  marketSession?: "premarket" | "regular" | "after-hours" | "closed" | null;
};

export type ProspectScoreResult = {
  score: number;
  status: ProspectStatus;
  watchlistEligible: boolean;
  botReviewEligible: boolean;
  suggestedBotIds: string[];
  components: {
    momentum: number;
    activity: number;
    liquidity: number;
    volumeExpansion: number;
    structure: number;
    news: number;
    acceleration: number;
    catalyst: number;
    chasePenalty: number;
  };
  reasons: string[];
};

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const positive = (value: unknown): value is number => finite(value) && value > 0;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const round = (value: number) => Number(value.toFixed(2));

function momentumScore(assetClass: ProspectAssetClass, change: number | null) {
  if (!finite(change) || change <= 0) return 0;
  if (assetClass === "crypto") {
    if (change >= 20) return 35;
    if (change >= 10) return 32;
    if (change >= 7) return 29;
    if (change >= 5) return 25;
    if (change >= 3) return 20;
    if (change >= 2) return 14;
    if (change >= 1) return 8;
    return 4;
  }
  // For stocks, the sweet spot is a move that is developing, not one that has
  // already completed most of its session move. Fresh acceleration is scored
  // separately below so a large mover can still qualify when it is actively
  // breaking out again.
  if (change >= 30) return 14;
  if (change >= 20) return 18;
  if (change >= 15) return 22;
  if (change >= 10) return 26;
  if (change >= 7) return 24;
  if (change >= 5) return 20;
  if (change >= 3) return 15;
  if (change >= 2) return 10;
  if (change >= 1) return 5;
  return 2;
}

function activityScore(input: ProspectScoreInput) {
  if (input.assetClass === "crypto") return 0;
  const rank = input.activityRank;
  if (!finite(rank) || rank <= 0) return 0;
  if (rank <= 10) return 25;
  if (rank <= 25) return 21;
  if (rank <= 50) return 16;
  if (rank <= 100) return 10;
  return 0;
}

function liquidityScore(input: ProspectScoreInput) {
  const spread = input.spreadPct;
  const price = input.price;
  const volume = input.volume;

  let spreadPoints = 0;
  if (finite(spread) && spread >= 0) {
    if (spread <= 0.15) spreadPoints = input.assetClass === "crypto" ? 20 : 12;
    else if (spread <= 0.30) spreadPoints = input.assetClass === "crypto" ? 16 : 10;
    else if (spread <= 0.60) spreadPoints = input.assetClass === "crypto" ? 10 : 6;
    else if (spread <= 1.00) spreadPoints = input.assetClass === "crypto" ? 5 : 3;
  }

  if (input.assetClass === "crypto") return spreadPoints;

  let tradabilityPoints = 0;
  if (positive(price) && positive(volume)) {
    if (price >= 1 && volume >= 5_000_000) tradabilityPoints = 8;
    else if (price >= 1 && volume >= 1_000_000) tradabilityPoints = 6;
    else if (price >= 0.25 && volume >= 5_000_000) tradabilityPoints = 5;
    else if (price >= 0.25 && volume >= 500_000) tradabilityPoints = 3;
  }
  return Math.min(20, spreadPoints + tradabilityPoints);
}

function volumeExpansionScore(input: ProspectScoreInput) {
  const volume = input.volume;
  const previous = input.previousVolume;
  if (!positive(volume) || !positive(previous)) return 0;
  const ratio = volume / previous;
  if (input.assetClass === "crypto") {
    if (ratio >= 3) return 25;
    if (ratio >= 2) return 22;
    if (ratio >= 1.5) return 18;
    if (ratio >= 1.0) return 14;
    if (ratio >= 0.7) return 8;
    return 3;
  }
  if (ratio >= 3) return 10;
  if (ratio >= 2) return 9;
  if (ratio >= 1.5) return 7;
  if (ratio >= 1.0) return 5;
  if (ratio >= 0.7) return 3;
  return 1;
}

function accelerationScore(input: ProspectScoreInput) {
  if (input.assetClass !== "stock") return 0;

  const score5m = finite(input.recent5mChangePct) && input.recent5mChangePct > 0
    ? input.recent5mChangePct >= 5 ? 20
      : input.recent5mChangePct >= 3 ? 18
        : input.recent5mChangePct >= 2 ? 16
          : input.recent5mChangePct >= 1 ? 12
            : input.recent5mChangePct >= 0.5 ? 8
              : input.recent5mChangePct >= 0.25 ? 4
                : 0
    : 0;
  const score15m = finite(input.recent15mChangePct) && input.recent15mChangePct > 0
    ? input.recent15mChangePct >= 8 ? 20
      : input.recent15mChangePct >= 5 ? 18
        : input.recent15mChangePct >= 3 ? 15
          : input.recent15mChangePct >= 2 ? 12
            : input.recent15mChangePct >= 1 ? 8
              : input.recent15mChangePct >= 0.5 ? 4
                : 0
    : 0;
  const score60m = finite(input.recent60mChangePct) && input.recent60mChangePct > 0
    ? input.recent60mChangePct >= 12 ? 20
      : input.recent60mChangePct >= 8 ? 18
        : input.recent60mChangePct >= 5 ? 15
          : input.recent60mChangePct >= 3 ? 12
            : input.recent60mChangePct >= 1.5 ? 8
              : input.recent60mChangePct >= 0.75 ? 4
                : 0
    : 0;

  return Math.min(config.timing.maxAccelerationPoints, Math.max(score5m, score15m, score60m));
}

function catalystScore(input: ProspectScoreInput) {
  if (
    input.assetClass !== "stock"
    || !finite(input.freshCatalystAgeMinutes)
    || input.freshCatalystAgeMinutes < 0
    || !finite(input.percentChange)
    || input.percentChange < 2
  ) return 0;

  const age = input.freshCatalystAgeMinutes;
  const score = age <= 15 ? 8
    : age <= 30 ? 7
      : age <= 60 ? 6
        : age <= 120 ? 4
          : age <= config.timing.catalystFreshMinutes ? 2
            : 0;
  return Math.min(config.timing.maxCatalystPoints, score);
}

function chasePenaltyScore(input: ProspectScoreInput, acceleration: number, catalyst: number) {
  if (input.assetClass !== "stock" || !finite(input.percentChange) || input.percentChange < 15) return 0;

  const change = input.percentChange;
  const freshContinuation = acceleration >= 12 || catalyst >= 6;
  let penalty = 0;

  if (freshContinuation) {
    if (change >= 35) penalty = 8;
    else if (change >= 25) penalty = 5;
    else penalty = 2;
  } else {
    if (change >= 35) penalty = 24;
    else if (change >= 30) penalty = 22;
    else if (change >= 25) penalty = 18;
    else if (change >= 20) penalty = 14;
    else penalty = 8;
  }

  return Math.min(config.timing.maxChasePenaltyPoints, penalty);
}

function structureScore(input: ProspectScoreInput) {
  const distance = input.nearHighPct;
  if (!finite(distance) || distance < 0) return 0;
  if (input.assetClass === "crypto") {
    if (distance <= 1) return 20;
    if (distance <= 3) return 15;
    if (distance <= 5) return 10;
    if (distance <= 10) return 5;
    return 0;
  }
  if (distance <= 1) return 15;
  if (distance <= 3) return 11;
  if (distance <= 5) return 7;
  if (distance <= 10) return 3;
  return 0;
}

export function suggestedProspectBots(input: {
  assetClass: ProspectAssetClass;
  price: number | null;
  botReviewEligible: boolean;
}) {
  if (!input.botReviewEligible) return [];
  if (input.assetClass === "crypto") {
    return ["weekend-crypto-day-100", "crypto-swing-100", "default-diverse"];
  }
  if (positive(input.price) && input.price <= config.assignment.pennyPriceCeilingUsd) {
    return ["penny-volatility-day-100", "default-diverse"];
  }
  return ["default-diverse", "three-trade-weekly-swing-100"];
}

export function scoreProspect(input: ProspectScoreInput): ProspectScoreResult {
  const momentum = momentumScore(input.assetClass, input.percentChange);
  const activity = activityScore(input);
  const liquidity = liquidityScore(input);
  const volumeExpansion = volumeExpansionScore(input);
  const structure = structureScore(input);
  const news = finite(input.newsImpact)
    ? clamp(input.newsImpact, -config.news.maxScannerImpactPoints, config.news.maxScannerImpactPoints)
    : 0;
  const acceleration = accelerationScore(input);
  const catalyst = catalystScore(input);
  const chasePenalty = chasePenaltyScore(input, acceleration, catalyst);

  const raw = input.assetClass === "crypto"
    ? momentum + liquidity + volumeExpansion + structure + news
    : momentum + activity + liquidity + volumeExpansion + structure + news + acceleration + catalyst - chasePenalty;

  const score = round(clamp(raw, 0, 100));
  const watchlistEligible = score >= config.thresholds.watchlistScore;
  const botReviewEligible = score >= config.thresholds.botReviewScore;
  const status: ProspectStatus = botReviewEligible
    ? "review-ready"
    : watchlistEligible
      ? "watchlist"
      : "candidate";

  const reasons: string[] = [];
  if (finite(input.percentChange)) reasons.push(`${input.percentChange >= 0 ? "+" : ""}${input.percentChange.toFixed(2)}% session change`);
  if (input.activityRank) reasons.push(`#${input.activityRank} most-active stock`);
  if (positive(input.volume) && positive(input.previousVolume)) reasons.push(`${(input.volume / input.previousVolume).toFixed(2)}× prior-day volume`);
  if (finite(input.nearHighPct)) reasons.push(`${input.nearHighPct.toFixed(2)}% below session high`);
  if (finite(input.spreadPct)) reasons.push(`${input.spreadPct.toFixed(2)}% spread`);
  if (finite(input.gapPct)) reasons.push(`${input.gapPct >= 0 ? "+" : ""}${input.gapPct.toFixed(2)}% session-open gap vs prior close`);
  if (finite(input.recent5mChangePct) && Math.abs(input.recent5mChangePct) >= 0.25) reasons.push(`${input.recent5mChangePct >= 0 ? "+" : ""}${input.recent5mChangePct.toFixed(2)}% last 5m`);
  if (finite(input.recent15mChangePct) && Math.abs(input.recent15mChangePct) >= 0.5) reasons.push(`${input.recent15mChangePct >= 0 ? "+" : ""}${input.recent15mChangePct.toFixed(2)}% last 15m`);
  if (finite(input.recent60mChangePct) && Math.abs(input.recent60mChangePct) >= 0.75) reasons.push(`${input.recent60mChangePct >= 0 ? "+" : ""}${input.recent60mChangePct.toFixed(2)}% last 60m`);
  if (catalyst > 0 && finite(input.freshCatalystAgeMinutes)) reasons.push(`Fresh market-news catalyst ${input.freshCatalystAgeMinutes.toFixed(0)}m ago`);
  if (chasePenalty > 0) reasons.push(`Chase-risk penalty -${chasePenalty.toFixed(0)} points`);
  if (news !== 0) reasons.push(`News impact ${news > 0 ? "+" : ""}${news.toFixed(2)} points`);
  for (const flag of input.sourceFlags) if (!reasons.includes(flag)) reasons.push(flag);

  return {
    score,
    status,
    watchlistEligible,
    botReviewEligible,
    suggestedBotIds: suggestedProspectBots({ assetClass: input.assetClass, price: input.price, botReviewEligible }),
    components: { momentum, activity, liquidity, volumeExpansion, structure, news, acceleration, catalyst, chasePenalty },
    reasons,
  };
}

export function prospectVolumeRatio(volume: number | null, previousVolume: number | null) {
  return positive(volume) && positive(previousVolume) ? round(volume / previousVolume) : null;
}
