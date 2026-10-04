"use client";

import { useEffect, useState } from "react";
import type { PaperBotTradePlan } from "@/lib/paper-bot-trade-plan";

export type CryptoSwingReadinessReport = {
  collectedAt: string;
  strategyId: string;
  strategyVersion: number;
  paperOnly: true;
  executionEnabled: boolean;
  intendedHoldingDays?: readonly [number,number] | [number,number];
  plans: PaperBotTradePlan[];
};

export default function useCryptoSwingReadiness() {
  const [report, setReport] = useState<CryptoSwingReadinessReport | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    let running = false;

    const refresh = async () => {
      if (document.hidden || running || controller.signal.aborted) return;
      running = true;
      try {
        const response = await fetch("/api/paper-trading/bots/crypto-swing-readiness", {
          cache:"no-store",
          signal:AbortSignal.any([controller.signal,AbortSignal.timeout(20_000)]),
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Crypto swing readiness unavailable.");
        if (!controller.signal.aborted) {
          setReport(body);
          setError("");
        }
      } catch (reason) {
        if (!controller.signal.aborted) {
          setError(reason instanceof Error ? reason.message : "Crypto swing readiness unavailable.");
        }
      } finally {
        running = false;
      }
    };

    const visible = () => { if (!document.hidden) void refresh(); };
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 60_000);
    document.addEventListener("visibilitychange",visible);

    return () => {
      controller.abort();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange",visible);
    };
  },[]);

  return { report, error };
}
