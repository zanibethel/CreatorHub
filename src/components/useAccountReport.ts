"use client";

import { useEffect, useState } from "react";
import type { AccountReport } from "@/lib/account-report";

export default function useAccountReport() {
  const [report, setReport] = useState<AccountReport | null>(null);
  const [error, setError] = useState("");
  const [refreshVersion, setRefreshVersion] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let running = false;
    const refresh = async () => {
      if (document.hidden || running || controller.signal.aborted) return;
      running = true;
      try {
        const response = await fetch("/api/paper-trading/account-report", { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]) });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Account report unavailable.");
        if (!controller.signal.aborted) { setReport(body); setError(""); }
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Account report unavailable.");
      } finally { running = false; }
    };
    const visible = () => { if (!document.hidden) void refresh(); };
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 15_000);
    document.addEventListener("visibilitychange", visible);
    return () => { controller.abort(); window.clearInterval(timer); document.removeEventListener("visibilitychange", visible); };
  }, [refreshVersion]);
  return { report, error, refresh: () => setRefreshVersion(value => value + 1) };
}
