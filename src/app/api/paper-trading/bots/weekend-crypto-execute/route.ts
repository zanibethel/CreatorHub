import { NextResponse } from "next/server";
import { z } from "zod";
import { buildPaperExecutionFailureJournalRow } from "@/lib/paper-order-lifecycle-evidence";
import { createPaperClientOrderId } from "@/lib/paper-order-attribution";
import { observeCryptoEntryFee } from "@/lib/paper-crypto-fees";
import { ACTIVE_DAILY_CRYPTO_DAY_STRATEGY as strategy } from "@/lib/paper-weekend-crypto-strategy-config";

export const dynamic = "force-dynamic";

const PUBLIC_ORIGIN=process.env.CREATORHUB_PUBLIC_ORIGIN||"https://creatorhub-gray.vercel.app";

const BOT_ID = strategy.botProfileId;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://yufptpfiwdbzzrvhkvux.supabase.co";
const ALPACA_PAPER = "https://paper-api.alpaca.markets/v2";

const requestSchema = z.object({
  symbol: z.enum(strategy.executionUniverse),
}).strict();

const candidateSchema = z.object({
  symbol: z.string(),
  executionEligible: z.boolean(),
  state: z.enum(["ready","waiting","blocked"]),
  selectedForSubmission: z.boolean(),
  quoteAgeSeconds: z.number().finite().nonnegative().nullable(),
  trigger: z.number().finite().positive().nullable(),
  maxEntry: z.number().finite().positive().nullable(),
  protectiveStop: z.number().finite().positive().nullable(),
  takeProfit: z.number().finite().positive().nullable(),
  plannedNotional: z.number().finite().positive().nullable(),
  plannedQuantity: z.number().finite().positive().nullable(),
  plannedRiskDollars: z.number().finite().nonnegative().nullable(),
  plannedRiskPct: z.number().finite().nonnegative().nullable(),
  estimatedRoundTripFees: z.number().finite().nonnegative().nullable(),
  feeCoverageMultiple: z.number().finite().nonnegative().nullable(),
});

const readinessSchema = z.object({
  collectedAt: z.string(),
  paperOnly: z.literal(true),
  executionEnabled: z.boolean(),
  submissionReady: z.boolean(),
  selectedSymbol: z.enum(strategy.executionUniverse).nullable(),
  session: z.object({
    localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    isTradingDay: z.boolean(),
    entriesOpen: z.boolean(),
    flattenDue: z.boolean(),
  }),
  candidates: z.array(candidateSchema),
});

type BrokerOrder = {
  id?: string;
  client_order_id?: string;
  status?: string;
  symbol?: string;
  side?: string;
  qty?: string;
  filled_qty?: string;
  filled_avg_price?: string | null;
};

type BrokerPosition = {
  symbol?: string;
  qty?: string;
  qty_available?: string;
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
  const expected = process.env.PAPER_WEEKEND_CRYPTO_EXECUTION_TOKEN?.trim() ?? "";
  const supplied = request.headers.get("x-paper-weekend-execution-token")?.trim() ?? "";
  if (expected.length < 32 || supplied.length < 32) return false;
  return (await digest(expected)) === (await digest(supplied));
}

function normalizeSymbol(value: string | undefined) {
  return (value ?? "").replace("/","").toUpperCase();
}

function numeric(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function floorQty(value: number) {
  return Math.floor((value + Number.EPSILON) * 1_000_000_000) / 1_000_000_000;
}

function qtyString(value: number) {
  return value.toFixed(9).replace(/0+$/,"").replace(/\.$/,"");
}

function roundPrice(value: number) {
  const decimals = value >= 1000 ? 2 : value >= 1 ? 4 : 6;
  return Number(value.toFixed(decimals));
}

function stopLimitFloor(stop: number) {
  return roundPrice(stop * 0.997);
}

function mappedStatus(value: unknown) {
  const status = typeof value === "string" ? value : "submitted";
  if (status === "filled") return "filled";
  if (status === "partially_filled") return "partially_filled";
  if (status === "canceled" || status === "cancelled") return "canceled";
  if (status === "rejected") return "rejected";
  if (status === "expired") return "expired";
  if (status === "replaced") return "replaced";
  return "submitted";
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function POST(request: Request) {
  if (!(await authorized(request))) return reply({ error: "Unauthorized." }, 401);

  const supabaseSecret = process.env.SUPABASE_SECRET_KEY?.trim() ?? "";
  const alpacaKey = process.env.ALPACA_API_KEY_ID?.trim() ?? "";
  const alpacaSecret = process.env.ALPACA_API_SECRET_KEY?.trim() ?? "";
  if (!supabaseSecret || !alpacaKey || !alpacaSecret) {
    return reply({ error: "Daily crypto PAPER execution dependencies are not configured." }, 503);
  }

  let requested: z.infer<typeof requestSchema>;
  try {
    requested = requestSchema.parse(await request.json());
  } catch {
    return reply({ error: "A supported daily crypto symbol is required." }, 400);
  }

  const supabaseHeaders: Record<string,string> = {
    apikey: supabaseSecret,
    "Content-Type": "application/json",
  };
  if (supabaseSecret.startsWith("eyJ")) supabaseHeaders.Authorization = `Bearer ${supabaseSecret}`;

  const db = async (
    path: string,
    body?: unknown,
    method: "GET"|"POST"|"PATCH" = body === undefined ? "GET" : "POST",
    prefer?: string,
  ) => {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      method,
      headers: { ...supabaseHeaders, ...(prefer ? { Prefer: prefer } : {}) },
      ...(body === undefined || method === "GET" ? {} : { body: JSON.stringify(body) }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    const text = await response.text();
    if (!response.ok) {
      const detail = text ? (() => { try { return JSON.parse(text)?.message; } catch { return ""; } })() : "";
      throw new Error(detail || `Daily crypto PAPER storage returned HTTP ${response.status}.`);
    }
    return text ? JSON.parse(text) : null;
  };

  const alpacaHeaders = {
    "APCA-API-KEY-ID": alpacaKey,
    "APCA-API-SECRET-KEY": alpacaSecret,
    Accept: "application/json",
    "Content-Type": "application/json",
  };

  const alpaca = async (
    path: string,
    init: RequestInit = {},
  ) => {
    const response = await fetch(`${ALPACA_PAPER}/${path}`, {
      ...init,
      headers: { ...alpacaHeaders, ...(init.headers ?? {}) },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    const text = await response.text();
    const body = text ? JSON.parse(text) : null;
    if (!response.ok) {
      const detail = typeof body?.message === "string" ? body.message : `HTTP ${response.status}`;
      throw new Error(`Alpaca PAPER request failed: ${detail}`);
    }
    return body;
  };

  const readinessResponse = await fetch(new URL("/api/paper-trading/bots/weekend-crypto-readiness", PUBLIC_ORIGIN), {
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (!readinessResponse.ok) return reply({ error: "Daily crypto readiness recheck failed." }, 503);

  const readiness = readinessSchema.parse(await readinessResponse.json());
  const candidate = readiness.candidates.find(item => item.symbol === requested.symbol);

  if (
    !readiness.paperOnly
    || !readiness.executionEnabled
    || !readiness.submissionReady
    || !readiness.session.isTradingDay
    || !readiness.session.entriesOpen
    || readiness.session.flattenDue
    || readiness.selectedSymbol !== requested.symbol
    || candidate?.executionEligible !== true
    || candidate?.state !== "ready"
    || !candidate.selectedForSubmission
  ) {
    return reply({
      error: "Daily crypto PAPER entry is not authorized by the current readiness state.",
      symbol: requested.symbol,
      state: candidate?.state ?? "blocked",
    }, 423);
  }

  if (
    candidate.quoteAgeSeconds === null
    || candidate.quoteAgeSeconds > strategy.marketData.quoteFreshnessSeconds
    || candidate.trigger === null
    || candidate.maxEntry === null
    || candidate.protectiveStop === null
    || candidate.takeProfit === null
    || candidate.plannedNotional === null
    || candidate.plannedRiskDollars === null
    || candidate.maxEntry <= candidate.protectiveStop
    || candidate.takeProfit <= candidate.maxEntry
  ) {
    return reply({ error: "Selected daily crypto setup is missing a valid execution/risk plan." }, 409);
  }

  // Shared PAPER-account guard: no broker position or open order may already exist
  // for this crypto symbol, regardless of which bot created it.
  const [positionsRaw,openOrdersRaw] = await Promise.all([
    alpaca("positions"),
    alpaca("orders?status=open&limit=500&nested=true&direction=desc"),
  ]);
  const compact = normalizeSymbol(requested.symbol);
  const positions = Array.isArray(positionsRaw) ? positionsRaw as BrokerPosition[] : [];
  const openOrders = Array.isArray(openOrdersRaw) ? openOrdersRaw as BrokerOrder[] : [];

  if (positions.some(position => normalizeSymbol(position.symbol) === compact && Math.abs(numeric(position.qty) ?? 0) > 0)) {
    return reply({ error: "Shared Alpaca PAPER account already has a position in this symbol." }, 409);
  }
  if (openOrders.some(order => normalizeSymbol(order.symbol) === compact)) {
    return reply({ error: "Shared Alpaca PAPER account already has an open order in this symbol." }, 409);
  }

  // Size from the worst allowed fill (maxEntry), not the current ask.
  const worstRiskPerUnit = candidate.maxEntry - candidate.protectiveStop;
  const quantityByNotional = candidate.plannedNotional / candidate.maxEntry;
  const quantityByRisk = candidate.plannedRiskDollars > 0
    ? candidate.plannedRiskDollars / worstRiskPerUnit
    : quantityByNotional;
  const entryQty = floorQty(Math.min(quantityByNotional, quantityByRisk));
  if (!(entryQty > 0)) return reply({ error: "Daily crypto entry quantity is below the supported minimum." }, 409);

  const claimedNotional = entryQty * candidate.maxEntry;
  const worstRiskDollars = entryQty * worstRiskPerUnit;
  if (claimedNotional < strategy.execution.minimumOrderNotionalUsd) {
    return reply({
      error: `Daily crypto entry is below the ${strategy.execution.minimumOrderNotionalUsd.toFixed(0)} broker-minimum buffer.`,
    }, 409);
  }
  const clientOrderId = createPaperClientOrderId(BOT_ID, strategy.version, crypto.randomUUID());
  const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();

  try {
    await db("rpc/paper_bot_claim_weekend_crypto_entry", {
      p_client_order_id: clientOrderId,
      p_symbol: requested.symbol,
      p_requested_notional: claimedNotional,
      p_entry_trigger: candidate.trigger,
      p_max_entry_price: candidate.maxEntry,
      p_protective_stop: candidate.protectiveStop,
      p_take_profit_price: candidate.takeProfit,
      p_planned_risk_dollars: worstRiskDollars,
      p_session_date: readiness.session.localDate,
      p_expires_at: expiresAt,
      p_metadata: {
        setupScore: candidate.state === "ready" ? "ready" : candidate.state,
        scannerCollectedAt: readiness.collectedAt,
        quoteAgeSeconds: candidate.quoteAgeSeconds,
        estimatedRoundTripFees: candidate.estimatedRoundTripFees,
        feeCoverageMultiple: candidate.feeCoverageMultiple,
        worstCaseEntryPrice: candidate.maxEntry,
      },
    }, "POST");
  } catch (error) {
    return reply({
      error: error instanceof Error ? error.message : "Daily crypto entry claim failed.",
    }, 409);
  }

  const patchOrder = async (id: string, values: Record<string,unknown>) =>
    db(`paper_bot_orders?client_order_id=eq.${encodeURIComponent(id)}`, {
      ...values,
      updated_at: new Date().toISOString(),
    }, "PATCH", "return=minimal");

  const journalFailure = async (input: Parameters<typeof buildPaperExecutionFailureJournalRow>[0]) => {
    try {
      await db("paper_bot_journal", buildPaperExecutionFailureJournalRow(input), "POST", "return=minimal");
    } catch {
      // Evidence failure must not change the PAPER execution outcome.
    }
  };

  let entryOrder: BrokerOrder | null = null;
  try {
    entryOrder = await alpaca("orders", {
      method: "POST",
      body: JSON.stringify({
        symbol: requested.symbol,
        qty: qtyString(entryQty),
        side: "buy",
        type: "limit",
        time_in_force: "gtc",
        limit_price: String(roundPrice(candidate.maxEntry)),
        client_order_id: clientOrderId,
      }),
    }) as BrokerOrder;
    await patchOrder(clientOrderId, {
      status: mappedStatus(entryOrder.status),
      broker_order_id: entryOrder.id ?? null,
      requested_quantity: entryQty,
      submitted_at: new Date().toISOString(),
      metadata: {
        paperOnly: true,
        executionMode: "paper-crypto",
        entryOrderType: "marketable-limit",
        entryLimitPrice: roundPrice(candidate.maxEntry),
        estimatedFeeBps: strategy.fees.estimatedTakerFeeBpsPerSide,
        feeReconciliationPending: true,
      },
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0,180) : "Entry submission failed.";
    await patchOrder(clientOrderId, {
      status: "error",
      metadata: {
        paperOnly: true,
        executionMode: "paper-crypto",
        executionError: reason,
      },
    });
    await journalFailure({
      botId: BOT_ID,
      strategyId: strategy.id,
      strategyVersion: strategy.version,
      symbol: requested.symbol,
      assetClass: "crypto",
      clientOrderId,
      phase: "entry-submission",
      reason,
      side: "buy",
    });
    return reply({ error: "Daily crypto PAPER entry submission failed before any confirmed fill." }, 502);
  }

  if (!entryOrder?.id) {
    const reason = "Alpaca did not return a broker order for the daily crypto entry.";
    await patchOrder(clientOrderId, {
      status: "error",
      metadata: {
        paperOnly: true,
        executionMode: "paper-crypto",
        executionError: reason,
        brokerLookupPending: true,
      },
    });
    await journalFailure({
      botId: BOT_ID,
      strategyId: strategy.id,
      strategyVersion: strategy.version,
      symbol: requested.symbol,
      assetClass: "crypto",
      clientOrderId,
      phase: "entry-submission",
      reason,
      side: "buy",
      brokerLookupPending: true,
    });
    return reply({ error: reason }, 502);
  }

  let finalEntry = entryOrder;
  for (let index = 0; index < 12; index++) {
    if (["filled","canceled","rejected","expired"].includes(finalEntry.status ?? "")) break;
    await sleep(250);
    try {
      finalEntry = await alpaca(`orders/${encodeURIComponent(entryOrder.id)}`) as BrokerOrder;
    } catch {
      break;
    }
  }

  let filledQty = numeric(finalEntry.filled_qty) ?? 0;
  if ((finalEntry.status !== "filled") && entryOrder.id) {
    try {
      await alpaca(`orders/${encodeURIComponent(entryOrder.id)}`, { method: "DELETE" });
    } catch { /* reconciliation will discover any late terminal state */ }
    for (let index = 0; index < 6; index++) {
      await sleep(200);
      try {
        finalEntry = await alpaca(`orders/${encodeURIComponent(entryOrder.id)}`) as BrokerOrder;
        filledQty = numeric(finalEntry.filled_qty) ?? filledQty;
        if (["filled","canceled","rejected","expired"].includes(finalEntry.status ?? "")) break;
      } catch {
        break;
      }
    }
  }

  await patchOrder(clientOrderId, {
    status: filledQty > 0 ? (finalEntry.status === "filled" ? "filled" : "partially_filled") : mappedStatus(finalEntry.status),
    metadata: {
      paperOnly: true,
      executionMode: "paper-crypto",
      entryOrderType: "marketable-limit",
      entryLimitPrice: roundPrice(candidate.maxEntry),
      estimatedFeeBps: strategy.fees.estimatedTakerFeeBpsPerSide,
      filledQuantityObserved: filledQty,
      filledAveragePriceObserved: numeric(finalEntry.filled_avg_price),
      feeReconciliationPending: filledQty > 0,
    },
  });

  if (!(filledQty > 0)) {
    return reply({
      ok: true,
      paperOnly: true,
      symbol: requested.symbol,
      outcome: "no-fill",
      protectionAttached: false,
    });
  }

  // Query the actual broker position after crypto fees so the protective quantity
  // uses what Alpaca says is sellable, not a locally estimated net quantity.
  let position: BrokerPosition | null = null;
  for (let index = 0; index < 12; index++) {
    try {
      const current = await alpaca("positions") as BrokerPosition[];
      position = current.find(item => normalizeSymbol(item.symbol) === compact) ?? null;
      const available = numeric(position?.qty_available);
      const qty = numeric(position?.qty);
      if ((available ?? qty ?? 0) > 0) break;
    } catch { /* retry briefly */ }
    await sleep(250);
  }

  const protectiveQty = floorQty(numeric(position?.qty_available) ?? numeric(position?.qty) ?? 0);
  if (!(protectiveQty > 0)) {
    const reason = "Daily crypto entry filled, but the broker sellable quantity could not be confirmed for protection.";
    await journalFailure({
      botId: BOT_ID,
      strategyId: strategy.id,
      strategyVersion: strategy.version,
      symbol: requested.symbol,
      assetClass: "crypto",
      clientOrderId,
      phase: "protection-quantity-confirmation",
      reason,
      side: "buy",
      critical: true,
    });
    return reply({
      error: reason,
      paperOnly: true,
      symbol: requested.symbol,
      critical: true,
    }, 502);
  }

  const filledAveragePrice = numeric(finalEntry.filled_avg_price);
  const observedEntryFee = observeCryptoEntryFee(
    filledQty,
    protectiveQty,
    filledAveragePrice,
  );
  const observedEntryFeeQuantity = observedEntryFee.feeQuantity;
  const observedEntryFeeBps = observedEntryFee.feeBps;
  const observedEntryFeeUsd = observedEntryFee.feeUsd;

  await patchOrder(clientOrderId, {
    metadata: {
      paperOnly: true,
      executionMode: "paper-crypto",
      entryOrderType: "marketable-limit",
      entryLimitPrice: roundPrice(candidate.maxEntry),
      estimatedFeeBps: strategy.fees.estimatedTakerFeeBpsPerSide,
      filledQuantityObserved: filledQty,
      filledAveragePriceObserved: filledAveragePrice,
      brokerSellableQuantityObserved: protectiveQty,
      observedEntryFeeQuantity,
      observedEntryFeeBps,
      observedEntryFeeUsd,
      feeReconciliationPending: false,
      feeReconciliationSource: observedEntryFeeBps !== null ? "broker-position-quantity" : "estimated-fallback",
    },
  });

  const stopClientOrderId = createPaperClientOrderId(BOT_ID, strategy.version, crypto.randomUUID());
  const stopPrice = roundPrice(candidate.protectiveStop);
  const stopLimit = stopLimitFloor(stopPrice);

  await db("paper_bot_orders", {
    client_order_id: stopClientOrderId,
    bot_id: BOT_ID,
    strategy_id: strategy.id,
    strategy_version: strategy.version,
    symbol: requested.symbol,
    asset_class: "crypto",
    side: "sell",
    status: "prepared",
    requested_quantity: protectiveQty,
    pool_id: "day",
    entry_trigger: stopPrice,
    max_entry_price: stopLimit,
    protective_stop: stopPrice,
    planned_risk_dollars: 0,
    expires_at: null,
    stage_reason: "Protective stop-limit for daily crypto day position.",
    take_profit_price: candidate.takeProfit,
    take_profit_fraction: strategy.risk.firstTakeProfitFraction,
    take_profit_r: strategy.risk.firstTakeProfitR,
    protect_winner_at_r: strategy.risk.protectWinnerAtR,
    trail_remainder: strategy.risk.trailRemainder,
    metadata: {
      purpose: "protective-stop",
      parentClientOrderId: clientOrderId,
      paperOnly: true,
      executionMode: "paper-crypto",
      estimatedFeeBps: strategy.fees.estimatedTakerFeeBpsPerSide,
    },
  }, "POST", "return=minimal");

  try {
    const stopOrder = await alpaca("orders", {
      method: "POST",
      body: JSON.stringify({
        symbol: requested.symbol,
        qty: qtyString(protectiveQty),
        side: "sell",
        type: "stop_limit",
        time_in_force: "gtc",
        stop_price: String(stopPrice),
        limit_price: String(stopLimit),
        client_order_id: stopClientOrderId,
      }),
    }) as BrokerOrder;

    await patchOrder(stopClientOrderId, {
      status: mappedStatus(stopOrder.status),
      broker_order_id: stopOrder.id ?? null,
      submitted_at: new Date().toISOString(),
    });
    await patchOrder(clientOrderId, {
      metadata: {
        paperOnly: true,
        executionMode: "paper-crypto",
        entryOrderType: "marketable-limit",
        entryLimitPrice: roundPrice(candidate.maxEntry),
        estimatedFeeBps: strategy.fees.estimatedTakerFeeBpsPerSide,
        filledQuantityObserved: filledQty,
        filledAveragePriceObserved: filledAveragePrice,
        brokerSellableQuantityObserved: protectiveQty,
        observedEntryFeeQuantity,
        observedEntryFeeBps,
        observedEntryFeeUsd,
        feeReconciliationPending: false,
        feeReconciliationSource: observedEntryFeeBps !== null ? "broker-position-quantity" : "estimated-fallback",
        protectionAttached: true,
        protectionClientOrderId: stopClientOrderId,
      },
    });

    return reply({
      ok: true,
      paperOnly: true,
      symbol: requested.symbol,
      outcome: "filled-protected",
      protectionAttached: true,
      stop: stopPrice,
      takeProfitPlan: candidate.takeProfit,
    });
  } catch (protectionError) {
    const protectionReason = protectionError instanceof Error ? protectionError.message.slice(0,180) : "Protective stop failed.";
    await patchOrder(stopClientOrderId, {
      status: "error",
      metadata: {
        purpose: "protective-stop",
        parentClientOrderId: clientOrderId,
        paperOnly: true,
        protectionError: protectionReason,
      },
    });
    await journalFailure({
      botId: BOT_ID,
      strategyId: strategy.id,
      strategyVersion: strategy.version,
      symbol: requested.symbol,
      assetClass: "crypto",
      clientOrderId: stopClientOrderId,
      phase: "protective-stop-submission",
      reason: protectionReason,
      side: "sell",
      purpose: "protective-stop",
      critical: true,
      metadata: { parentClientOrderId: clientOrderId },
    });

    // Fail closed: if broker protection cannot be attached, immediately submit a
    // tagged PAPER market exit rather than intentionally leaving the POC position naked.
    const emergencyClientOrderId = createPaperClientOrderId(BOT_ID, strategy.version, crypto.randomUUID());
    await db("paper_bot_orders", {
      client_order_id: emergencyClientOrderId,
      bot_id: BOT_ID,
      strategy_id: strategy.id,
      strategy_version: strategy.version,
      symbol: requested.symbol,
      asset_class: "crypto",
      side: "sell",
      status: "prepared",
      requested_quantity: protectiveQty,
      pool_id: "day",
      stage_reason: "Emergency PAPER flatten because protective stop placement failed.",
      planned_risk_dollars: 0,
      metadata: {
        purpose: "emergency-flatten",
        parentClientOrderId: clientOrderId,
        paperOnly: true,
        estimatedFeeBps: strategy.fees.estimatedTakerFeeBpsPerSide,
      },
    }, "POST", "return=minimal");

    let flattenSubmitted = false;
    try {
      const flatten = await alpaca("orders", {
        method: "POST",
        body: JSON.stringify({
          symbol: requested.symbol,
          qty: qtyString(protectiveQty),
          side: "sell",
          type: "market",
          time_in_force: "gtc",
          client_order_id: emergencyClientOrderId,
        }),
      }) as BrokerOrder;
      flattenSubmitted = Boolean(flatten.id);
      await patchOrder(emergencyClientOrderId, {
        status: mappedStatus(flatten.status),
        broker_order_id: flatten.id ?? null,
        submitted_at: new Date().toISOString(),
      });
    } catch (flattenError) {
      const flattenReason = flattenError instanceof Error ? flattenError.message.slice(0,180) : "Emergency flatten submission failed.";
      await patchOrder(emergencyClientOrderId, {
        status: "error",
        metadata: {
          purpose: "emergency-flatten",
          parentClientOrderId: clientOrderId,
          paperOnly: true,
          executionError: flattenReason,
        },
      });
      await journalFailure({
        botId: BOT_ID,
        strategyId: strategy.id,
        strategyVersion: strategy.version,
        symbol: requested.symbol,
        assetClass: "crypto",
        clientOrderId: emergencyClientOrderId,
        phase: "emergency-flatten-submission",
        reason: flattenReason,
        side: "sell",
        purpose: "emergency-flatten",
        critical: true,
        metadata: { parentClientOrderId: clientOrderId },
      });
    }

    return reply({
      error: "Protective stop placement failed after a fill; an emergency PAPER flatten was attempted.",
      paperOnly: true,
      symbol: requested.symbol,
      critical: true,
      emergencyFlattenSubmitted: flattenSubmitted,
    }, 502);
  }
}
