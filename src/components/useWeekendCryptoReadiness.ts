"use client";

import { useEffect, useState } from "react";

export type WeekendCryptoCandidate = {
  symbol: string;
  tier: "execution" | "monitor";
  executionEligible: boolean;
  state: "ready" | "waiting" | "blocked";
  selectedForSubmission: boolean;
  score: number;
  bid: number | null;
  ask: number | null;
  spreadPct: number | null;
  quoteAgeSeconds: number | null;
  fastMomentumPct: number | null;
  slowMomentumPct: number | null;
  atrPct: number | null;
  trigger: number | null;
  maxEntry: number | null;
  protectiveStop: number | null;
  takeProfit: number | null;
  plannedNotional: number | null;
  plannedQuantity: number | null;
  plannedRiskDollars: number | null;
  plannedRiskPct: number | null;
  estimatedRoundTripFees: number | null;
  estimatedGrossTargetDollars: number | null;
  feeCoverageMultiple: number | null;
  waitingOn: string[];
  blockers: string[];
};

export type WeekendCryptoReadiness = {
  collectedAt: string;
  source: string;
  fastTimeframe: "5Min";
  slowTimeframe: "15Min";
  strategyId: string;
  strategyVersion: number;
  paperOnly: boolean;
  executionUniverse: string[];
  monitorOnlyUniverse: string[];
  session: {
    localDate: string;
    localWeekday: string;
    localTime: string;
    isTradingDay: boolean;
    isWeekend: boolean;
    entriesOpen: boolean;
    flattenDue: boolean;
  };
  broadCryptoSupportive: boolean;
  executionEnabled: boolean;
  submissionReady: boolean;
  dailyEntriesRemaining: number;
  openPositionSlotsRemaining: number;
  selectedSymbol: string | null;
  occupiedByOtherBots: string[];
  candidates: WeekendCryptoCandidate[];
};

export default function useWeekendCryptoReadiness() {
  const [report, setReport] = useState<WeekendCryptoReadiness | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    let running = false;

    const refresh = async () => {
      if (document.hidden || running || controller.signal.aborted) return;
      running = true;
      try {
        const response = await fetch("/api/paper-trading/bots/weekend-crypto-readiness", {
          cache: "no-store",
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]),
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Daily crypto readiness unavailable.");
        if (!controller.signal.aborted) {
          setReport(body);
          setError("");
        }
      } catch (reason) {
        if (!controller.signal.aborted) {
          setError(reason instanceof Error ? reason.message : "Daily crypto readiness unavailable.");
        }
      } finally {
        running = false;
      }
    };

    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 15_000);
    const visibilityChanged = () => { if (!document.hidden) void refresh(); };
    document.addEventListener("visibilitychange", visibilityChanged);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", visibilityChanged);
    };
  }, []);

  return { report, error };
}
