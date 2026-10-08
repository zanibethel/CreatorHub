import { NextResponse } from "next/server";
import { analyzeCryptoBook, analyzeStockPrints, type MoverObservation } from "@/lib/paper-market-mover-intelligence";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DATABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://yufptpfiwdbzzrvhkvux.supabase.co";
const DATA_URL = "https://data.alpaca.markets";

type Prospect = { asset_class: string; symbol: string; score: number; last_seen_at: string };
type Json = Record<string, unknown>;

const object = (value: unknown): Json => value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
const reply = (body: unknown, status = 200) => NextResponse.json(body, {
  status, headers: { "Cache-Control": "no-store" },
});

function regularStockSession(nowMs: number) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(nowMs));
  const weekday = parts.find(part => part.type === "weekday")?.value;
  if (weekday === "Sat" || weekday === "Sun") return false;
  const hours = Number(parts.find(part => part.type === "hour")?.value ?? 0);
  const minutes = Number(parts.find(part => part.type === "minute")?.value ?? 0);
  const minuteOfDay = hours * 60 + minutes;
  return minuteOfDay >= 570 && minuteOfDay < 960;
}

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return reply({ error: "Unauthorized." }, 401);
  }
  const supabaseSecret = process.env.SUPABASE_SECRET_KEY?.trim();
  const key = process.env.ALPACA_API_KEY_ID?.trim();
  const secret = process.env.ALPACA_API_SECRET_KEY?.trim();
  if (!supabaseSecret || !key || !secret) return reply({ error: "Market mover data sources not configured." }, 503);

  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const dbHeaders: Record<string, string> = { apikey: supabaseSecret, Accept: "application/json" };
  if (supabaseSecret.startsWith("eyJ")) dbHeaders.Authorization = `Bearer ${supabaseSecret}`;
  const marketHeaders = {
    "APCA-API-KEY-ID": key,
    "APCA-API-SECRET-KEY": secret,
    Accept: "application/json",
  };

  const prospectsResponse = await fetch(
    `${DATABASE_URL}/rest/v1/paper_prospects?select=asset_class,symbol,score,last_seen_at&status=neq.expired&order=score.desc,last_seen_at.desc&limit=160`,
    { headers: dbHeaders, cache: "no-store", signal: AbortSignal.timeout(10_000) },
  ).catch(() => null);
  if (!prospectsResponse?.ok) return reply({ error: "Current prospect universe unavailable." }, 503);
  const prospects = await prospectsResponse.json() as Prospect[];

  const crypto = [...new Set(prospects.filter(row =>
    row.asset_class === "crypto" && /^[A-Z0-9]{2,12}\/USD$/.test(row.symbol)
    && nowMs - Date.parse(row.last_seen_at) < 4 * 60 * 60_000,
  ).map(row => row.symbol))].slice(0, 8);
  const stocks = regularStockSession(nowMs)
    ? [...new Set(prospects.filter(row =>
      row.asset_class === "stock" && /^[A-Z][A-Z0-9.]{0,6}$/.test(row.symbol)
      && nowMs - Date.parse(row.last_seen_at) < 2 * 60 * 60_000,
    ).map(row => row.symbol))].slice(0, 8)
    : [];

  const observations: MoverObservation[] = [];
  const failures: string[] = [];
  const marketJson = async (url: string) => {
    const response = await fetch(url, {
      headers: marketHeaders, cache: "no-store", signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return object(await response.json());
  };

  if (crypto.length) {
    try {
      const result = await marketJson(
        `${DATA_URL}/v1beta3/crypto/us/latest/orderbooks?symbols=${encodeURIComponent(crypto.join(","))}`,
      );
      const books = object(result.orderbooks);
      for (const symbol of crypto) {
        const finding = analyzeCryptoBook(symbol, object(books[symbol]), nowMs);
        if (finding) observations.push(finding);
      }
    } catch (error) {
      failures.push(`crypto orderbook source: ${error instanceof Error ? error.message : "unavailable"}`);
    }
  }

  const start = new Date(nowMs - 20 * 60_000).toISOString();
  for (const symbol of stocks) {
    try {
      const result = await marketJson(
        `${DATA_URL}/v2/stocks/${symbol}/trades?feed=iex&sort=desc&limit=1000&start=${encodeURIComponent(start)}&end=${encodeURIComponent(now)}`,
      );
      const finding = analyzeStockPrints(symbol, result.trades, nowMs);
      if (finding) observations.push(finding);
    } catch (error) {
      failures.push(`IEX prints for ${symbol}: ${error instanceof Error ? error.message : "unavailable"}`);
    }
  }

  if (observations.length) {
    const stored = await fetch(
      `${DATABASE_URL}/rest/v1/paper_market_mover_observations?on_conflict=asset_class,symbol,signal_kind,observed_bucket`,
      {
        method: "POST",
        headers: {
          ...dbHeaders,
          "Content-Type": "application/json",
          Prefer: "resolution=ignore-duplicates,return=minimal",
        },
        body: JSON.stringify(observations),
        cache: "no-store",
        signal: AbortSignal.timeout(12_000),
      },
    ).catch(() => null);
    if (!stored?.ok) return reply({
      error: "Market mover observations could not be persisted.",
      candidatesChecked: { crypto: crypto.length, stock: stocks.length },
      observationsPrepared: observations.length,
    }, 502);
  }

  return reply({
    module: "market-mover-intelligence-v1",
    status: "research-only",
    collectedAt: now,
    candidatesChecked: { crypto: crypto.length, stock: stocks.length },
    observationsSavedOrDeduplicated: observations.length,
    upstreamFailures: failures,
    tradeAuthority: false,
  });
}
