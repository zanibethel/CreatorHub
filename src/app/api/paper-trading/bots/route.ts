import { NextResponse } from "next/server";
import { z } from "zod";
import { paperBotLedgerRowSchema, projectPaperBotSummary } from "@/lib/paper-bot-ledger";

export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://yufptpfiwdbzzrvhkvux.supabase.co";
const timestamp = z.string().max(64).refine(value => Number.isFinite(Date.parse(value)), "Invalid timestamp");
const historyRow = z.object({
  bot_id: z.string().min(1).max(64),
  collected_at: timestamp,
  equity: z.coerce.number().finite().nonnegative(),
});
const positionRow = z.object({ bot_id: z.string().min(1).max(64), symbol: z.string().min(1).max(32) });
const journalCountRow = z.object({ bot_id: z.string().min(1).max(64), id: z.coerce.number().int().positive() });

export async function GET() {
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret) return NextResponse.json({ error: "Bot ledger storage is not configured." }, { status: 503 });

  const headers: Record<string, string> = { apikey: secret };
  if (secret.startsWith("eyJ")) headers.Authorization = `Bearer ${secret}`;

  const read = async (path: string) => {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error("Bot ledger storage is unavailable.");
    return response.json();
  };

  try {
    const [ledgerRaw, historyRaw, positionRaw, journalRaw] = await Promise.all([
      read("paper_bot_ledgers?select=bot_id,display_name,status,strategy_id,strategy_version,starting_cash,cash,equity,realized_pl,unrealized_pl,buying_power,peak_equity,current_drawdown_pct,open_planned_risk_pct,correlated_risk_pct,daily_realized_loss_pct,weekly_drawdown_pct,last_synced_at,source&order=bot_id.asc"),
      read("paper_bot_equity_history?select=bot_id,collected_at,equity&order=collected_at.asc&limit=5000"),
      read("paper_bot_positions?select=bot_id,symbol&limit=5000"),
      read("paper_bot_journal?select=id,bot_id&limit=10000"),
    ]);

    const ledgers = z.array(paperBotLedgerRowSchema).parse(ledgerRaw);
    const history = z.array(historyRow).parse(historyRaw);
    const positions = z.array(positionRow).parse(positionRaw);
    const journals = z.array(journalCountRow).parse(journalRaw);

    const body = {
      collectedAt: new Date().toISOString(),
      bots: ledgers.map(row => projectPaperBotSummary(
        row,
        positions.filter(position => position.bot_id === row.bot_id).length,
        journals.filter(event => event.bot_id === row.bot_id).length,
      )),
      history: Object.fromEntries(ledgers.map(row => [
        row.bot_id,
        history.filter(point => point.bot_id === row.bot_id).map(point => ({ time: point.collected_at, equity: point.equity })),
      ])),
      accountingModel: {
        challengeStartingCash: 100,
        virtualLedgerIsAuthority: true,
        brokerAccountIsExecutionVenueOnly: true,
        tradeAttributionRequired: true,
      },
    };

    return NextResponse.json(body, {
      headers: { "Cache-Control": "public, s-maxage=5, stale-while-revalidate=5" },
    });
  } catch {
    return NextResponse.json({ error: "Stored bot ledgers are temporarily unavailable." }, {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
