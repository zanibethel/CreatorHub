/**
 * Market Mover Intelligence v1: evidence-only market microstructure observations.
 * A displayed bid is NOT a purchase, and a trade print does NOT reveal its buyer.
 * Never feed these scores into order authorization without validated backtests.
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

type Level = { p?: unknown; s?: unknown };
type Trade = { t?: unknown; p?: unknown; s?: unknown; c?: unknown };
type Book = { t?: unknown; b?: unknown; a?: unknown };

const number = (n: unknown) => typeof n === "number" && Number.isFinite(n) ? n : null;
const round = (n: number) => Number(n.toFixed(2));
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const timestamp = (s: unknown) => typeof s === "string" && Number.isFinite(Date.parse(s)) ? Date.parse(s) : null;
const bucketAt = (nowMs: number) => new Date(Math.floor(nowMs / 900_000) * 900_000).toISOString();
const observedAt = (nowMs: number) => new Date(nowMs).toISOString();

/** Only use the first ten levels within 2% of the midpoint to avoid distant spoofable liquidity. */
function levels(value: unknown): Array<{ price: number; size: number }> {
  if (!Array.isArray(value)) return [];
  return (value as Level[]).slice(0, 10).flatMap(level => {
    const price = number(level?.p);
    const size = number(level?.s);
    return price !== null && price > 0 && size !== null && size > 0 ? [{ price, size }] : [];
  });
}

export function analyzeCryptoBook(symbol: string, book: Book, nowMs: number): MoverObservation | null {
  const bids = levels(book.b);
  const asks = levels(book.a);
  const bookTime = timestamp(book.t);
  if (!bids.length || !asks.length || bookTime === null) return null;
  const age = (nowMs - bookTime) / 1000;
  if (age < -30 || age > 120 || bids[0].price >= asks[0].price) return null;
  const midpoint = (bids[0].price + asks[0].price) / 2;
  const bidUsd = bids.filter(level => level.price >= midpoint * 0.98)
    .reduce((sum, level) => sum + level.price * level.size, 0);
  const askUsd = asks.filter(level => level.price <= midpoint * 1.02)
    .reduce((sum, level) => sum + level.price * level.size, 0);
  if (bidUsd <= 0 || askUsd <= 0) return null;
  const imbalance = (bidUsd - askUsd) / (bidUsd + askUsd);
  const spreadPct = (asks[0].price - bids[0].price) / midpoint * 100;
  // These are provisional research-strength scores, deliberately capped at 65.
  // They are NOT calibrated win probabilities or execution gates.
  const score = round(Math.min(65, Math.max(0, Math.abs(imbalance) - 0.05) * 100));
  const direction: MoverDirection = imbalance > 0.10 ? "buy-side-depth"
    : imbalance < -0.10 ? "sell-side-depth" : "balanced-depth";
  const now = observedAt(nowMs);
  return {
    asset_class: "crypto",
    symbol,
    signal_kind: "crypto-book-depth",
    observed_bucket: bucketAt(nowMs),
    event_at: new Date(bookTime).toISOString(),
    available_at: now,
    observed_at: now,
    score,
    confidence: 30,
    direction,
    actor_class: "unattributed",
    source_name: "alpaca-crypto-us-orderbook",
    evidence: {
      bid_depth_usd: round(bidUsd),
      ask_depth_usd: round(askUsd),
      imbalance_pct: round(imbalance * 100),
      spread_pct: round(spreadPct),
      midpoint_usd: round(midpoint),
      depth_levels_each_side: 10,
      source_scope: "single-venue-snapshot-not-global-flow",
      data_age_seconds: round(age),
    },
  };
}

/** Exchange prints show executions, not the identity or initiation side of the trade. */
export function analyzeStockPrints(symbol: string, input: unknown, nowMs: number): MoverObservation | null {
  if (!Array.isArray(input)) return null;
  const trades = (input as Trade[]).flatMap(trade => {
    const at = timestamp(trade?.t);
    const price = number(trade?.p);
    const size = number(trade?.s);
    if (at === null || at > nowMs + 30_000 || at < nowMs - 20 * 60_000
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
