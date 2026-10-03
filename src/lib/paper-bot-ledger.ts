import { z } from "zod";

const finiteNumber = z.coerce.number().finite();
const nullableFinite = z.coerce.number().finite().nullable();
const timestamp = z.string().max(64).refine(value => Number.isFinite(Date.parse(value)), "Invalid timestamp");

export const paperBotLedgerRowSchema = z.object({
  bot_id: z.string().min(1).max(64),
  display_name: z.string().min(1).max(120),
  status: z.enum(["active", "planned", "paused"]),
  strategy_id: z.string().nullable(),
  strategy_version: z.coerce.number().int().positive().nullable(),
  starting_cash: finiteNumber,
  cash: finiteNumber,
  equity: finiteNumber,
  realized_pl: finiteNumber,
  unrealized_pl: finiteNumber,
  buying_power: nullableFinite,
  peak_equity: finiteNumber,
  current_drawdown_pct: finiteNumber,
  open_planned_risk_pct: nullableFinite,
  correlated_risk_pct: nullableFinite,
  daily_realized_loss_pct: nullableFinite,
  weekly_drawdown_pct: nullableFinite,
  last_synced_at: timestamp.nullable(),
  source: z.string().max(80),
});

export const paperBotJournalPublicRowSchema = z.object({
  id: z.coerce.number().int().positive(),
  bot_id: z.string().min(1).max(64),
  strategy_id: z.string().nullable(),
  strategy_version: z.coerce.number().int().positive().nullable(),
  event_type: z.enum([
    "candidate", "rejected", "authorized", "submitted", "filled", "position_update",
    "stop_update", "partial_exit", "closed", "risk_event", "system",
  ]),
  symbol: z.string().nullable(),
  asset_class: z.enum(["stock", "etf", "crypto", "unknown"]).nullable(),
  occurred_at: timestamp,
  score: nullableFinite,
  qualification: z.enum(["unqualified", "watch", "qualified", "trade-ready"]).nullable(),
  regime: z.enum(["bullish", "neutral", "bearish", "unknown"]).nullable(),
  component_scores: z.record(z.string(), z.unknown()),
  risk_plan: z.record(z.string(), z.unknown()),
  blockers: z.array(z.unknown()),
  warnings: z.array(z.unknown()),
  entry_price: nullableFinite,
  exit_price: nullableFinite,
  quantity: nullableFinite,
  realized_pl: nullableFinite,
  r_multiple: nullableFinite,
  mfe_r: nullableFinite,
  mae_r: nullableFinite,
  exit_reason: z.string().nullable(),
});

export type PaperBotLedgerRow = z.infer<typeof paperBotLedgerRowSchema>;
export type PaperBotJournalPublicRow = z.infer<typeof paperBotJournalPublicRowSchema>;

export type PaperBotSummary = {
  botId: string;
  displayName: string;
  status: "active" | "planned" | "paused";
  strategyId: string | null;
  strategyVersion: number | null;
  startingCash: number;
  cash: number;
  equity: number;
  realizedPl: number;
  unrealizedPl: number;
  buyingPower: number | null;
  peakEquity: number;
  currentDrawdownPct: number;
  openPlannedRiskPct: number | null;
  correlatedRiskPct: number | null;
  dailyRealizedLossPct: number | null;
  weeklyDrawdownPct: number | null;
  lastSyncedAt: string | null;
  source: string;
  positionCount: number;
  journalCount: number;
};

export function projectPaperBotSummary(
  row: PaperBotLedgerRow,
  positionCount = 0,
  journalCount = 0,
): PaperBotSummary {
  return {
    botId: row.bot_id,
    displayName: row.display_name,
    status: row.status,
    strategyId: row.strategy_id,
    strategyVersion: row.strategy_version,
    startingCash: row.starting_cash,
    cash: row.cash,
    equity: row.equity,
    realizedPl: row.realized_pl,
    unrealizedPl: row.unrealized_pl,
    buyingPower: row.buying_power,
    peakEquity: row.peak_equity,
    currentDrawdownPct: row.current_drawdown_pct,
    openPlannedRiskPct: row.open_planned_risk_pct,
    correlatedRiskPct: row.correlated_risk_pct,
    dailyRealizedLossPct: row.daily_realized_loss_pct,
    weeklyDrawdownPct: row.weekly_drawdown_pct,
    lastSyncedAt: row.last_synced_at,
    source: row.source,
    positionCount,
    journalCount,
  };
}
