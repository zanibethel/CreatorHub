import { NextResponse } from "next/server";
import { z } from "zod";
import {
  evaluateWeekendCryptoReadiness,
  weekendCryptoSession,
  type CryptoBar,
  type CryptoQuote,
} from "@/lib/paper-weekend-crypto-readiness";
import { ACTIVE_DAILY_CRYPTO_DAY_STRATEGY as strategy } from "@/lib/paper-weekend-crypto-strategy-config";

export const dynamic = "force-dynamic";

const BOT_ID = strategy.botProfileId;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://yufptpfiwdbzzrvhkvux.supabase.co";
const ALPACA_DATA = "https://data.alpaca.markets";

const ledgerSchema = z.object({
  status: z.enum(["active","planned","paused"]),
  equity: z.coerce.number().finite().nonnegative(),
  buying_power: z.coerce.number().finite().nonnegative().nullable(),
  open_planned_risk_pct: z.coerce.number().finite().nonnegative().nullable(),
  daily_realized_loss_pct: z.coerce.number().finite().nonnegative().nullable(),
  metadata: z.object({
    executionEnabled: z.boolean().optional(),
  }).passthrough(),
});

const positionSchema = z.object({
  bot_id: z.string(),
  symbol: z.string(),
  quantity: z.coerce.number().finite().positive(),
});

const orderSchema = z.object({
  bot_id: z.string(),
  side: z.literal("buy"),
  status: z.string(),
  created_at: z.string(),
});

const rawBarSchema = z.object({
  t: z.string(),
  o: z.coerce.number().finite().positive(),
  h: z.coerce.number().finite().positive(),
  l: z.coerce.number().finite().positive(),
  c: z.coerce.number().finite().positive(),
  v: z.coerce.number().finite().nonnegative().optional(),
});

const rawQuoteSchema = z.object({
  bp: z.coerce.number().finite().positive().optional(),
  ap: z.coerce.number().finite().positive().optional(),
  t: z.string().optional(),
});

function reply(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "public, s-maxage=5, stale-while-revalidate=5" },
  });
}

function completedBars(
  values: unknown,
  timeframeMs: number,
  now: number,
): CryptoBar[] {
  const parsed = z.array(rawBarSchema).safeParse(values);
  if (!parsed.success) return [];
  return parsed.data
    .filter(bar => Date.parse(bar.t) + timeframeMs <= now)
    .map(bar => ({ t: bar.t, o: bar.o, h: bar.h, l: bar.l, c: bar.c, v: bar.v }));
}

export async function GET() {
  const alpacaKey = process.env.ALPACA_API_KEY_ID?.trim() ?? "";
  const alpacaSecret = process.env.ALPACA_API_SECRET_KEY?.trim() ?? "";
  const supabaseSecret = process.env.SUPABASE_SECRET_KEY?.trim() ?? "";
  if (!alpacaKey || !alpacaSecret || !supabaseSecret) {
    return reply({ error: "Daily crypto readiness dependencies are not configured." }, 503);
  }

  const now = Date.now();
  const symbols = strategy.universe.join(",");
  const alpacaHeaders = {
    "APCA-API-KEY-ID": alpacaKey,
    "APCA-API-SECRET-KEY": alpacaSecret,
    Accept: "application/json",
  };
  const supabaseHeaders: Record<string,string> = {
    apikey: supabaseSecret,
    Accept: "application/json",
  };
  if (supabaseSecret.startsWith("eyJ")) supabaseHeaders.Authorization = `Bearer ${supabaseSecret}`;

  const readDb = async (path: string) => {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      headers: supabaseHeaders,
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Daily crypto storage returned HTTP ${response.status}.`);
    return response.json();
  };

  const cryptoFetch = async (path: string) => {
    const response = await fetch(`${ALPACA_DATA}${path}`, {
      headers: alpacaHeaders,
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) throw new Error(`Crypto market-data source returned HTTP ${response.status}.`);
    return response.json();
  };

  try {
    const quoteQuery = new URLSearchParams({ symbols });
    const bars5Query = new URLSearchParams({
      symbols,
      timeframe: "5Min",
      start: new Date(now - 12 * 60 * 60 * 1000).toISOString(),
      end: new Date(now).toISOString(),
      limit: "10000",
      sort: "asc",
    });
    const bars15Query = new URLSearchParams({
      symbols,
      timeframe: "15Min",
      start: new Date(now - 36 * 60 * 60 * 1000).toISOString(),
      end: new Date(now).toISOString(),
      limit: "10000",
      sort: "asc",
    });
    const orderCutoff = encodeURIComponent(new Date(now - 48 * 60 * 60 * 1000).toISOString());

    const [quotesRaw,bars5Raw,bars15Raw,ledgerRaw,positionsRaw,ordersRaw] = await Promise.all([
      cryptoFetch(`/v1beta3/crypto/us/latest/quotes?${quoteQuery.toString()}`),
      cryptoFetch(`/v1beta3/crypto/us/bars?${bars5Query.toString()}`),
      cryptoFetch(`/v1beta3/crypto/us/bars?${bars15Query.toString()}`),
      readDb(`paper_bot_ledgers?select=status,equity,buying_power,open_planned_risk_pct,daily_realized_loss_pct,metadata&bot_id=eq.${BOT_ID}&limit=1`),
      readDb("paper_bot_positions?select=bot_id,symbol,quantity&quantity=gt.0"),
      readDb(`paper_bot_orders?select=bot_id,side,status,created_at&bot_id=eq.${BOT_ID}&side=eq.buy&created_at=gte.${orderCutoff}&order=created_at.desc&limit=100`),
    ]);

    const ledgerRows = z.array(ledgerSchema).parse(ledgerRaw);
    const ledger = ledgerRows[0];
    if (!ledger) return reply({ error: "Daily crypto virtual ledger is missing." }, 503);

    const positions = z.array(positionSchema).parse(positionsRaw);
    const recentOrders = z.array(orderSchema).parse(ordersRaw);
    const quoteRecord = (quotesRaw as { quotes?: Record<string,unknown> })?.quotes ?? {};
    const raw5 = (bars5Raw as { bars?: Record<string,unknown> })?.bars ?? {};
    const raw15 = (bars15Raw as { bars?: Record<string,unknown> })?.bars ?? {};

    const quotes: Record<string,CryptoQuote> = {};
    const bars5m: Record<string,CryptoBar[]> = {};
    const bars15m: Record<string,CryptoBar[]> = {};

    for (const symbol of strategy.universe) {
      const parsedQuote = rawQuoteSchema.safeParse(quoteRecord[symbol]);
      quotes[symbol] = parsedQuote.success ? {
        bid: parsedQuote.data.bp ?? null,
        ask: parsedQuote.data.ap ?? null,
        timestamp: parsedQuote.data.t ?? null,
      } : { bid: null, ask: null, timestamp: null };
      bars5m[symbol] = completedBars(raw5[symbol], 5 * 60 * 1000, now);
      bars15m[symbol] = completedBars(raw15[symbol], 15 * 60 * 1000, now);
    }

    const currentSession = weekendCryptoSession(now);
    const countedStatuses = new Set(["submitted","partially_filled","filled","closed","replaced"]);
    const dailyNewEntries = recentOrders.filter(order =>
      countedStatuses.has(order.status)
      && weekendCryptoSession(Date.parse(order.created_at)).localDate === currentSession.localDate
    ).length;

    const ownPositions = positions.filter(position => position.bot_id === BOT_ID);
    const occupiedByOtherBots = [...new Set(
      positions
        .filter(position => position.bot_id !== BOT_ID && strategy.universe.includes(position.symbol as typeof strategy.universe[number]))
        .map(position => position.symbol)
    )];

    const result = evaluateWeekendCryptoReadiness({
      now,
      ledger: {
        active: ledger.status === "active",
        equity: ledger.equity,
        buyingPower: ledger.buying_power ?? 0,
        openRiskPct: ledger.open_planned_risk_pct ?? 0,
        dailyRealizedLossPct: ledger.daily_realized_loss_pct ?? 0,
        openPositions: ownPositions.length,
        dailyNewEntries,
        executionEnabled: ledger.metadata.executionEnabled === true,
      },
      quotes,
      bars5m,
      bars15m,
      occupiedByOtherBots,
    });

    return reply({
      collectedAt: new Date(now).toISOString(),
      source: "crypto-market-feed-us",
      fastTimeframe: "5Min",
      slowTimeframe: "15Min",
      occupiedByOtherBots,
      ...result,
    });
  } catch (error) {
    return reply({
      error: error instanceof Error ? error.message : "Daily crypto readiness unavailable.",
    }, 503);
  }
}
