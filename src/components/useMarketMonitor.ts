"use client";

import { useEffect, useRef, useState } from "react";
import { createMarketMonitor, mergeMarketSnapshot, type MarketSnapshot, type MonitorStatus } from "@/lib/market-monitor";

export default function useMarketMonitor(stocks: string, crypto: string, ready: boolean) {
  const [enabled, setEnabled] = useState(true);
  const [snapshot, setSnapshot] = useState<MarketSnapshot | null>(null);
  const [status, setStatus] = useState<MonitorStatus>("connecting");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const monitor = useRef<ReturnType<typeof createMarketMonitor> | null>(null);
  const enabledRef = useRef(enabled);

  useEffect(() => {
    if (!ready) return;
    setSnapshot(null);
    setError("");
    setLoading(false);
    const current = createMarketMonitor({
      isVisible: () => !document.hidden,
      onSnapshot: next => setSnapshot(previous => mergeMarketSnapshot(previous, next)),
      onLoading: setLoading, onError: setError, onStatus: setStatus,
      load: async (signal, includeHistory) => {
        const query = new URLSearchParams({ stocks, crypto, history: includeHistory ? "1" : "0" });
        const response = await fetch(`/api/paper-trading/market-data?${query}`, { cache: "no-store", signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]) });
        const result = await response.json();
        if (!response.ok) {
          const detail = Object.entries(result.errors ?? {}).map(([source, message]) => `${source}: ${message}`).join(" · ");
          throw Object.assign(new Error(detail || result.error || "Could not load quotes."), { status: response.status });
        }
        return result as MarketSnapshot;
      },
    });
    monitor.current = current;
    current.setEnabled(enabledRef.current);
    const visibilityChanged = () => current.visibilityChanged();
    document.addEventListener("visibilitychange", visibilityChanged);
    return () => {
      document.removeEventListener("visibilitychange", visibilityChanged);
      current.dispose();
      if (monitor.current === current) monitor.current = null;
    };
  }, [stocks, crypto, ready]);

  useEffect(() => {
    enabledRef.current = enabled;
    monitor.current?.setEnabled(enabled);
  }, [enabled]);

  return { enabled, setEnabled, snapshot, status, loading, error, refresh: () => { void monitor.current?.refresh(); } };
}
