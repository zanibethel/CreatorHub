import { NextResponse } from "next/server";
import { z } from "zod";
import { buildDailyCryptoScanJournalRows } from "@/lib/paper-daily-crypto-scan-journal";

export const dynamic = "force-dynamic";

const PUBLIC_ORIGIN=process.env.CREATORHUB_PUBLIC_ORIGIN||"https://creatorhub-gray.vercel.app";
const BOT_ID = "weekend-crypto-day-100";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://yufptpfiwdbzzrvhkvux.supabase.co";

const candidateSchema = z.object({
  symbol: z.string(),
  tier: z.enum(["execution","monitor"]),
  executionEligible: z.boolean(),
  state: z.enum(["ready","waiting","blocked"]),
  selectedForSubmission: z.boolean(),
  score: z.number().finite().nonnegative(),
  bid: z.number().finite().positive().nullable(),
  ask: z.number().finite().positive().nullable(),
  spreadPct: z.number().finite().nonnegative().nullable(),
  quoteAgeSeconds: z.number().finite().nonnegative().nullable(),
  fastMomentumPct: z.number().finite().nullable(),
  slowMomentumPct: z.number().finite().nullable(),
  atrPct: z.number().finite().nonnegative().nullable(),
  trigger: z.number().finite().positive().nullable(),
  maxEntry: z.number().finite().positive().nullable(),
  protectiveStop: z.number().finite().positive().nullable(),
  takeProfit: z.number().finite().positive().nullable(),
  plannedNotional: z.number().finite().positive().nullable(),
  plannedQuantity: z.number().finite().positive().nullable(),
  plannedRiskDollars: z.number().finite().nonnegative().nullable(),
  plannedRiskPct: z.number().finite().nonnegative().nullable(),
  estimatedRoundTripFees: z.number().finite().nonnegative().nullable(),
  estimatedGrossTargetDollars: z.number().finite().nonnegative().nullable(),
  feeCoverageMultiple: z.number().finite().nonnegative().nullable(),
  waitingOn: z.array(z.string()),
  blockers: z.array(z.string()),
});

const readinessSchema = z.object({
  collectedAt: z.string(),
  strategyId: z.string(),
  strategyVersion: z.number().int().positive(),
  paperOnly: z.literal(true),
  broadCryptoSupportive: z.boolean(),
  executionEnabled: z.boolean(),
  submissionReady: z.boolean(),
  selectedSymbol: z.enum(["BTC/USD","ETH/USD","SOL/USD","LINK/USD","DOT/USD"]).nullable(),
  session: z.object({
    localDate: z.string(),
    localWeekday: z.string(),
    localTime: z.string(),
    isTradingDay: z.boolean(),
    entriesOpen: z.boolean(),
    flattenDue: z.boolean(),
  }),
  candidates: z.array(candidateSchema),
});

function reply(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

async function persistScanJournal(readiness: z.infer<typeof readinessSchema>) {
  const supabaseSecret = process.env.SUPABASE_SECRET_KEY?.trim() ?? "";
  if (!supabaseSecret) return false;

  const headers: Record<string,string> = {
    apikey: supabaseSecret,
    "Content-Type": "application/json",
    Prefer: "return=minimal",
  };
  if (supabaseSecret.startsWith("eyJ")) headers.Authorization = `Bearer ${supabaseSecret}`;

  const rows = buildDailyCryptoScanJournalRows(BOT_ID, readiness);
  const response = await fetch(`${SUPABASE_URL}/rest/v1/paper_bot_journal`, {
    method: "POST",
    headers,
    body: JSON.stringify(rows),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  return response.ok;
}

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET?.trim() ?? "";
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return reply({ error: "Unauthorized." }, 401);
  }

  const executionToken = process.env.PAPER_WEEKEND_CRYPTO_EXECUTION_TOKEN?.trim() ?? "";
  if (executionToken.length < 32) {
    return reply({ error: "Daily crypto execution token is not configured." }, 503);
  }

  const readinessUrl = new URL("/api/paper-trading/bots/weekend-crypto-readiness", PUBLIC_ORIGIN);
  const readinessResponse = await fetch(readinessUrl, {
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (!readinessResponse.ok) {
    return reply({ error: "Daily crypto readiness check failed." }, 503);
  }

  const readiness = readinessSchema.parse(await readinessResponse.json());
  let journalPersisted = false;
  try {
    journalPersisted = await persistScanJournal(readiness);
  } catch {
    journalPersisted = false;
  }

  if (!readiness.session.isTradingDay) {
    return reply({ ok: true, action: "none", reason: "outside-daily-crypto-session", journalPersisted });
  }

  if (readiness.session.flattenDue) {
    const flattenResponse = await fetch(
      new URL("/api/paper-trading/bots/weekend-crypto-flatten", PUBLIC_ORIGIN),
      {
        method: "POST",
        headers: { "x-paper-weekend-execution-token": executionToken },
        cache: "no-store",
        signal: AbortSignal.timeout(30_000),
      },
    );
    const flatten = await flattenResponse.json().catch(() => ({ error: "Flatten returned an invalid response." }));
    return reply({
      ok: flattenResponse.ok,
      action: "flatten",
      localTime: readiness.session.localTime,
      result: flatten,
      journalPersisted,
    }, flattenResponse.ok ? 200 : 502);
  }

  if (!readiness.session.entriesOpen) {
    return reply({ ok: true, action: "none", reason: "entry-window-closed", journalPersisted });
  }

  if (readiness.executionEnabled) {
    const manageResponse = await fetch(
      new URL("/api/paper-trading/bots/weekend-crypto-manage", PUBLIC_ORIGIN),
      {
        method: "POST",
        headers: { "x-paper-weekend-execution-token": executionToken },
        cache: "no-store",
        signal: AbortSignal.timeout(30_000),
      },
    );
    const manage = await manageResponse.json().catch(() => ({ error: "Manager returned an invalid response." }));
    if (!manageResponse.ok) {
      return reply({ ok: false, action: "manager-error", result: manage, journalPersisted }, 502);
    }
    if (!["none","hold"].includes(manage.action ?? "none")) {
      return reply({ ok: true, action: "manage", result: manage, journalPersisted });
    }
  }

  if (!readiness.executionEnabled) {
    return reply({ ok: true, action: "none", reason: "daily-crypto-executor-disabled", journalPersisted });
  }

  if (!readiness.submissionReady || !readiness.selectedSymbol) {
    return reply({ ok: true, action: "none", reason: "no-selected-ready-setup", journalPersisted });
  }

  const executeResponse = await fetch(
    new URL("/api/paper-trading/bots/weekend-crypto-execute", PUBLIC_ORIGIN),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-paper-weekend-execution-token": executionToken,
      },
      body: JSON.stringify({ symbol: readiness.selectedSymbol }),
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    },
  );

  const body = await executeResponse.json().catch(() => ({ error: "Executor returned an invalid response." }));
  if (!executeResponse.ok) {
    const expectedRace = [409,423].includes(executeResponse.status);
    return reply({
      ok: expectedRace,
      action: expectedRace ? "none" : "execution-error",
      symbol: readiness.selectedSymbol,
      executorStatus: executeResponse.status,
      result: body,
      journalPersisted,
    }, expectedRace ? 200 : 502);
  }

  return reply({
    ok: true,
    action: "execute",
    symbol: readiness.selectedSymbol,
    result: body,
    journalPersisted,
  });
}
