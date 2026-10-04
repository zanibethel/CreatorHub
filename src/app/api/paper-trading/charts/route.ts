import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type Candle = {
  time: string;
  close: number;
  high?: number;
  low?: number;
  volume?: number;
};

const STOCK_PATTERN = /^[A-Z][A-Z0-9.]{0,9}$/;
const CRYPTO_PATTERN = /^[A-Z0-9]{2,16}\/USD$/;

function parseSymbols(value: string | null) {
  if (!value?.trim()) return [];
  const symbols = [...new Set(value.split(",").map(item => item.trim().toUpperCase()).filter(Boolean))];
  return symbols.length <= 20 ? symbols : null;
}

function settings(botId: string) {
  if (botId === "weekend-crypto-day-100") {
    return { timeframe: "5Min", lookbackMs: 18 * 60 * 60_000, limit: "10000" };
  }
  if (botId === "crypto-swing-100") {
    return { timeframe: "1Hour", lookbackMs: 14 * 86_400_000, limit: "10000" };
  }
  if (botId === "three-trade-weekly-swing-100") {
    return { timeframe: "1Hour", lookbackMs: 14 * 86_400_000, limit: "10000" };
  }
  return { timeframe: "1Day", lookbackMs: 60 * 86_400_000, limit: "1000" };
}

function finitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const botId = url.searchParams.get("botId")?.trim() || "default-diverse";
  const symbols = parseSymbols(url.searchParams.get("symbols"));
  if (symbols === null || !symbols.length) {
    return NextResponse.json({ error:"Provide up to 20 chart symbols." }, { status:400 });
  }

  const stocks = symbols.filter(symbol => STOCK_PATTERN.test(symbol));
  const crypto = symbols
    .map(symbol => symbol.replace("-", "/"))
    .filter(symbol => CRYPTO_PATTERN.test(symbol));

  if (stocks.length + crypto.length !== symbols.length) {
    return NextResponse.json({ error:"One or more chart symbols are invalid." }, { status:400 });
  }

  const key = process.env.ALPACA_API_KEY_ID?.trim() ?? "";
  const secret = process.env.ALPACA_API_SECRET_KEY?.trim() ?? "";
  if (!key || !secret) {
    return NextResponse.json({ error:"Chart market-data keys are not configured." }, { status:503 });
  }

  const selected = settings(botId);
  const start = new Date(Date.now() - selected.lookbackMs).toISOString();
  const headers = {
    "APCA-API-KEY-ID":key,
    "APCA-API-SECRET-KEY":secret,
    Accept:"application/json",
  };

  const fetchJson = async (href: string) => {
    const response = await fetch(href, {
      headers,
      cache:"no-store",
      signal:AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Alpaca chart request returned HTTP ${response.status}.`);
    return response.json() as Promise<unknown>;
  };

  try {
    const [stockRaw,cryptoRaw] = await Promise.all([
      stocks.length
        ? fetchJson(`https://data.alpaca.markets/v2/stocks/bars?${new URLSearchParams({
            symbols:stocks.join(","),
            timeframe:selected.timeframe,
            start,
            limit:selected.limit,
            feed:"iex",
            adjustment:"split",
            sort:"asc",
          }).toString()}`)
        : Promise.resolve({ bars:{} }),
      crypto.length
        ? fetchJson(`https://data.alpaca.markets/v1beta3/crypto/us/bars?${new URLSearchParams({
            symbols:crypto.join(","),
            timeframe:selected.timeframe,
            start,
            limit:selected.limit,
            sort:"asc",
          }).toString()}`)
        : Promise.resolve({ bars:{} }),
    ]);

    const stockBars = (stockRaw as {bars?:Record<string,Array<{t:string;c:number;h?:number;l?:number;v?:number}>>}).bars ?? {};
    const cryptoBars = (cryptoRaw as {bars?:Record<string,Array<{t:string;c:number;h?:number;l?:number;v?:number}>>}).bars ?? {};

    const series: Record<string,Candle[]> = {};
    for (const symbol of stocks) {
      series[symbol] = (stockBars[symbol] ?? [])
        .filter(bar => finitePositive(bar.c))
        .slice(-120)
        .map(bar => ({
          time:bar.t,
          close:bar.c,
          ...(finitePositive(bar.h) ? {high:bar.h} : {}),
          ...(finitePositive(bar.l) ? {low:bar.l} : {}),
          ...(typeof bar.v === "number" && Number.isFinite(bar.v) && bar.v >= 0 ? {volume:bar.v} : {}),
        }));
    }
    for (const symbol of crypto) {
      series[symbol] = (cryptoBars[symbol] ?? [])
        .filter(bar => finitePositive(bar.c))
        .slice(-160)
        .map(bar => ({
          time:bar.t,
          close:bar.c,
          ...(finitePositive(bar.h) ? {high:bar.h} : {}),
          ...(finitePositive(bar.l) ? {low:bar.l} : {}),
          ...(typeof bar.v === "number" && Number.isFinite(bar.v) && bar.v >= 0 ? {volume:bar.v} : {}),
        }));
    }

    return NextResponse.json({
      collectedAt:new Date().toISOString(),
      botId,
      timeframe:selected.timeframe,
      series,
    }, {
      headers:{ "Cache-Control":"public, s-maxage=30, stale-while-revalidate=60" },
    });
  } catch (error) {
    return NextResponse.json({
      error:error instanceof Error ? error.message : "Chart data is unavailable.",
    }, {
      status:503,
      headers:{ "Cache-Control":"no-store" },
    });
  }
}
