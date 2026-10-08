"use client";

import { useEffect, useState } from "react";

export type PaperSignalDeskEvent = {
  bot_id: string;
  strategy_id: string | null;
  strategy_version: number | null;
  event_type: string;
  symbol: string | null;
  occurred_at: string;
  score: number | null;
  qualification: string | null;
  component_scores: Record<string, unknown>;
  market_snapshot: Record<string, unknown>;
  risk_plan: Record<string, unknown>;
  blockers: string[];
  warnings: string[];
  client_order_id: string | null;
  metadata: Record<string, unknown>;
};

export type PaperSignalDeskReport = {
  collectedAt: string;
  events: Record<string, PaperSignalDeskEvent[]>;
};

export default function usePaperSignalDesk() {
  const [report, setReport] = useState<PaperSignalDeskReport | null>(null);
  const [error, setError] = useState("");
  const [refreshVersion, setRefreshVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let running = false;

    const refresh = async () => {
      if (document.hidden || running || controller.signal.aborted) return;
      running = true;
      try {
        const response = await fetch("/api/paper-trading/bots/signal-desk", {
          cache: "no-store",
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Signal Desk unavailable.");
        if (!controller.signal.aborted) {
          setReport(body);
          setError("");
        }
      } catch (reason) {
        if (!controller.signal.aborted) {
          setError(reason instanceof Error ? reason.message : "Signal Desk unavailable.");
        }
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
