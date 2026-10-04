"use client";

import { useEffect, useState } from "react";

export type PaperChartCandle = {
  time: string;
  close: number;
  high?: number;
  low?: number;
  volume?: number;
};

export type PaperChartReport = {
  collectedAt: string;
  botId: string;
  timeframe: string;
  series: Record<string,PaperChartCandle[]>;
};

export default function usePaperChartData(botId: string, symbols: string[]) {
  const [report, setReport] = useState<PaperChartReport | null>(null);
  const [error, setError] = useState("");
  const symbolKey = [...new Set(symbols.map(symbol => symbol.toUpperCase()).filter(Boolean))].sort().join(",");

  useEffect(() => {
    if (!symbolKey) {
      setReport(null);
      setError("");
      return;
    }

    const controller = new AbortController();
    let running = false;

    const refresh = async () => {
      if (running || controller.signal.aborted || document.hidden) return;
      running = true;
      try {
        const query = new URLSearchParams({ botId, symbols:symbolKey });
        const response = await fetch(`/api/paper-trading/charts?${query.toString()}`, {
          cache:"no-store",
          signal:controller.signal,
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Chart data unavailable.");
        if (!controller.signal.aborted) {
          setReport(body);
          setError("");
        }
      } catch (reason) {
        if (!controller.signal.aborted) {
          setError(reason instanceof Error ? reason.message : "Chart data unavailable.");
        }
      } finally {
        running = false;
      }
    };

    const visible = () => { if (!document.hidden) void refresh(); };
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 5 * 60_000);
    document.addEventListener("visibilitychange",visible);

    return () => {
      controller.abort();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange",visible);
    };
  },[botId,symbolKey]);

  return { report, error };
}
