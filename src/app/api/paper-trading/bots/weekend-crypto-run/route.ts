import { NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const readinessSchema = z.object({
  paperOnly: z.literal(true),
  executionEnabled: z.boolean(),
  submissionReady: z.boolean(),
  selectedSymbol: z.enum(["BTC/USD","ETH/USD","SOL/USD"]).nullable(),
  session: z.object({
    localDate: z.string(),
    localWeekday: z.string(),
    localTime: z.string(),
    isWeekend: z.boolean(),
    entriesOpen: z.boolean(),
    flattenDue: z.boolean(),
  }),
});

function reply(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET?.trim() ?? "";
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return reply({ error: "Unauthorized." }, 401);
  }

  const executionToken = process.env.PAPER_WEEKEND_CRYPTO_EXECUTION_TOKEN?.trim() ?? "";
  if (executionToken.length < 32) {
    return reply({ error: "Weekend execution token is not configured." }, 503);
  }

  const readinessUrl = new URL("/api/paper-trading/bots/weekend-crypto-readiness", request.url);
  const readinessResponse = await fetch(readinessUrl, {
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (!readinessResponse.ok) {
    return reply({ error: "Weekend readiness check failed." }, 503);
  }

  const readiness = readinessSchema.parse(await readinessResponse.json());

  if (!readiness.session.isWeekend) {
    return reply({ ok: true, action: "none", reason: "outside-weekend-session" });
  }

  if (readiness.session.flattenDue) {
    const flattenResponse = await fetch(
      new URL("/api/paper-trading/bots/weekend-crypto-flatten", request.url),
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
    }, flattenResponse.ok ? 200 : 502);
  }

  if (!readiness.session.entriesOpen) {
    return reply({ ok: true, action: "none", reason: "entry-window-closed" });
  }

  if (readiness.executionEnabled) {
    const manageResponse = await fetch(
      new URL("/api/paper-trading/bots/weekend-crypto-manage", request.url),
      {
        method: "POST",
        headers: { "x-paper-weekend-execution-token": executionToken },
        cache: "no-store",
        signal: AbortSignal.timeout(30_000),
      },
    );
    const manage = await manageResponse.json().catch(() => ({ error: "Manager returned an invalid response." }));
    if (!manageResponse.ok) {
      return reply({ ok: false, action: "manager-error", result: manage }, 502);
    }
    if (!["none","hold"].includes(manage.action ?? "none")) {
      return reply({ ok: true, action: "manage", result: manage });
    }
  }

  if (!readiness.executionEnabled) {
    return reply({ ok: true, action: "none", reason: "weekend-executor-disabled" });
  }

  if (!readiness.submissionReady || !readiness.selectedSymbol) {
    return reply({ ok: true, action: "none", reason: "no-selected-ready-setup" });
  }

  const executeResponse = await fetch(
    new URL("/api/paper-trading/bots/weekend-crypto-execute", request.url),
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
    }, expectedRace ? 200 : 502);
  }

  return reply({
    ok: true,
    action: "execute",
    symbol: readiness.selectedSymbol,
    result: body,
  });
}
