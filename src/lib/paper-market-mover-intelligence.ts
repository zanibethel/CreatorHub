/**
 * Midas Market Mover Intelligence v2: evidence-only, source-limited microstructure.
 * Displayed depth is NOT executed buying, and stock prints do NOT identify participants.
 * Never feed this observational score into execution gates without out-of-sample validation.
 */
export type MoverAssetClass = "stock" | "crypto";
export type MoverDirection = "buy-side-depth" | "sell-side-depth" | "balanced-depth" | "unknown";
export type MoverSignalKind = "crypto-book-depth" | "stock-large-print";

export type MoverObservation = {
  asset_class: MoverAssetClass;
  symbol: string;
  signal_kind: MoverSignalKind;
  observed_bucket: string;
  event_at: string;
  available_at: string;
  observed_at: string;
  score: number;
  confidence: number;
  direction: MoverDirection;
  actor_class: "unattributed";
  source_name: string;
  evidence: Record<string, string | number | boolean | null>;
};

export type CryptoPriorObservation = Pick<
  MoverObservation, "symbol" | "signal_kind" | "observed_bucket" | "observed_at" |
  "available_at" | "direction" | "source_name" | "evidence"
>;

type Level = { p?: unknown; s?: unknown };
type Trade = { t?: unknown; p?: unknown; s?: unknown };
type Book = { t?: unknown; b?: unknown; a?: unknown };

export const MIDAS_CRYPTO_QUALITY_V2 = {
  version: "midas-crypto-quality-v2",
  minSideDepthUsd: 20_000,
  minCombinedDepthUsd: 100_000,
  maxSpreadPct: 0.50,
  maxSingleLevelShare: 0.90,
  minDepthLevelsPerSide: 2,
  minImbalancePct: 15,
  minConfirmMinutes: 10,
  maxConfirmMinutes: 45,
} as const;

const number = (n: unknown) => typeof n === "number" && Number.isFinite(n) ? n : null;
const round = (n: number) => Number(n.toFixed(2));
const timestamp = (s: unknown) => typeof s === "string" && Number.isFinite(Date.parse(s)) ? Date.parse(s) : null;
const bucketAt = (ms: number) => new Date(Math.floor(ms / 900_000) * 900_000).toISOString();
const observedAt = (ms: number) => new Date(ms).toISOString();

function levels(value: unknown): Array<{ price: number; size: number }> {
  if (!Array.isArray(value)) return [];
  return (value as Level[]).slice(0, 10).flatMap(level => {
    const price = number(level?.p);
    const size = number(level?.s);
    return price !== null && price > 0 && size !== null && size > 0 ? [{ price, size }] : [];
  });
}

export function analyzeCryptoBook(
  symbol: string, book: Book, nowMs: number, prior: CryptoPriorObservation[] = [],
): MoverObservation | null {
  const bids = levels(book.b);
  const asks = levels(book.a);
  const bookTime = timestamp(book.t);
  if (!bids.length || !asks.length || bookTime === null) return null;
  const ageSeconds = (nowMs - bookTime) / 1000;
  if (ageSeconds < 0 || ageSeconds > 120 || bids[0].price >= asks[0].price) return null;

  const mid = (bids[0].price + asks[0].price) / 2;
  const nearBids = bids.filter(level => level.price >= mid * 0.98);
  const nearAsks = asks.filter(level => level.price <= mid * 1.02);
  const bidLevelsUsd = nearBids.map(level => level.price * level.size);
  const askLevelsUsd = nearAsks.map(level => level.price * level.size);
  const bidUsd = bidLevelsUsd.reduce((sum, usd) => sum + usd, 0);
  const askUsd = askLevelsUsd.reduce((sum, usd) => sum + usd, 0);
  if (bidUsd <= 0 || askUsd <= 0) return null;
  const imbalancePct = (bidUsd - askUsd) / (bidUsd + askUsd) * 100;
  const spreadPct = (asks[0].price - bids[0].price) / mid * 100;
  const maxLevelShare = Math.max(
    ...bidLevelsUsd.map(usd => usd / bidUsd),
    ...askLevelsUsd.map(usd => usd / askUsd),
  );
  const direction: MoverDirection = imbalancePct >= MIDAS_CRYPTO_QUALITY_V2.minImbalancePct
    ? "buy-side-depth"
    : imbalancePct <= -MIDAS_CRYPTO_QUALITY_V2.minImbalancePct
      ? "sell-side-depth" : "balanced-depth";

  const failed: string[] = [];
  if (bidUsd < MIDAS_CRYPTO_QUALITY_V2.minSideDepthUsd
    || askUsd < MIDAS_CRYPTO_QUALITY_V2.minSideDepthUsd) failed.push("insufficient-two-sided-depth");
  if (bidUsd + askUsd < MIDAS_CRYPTO_QUALITY_V2.minCombinedDepthUsd) failed.push("insufficient-combined-depth");
  if (spreadPct > MIDAS_CRYPTO_QUALITY_V2.maxSpreadPct) failed.push("wide-spread");
  if (nearBids.length < MIDAS_CRYPTO_QUALITY_V2.minDepthLevelsPerSide
    || nearAsks.length < MIDAS_CRYPTO_QUALITY_V2.minDepthLevelsPerSide) failed.push("insufficient-depth-levels");
  if (maxLevelShare > MIDAS_CRYPTO_QUALITY_V2.maxSingleLevelShare) failed.push("concentrated-displayed-liquidity");
  if (direction === "balanced-depth") failed.push("no-directional-imbalance");

  // Only a previously persisted v2 observation in a different 15-minute bucket
  // can confirm a fresh sample. Never use legacy readings or future information.
  const previous = failed.length === 0 && prior.some(row => {
    if (row.symbol !== symbol || row.signal_kind !== "crypto-book-depth"
      || row.source_name !== "alpaca-crypto-us-orderbook"
      || row.direction !== direction
      || row.observed_bucket === bucketAt(nowMs)
      || row.evidence.quality_version !== MIDAS_CRYPTO_QUALITY_V2.version
      || row.evidence.quality_gates_passed !== true) return false;
    const observed = timestamp(row.observed_at);
    const available = timestamp(row.available_at);
    if (observed === null || available === null || available > observed) return false;
    const elapsed = (nowMs - observed) / 60_000;
    return available <= nowMs
      && elapsed >= MIDAS_CRYPTO_QUALITY_V2.minConfirmMinutes
      && elapsed <= MIDAS_CRYPTO_QUALITY_V2.maxConfirmMinutes;
  });
  const qualityStatus = failed.length ? "rejected" : previous ? "confirmed" : "watching";
  const rawScore = round(Math.min(65, Math.max(0, Math.abs(imbalancePct) - 5)));
  const now = observedAt(nowMs);

  return {
    asset_class: "crypto",
    symbol,
    signal_kind: "crypto-book-depth",
    observed_bucket: bucketAt(nowMs),
    event_at: new Date(bookTime).toISOString(),
    available_at: now,
    observed_at: now,
    // Do not display apparent strength on a thin or unconfirmed order book.
    score: qualityStatus === "confirmed" ? rawScore : 0,
    confidence: qualityStatus === "confirmed" ? 30 : 0,
    direction,
    actor_class: "unattributed",
    source_name: "alpaca-crypto-us-orderbook",
    evidence: {
      quality_version: MIDAS_CRYPTO_QUALITY_V2.version,
      quality_status: qualityStatus,
      quality_gates_passed: failed.length === 0,
      quality_reason: failed.join(",") || (previous ? "repeated-direction-confirmation" : "awaiting-next-scan"),
      confirmed_scan_count: previous ? 2 : 1,
      raw_unverified_score: rawScore,
      bid_depth_usd: round(bidUsd),
      ask_depth_usd: round(askUsd),
      imbalance_pct: round(imbalancePct),
      spread_pct: round(spreadPct),
      midpoint_usd: Number(mid.toFixed(6)),
      bid_level_count: nearBids.length,
      ask_level_count: nearAsks.length,
      largest_single_level_share_pct: round(maxLevelShare * 100),
      depth_levels_each_side: 10,
      source_scope: "single-venue-snapshot-not-global-flow",
      data_age_seconds: round(ageSeconds),
    },
  };
}

/** IEX trade prints are never proof of who bought or which side initiated. */
export function analyzeStockPrints(symbol: string, input: unknown, nowMs: number): MoverObservation | null {
  if (!Array.isArray(input)) return null;
  const trades = (input as Trade[]).flatMap(trade => {
    const at = timestamp(trade?.t);
    const price = number(trade?.p);
    const size = number(trade?.s);
    if (at === null || at > nowMs || at < nowMs - 20 * 60_000
      || price === null || price <= 0 || size === null || size <= 0) return [];
    return [{ at, notional: price * size }];
  });
  if (trades.length < 5) return null;
  const sorted = trades.map(trade => trade.notional).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const maxNotional = sorted[sorted.length - 1];
  if (median <= 0 || maxNotional < 25_000) return null;
  const multiple = maxNotional / median;
  if (multiple < 4) return null;
  const now = observedAt(nowMs);
  return {
    asset_class: "stock",
    symbol,
    signal_kind: "stock-large-print",
    observed_bucket: bucketAt(nowMs),
    event_at: new Date(Math.max(...trades.map(trade => trade.at))).toISOString(),
    available_at: now,
    observed_at: now,
    score: round(Math.min(65, 20 + (multiple - 4) * 5)),
    confidence: 25,
    direction: "unknown",
    actor_class: "unattributed",
    source_name: "alpaca-iex-trades",
    evidence: {
      largest_print_usd: round(maxNotional),
      median_print_usd: round(median),
      largest_to_median_ratio: round(multiple),
      sampled_trade_count: trades.length,
      source_scope: "iex-only-trade-sample-not-consolidated",
      trade_direction_known: false,
    },
  };
}
