export type Candle = { time: string; close: number; high?: number; low?: number; volume?: number };
export type MarketSnapshot = {
  collectedAt: string;
  stocks: Record<string, { bid: number | null; ask: number | null; timestamp: string | null } | null>;
  stockBars: Record<string, Candle[]>;
  crypto: Array<{ product: string; timestamp: string | null; bestBid: { price: number } | null; bestAsk: { price: number } | null; candles: Candle[]; historyError?: string }>;
  historyIncluded?: boolean;
  errors?: Record<string, string>;
};

export type MonitorStatus = "off" | "connecting" | "monitoring" | "partial" | "hidden" | "retrying" | "blocked";
export const MONITOR_INTERVAL_MS = 15_000;
const HISTORY_INTERVAL_MS = 300_000;

export function mergeMarketSnapshot(previous: MarketSnapshot | null, next: MarketSnapshot): MarketSnapshot {
  if (!previous) return next;
  return {
    ...next,
    stockBars: next.historyIncluded === false || next.errors?.stockBars ? previous.stockBars : next.stockBars,
    crypto: next.crypto.map(book => ({
      ...book, candles: next.historyIncluded === false || book.historyError
        ? previous.crypto.find(old => old.product === book.product)?.candles ?? [] : book.candles,
    })),
  };
}

export function quoteAge(timestamp: string | null | undefined, now: number) {
  const time = timestamp ? Date.parse(timestamp) : NaN;
  if (!Number.isFinite(time)) return { stale: true, label: "Timestamp unavailable" };
  if (time > now + 60_000) return { stale: true, label: "Check source clock" };
  const seconds = Math.max(0, Math.floor((now - time) / 1000));
  const age = seconds < 60 ? `${seconds}s` : seconds < 3600 ? `${Math.floor(seconds / 60)}m` : `${Math.floor(seconds / 3600)}h`;
  return { stale: seconds >= 60, label: `${seconds >= 60 ? "Stale · " : ""}${age} since quote` };
}

type MonitorOptions = {
  load: (signal: AbortSignal, includeHistory: boolean) => Promise<MarketSnapshot>;
  onSnapshot: (snapshot: MarketSnapshot) => void;
  onError: (message: string) => void;
  onStatus: (status: MonitorStatus) => void;
  onLoading: (loading: boolean) => void;
  isVisible: () => boolean;
  now?: () => number;
  setTimer?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
};

// One request at a time, no background polling, bounded failure backoff.
// Browser lifetime only: this is not the scheduled paper-trading worker.
export function createMarketMonitor(options: MonitorOptions) {
  const now = options.now ?? Date.now;
  const setTimer = options.setTimer ?? setTimeout;
  const clearTimer = options.clearTimer ?? clearTimeout;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let request: AbortController | null = null;
  let disposed = false;
  let enabled = false;
  let blocked = false;
  let failures = 0;
  let lastHistoryAt: number | null = null;

  function clear() {
    if (timer !== undefined) clearTimer(timer);
    timer = undefined;
  }

  async function refresh(forceHistory = false) {
    if (disposed || request) return;
    clear();
    const controller = new AbortController();
    request = controller;
    const includeHistory = forceHistory || lastHistoryAt === null || now() - lastHistoryAt >= HISTORY_INTERVAL_MS;
    options.onLoading(true);
    options.onStatus("connecting");
    try {
      const snapshot = await options.load(controller.signal, includeHistory);
      if (disposed || controller.signal.aborted) return;
      if (includeHistory) lastHistoryAt = now();
      failures = 0;
      blocked = false;
      options.onSnapshot(snapshot);
      options.onError("");
      options.onStatus(enabled ? Object.keys(snapshot.errors ?? {}).length ? "partial" : "monitoring" : "off");
    } catch (error) {
      if (disposed || controller.signal.aborted) return;
      failures++;
      const status = (error as { status?: number })?.status;
      blocked = status === 400 || status === 401;
      options.onError(error instanceof Error ? error.message : "Market refresh failed.");
      options.onStatus(enabled ? blocked ? "blocked" : "retrying" : "off");
    } finally {
      request = null;
      if (!disposed) {
        options.onLoading(false);
        if (enabled && !blocked && options.isVisible()) {
          const delay = Math.min(MONITOR_INTERVAL_MS * 2 ** Math.min(failures, 3), 120_000);
          timer = setTimer(() => { void refresh(); }, delay);
        }
      }
    }
  }

  return {
    refresh: () => refresh(true),
    setEnabled(value: boolean) {
      enabled = value;
      blocked = false;
      clear();
      if (!value) { request?.abort(); options.onStatus("off"); }
      else if (options.isVisible()) { void refresh(); }
      else options.onStatus("hidden");
    },
    visibilityChanged() {
      clear();
      if (!enabled) return;
      if (!options.isVisible()) { request?.abort(); options.onStatus("hidden"); }
      else if (!blocked) { void refresh(); }
    },
    dispose() { disposed = true; enabled = false; clear(); request?.abort(); },
  };
}
