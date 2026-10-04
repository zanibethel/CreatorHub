import { NextResponse } from "next/server";
import { z } from "zod";
import { evaluateSwingReadiness, type SwingPreparedPlan } from "@/lib/paper-swing-revalidation";
import { buildSwingExecutionPreview } from "@/lib/paper-swing-execution";
import { buildSwingRevalidationJournalRows } from "@/lib/paper-swing-evidence";

export const dynamic = "force-dynamic";

const BOT_ID = "three-trade-weekly-swing-100";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://yufptpfiwdbzzrvhkvux.supabase.co";

const ledgerSchema = z.object({
  status: z.enum(["active","planned","paused"]),
  equity: z.coerce.number().finite().nonnegative(),
  buying_power: z.coerce.number().finite().nullable(),
  open_planned_risk_pct: z.coerce.number().finite().nullable(),
  daily_realized_loss_pct: z.coerce.number().finite().nullable(),
  weekly_drawdown_pct: z.coerce.number().finite().nullable(),
  metadata: z.object({
    executionEnabled: z.boolean().optional(),
  }).passthrough(),
});

const planSchema = z.object({
  client_order_id: z.string().min(12).max(128),
  strategy_id: z.string().min(1),
  strategy_version: z.coerce.number().int().positive(),
  symbol: z.string().min(1).max(32),
  requested_notional: z.coerce.number().finite().positive(),
  entry_trigger: z.coerce.number().finite().positive(),
  max_entry_price: z.coerce.number().finite().positive(),
  protective_stop: z.coerce.number().finite().positive(),
  planned_risk_dollars: z.coerce.number().finite().positive(),
  expires_at: z.string().max(64),
  created_at: z.string().max(64),
  stage_reason: z.string().nullable(),
  take_profit_price: z.coerce.number().finite().positive().nullable(),
  take_profit_fraction: z.coerce.number().finite().positive().nullable(),
  take_profit_r: z.coerce.number().finite().positive().nullable(),
  protect_winner_at_r: z.coerce.number().finite().positive().nullable(),
  trail_remainder: z.boolean(),
  metadata: z.record(z.string(), z.unknown()),
});

const positionSchema = z.object({
  symbol: z.string().min(1).max(32),
  planned_risk_dollars: z.coerce.number().finite().nonnegative().nullable(),
});

const priorOrderSchema = z.object({
  submitted_at: z.string().nullable(),
  status: z.string(),
});

type AlpacaQuote = { ap?: number; bp?: number; t?: string };
type AlpacaBar = { c: number; t: string };
type AlpacaClock = { timestamp?: string; is_open?: boolean; next_open?: string; next_close?: string };

const json = (error: string, status = 503) =>
  NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });

function weekStartUtc(now: number) {
  const date = new Date(now);
  const day = date.getUTCDay();
  const diff = day === 0 ? 6 : day - 1;
  date.setUTCDate(date.getUTCDate() - diff);
  date.setUTCHours(0,0,0,0);
  return date.getTime();
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

export async function GET(request: Request) {
  const supabaseSecret = process.env.SUPABASE_SECRET_KEY;
  const alpacaKey = process.env.ALPACA_API_KEY_ID;
  const alpacaSecret = process.env.ALPACA_API_SECRET_KEY;
  if (!supabaseSecret || !alpacaKey || !alpacaSecret) {
    return json("Swing readiness dependencies are not configured.");
  }

  const supabaseHeaders: Record<string,string> = { apikey: supabaseSecret };
  if (supabaseSecret.startsWith("eyJ")) supabaseHeaders.Authorization = `Bearer ${supabaseSecret}`;

  const readDb = async (path: string) => {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      headers: supabaseHeaders,
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error("Stored swing state is unavailable.");
    return response.json();
  };

  const writeDb = async (
    path: string,
    body: unknown,
    method: "POST" | "PATCH" = "POST",
    prefer = "return=minimal",
  ) => {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      method,
      headers: {
        ...supabaseHeaders,
        "Content-Type": "application/json",
        Prefer: prefer,
      },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Swing evidence storage returned HTTP ${response.status}.`);
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  };

  const alpacaHeaders = {
    "APCA-API-KEY-ID": alpacaKey,
    "APCA-API-SECRET-KEY": alpacaSecret,
    Accept: "application/json",
  };
  const readAlpaca = async (url: string) => {
    const response = await fetch(url, {
      headers: alpacaHeaders,
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Alpaca returned HTTP ${response.status}.`);
    return response.json();
  };

  try {
    const [ledgerRaw, plansRaw, positionsRaw, priorRaw, clockRaw, quoteRaw, barsRaw] = await Promise.all([
      readDb(`paper_bot_ledgers?select=status,equity,buying_power,open_planned_risk_pct,daily_realized_loss_pct,weekly_drawdown_pct,metadata&bot_id=eq.${BOT_ID}&limit=1`),
      readDb(`paper_bot_orders?select=client_order_id,strategy_id,strategy_version,symbol,requested_notional,entry_trigger,max_entry_price,protective_stop,planned_risk_dollars,expires_at,created_at,stage_reason,take_profit_price,take_profit_fraction,take_profit_r,protect_winner_at_r,trail_remainder,metadata&bot_id=eq.${BOT_ID}&side=eq.buy&status=eq.prepared&order=created_at.asc&limit=20`),
      readDb(`paper_bot_positions?select=symbol,planned_risk_dollars&bot_id=eq.${BOT_ID}&quantity=gt.0&limit=20`),
      readDb(`paper_bot_orders?select=submitted_at,status&bot_id=eq.${BOT_ID}&side=eq.buy&status=in.(submitted,partially_filled,filled)&limit=100`),
      readAlpaca("https://paper-api.alpaca.markets/v2/clock"),
      readAlpaca("https://data.alpaca.markets/v2/stocks/quotes/latest?symbols=QQQ,NVDA,MSFT,SPY&feed=iex"),
      readAlpaca(`https://data.alpaca.markets/v2/stocks/bars?symbols=QQQ,NVDA,MSFT,SPY&timeframe=1Day&limit=1000&feed=iex&adjustment=split&sort=asc&start=${encodeURIComponent(new Date(Date.now()-45*86_400_000).toISOString())}`),
    ]);

    const ledgerRows = z.array(ledgerSchema).parse(ledgerRaw);
    const planRows = z.array(planSchema).parse(plansRaw);
    const positions = z.array(positionSchema).parse(positionsRaw);
    const priorOrders = z.array(priorOrderSchema).parse(priorRaw);
    const ledger = ledgerRows[0];
    if (!ledger) return json("Swing bot ledger is unavailable.");

    const now = Date.now();
    const clock = clockRaw as AlpacaClock;
    const quotes = (quoteRaw as { quotes?: Record<string,AlpacaQuote> }).quotes ?? {};
    const bars = (barsRaw as { bars?: Record<string,AlpacaBar[]> }).bars ?? {};
    const weekStart = weekStartUtc(now);
    const weeklyNewEntries = priorOrders.filter(order => order.submitted_at && Date.parse(order.submitted_at) >= weekStart).length;

    const trendValid: Record<string,boolean> = {};
    for (const symbol of ["QQQ","NVDA","MSFT"]) {
      const closes = (bars[symbol] ?? []).map(bar => bar.c).filter(value => Number.isFinite(value) && value > 0);
      const sma10 = average(closes.slice(-10));
      const sma20 = average(closes.slice(-20));
      const last = closes.at(-1) ?? null;
      trendValid[symbol] = last !== null && sma10 !== null && sma20 !== null && last >= sma10 && last >= sma20;
    }

    const spyCloses = (bars.SPY ?? []).map(bar => bar.c).filter(value => Number.isFinite(value) && value > 0);
    const spySma20 = average(spyCloses.slice(-20));
    const spyQuote = quotes.SPY;
    const spyMid = typeof spyQuote?.bp === "number" && typeof spyQuote?.ap === "number"
      ? (spyQuote.bp + spyQuote.ap) / 2
      : spyCloses.at(-1) ?? null;
    const broadMarketSupportive = spyMid !== null && spySma20 !== null && spyMid >= spySma20;

    let minutesSinceOpen: number | null = null;
    if (clock.is_open && clock.next_close) {
      const close = Date.parse(clock.next_close);
      if (Number.isFinite(close)) minutesSinceOpen = Math.max(0, (now - (close - 390*60_000)) / 60_000);
    }

    const plans: SwingPreparedPlan[] = planRows.map(plan => ({
      symbol: plan.symbol,
      requestedNotional: plan.requested_notional,
      entryTrigger: plan.entry_trigger,
      maxEntryPrice: plan.max_entry_price,
      protectiveStop: plan.protective_stop,
      plannedRiskDollars: plan.planned_risk_dollars,
      expiresAt: plan.expires_at,
    }));

    const evidencePlans = planRows.map(plan => ({
      clientOrderId: plan.client_order_id,
      symbol: plan.symbol,
      requestedNotional: plan.requested_notional,
      entryTrigger: plan.entry_trigger,
      maxEntryPrice: plan.max_entry_price,
      protectiveStop: plan.protective_stop,
      plannedRiskDollars: plan.planned_risk_dollars,
      expiresAt: plan.expires_at,
      createdAt: plan.created_at,
      stageReason: plan.stage_reason,
      takeProfitPrice: plan.take_profit_price,
      takeProfitFraction: plan.take_profit_fraction,
      takeProfitR: plan.take_profit_r,
      protectWinnerAtR: plan.protect_winner_at_r,
      trailRemainder: plan.trail_remainder,
      metadata: plan.metadata,
    }));

    const result = evaluateSwingReadiness({
      now,
      marketOpen: Boolean(clock.is_open),
      minutesSinceOpen,
      broadMarketSupportive,
      trendValid,
      ledger: {
        active: ledger.status === "active",
        equity: ledger.equity,
        buyingPower: ledger.buying_power ?? 0,
        openRiskPct: ledger.open_planned_risk_pct ?? 0,
        dailyRealizedLossPct: ledger.daily_realized_loss_pct ?? 0,
        weeklyDrawdownPct: ledger.weekly_drawdown_pct ?? 0,
        openPositions: positions.length,
        weeklyNewEntries,
      },
      currentRisk: positions.map(position => ({
        symbol: position.symbol,
        plannedRiskDollars: position.planned_risk_dollars ?? 0,
      })),
      plans,
      quotes: Object.fromEntries(plans.map(plan => {
        const quote = quotes[plan.symbol];
        return [plan.symbol, {
          bid: typeof quote?.bp === "number" ? quote.bp : null,
          ask: typeof quote?.ap === "number" ? quote.ap : null,
          timestamp: quote?.t ?? null,
        }];
      })),
    });

    const executionEnabled = ledger.metadata.executionEnabled === true;
    const cronSecret = process.env.CRON_SECRET?.trim() ?? "";
    const evidenceRun = Boolean(
      cronSecret
      && request.headers.get("authorization") === `Bearer ${cronSecret}`
    );
    let evidencePersisted = false;
    let expiredPlans = 0;

    if (evidenceRun && evidencePlans.length > 0) {
      const collectedAt = new Date(now).toISOString();
      const rows = buildSwingRevalidationJournalRows({
        botId: BOT_ID,
        strategyId: result.strategyId,
        strategyVersion: result.strategyVersion,
        collectedAt,
        broadMarketSupportive,
        marketOpen: Boolean(clock.is_open),
        minutesSinceOpen,
        weeklySlotsRemaining: result.weeklySlotsRemaining,
        openPositionSlotsRemaining: result.openPositionSlotsRemaining,
        executionEnabled,
        plans: evidencePlans,
        readiness: result.plans,
      });
      await writeDb("paper_bot_journal", rows);
      evidencePersisted = true;

      for (const row of rows) {
        if (row.metadata.terminalDisposition !== "expired" || !row.client_order_id) continue;
        const source = planRows.find(plan => plan.client_order_id === row.client_order_id);
        if (!source) continue;
        await writeDb(
          `paper_bot_orders?client_order_id=eq.${encodeURIComponent(source.client_order_id)}&status=eq.prepared`,
          {
            status: "expired",
            metadata: {
              ...source.metadata,
              terminalDisposition: "expired",
              terminalReason: "Prepared plan expired before PAPER submission.",
              terminalAt: collectedAt,
            },
            updated_at: collectedAt,
          },
          "PATCH",
        );
        expiredPlans += 1;
      }
    }

    const plansWithExecution = result.plans.map(readiness => {
      const sourcePlan = plans.find(plan => plan.symbol === readiness.symbol);
      if (!readiness.selectedForSubmission || !sourcePlan || readiness.ask === null) {
        return { ...readiness, executionPreview: null };
      }
      try {
        return {
          ...readiness,
          executionPreview: buildSwingExecutionPreview({
            symbol: readiness.symbol,
            ask: readiness.ask,
            protectiveStop: sourcePlan.protectiveStop,
            equity: ledger.equity,
            buyingPower: ledger.buying_power ?? 0,
          }),
        };
      } catch {
        return { ...readiness, executionPreview: null };
      }
    });

    return NextResponse.json({
      collectedAt: new Date(now).toISOString(),
      nextMarketOpen: clock.next_open ?? null,
      nextMarketClose: clock.next_close ?? null,
      broadMarketSupportive,
      marketClockAvailable: typeof clock.is_open === "boolean",
      ...result,
      plans: plansWithExecution,
      executionEnabled,
      submissionReady: executionEnabled && result.readyCount > 0,
      brokerProtection: "bracket",
      ...(evidenceRun ? { evidencePersisted, expiredPlans } : {}),
    }, { headers: { "Cache-Control": evidenceRun ? "no-store" : "public, s-maxage=5, stale-while-revalidate=5" } });
  } catch (error) {
    return json(error instanceof Error ? error.message : "Swing readiness is temporarily unavailable.");
  }
}
