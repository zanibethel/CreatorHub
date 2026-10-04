import { PAPER_PROSPECT_SCANNER_V1 as config } from "./paper-prospect-scanner-config";

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
  if (change >= 20) return 30;
  if (change >= 10) return 27;
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
    return ["weekend-crypto-day-100", "default-diverse"];
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

  const raw = input.assetClass === "crypto"
    ? momentum + liquidity + volumeExpansion + structure
    : momentum + activity + liquidity + volumeExpansion + structure;

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
  for (const flag of input.sourceFlags) if (!reasons.includes(flag)) reasons.push(flag);

  return {
    score,
    status,
    watchlistEligible,
    botReviewEligible,
    suggestedBotIds: suggestedProspectBots({ assetClass: input.assetClass, price: input.price, botReviewEligible }),
    components: { momentum, activity, liquidity, volumeExpansion, structure },
    reasons,
  };
}

export function prospectVolumeRatio(volume: number | null, previousVolume: number | null) {
  return positive(volume) && positive(previousVolume) ? round(volume / previousVolume) : null;
}
