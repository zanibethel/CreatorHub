import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";

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

type Candle = { time: string; close: number };

function parseSymbols(value: string | null, pattern: RegExp) {
  if (!value?.trim()) return [];
  const symbols = [...new Set(value.split(",").map((item) => item.trim().toUpperCase()).filter(Boolean))];
  if (symbols.length > 10 || symbols.some((symbol) => !pattern.test(symbol))) return null;
  return symbols;
}

export async function GET(request: Request) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user || user.is_anonymous) {
    return NextResponse.json({ error: "Sign in to view paper-trading market data." }, { status: 401 });
  }

  const requestUrl = new URL(request.url);
  const stockSymbols = parseSymbols(requestUrl.searchParams.get("stocks"), /^[A-Z][A-Z0-9.]{0,9}$/);
  const cryptoProducts = parseSymbols(requestUrl.searchParams.get("crypto"), /^[A-Z0-9]{2,12}-USD$/);

  if (stockSymbols === null || cryptoProducts === null || (!stockSymbols.length && !cryptoProducts.length)) {
    return NextResponse.json({ error: "Provide up to 10 comma-separated stock symbols and/or USD crypto pairs." }, { status: 400 });
  }

  const stocksPromise = stockSymbols.length
    ? fetchStockQuotes(stockSymbols)
    : Promise.resolve({});
  const stockBarsPromise = stockSymbols.length
    ? fetchStockBars(stockSymbols)
    : Promise.resolve({});
  const cryptoPromise = Promise.all(cryptoProducts.map(fetchKrakenMarketData));

  try {
    const [stocks, stockBars, crypto] = await Promise.all([stocksPromise, stockBarsPromise, cryptoPromise]);
    return NextResponse.json({
      collectedAt: new Date().toISOString(),
      sources: {
        stocks: stockSymbols.length ? "Alpaca IEX (single-exchange feed)" : null,
        crypto: cryptoProducts.length ? "Kraken public order book" : null,
      },
      stocks,
      stockBars,
      crypto,
      note: "Read-only market data snapshot. It is not a trade signal or a simulated fill.",
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Market-data request failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

async function fetchStockQuotes(symbols: string[]) {
  const key = process.env.ALPACA_API_KEY_ID;
  const secret = process.env.ALPACA_API_SECRET_KEY;
  if (!key || !secret) throw new Error("Alpaca data keys are not configured on the server.");

  const query = new URLSearchParams({ symbols: symbols.join(","), feed: "iex" });
  const response = await fetch(`https://data.alpaca.markets/v2/stocks/quotes/latest?${query.toString()}`, {
    headers: { "APCA-API-KEY-ID": key, "APCA-API-SECRET-KEY": secret },
    cache: "no-store",
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

  const query = new URLSearchParams({ symbols: symbols.join(","), timeframe: "1Day", limit: "30", feed: "iex" });
  const response = await fetch(`https://data.alpaca.markets/v2/stocks/bars?${query.toString()}`, {
    headers: { "APCA-API-KEY-ID": key, "APCA-API-SECRET-KEY": secret },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Alpaca history request returned HTTP ${response.status}.`);

  const payload = await response.json() as {
    bars?: Record<string, Array<{ t: string; c: number }>>;
  };
  return Object.fromEntries(symbols.map((symbol) => [
    symbol,
    (payload.bars?.[symbol] ?? []).map(({ t, c }) => ({ time: t, close: c })),
  ]));
}

async function fetchKrakenMarketData(product: string) {
  const [book, candles] = await Promise.all([fetchKrakenBook(product), fetchKrakenCandles(product)]);
  return { ...book, candles };
}

async function fetchKrakenCandles(product: string): Promise<Candle[]> {
  const [base, quote] = product.split("-");
  const krakenBase = base === "BTC" ? "XBT" : base;
  const query = new URLSearchParams({ pair: `${krakenBase}${quote}`, interval: "60" });
  const response = await fetch(`https://api.kraken.com/0/public/OHLC?${query.toString()}`, {
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Kraken history request returned HTTP ${response.status} for ${product}.`);

  const payload = await response.json() as {
    error?: string[];
    result?: Record<string, Array<[number, string, string, string, string, string, string, number]>> & { last?: number };
  };
  if (payload.error?.length) throw new Error(`Kraken could not load history for ${product}: ${payload.error.join(", ")}`);
  const result = payload.result ?? {};
  const pairKey = Object.keys(result).find((key) => key !== "last");
  return pairKey ? (result[pairKey] ?? []).map(([timestamp, , , , close]) => ({
    time: new Date(timestamp * 1000).toISOString(),
    close: Number(close),
  })) : [];
}

async function fetchKrakenBook(product: string) {
  const [base, quote] = product.split("-");
  const symbol = `${base}/${quote}`;
  const query = new URLSearchParams({ symbol });
  const response = await fetch(`https://api.kraken.com/0/public/PreTrade?${query.toString()}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Kraken returned HTTP ${response.status} for ${product}.`);

  const payload = await response.json() as {
    error?: string[];
    result?: KrakenBook;
  };
  if (payload.error?.length) throw new Error(`Kraken could not load ${product}: ${payload.error.join(", ")}`);

  const book = payload.result;
  const bids = (book?.bids ?? []).map(({ price, qty, publication_ts }) => ({ price: Number(price), size: Number(qty), timestamp: publication_ts }));
  const asks = (book?.asks ?? []).map(({ price, qty, publication_ts }) => ({ price: Number(price), size: Number(qty), timestamp: publication_ts }));
  return {
    product,
    timestamp: bids[0]?.timestamp ?? asks[0]?.timestamp ?? new Date().toISOString(),
    bestBid: bids[0] ?? null,
    bestAsk: asks[0] ?? null,
    bids,
    asks,
  };
}
