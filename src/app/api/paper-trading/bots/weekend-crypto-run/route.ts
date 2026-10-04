import { NextResponse } from "next/server";
import { z } from "zod";
import { buildDailyCryptoScanJournalRows } from "@/lib/paper-daily-crypto-scan-journal";
import { advancePaperCounterfactual, buildDailyCryptoCounterfactualSeeds, counterfactualPatch } from "@/lib/paper-counterfactual";
import { DAILY_CRYPTO_DAY_STRATEGY_V4 as strategy } from "@/lib/paper-weekend-crypto-strategy-config";

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
  trackingBars: z.array(z.object({
    t: z.string(),
    o: z.number().finite().positive(),
    h: z.number().finite().positive(),
    l: z.number().finite().positive(),
    c: z.number().finite().positive(),
  })),
});

const readinessSchema = z.object({
  collectedAt: z.string(),
  strategyId: z.string(),
  strategyVersion: z.number().int().positive(),
  paperOnly: z.literal(true),
  broadCryptoSupportive: z.boolean(),
  executionEnabled: z.boolean(),
  submissionReady: z.boolean(),
  selectedSymbol: z.enum(strategy.executionUniverse).nullable(),
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

const counterfactualRowSchema = z.object({
  id: z.coerce.number().int().positive(),
  setup_key: z.string(),
  bot_id: z.string(),
  strategy_id: z.string().nullable(),
  strategy_version: z.coerce.number().int().positive().nullable(),
  symbol: z.string(),
  asset_class: z.string(),
  decision_at: z.string(),
  session_key: z.string().nullable(),
  status: z.enum(["watching","triggered","completed","expired","ambiguous","superseded"]),
  score: z.coerce.number().finite().nullable(),
  trigger_price: z.coerce.number().finite().positive(),
  max_entry_price: z.coerce.number().finite().positive(),
  protective_stop: z.coerce.number().finite().positive(),
  planned_take_profit: z.coerce.number().finite().positive().nullable(),
  assumed_entry_price: z.coerce.number().finite().positive().nullable(),
  risk_per_unit: z.coerce.number().finite().positive().nullable(),
  one_r_price: z.coerce.number().finite().positive().nullable(),
  two_r_price: z.coerce.number().finite().positive().nullable(),
  triggered_at: z.string().nullable(),
  stop_hit_at: z.string().nullable(),
  one_r_hit_at: z.string().nullable(),
  two_r_hit_at: z.string().nullable(),
  first_outcome: z.string().nullable(),
  peak_price: z.coerce.number().finite().positive().nullable(),
  trough_price: z.coerce.number().finite().positive().nullable(),
  last_bar_at: z.string().nullable(),
  mark_count: z.coerce.number().int().nonnegative(),
  mfe_r: z.coerce.number().finite(),
  mae_r: z.coerce.number().finite(),
  blockers: z.array(z.string()),
  warnings: z.array(z.string()),
  metadata: z.record(z.string(),z.unknown()),
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

async function persistCounterfactuals(readiness: z.infer<typeof readinessSchema>) {
  const supabaseSecret = process.env.SUPABASE_SECRET_KEY?.trim() ?? "";
  if (!supabaseSecret) return { ok:false, seedsAttempted:0, updates:0 };

  const headers: Record<string,string> = {
    apikey: supabaseSecret,
    "Content-Type": "application/json",
  };
  if (supabaseSecret.startsWith("eyJ")) headers.Authorization = `Bearer ${supabaseSecret}`;

  const seeds = buildDailyCryptoCounterfactualSeeds(BOT_ID, readiness);
  if (seeds.length) {
    const seedResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/paper_bot_counterfactuals?on_conflict=setup_key`,
      {
        method:"POST",
        headers:{...headers,Prefer:"resolution=ignore-duplicates,return=minimal"},
        body:JSON.stringify(seeds),
        cache:"no-store",
        signal:AbortSignal.timeout(10_000),
      },
    );
    if (!seedResponse.ok) throw new Error(`Counterfactual seed storage returned HTTP ${seedResponse.status}.`);
  }

  const activeResponse = await fetch(
    `${SUPABASE_URL}/rest/v1/paper_bot_counterfactuals?select=*&bot_id=eq.${BOT_ID}&status=in.(watching,triggered)&order=decision_at.asc`,
    {
      headers:{...headers,Accept:"application/json"},
      cache:"no-store",
      signal:AbortSignal.timeout(10_000),
    },
  );
  if (!activeResponse.ok) throw new Error(`Counterfactual read returned HTTP ${activeResponse.status}.`);

  const rows = z.array(counterfactualRowSchema).parse(await activeResponse.json());
  let updates = 0;

  for (const row of rows) {
    const candidate = readiness.candidates.find(item => item.symbol === row.symbol);
    if (!candidate) continue;

    const result = advancePaperCounterfactual({
      id: row.id,
      setupKey: row.setup_key,
      botId: row.bot_id,
      strategyId: row.strategy_id,
      strategyVersion: row.strategy_version,
      symbol: row.symbol,
      assetClass: row.asset_class,
      decisionAt: row.decision_at,
      sessionKey: row.session_key,
      status: row.status,
      score: row.score,
      triggerPrice: row.trigger_price,
      maxEntryPrice: row.max_entry_price,
      protectiveStop: row.protective_stop,
      plannedTakeProfit: row.planned_take_profit,
      assumedEntryPrice: row.assumed_entry_price,
      riskPerUnit: row.risk_per_unit,
      oneRPrice: row.one_r_price,
      twoRPrice: row.two_r_price,
      triggeredAt: row.triggered_at,
      stopHitAt: row.stop_hit_at,
      oneRHitAt: row.one_r_hit_at,
      twoRHitAt: row.two_r_hit_at,
      firstOutcome: row.first_outcome,
      peakPrice: row.peak_price,
      troughPrice: row.trough_price,
      lastBarAt: row.last_bar_at,
      markCount: row.mark_count,
      mfeR: row.mfe_r,
      maeR: row.mae_r,
      blockers: row.blockers,
      warnings: row.warnings,
      metadata: row.metadata,
    }, candidate.trackingBars, {
      expire: row.status === "watching"
        && row.session_key !== null
        && row.session_key !== readiness.session.localDate,
    });

    if (!result.changed) continue;
    const updateResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/paper_bot_counterfactuals?id=eq.${row.id}`,
      {
        method:"PATCH",
        headers:{...headers,Prefer:"return=minimal"},
        body:JSON.stringify(counterfactualPatch(result.state)),
        cache:"no-store",
        signal:AbortSignal.timeout(10_000),
      },
    );
    if (!updateResponse.ok) throw new Error(`Counterfactual update returned HTTP ${updateResponse.status}.`);
    updates += 1;
  }

  return { ok:true, seedsAttempted:seeds.length, updates };
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

  let counterfactualTracking = { ok:false, seedsAttempted:0, updates:0 };
  try {
    counterfactualTracking = await persistCounterfactuals(readiness);
  } catch {
    counterfactualTracking = { ok:false, seedsAttempted:0, updates:0 };
  }

  if (!readiness.session.isTradingDay) {
    return reply({ ok: true, action: "none", reason: "outside-daily-crypto-session", journalPersisted, counterfactualTracking });
  }

  if (!readiness.session.entriesOpen) {
    return reply({ ok: true, action: "none", reason: "entry-window-closed", journalPersisted, counterfactualTracking });
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
      return reply({ ok: true, action: "manage", result: manage, journalPersisted, counterfactualTracking });
    }
  }

  if (!readiness.executionEnabled) {
    return reply({ ok: true, action: "none", reason: "daily-crypto-executor-disabled", journalPersisted, counterfactualTracking });
  }

  if (!readiness.submissionReady || !readiness.selectedSymbol) {
    return reply({ ok: true, action: "none", reason: "no-selected-ready-setup", journalPersisted, counterfactualTracking });
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
      counterfactualTracking,
    }, expectedRace ? 200 : 502);
  }

  return reply({
    ok: true,
    action: "execute",
    symbol: readiness.selectedSymbol,
    result: body,
    journalPersisted,
    counterfactualTracking,
  });
}
