import { NextResponse } from "next/server";
import { z } from "zod";
import { buildPaperExecutionFailureJournalRow } from "@/lib/paper-order-lifecycle-evidence";
import {
  assertSwingPaperExecutionAllowed,
  buildAlpacaSwingBracketRequest,
  type SwingExecutionPreview,
  SWING_PAPER_BROKER_HOST,
} from "@/lib/paper-swing-execution";

export const dynamic = "force-dynamic";

const BOT_ID = "three-trade-weekly-swing-100";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://yufptpfiwdbzzrvhkvux.supabase.co";

const requestSchema = z.object({
  symbol: z.enum(["QQQ", "NVDA", "MSFT"]),
}).strict();

const readinessSchema = z.object({
  collectedAt: z.string(),
  paperOnly: z.literal(true),
  executionEnabled: z.boolean(),
  submissionReady: z.boolean(),
  marketClockAvailable: z.boolean(),
  plans: z.array(z.object({
    symbol: z.string(),
    state: z.enum(["ready","waiting","blocked"]),
    selectedForSubmission: z.boolean(),
    quoteAgeSeconds: z.number().finite().nonnegative().nullable(),
    executionPreview: z.object({
      symbol: z.string(),
      quantity: z.number().finite().positive(),
      estimatedNotional: z.number().finite().positive(),
      entryReference: z.number().finite().positive(),
      stopLoss: z.number().finite().positive(),
      takeProfit: z.number().finite().positive(),
      plannedRiskDollars: z.number().finite().nonnegative(),
      plannedRiskPct: z.number().finite().nonnegative(),
      allocationPct: z.number().finite().nonnegative(),
      orderClass: z.literal("bracket"),
      orderType: z.literal("market"),
      timeInForce: z.literal("day"),
      paperOnly: z.literal(true),
    }).nullable(),
  })),
});

const preparedOrderSchema = z.object({
  client_order_id: z.string().min(12).max(128),
  bot_id: z.literal(BOT_ID),
  strategy_id: z.string().min(1),
  strategy_version: z.coerce.number().int().positive(),
  symbol: z.enum(["QQQ","NVDA","MSFT"]),
  asset_class: z.enum(["stock","etf"]),
  side: z.literal("buy"),
  status: z.enum(["prepared","submitted","error","rejected"]),
  broker_order_id: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
});

type AlpacaOrder = {
  id?: string;
  client_order_id?: string;
  status?: string;
  order_class?: string;
  type?: string;
  side?: string;
  symbol?: string;
  qty?: string;
  limit_price?: string | null;
  stop_price?: string | null;
  legs?: AlpacaOrder[] | null;
};

const noStore = { "Cache-Control": "no-store" };

function reply(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: noStore });
}

async function digest(value: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

async function authorized(request: Request) {
  const expected = process.env.PAPER_SWING_EXECUTION_TOKEN?.trim() ?? "";
  const supplied = request.headers.get("x-paper-swing-execution-token")?.trim() ?? "";
  if (expected.length < 32 || supplied.length < 32) return false;
  return (await digest(expected)) === (await digest(supplied));
}

function mapBrokerStatus(value: unknown) {
  const status = typeof value === "string" ? value : "submitted";
  if (status === "filled") return "filled";
  if (status === "partially_filled") return "partially_filled";
  if (status === "rejected") return "rejected";
  if (status === "canceled" || status === "cancelled") return "canceled";
  if (status === "expired") return "expired";
  if (status === "replaced") return "replaced";
  return "submitted";
}

function protectionSummary(order: AlpacaOrder) {
  const legs = Array.isArray(order.legs) ? order.legs : [];
  const sellLegs = legs.filter(leg => leg.side === "sell");
  const takeProfit = sellLegs.find(leg => leg.type === "limit");
  const stopLoss = sellLegs.find(leg => leg.type === "stop" || leg.type === "stop_limit");
  return {
    bracketAccepted: order.order_class === "bracket",
    takeProfitObserved: Boolean(takeProfit?.id),
    stopLossObserved: Boolean(stopLoss?.id),
    childLegCount: sellLegs.length,
  };
}

export async function POST(request: Request) {
  if (!(await authorized(request))) return reply({ error: "Unauthorized." }, 401);

  const supabaseSecret = process.env.SUPABASE_SECRET_KEY?.trim() ?? "";
  const alpacaKey = process.env.ALPACA_API_KEY_ID?.trim() ?? "";
  const alpacaSecret = process.env.ALPACA_API_SECRET_KEY?.trim() ?? "";
  if (!supabaseSecret || !alpacaKey || !alpacaSecret) {
    return reply({ error: "Paper execution dependencies are not configured." }, 503);
  }

  let parsedBody: z.infer<typeof requestSchema>;
  try {
    parsedBody = requestSchema.parse(await request.json());
  } catch {
    return reply({ error: "A supported staged symbol is required." }, 400);
  }

  const supabaseHeaders: Record<string,string> = {
    apikey: supabaseSecret,
    "Content-Type": "application/json",
  };
  if (supabaseSecret.startsWith("eyJ")) supabaseHeaders.Authorization = `Bearer ${supabaseSecret}`;

  const db = async (
    path: string,
    body?: unknown,
    method: "GET"|"POST"|"PATCH" = body === undefined ? "GET" : "PATCH",
    prefer?: string,
  ) => {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      method,
      headers: { ...supabaseHeaders, ...(prefer ? { Prefer: prefer } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`Paper execution storage returned HTTP ${response.status}.`);
    return text ? JSON.parse(text) : null;
  };

  const journalFailure = async (input: Parameters<typeof buildPaperExecutionFailureJournalRow>[0]) => {
    try {
      await db("paper_bot_journal", buildPaperExecutionFailureJournalRow(input), "POST", "return=minimal");
    } catch {
      // Evidence failure must not change the PAPER execution outcome.
    }
  };

  const readinessUrl = new URL("/api/paper-trading/bots/swing-readiness", request.url);
  const readinessResponse = await fetch(readinessUrl, {
    cache: "no-store",
    headers: { "x-paper-execution-recheck": "1" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!readinessResponse.ok) return reply({ error: "Same-session readiness recheck failed." }, 503);

  const readiness = readinessSchema.parse(await readinessResponse.json());
  const selected = readiness.plans.find(plan => plan.symbol === parsedBody.symbol);
  const preview = selected?.executionPreview as SwingExecutionPreview | null | undefined;

  try {
    assertSwingPaperExecutionAllowed({
      executionEnabled: readiness.executionEnabled,
      readinessSelected: Boolean(selected?.selectedForSubmission && preview),
      marketOpen: readiness.submissionReady,
      quoteFresh: selected?.quoteAgeSeconds !== null && selected?.quoteAgeSeconds !== undefined && selected.quoteAgeSeconds <= 30,
      paperOnly: readiness.paperOnly,
    });
  } catch (error) {
    return reply({
      error: error instanceof Error ? error.message : "Paper swing submission is blocked.",
      symbol: parsedBody.symbol,
      state: selected?.state ?? "blocked",
    }, 423);
  }

  if (!preview) return reply({ error: "No execution preview is available for this plan." }, 409);

  const preparedRaw = await db(
    `paper_bot_orders?select=client_order_id,bot_id,strategy_id,strategy_version,symbol,asset_class,side,status,broker_order_id,metadata&bot_id=eq.${BOT_ID}&symbol=eq.${parsedBody.symbol}&side=eq.buy&status=eq.prepared&broker_order_id=is.null&order=created_at.asc&limit=1`
  );
  const preparedRows = z.array(preparedOrderSchema).parse(preparedRaw);
  const prepared = preparedRows[0];
  if (!prepared) return reply({ error: "No unclaimed prepared plan exists for this symbol." }, 409);

  const claimedAt = new Date().toISOString();
  const claimMetadata = {
    ...prepared.metadata,
    executionMode: "paper-bracket",
    executionClaimedAt: claimedAt,
    executionPreview: preview,
    brokerProtection: "bracket",
  };

  const claimRaw = await db(
    `paper_bot_orders?client_order_id=eq.${encodeURIComponent(prepared.client_order_id)}&status=eq.prepared&broker_order_id=is.null`,
    {
      status: "submitted",
      requested_quantity: preview.quantity,
      submitted_at: claimedAt,
      metadata: claimMetadata,
      updated_at: claimedAt,
    },
    "PATCH",
    "return=representation",
  );
  const claimed = z.array(preparedOrderSchema.extend({
    requested_quantity: z.coerce.number().finite().positive().nullable().optional(),
  })).parse(claimRaw);
  if (claimed.length !== 1) return reply({ error: "Prepared plan was already claimed by another execution request." }, 409);

  const bracket = buildAlpacaSwingBracketRequest(preview, prepared.client_order_id);
  const alpacaHeaders = {
    "APCA-API-KEY-ID": alpacaKey,
    "APCA-API-SECRET-KEY": alpacaSecret,
    Accept: "application/json",
    "Content-Type": "application/json",
  };

  let brokerOrder: AlpacaOrder | null = null;
  let submitError = "";
  try {
    const response = await fetch(`${SWING_PAPER_BROKER_HOST}/v2/orders`, {
      method: "POST",
      headers: alpacaHeaders,
      body: JSON.stringify({
        symbol: bracket.symbol,
        side: bracket.side,
        qty: bracket.qty,
        type: bracket.type,
        time_in_force: bracket.time_in_force,
        extended_hours: bracket.extended_hours,
        client_order_id: bracket.client_order_id,
        order_class: bracket.order_class,
        take_profit: { limit_price: bracket.take_profit_limit_price },
        stop_loss: { stop_price: bracket.stop_loss_stop_price },
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    const text = await response.text();
    const body = text ? JSON.parse(text) : {};
    if (!response.ok) throw new Error(typeof body?.message === "string" ? body.message : `Alpaca returned HTTP ${response.status}.`);
    brokerOrder = body as AlpacaOrder;
  } catch (error) {
    submitError = error instanceof Error ? error.message.slice(0,180) : "Paper bracket submission failed.";
  }

  if (!brokerOrder) {
    try {
      const lookup = await fetch(
        `${SWING_PAPER_BROKER_HOST}/v2/orders:by_client_order_id?client_order_id=${encodeURIComponent(prepared.client_order_id)}`,
        { headers: alpacaHeaders, cache: "no-store", signal: AbortSignal.timeout(8_000) },
      );
      if (lookup.ok) brokerOrder = await lookup.json() as AlpacaOrder;
    } catch { /* keep the claim locked when provider outcome is ambiguous */ }
  }

  if (!brokerOrder?.id) {
    const reason = submitError || "Broker outcome could not be confirmed.";
    await db(
      `paper_bot_orders?client_order_id=eq.${encodeURIComponent(prepared.client_order_id)}`,
      {
        metadata: {
          ...claimMetadata,
          executionError: reason,
          brokerLookupPending: true,
        },
        updated_at: new Date().toISOString(),
      },
      "PATCH",
      "return=minimal",
    );
    await journalFailure({
      botId: prepared.bot_id,
      strategyId: prepared.strategy_id,
      strategyVersion: prepared.strategy_version,
      symbol: prepared.symbol,
      assetClass: prepared.asset_class,
      clientOrderId: prepared.client_order_id,
      phase: "broker-submission",
      reason,
      side: "buy",
      brokerLookupPending: true,
    });
    return reply({ error: "Broker submission outcome is unconfirmed; the order remains claimed to prevent duplication." }, 502);
  }

  let nested = brokerOrder;
  try {
    const nestedResponse = await fetch(
      `${SWING_PAPER_BROKER_HOST}/v2/orders/${encodeURIComponent(brokerOrder.id)}?nested=true`,
      { headers: alpacaHeaders, cache: "no-store", signal: AbortSignal.timeout(8_000) },
    );
    if (nestedResponse.ok) nested = await nestedResponse.json() as AlpacaOrder;
  } catch { /* parent bracket acceptance is still retained */ }

  const protection = protectionSummary(nested);
  await db(
    `paper_bot_orders?client_order_id=eq.${encodeURIComponent(prepared.client_order_id)}`,
    {
      broker_order_id: brokerOrder.id,
      status: mapBrokerStatus(brokerOrder.status),
      metadata: {
        ...claimMetadata,
        brokerObservedStatus: brokerOrder.status ?? "submitted",
        bracketAccepted: protection.bracketAccepted,
        takeProfitLegObserved: protection.takeProfitObserved,
        stopLossLegObserved: protection.stopLossObserved,
        childLegCount: protection.childLegCount,
        protectionValidatedAt: new Date().toISOString(),
        brokerLookupPending: false,
      },
      updated_at: new Date().toISOString(),
    },
    "PATCH",
    "return=minimal",
  );

  return reply({
    ok: true,
    symbol: parsedBody.symbol,
    status: mapBrokerStatus(brokerOrder.status),
    paperOnly: true,
    bracketAccepted: protection.bracketAccepted,
    takeProfitLegObserved: protection.takeProfitObserved,
    stopLossLegObserved: protection.stopLossObserved,
  });
}
