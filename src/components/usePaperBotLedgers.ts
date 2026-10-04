"use client";

import { useEffect, useState } from "react";
import type { PaperBotSummary } from "@/lib/paper-bot-ledger";

export type StagedPaperOrder = {
  bot_id: string;
  strategy_id: string | null;
  strategy_version: number | null;
  symbol: string;
  asset_class: "stock" | "etf" | "crypto" | "unknown";
  status: string;
  requested_notional: number | null;
  requested_quantity: number | null;
  pool_id: "day" | "multi-day" | "multi-week" | null;
  entry_trigger: number | null;
  max_entry_price: number | null;
  protective_stop: number | null;
  planned_risk_dollars: number | null;
  expires_at: string | null;
  stage_reason: string | null;
  take_profit_price: number | null;
  take_profit_fraction: number | null;
  take_profit_r: number | null;
  protect_winner_at_r: number | null;
  trail_remainder: boolean;
};

export type ExitManagerState = {
  version?: string;
  mode?: string;
  plannedAction?: "hold" | "repair_stop" | "partial_profit" | "goal_exit" | "tighten_stop_trail" | "tighten_stop_breakeven";
  rMultiple?: number;
  markPrice?: number;
  evaluatedAt?: string;
  hasActiveStop?: boolean;
  reason?: string;
  desiredStop?: number;
  partialFraction?: number;
  partialProfitState?: string;
};

export type PaperPositionPlan = {
  bot_id: string;
  symbol: string;
  quantity: number;
  average_entry: number | null;
  protective_stop: number | null;
  initial_protective_stop: number | null;
  planned_risk_dollars: number | null;
  take_profit_price: number | null;
  take_profit_fraction: number | null;
  take_profit_r: number | null;
  protect_winner_at_r: number | null;
  trail_remainder: boolean;
  last_exit_manager_at: string | null;
  exit_manager_state: ExitManagerState;
};

export type PaperBrokerOrder = {
  symbol: string;
  asset_class: "stock" | "etf" | "crypto" | "unknown";
  side: "buy" | "sell";
  order_type: string | null;
  order_class: string | null;
  status: string;
  quantity: number | null;
  filled_quantity: number | null;
  average_fill_price: number | null;
  submitted_at: string | null;
  filled_at: string | null;
  last_seen_at: string;
};

export type PaperBrokerFill = {
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  price: number;
  transaction_time: string;
  ledger_applied_at: string | null;
};

export type PaperTradeMetric = {
  bot_id: string;
  symbol: string;
  status: "open" | "closing" | "closed";
  opened_at: string;
  closed_at: string | null;
  entry_price: number | null;
  initial_protective_stop: number | null;
  initial_risk_dollars: number | null;
  peak_mark_price: number | null;
  trough_mark_price: number | null;
  last_mark_price: number | null;
  last_mark_at: string | null;
  mark_count: number;
  mfe_r: number;
  mae_r: number;
  exit_price: number | null;
  realized_pl: number | null;
  r_multiple: number | null;
  estimated_fees: number | null;
  exit_reason: string | null;
};

export type PaperCounterfactual = {
  bot_id: string;
  strategy_id: string | null;
  strategy_version: number | null;
  symbol: string;
  status: "watching" | "triggered" | "completed" | "expired" | "ambiguous" | "superseded";
  source_event_type: string;
  decision_state: string | null;
  decision_at: string;
  session_key: string | null;
  score: number | null;
  trigger_price: number;
  max_entry_price: number;
  protective_stop: number;
  assumed_entry_price: number | null;
  one_r_price: number | null;
  two_r_price: number | null;
  triggered_at: string | null;
  stop_hit_at: string | null;
  one_r_hit_at: string | null;
  two_r_hit_at: string | null;
  first_outcome: string | null;
  mark_count: number;
  mfe_r: number;
  mae_r: number;
};

export type PaperBotLedgerReport = {
  collectedAt: string;
  bots: PaperBotSummary[];
  brokerOrders: Record<string, PaperBrokerOrder[]>;
  brokerFills: Record<string, PaperBrokerFill[]>;
  stagedOrders: Record<string, StagedPaperOrder[]>;
  positionPlans: Record<string, PaperPositionPlan[]>;
  tradeMetrics: Record<string, PaperTradeMetric[]>;
  counterfactuals: Record<string, PaperCounterfactual[]>;
  history: Record<string, Array<{ time: string; equity: number }>>;
  accountingModel: {
    challengeStartingCash: number;
    programStartingCapital: number;
    reservedBotPools: number;
    allocatedBotCapital: number;
    unallocatedReserve: number;
    currency: string;
    virtualLedgerIsAuthority: boolean;
    executionVenueBalanceIsNotProgramCapital: boolean;
    tradeAttributionRequired: boolean;
  };
};

export default function usePaperBotLedgers() {
  const [report, setReport] = useState<PaperBotLedgerReport | null>(null);
  const [error, setError] = useState("");
  const [refreshVersion, setRefreshVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let running = false;

    const refresh = async () => {
      if (document.hidden || running || controller.signal.aborted) return;
      running = true;
      try {
        const response = await fetch("/api/paper-trading/bots", {
          cache: "no-store",
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Bot ledgers unavailable.");
        if (!controller.signal.aborted) {
          setReport(body);
          setError("");
        }
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Bot ledgers unavailable.");
      } finally {
        running = false;
      }
    };

    const visible = () => { if (!document.hidden) void refresh(); };
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 15_000);
    document.addEventListener("visibilitychange", visible);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [refreshVersion]);

  return { report, error, refresh: () => setRefreshVersion(value => value + 1) };
}
