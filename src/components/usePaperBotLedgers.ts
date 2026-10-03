"use client";

import { useEffect, useState } from "react";
import type { PaperBotSummary } from "@/lib/paper-bot-ledger";

export type PaperBotLedgerReport = {
  collectedAt: string;
  bots: PaperBotSummary[];
  history: Record<string, Array<{ time: string; equity: number }>>;
  accountingModel: {
    challengeStartingCash: number;
    virtualLedgerIsAuthority: boolean;
    brokerAccountIsExecutionVenueOnly: boolean;
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
