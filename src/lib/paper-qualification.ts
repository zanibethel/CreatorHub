import { quoteAge, type Candle } from "./market-monitor";
import type { PaperWatchlist } from "./paper-watchlist";

export type Candidate = PaperWatchlist["stocks"][number];
export const RESEARCH_POOLS = [
  { id: "day", label: "Day", allocationPct: 20 },
  { id: "multi-day", label: "Multi-day", allocationPct: 40 },
  { id: "multi-week", label: "Multi-week", allocationPct: 40 },
] as const;

// Descriptive data checks only. No strategy thresholds or order authorization.
export function qualificationEvidence(item: Candidate, quote: { bid: number | null; ask: number | null } | null | undefined, timestamp: string | null | undefined, candles: Candle[], now: number) {
  const valid = typeof quote?.bid === "number" && Number.isFinite(quote.bid) && quote.bid > 0
    && typeof quote?.ask === "number" && Number.isFinite(quote.ask) && quote.ask >= quote.bid;
  const fresh = now > 0 && !quoteAge(timestamp, now).stale;
  const spread = valid ? (quote!.ask! - quote!.bid!) / ((quote!.ask! + quote!.bid!) / 2) * 100 : null;
  const history = candles.filter(c => Number.isFinite(c.close) && c.close > 0 && Number.isFinite(Date.parse(c.time)) && Date.parse(c.time) <= now)
    .sort((a,b) => Date.parse(a.time) - Date.parse(b.time));
  const change = history.length >= 2 ? (history.at(-1)!.close / history[0].close - 1) * 100 : null;
  const inverse = item.symbol === "SH" || item.symbol === "PSQ";
  const blockers = [
    ...(inverse ? ["Inverse allocation is 0%."] : []),
    ...(!valid ? ["A positive, non-crossed bid and ask are needed."] : []),
    ...(!fresh ? ["Fresh quote required; an older stock quote may reflect a closed market."] : []),
    ...(history.length < 2 ? ["Recent chart history is unavailable."] : []),
    "Entry, stop, target and holding-period rules are not validated.",
    "Spread limits, fees, slippage and order minimums need validation.",
    "Current bot risk state and pool allocation capacity must pass before order authorization.",
  ];
  return { status: inverse ? "Monitor only · no allocation" : "Awaiting validated rules", valid, fresh, spread, change, historyCount: history.length, historyFrom: history[0]?.time, historyThrough: history.at(-1)?.time, blockers, pools: inverse ? [] : RESEARCH_POOLS };
}
