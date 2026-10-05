export type LiveStockQuote = {
  symbol: string;
  description: string | null;
  bid: number | null;
  bidSize: number | null;
  ask: number | null;
  askSize: number | null;
  last: number | null;
  lastSize: number | null;
  volume: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  previousClose: number | null;
  changePct: number | null;
  averageVolume: number | null;
  timestamp: string | null;
  source: "tradier-consolidated" | "alpaca-iex";
};

export type LiveStockQuoteBatch = {
  quotes: Record<string, LiveStockQuote | null>;
  source: "tradier-consolidated" | "alpaca-iex";
  fallback: boolean;
  providerError: string | null;
};

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value == null ? [] : [value];
}

function num(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function str(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function epochIso(...values: unknown[]) {
  const timestamps = values
    .map(value => num(value))
    .filter((value): value is number => value !== null && value > 0)
    .map(value => value < 10_000_000_000 ? value * 1000 : value);
  if (!timestamps.length) return null;
  return new Date(Math.max(...timestamps)).toISOString();
}

function chunk<T>(items: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

function normalizeSymbols(symbols: string[]) {
  return [...new Set(symbols.map(symbol => symbol.trim().toUpperCase()).filter(Boolean))];
}

async function fetchTradierQuotes(symbols: string[]): Promise<Record<string, LiveStockQuote | null>> {
  const token = process.env.TRADIER_ACCESS_TOKEN?.trim();
  if (!token) throw new Error("Tradier production market-data token is not configured.");

  const quotes: Record<string, LiveStockQuote | null> = Object.fromEntries(symbols.map(symbol => [symbol, null]));
  for (const batch of chunk(symbols, 50)) {
    const query = new URLSearchParams({ symbols: batch.join(","), greeks: "false" });
    const response = await fetch(`https://api.tradier.com/v1/markets/quotes?${query.toString()}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) throw new Error(`Tradier market data returned HTTP ${response.status}.`);

    const payload = record(await response.json());
    const root = record(payload.quotes);
    for (const raw of array(root.quote)) {
      const quote = record(raw);
      const symbol = str(quote.symbol)?.toUpperCase();
      if (!symbol || !(symbol in quotes)) continue;
      quotes[symbol] = {
        symbol,
        description: str(quote.description),
        bid: num(quote.bid),
        bidSize: num(quote.bidsize),
        ask: num(quote.ask),
        askSize: num(quote.asksize),
        last: num(quote.last),
        lastSize: num(quote.last_volume),
        volume: num(quote.volume),
        open: num(quote.open),
        high: num(quote.high),
        low: num(quote.low),
        close: num(quote.close),
        previousClose: num(quote.prevclose),
        changePct: num(quote.change_percentage),
        averageVolume: num(quote.average_volume),
        timestamp: epochIso(quote.trade_date, quote.bid_date, quote.ask_date),
        source: "tradier-consolidated",
      };
    }
  }
  return quotes;
}

async function fetchAlpacaIexQuotes(symbols: string[]): Promise<Record<string, LiveStockQuote | null>> {
  const key = process.env.ALPACA_API_KEY_ID?.trim();
  const secret = process.env.ALPACA_API_SECRET_KEY?.trim();
  if (!key || !secret) throw new Error("Fallback stock market-data credentials are not configured.");

  const quotes: Record<string, LiveStockQuote | null> = Object.fromEntries(symbols.map(symbol => [symbol, null]));
  for (const batch of chunk(symbols, 45)) {
    const query = new URLSearchParams({ symbols: batch.join(","), feed: "iex" });
    const response = await fetch(`https://data.alpaca.markets/v2/stocks/snapshots?${query.toString()}`, {
      headers: {
        "APCA-API-KEY-ID": key,
        "APCA-API-SECRET-KEY": secret,
        Accept: "application/json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) throw new Error(`Fallback stock market data returned HTTP ${response.status}.`);

    const payload = record(await response.json());
    for (const symbol of batch) {
      const snapshot = record(payload[symbol]);
      if (!Object.keys(snapshot).length) continue;
      const latestQuote = record(snapshot.latestQuote);
      const latestTrade = record(snapshot.latestTrade);
      const daily = record(snapshot.dailyBar);
      const previous = record(snapshot.prevDailyBar);
      quotes[symbol] = {
        symbol,
        description: null,
        bid: num(latestQuote.bp),
        bidSize: num(latestQuote.bs),
        ask: num(latestQuote.ap),
        askSize: num(latestQuote.as),
        last: num(latestTrade.p) ?? num(daily.c),
        lastSize: num(latestTrade.s),
        volume: num(daily.v),
        open: num(daily.o),
        high: num(daily.h),
        low: num(daily.l),
        close: num(daily.c),
        previousClose: num(previous.c),
        changePct: null,
        averageVolume: null,
        timestamp: str(latestQuote.t) ?? str(latestTrade.t) ?? str(daily.t),
        source: "alpaca-iex",
      };
    }
  }
  return quotes;
}

export async function fetchPreferredStockQuotes(symbols: string[]): Promise<LiveStockQuoteBatch> {
  const normalized = normalizeSymbols(symbols);
  if (!normalized.length) {
    return { quotes: {}, source: "alpaca-iex", fallback: false, providerError: null };
  }

  if (process.env.TRADIER_ACCESS_TOKEN?.trim()) {
    try {
      return {
        quotes: await fetchTradierQuotes(normalized),
        source: "tradier-consolidated",
        fallback: false,
        providerError: null,
      };
    } catch (error) {
      const providerError = error instanceof Error ? error.message : "Tradier market data failed.";
      return {
        quotes: await fetchAlpacaIexQuotes(normalized),
        source: "alpaca-iex",
        fallback: true,
        providerError,
      };
    }
  }

  return {
    quotes: await fetchAlpacaIexQuotes(normalized),
    source: "alpaca-iex",
    fallback: false,
    providerError: null,
  };
}
