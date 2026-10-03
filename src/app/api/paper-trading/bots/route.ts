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
const brokerOrderRow = z.object({ bot_id: z.string().min(1).max(64), broker_order_id: z.string().min(1).max(80) });
const brokerFillRow = z.object({ bot_id: z.string().min(1).max(64), fill_activity_id: z.string().min(1).max(160), transaction_time: timestamp, ledger_applied_at: timestamp.nullable() });
const stagedOrderRow = z.object({
  bot_id: z.string().min(1).max(64),
  symbol: z.string().min(1).max(32),
  asset_class: z.enum(["stock","etf","crypto","unknown"]),
  status: z.enum(["prepared","submitted","partially_filled","filled","canceled","rejected","expired","replaced","closed","error"]),
  requested_notional: z.coerce.number().finite().positive().nullable(),
  requested_quantity: z.coerce.number().finite().positive().nullable(),
  pool_id: z.enum(["day","multi-day","multi-week"]).nullable(),
  entry_trigger: z.coerce.number().finite().positive().nullable(),
  max_entry_price: z.coerce.number().finite().positive().nullable(),
  protective_stop: z.coerce.number().finite().positive().nullable(),
  planned_risk_dollars: z.coerce.number().finite().nonnegative().nullable(),
  expires_at: timestamp.nullable(),
  stage_reason: z.string().nullable(),
});

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
    const [ledgerRaw, historyRaw, positionRaw, journalRaw, brokerOrderRaw, brokerFillRaw, stagedRaw] = await Promise.all([
      read("paper_bot_ledgers?select=bot_id,display_name,status,strategy_id,strategy_version,starting_cash,cash,equity,realized_pl,unrealized_pl,buying_power,peak_equity,current_drawdown_pct,open_planned_risk_pct,correlated_risk_pct,daily_realized_loss_pct,weekly_drawdown_pct,last_synced_at,source,pool_usage&order=bot_id.asc"),
      read("paper_bot_equity_history?select=bot_id,collected_at,equity&order=collected_at.asc&limit=5000"),
      read("paper_bot_positions?select=bot_id,symbol&limit=5000"),
      read("paper_bot_journal?select=id,bot_id&limit=10000"),
      read("paper_bot_broker_orders?select=bot_id,broker_order_id&limit=10000"),
      read("paper_bot_broker_fills?select=bot_id,fill_activity_id,transaction_time,ledger_applied_at&order=transaction_time.desc&limit=10000"),
      read("paper_bot_orders?select=bot_id,symbol,asset_class,status,requested_notional,requested_quantity,pool_id,entry_trigger,max_entry_price,protective_stop,planned_risk_dollars,expires_at,stage_reason&status=eq.prepared&order=created_at.asc&limit=100"),
    ]);

    const ledgers = z.array(paperBotLedgerRowSchema).parse(ledgerRaw);
    const history = z.array(historyRow).parse(historyRaw);
    const positions = z.array(positionRow).parse(positionRaw);
    const journals = z.array(journalCountRow).parse(journalRaw);
    const brokerOrders = z.array(brokerOrderRow).parse(brokerOrderRaw);
    const brokerFills = z.array(brokerFillRow).parse(brokerFillRaw);
    const stagedOrders = z.array(stagedOrderRow).parse(stagedRaw);

    const body = {
      collectedAt: new Date().toISOString(),
      bots: ledgers.map(row => projectPaperBotSummary(
        row,
        positions.filter(position => position.bot_id === row.bot_id).length,
        journals.filter(event => event.bot_id === row.bot_id).length,
        brokerOrders.filter(order => order.bot_id === row.bot_id).length,
        brokerFills.filter(fill => fill.bot_id === row.bot_id && fill.ledger_applied_at !== null).length,
        brokerFills.find(fill => fill.bot_id === row.bot_id && fill.ledger_applied_at !== null)?.transaction_time ?? null,
      )),
      stagedOrders: Object.fromEntries(ledgers.map(row => [row.bot_id, stagedOrders.filter(order => order.bot_id === row.bot_id)])),
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
