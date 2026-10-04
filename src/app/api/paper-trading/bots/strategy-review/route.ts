import { NextResponse } from "next/server";
import { z } from "zod";
import { buildPaperStrategyReview } from "@/lib/paper-strategy-review";

export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://yufptpfiwdbzzrvhkvux.supabase.co";
const timestamp = z.string().max(64).refine(value => Number.isFinite(Date.parse(value)), "Invalid timestamp");

const ledgerRow = z.object({
  bot_id:z.string().min(1).max(64),
  display_name:z.string().min(1).max(120),
  strategy_id:z.string().nullable(),
  strategy_version:z.coerce.number().int().positive().nullable(),
  status:z.string(),
});

const journalRow = z.object({
  bot_id:z.string().min(1).max(64),
  event_type:z.string(),
  symbol:z.string().max(32).nullable(),
  occurred_at:timestamp,
  score:z.coerce.number().finite().nullable(),
  qualification:z.string().nullable(),
  regime:z.string().nullable(),
  blockers:z.array(z.string()),
  warnings:z.array(z.string()),
  metadata:z.record(z.string(),z.unknown()),
});

const tradeRow = z.object({
  bot_id:z.string().min(1).max(64),
  strategy_id:z.string().nullable(),
  strategy_version:z.coerce.number().int().positive().nullable(),
  symbol:z.string().min(1).max(32),
  status:z.enum(["open","closing","closed"]),
  opened_at:timestamp,
  closed_at:timestamp.nullable(),
  realized_pl:z.coerce.number().finite().nullable(),
  r_multiple:z.coerce.number().finite().nullable(),
  mfe_r:z.coerce.number().finite(),
  mae_r:z.coerce.number().finite(),
  estimated_fees:z.coerce.number().finite().nonnegative().nullable(),
  exit_reason:z.string().nullable(),
});

const counterfactualRow = z.object({
  bot_id:z.string().min(1).max(64),
  strategy_id:z.string().nullable(),
  strategy_version:z.coerce.number().int().positive().nullable(),
  symbol:z.string().min(1).max(32),
  status:z.enum(["watching","triggered","completed","expired","ambiguous","superseded"]),
  source_event_type:z.string(),
  decision_at:timestamp,
  score:z.coerce.number().finite().nullable(),
  first_outcome:z.string().nullable(),
  mfe_r:z.coerce.number().finite(),
  mae_r:z.coerce.number().finite(),
});

export async function GET() {
  const secret = process.env.SUPABASE_SECRET_KEY?.trim() ?? "";
  if (!secret) return NextResponse.json({ error:"Strategy review storage is not configured." },{ status:503 });

  const headers:Record<string,string> = { apikey:secret, Accept:"application/json" };
  if (secret.startsWith("eyJ")) headers.Authorization = `Bearer ${secret}`;

  const read = async(path:string) => {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`,{
      headers,
      cache:"no-store",
      signal:AbortSignal.timeout(12_000),
    });
    if (!response.ok) throw new Error(`Strategy review storage returned HTTP ${response.status}.`);
    return response.json();
  };

  try {
    const [ledgersRaw,journalRaw,tradesRaw,counterfactualRaw] = await Promise.all([
      read("paper_bot_ledgers?select=bot_id,display_name,strategy_id,strategy_version,status&order=bot_id.asc"),
      read("paper_bot_journal?select=bot_id,event_type,symbol,occurred_at,score,qualification,regime,blockers,warnings,metadata&order=occurred_at.desc&limit=10000"),
      read("paper_bot_trade_metrics?select=bot_id,strategy_id,strategy_version,symbol,status,opened_at,closed_at,realized_pl,r_multiple,mfe_r,mae_r,estimated_fees,exit_reason&order=opened_at.desc&limit=2000"),
      read("paper_bot_counterfactuals?select=bot_id,strategy_id,strategy_version,symbol,status,source_event_type,decision_at,score,first_outcome,mfe_r,mae_r&order=decision_at.desc&limit=5000"),
    ]);

    const report = buildPaperStrategyReview({
      collectedAt:new Date().toISOString(),
      ledgers:z.array(ledgerRow).parse(ledgersRaw),
      journal:z.array(journalRow).parse(journalRaw),
      trades:z.array(tradeRow).parse(tradesRaw),
      counterfactuals:z.array(counterfactualRow).parse(counterfactualRaw),
    });

    return NextResponse.json(report,{
      headers:{ "Cache-Control":"public, s-maxage=15, stale-while-revalidate=30" },
    });
  } catch (error) {
    return NextResponse.json({
      error:error instanceof Error ? error.message : "Strategy review is temporarily unavailable.",
    },{ status:503,headers:{ "Cache-Control":"no-store" } });
  }
}
