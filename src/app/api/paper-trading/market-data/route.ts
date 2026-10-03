import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type KrakenLevel = {
  price: string;
  qty: string;
  publication_ts: string;
};

type KrakenBook = {
  symbol?: string;
  bids?: KrakenLevel[];
  asks?: KrakenLevel[];
};

type Candle = { time: string; close: number; high?: number; low?: number; volume?: number };

function parseSymbols(value: string | null, pattern: RegExp, maximum = 10) {
  if (!value?.trim()) return [];
  const symbols = [...new Set(value.split(",").map((item) => item.trim().toUpperCase()).filter(Boolean))];
  if (symbols.length > maximum || symbols.some((symbol) => !pattern.test(symbol))) return null;
  return symbols;
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const stockSymbols = parseSymbols(requestUrl.searchParams.get("stocks"), /^[A-Z][A-Z0-9.]{0,9}$/, 20);
  const cryptoProducts = parseSymbols(requestUrl.searchParams.get("crypto"), /^[A-Z0-9]{2,12}-USD$/);
  const includeHistory = requestUrl.searchParams.get("history") !== "0";

  if (stockSymbols === null || cryptoProducts === null || (!stockSymbols.length && !cryptoProducts.length)) {
    return NextResponse.json({ error: "Provide up to 20 comma-separated stock symbols and/or 10 USD crypto pairs." }, { status: 400 });
  }

  const stocksPromise = stockSymbols.length ? fetchStockQuotes(stockSymbols) : Promise.resolve({});
  const stockBarsPromise = stockSymbols.length && includeHistory ? fetchStockBars(stockSymbols) : Promise.resolve({});
  const [stocksResult, barsResult, ...cryptoResults] = await Promise.allSettled([
    stocksPromise,
    stockBarsPromise,
    ...cryptoProducts.map(product => fetchKrakenMarketData(product, includeHistory)),
  ] as const);

  const errors: Record<string, string> = {};
  const message = (reason: unknown) => reason instanceof Error ? reason.message : "Market-data request failed.";
  if (stocksResult.status === "rejected") errors.stocks = message(stocksResult.reason);
  if (barsResult.status === "rejected") errors.stockBars = message(barsResult.reason);

  const crypto = cryptoResults.flatMap((result, index) => {
    if (result.status === "fulfilled") {
      if (result.value.historyError) errors[`${cryptoProducts[index]} history`] = result.value.historyError;
      return [result.value];
    }
    errors[cryptoProducts[index]] = message(result.reason);
    return [];
  });

  const stocks = stocksResult.status === "fulfilled" ? stocksResult.value : {};
  const stockBars = barsResult.status === "fulfilled" ? barsResult.value : {};
  const hasQuotes = Object.values(stocks).some(Boolean) || crypto.some(book => book.bestBid || book.bestAsk);
  if (!hasQuotes) {
    return NextResponse.json({ error: "No quotes available from the requested sources.", errors }, {
      status: 502,
      headers: { "Cache-Control": "no-store" },
    });
  }

  return NextResponse.json({
    collectedAt: new Date().toISOString(),
    sources: {
      stocks: stockSymbols.length ? "Alpaca IEX (single-exchange feed)" : null,
      crypto: cryptoProducts.length ? "Kraken public order book" : null,
    },
    stocks,
    stockBars,
    crypto,
    historyIncluded: includeHistory,
    errors,
    note: "Read-only market data snapshot. It is not a trade signal or a simulated fill.",
  }, { headers: { "Cache-Control": "no-store" } });
}

async function fetchStockQuotes(symbols: string[]) {
  const key = process.env.ALPACA_API_KEY_ID;
  const secret = process.env.ALPACA_API_SECRET_KEY;
  if (!key || !secret) throw new Error("Alpaca data keys are not configured on the server.");

  const query = new URLSearchParams({ symbols: symbols.join(","), feed: "iex" });
  const response = await fetch(`https://data.alpaca.markets/v2/stocks/quotes/latest?${query.toString()}`, {
    headers: { "APCA-API-KEY-ID": key, "APCA-API-SECRET-KEY": secret },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Alpaca returned HTTP ${response.status}.`);

  const payload = await response.json() as {
    quotes?: Record<string, { ap?: number; as?: number; bp?: number; bs?: number; t?: string }>;
  };
  return Object.fromEntries(symbols.map((symbol) => {
    const quote = payload.quotes?.[symbol];
    return [symbol, quote ? {
      bid: quote.bp ?? null,
      bidSize: quote.bs ?? null,
      ask: quote.ap ?? null,
      askSize: quote.as ?? null,
      timestamp: quote.t ?? null,
    } : null];
  }));
}

async function fetchStockBars(symbols: string[]): Promise<Record<string, Candle[]>> {
  const key = process.env.ALPACA_API_KEY_ID;
  const secret = process.env.ALPACA_API_SECRET_KEY;
  if (!key || !secret) throw new Error("Alpaca data keys are not configured on the server.");

  const query = new URLSearchParams({
    symbols: symbols.join(","),
    timeframe: "1Day",
    limit: "1000",
    feed: "iex",
    start: new Date(Date.now() - 60 * 86_400_000).toISOString(),
    adjustment: "split",
    sort: "asc",
  });
  const bars: Record<string, Array<{ t: string; c: number; h?: number; l?: number; v?: number }>> = {};
  const signal = AbortSignal.timeout(10_000);

  for (let page = 0; page < 10; page++) {
    const response = await fetch(`https://data.alpaca.markets/v2/stocks/bars?${query.toString()}`, {
      headers: { "APCA-API-KEY-ID": key, "APCA-API-SECRET-KEY": secret },
      cache: "no-store",
      signal,
    });
    if (!response.ok) throw new Error(`Alpaca history request returned HTTP ${response.status}.`);

    const payload = await response.json() as {
      bars?: Record<string, Array<{ t: string; c: number; h?: number; l?: number; v?: number }>>;
      next_page_token?: string | null;
    };
    for (const symbol of symbols) bars[symbol] = [...(bars[symbol] ?? []), ...(payload.bars?.[symbol] ?? [])];
    if (!payload.next_page_token) break;
    if (page === 9) throw new Error("Stock history exceeded the page limit; retry with fewer symbols.");
    query.set("page_token", payload.next_page_token);
  }

  return Object.fromEntries(symbols.map((symbol) => [
    symbol,
    (bars[symbol] ?? [])
      .filter(({ c }) => Number.isFinite(c) && c > 0)
      .slice(-30)
      .map(({ t, c, h, l, v }) => ({
        time: t,
        close: c,
        ...(typeof h === "number" && Number.isFinite(h) && h > 0 ? { high: h } : {}),
        ...(typeof l === "number" && Number.isFinite(l) && l > 0 ? { low: l } : {}),
        ...(typeof v === "number" && Number.isFinite(v) && v >= 0 ? { volume: v } : {}),
      })),
  ]));
}

async function fetchKrakenMarketData(product: string, includeHistory: boolean) {
  const [book, candles] = await Promise.allSettled([
    fetchKrakenBook(product),
    includeHistory ? fetchKrakenCandles(product) : Promise.resolve([]),
  ]);
  if (book.status === "rejected") throw book.reason;
  return {
    ...book.value,
    candles: candles.status === "fulfilled" ? candles.value : [],
    historyError: candles.status === "rejected"
      ? candles.reason instanceof Error ? candles.reason.message : "Crypto history unavailable."
      : undefined,
  };
}

async function fetchKrakenCandles(product: string): Promise<Candle[]> {
  const [base, quote] = product.split("-");
  const krakenBase = base === "BTC" ? "XBT" : base;
  const query = new URLSearchParams({ pair: `${krakenBase}${quote}`, interval: "60" });
  const response = await fetch(`https://api.kraken.com/0/public/OHLC?${query.toString()}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Kraken history request returned HTTP ${response.status} for ${product}.`);

  const payload = await response.json() as {
    error?: string[];
    result?: Record<string, Array<[number, string, string, string, string, string, string, number]>> & { last?: number };
  };
  if (payload.error?.length) throw new Error(`Kraken could not load history for ${product}: ${payload.error.join(", ")}`);

  const result = payload.result ?? {};
  const pairKey = Object.keys(result).find((key) => key !== "last");
  if (!pairKey) return [];

  return (result[pairKey] ?? [])
    .slice(0, -1)
    .map(([timestamp, , high, low, close, , volume]) => ({
      time: new Date(timestamp * 1000).toISOString(),
      close: Number(close),
      high: Number(high),
      low: Number(low),
      volume: Number(volume),
    }))
    .filter(candle => finiteCandle(candle));
}

function finiteCandle(candle: Candle) {
  return finitePositive(candle.close)
    && finitePositive(candle.high)
    && finitePositive(candle.low)
    && typeof candle.volume === "number"
    && Number.isFinite(candle.volume)
    && candle.volume >= 0;
}

function finitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

async function fetchKrakenBook(product: string) {
  const [base, quote] = product.split("-");
  const symbol = `${base}/${quote}`;
  const query = new URLSearchParams({ symbol });
  const response = await fetch(`https://api.kraken.com/0/public/PreTrade?${query.toString()}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Kraken returned HTTP ${response.status} for ${product}.`);

  const payload = await response.json() as {
    error?: string[];
    result?: KrakenBook;
  };
  if (payload.error?.length) throw new Error(`Kraken could not load ${product}: ${payload.error.join(", ")}`);

  const book = payload.result;
  const validLevel = (level: { price: number; size: number }) =>
    Number.isFinite(level.price) && level.price > 0 && Number.isFinite(level.size) && level.size > 0;
  const bids = (book?.bids ?? [])
    .map(({ price, qty, publication_ts }) => ({ price: Number(price), size: Number(qty), timestamp: publication_ts }))
    .filter(validLevel)
    .sort((a, b) => b.price - a.price);
  const asks = (book?.asks ?? [])
    .map(({ price, qty, publication_ts }) => ({ price: Number(price), size: Number(qty), timestamp: publication_ts }))
    .filter(validLevel)
    .sort((a, b) => a.price - b.price);

  return {
    product,
    timestamp: bids[0]?.timestamp ?? asks[0]?.timestamp ?? null,
    bestBid: bids[0] ?? null,
    bestAsk: asks[0] ?? null,
    bids,
    asks,
  };
}
