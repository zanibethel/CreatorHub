"use client";

import { useEffect, useState } from "react";

export type PulseReadyPlan = {
  symbol: string;
  scannerScore: number;
  state: "blocked" | "waiting" | "ready";
  selectedForSubmission: boolean;
  bid: number | null;
  ask: number | null;
  trigger: number | null;
  maxEntry: number | null;
  protectiveStop: number | null;
  takeProfit: number | null;
  plannedQuantity: number | null;
  plannedNotional: number | null;
  plannedRiskDollars: number | null;
  blockers: string[];
  waitingOn: string[];
};
export type SparkReadyCandidate = {
  symbol: string;
  sourceScore: number;
  state: "blocked" | "waiting" | "ready";
  selectedForSubmission: boolean;
  bid: number | null;
  ask: number | null;
  trigger: number | null;
  maxEntry: number | null;
  protectiveStop: number | null;
  takeProfit: number | null;
  plannedQuantity: number | null;
  plannedNotional: number | null;
  plannedRiskDollars: number | null;
  blockers: string[];
  waitingOn: string[];
};
export type FastBotReadinessReport<T> = {
  collectedAt: string;
  strategyId: string;
  strategyVersion: number;
  paperOnly: true;
  executionEnabled: boolean;
  submissionReady: boolean;
  selectedSymbol: string | null;
} & T;

type PulseReport = FastBotReadinessReport<{ plans: PulseReadyPlan[] }>;
type SparkReport = FastBotReadinessReport<{ candidates: SparkReadyCandidate[] }>;

export default function useFastBotReadiness() {
  const [pulse, setPulse] = useState<PulseReport | null>(null);
  const [spark, setSpark] = useState<SparkReport | null>(null);
  const [pulseError, setPulseError] = useState("");
  const [sparkError, setSparkError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    let running = false;
    const refresh = async () => {
      if (document.hidden || running || controller.signal.aborted) return;
      running = true;
      const load = async <T,>(path: string, setReport: (report: T) => void, setError: (message: string) => void) => {
        try {
          const response = await fetch(path, {
            cache: "no-store",
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]),
          });
          const body = await response.json();
          if (!response.ok) throw new Error(body.error || "Bot readiness unavailable.");
          if (!controller.signal.aborted) {
            setReport(body as T);
            setError("");
          }
        } catch (error) {
          if (!controller.signal.aborted) {
            setError(error instanceof Error ? error.message : "Bot readiness unavailable.");
          }
        }
      };
      await Promise.all([
        load<PulseReport>("/api/paper-trading/bots/momentum-breakout-readiness", setPulse, setPulseError),
        load<SparkReport>("/api/paper-trading/bots/crypto-ignition-readiness", setSpark, setSparkError),
      ]);
      running = false;
    };
    const onVisible = () => { if (!document.hidden) void refresh(); };
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 60_000);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return { pulse, spark, pulseError, sparkError };
}
