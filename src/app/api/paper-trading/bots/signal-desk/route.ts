import { NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://yufptpfiwdbzzrvhkvux.supabase.co";

const eventSchema = z.object({
  bot_id: z.string(),
  strategy_id: z.string().nullable(),
  strategy_version: z.coerce.number().int().positive().nullable(),
  event_type: z.string(),
  symbol: z.string().nullable(),
  occurred_at: z.string(),
  score: z.coerce.number().finite().nullable(),
  qualification: z.string().nullable(),
  component_scores: z.record(z.string(), z.unknown()),
  market_snapshot: z.record(z.string(), z.unknown()),
  risk_plan: z.record(z.string(), z.unknown()),
  blockers: z.array(z.string()),
  warnings: z.array(z.string()),
  client_order_id: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
});

function reply(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "public, s-maxage=5, stale-while-revalidate=10" },
  });
}

export async function GET() {
  const supabaseSecret = process.env.SUPABASE_SECRET_KEY?.trim() ?? "";
  if (!supabaseSecret) return reply({ error: "Signal Desk storage is not configured." }, 503);

  const headers: Record<string,string> = {
    apikey: supabaseSecret,
    Accept: "application/json",
  };
  if (supabaseSecret.startsWith("eyJ")) headers.Authorization = `Bearer ${supabaseSecret}`;

  try {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/paper_bot_journal?select=bot_id,strategy_id,strategy_version,event_type,symbol,occurred_at,score,qualification,component_scores,market_snapshot,risk_plan,blockers,warnings,client_order_id,metadata&event_type=in.(prospect-intake,rejected,canceled,expired,replaced,execution_error)&order=occurred_at.desc&limit=500`,
      {
        headers,
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!response.ok) throw new Error(`Signal Desk storage returned HTTP ${response.status}.`);

    const rows = z.array(eventSchema).parse(await response.json());
    const byBot: Record<string, z.infer<typeof eventSchema>[]> = {};
    for (const row of rows) {
      if (!byBot[row.bot_id]) byBot[row.bot_id] = [];
      byBot[row.bot_id].push(row);
    }

    return reply({
      collectedAt: new Date().toISOString(),
      events: byBot,
    });
  } catch (error) {
    return reply({
      error: error instanceof Error ? error.message : "Signal Desk evidence unavailable.",
    }, 503);
  }
}
