import { NextResponse } from "next/server";
import { z } from "zod";
import { DEFAULT_PAPER_WATCHLIST } from "@/lib/paper-watchlist";
import { evaluatePaperCandidate } from "@/lib/paper-decision-engine";

export const dynamic = "force-dynamic";

const candle = z.object({
  time: z.iso.datetime(),
  close: z.number().finite().positive(),
  high: z.number().finite().positive().optional(),
  low: z.number().finite().positive().optional(),
  volume: z.number().finite().nonnegative().optional(),
}).refine(value => value.high === undefined || value.low === undefined || value.high >= value.low, "Candle high must be at least candle low.");

const requestSchema = z.object({
  symbol: z.string().trim().toUpperCase().max(20),
  quote: z.object({
    bid: z.number().finite().positive().nullable(),
    ask: z.number().finite().positive().nullable(),
    timestamp: z.iso.datetime().nullable(),
  }),
  candles: z.array(candle).min(1).max(200),
  benchmarkCandles: z.array(candle).min(1).max(200),
  risk: z.object({
    accountEquity: z.number().finite().positive().nullable().optional(),
    openRiskPct: z.number().finite().nonnegative().nullable().optional(),
    correlatedRiskPct: z.number().finite().nonnegative().nullable().optional(),
    dailyRealizedLossPct: z.number().finite().nonnegative().nullable().optional(),
    weeklyDrawdownPct: z.number().finite().nonnegative().nullable().optional(),
  }).optional(),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Provide a JSON dry-run request." }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid dry-run input.", issues: parsed.error.issues.map(issue => issue.message) }, {
      status: 400,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const stock = DEFAULT_PAPER_WATCHLIST.stocks.find(candidate => candidate.symbol === parsed.data.symbol);
  const crypto = DEFAULT_PAPER_WATCHLIST.crypto.find(candidate => candidate.symbol === parsed.data.symbol);
  const candidate = stock ?? crypto;
  if (!candidate) {
    return NextResponse.json({ error: "Symbol is not in the persisted paper watchlist." }, {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const decision = evaluatePaperCandidate({
    candidate,
    assetClass: stock ? "stock" : "crypto",
    quote: parsed.data.quote,
    candles: parsed.data.candles,
    benchmarkCandles: parsed.data.benchmarkCandles,
    risk: parsed.data.risk,
  });

  return NextResponse.json({
    ...decision,
    dryRun: true,
    inputTrust: "client-provided-market-snapshot",
    note: "Read-only paper decision analysis. This endpoint has no order-routing capability and cannot submit a trade.",
  }, { headers: { "Cache-Control": "no-store" } });
}
