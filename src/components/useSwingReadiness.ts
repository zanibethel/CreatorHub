"use client";

import { useEffect, useState } from "react";

export type SwingExecutionPreview = {
  symbol: string;
  quantity: number;
  estimatedNotional: number;
  entryReference: number;
  stopLoss: number;
  takeProfit: number;
  plannedRiskDollars: number;
  plannedRiskPct: number;
  allocationPct: number;
  orderClass: "bracket";
  orderType: "market";
  timeInForce: "day";
  paperOnly: true;
};

export type SwingReadinessPlan = {
  symbol: string;
  state: "ready" | "waiting" | "blocked";
  selectedForSubmission: boolean;
  bid: number | null;
  ask: number | null;
  spreadPct: number | null;
  quoteAgeSeconds: number | null;
  plannedRiskPct: number;
  allocationPct: number;
  correlationGroup: string | null;
  blockers: string[];
  waitingOn: string[];
  executionPreview: SwingExecutionPreview | null;
};

export type SwingReadinessReport = {
  collectedAt: string;
  nextMarketOpen: string | null;
  nextMarketClose: string | null;
  entryWindowStart: string | null;
  entryWindowEnd: string | null;
  minimumMinutesAfterOpen: number;
  maximumMinutesAfterOpen: number;
  broadMarketSupportive: boolean;
  marketClockAvailable: boolean;
  strategyId: string;
  strategyVersion: number;
  paperOnly: boolean;
  weeklySlotsRemaining: number;
  openPositionSlotsRemaining: number;
  readyCount: number;
  plans: SwingReadinessPlan[];
  executionEnabled: boolean;
  submissionReady: boolean;
  brokerProtection: "bracket";
};

export default function useSwingReadiness() {
  const [report, setReport] = useState<SwingReadinessReport | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    let running = false;
    const refresh = async () => {
      if (document.hidden || running || controller.signal.aborted) return;
      running = true;
      try {
        const response = await fetch("/api/paper-trading/bots/swing-readiness", {
          cache: "no-store",
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Swing readiness unavailable.");
        if (!controller.signal.aborted) {
          setReport(body);
          setError("");
        }
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Swing readiness unavailable.");
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
  }, []);

  return { report, error };
}
