"use client";

import { useEffect, useState } from "react";

export type PaperProspect = {
  asset_class: "stock" | "crypto";
  symbol: string;
  status: "candidate" | "watchlist" | "review-ready" | "expired";
  score: number;
  price: number | null;
  percent_change: number | null;
  spread_pct: number | null;
  volume: number | null;
  volume_ratio: number | null;
  activity_rank: number | null;
  near_high_pct: number | null;
  watchlist_eligible: boolean;
  bot_review_eligible: boolean;
  suggested_bot_ids: string[];
  assigned_bot_ids: string[];
  score_components: {
    momentum: number;
    activity: number;
    liquidity: number;
    volumeExpansion: number;
    structure: number;
  };
  reasons: string[];
  source_flags: string[];
  source_updated_at: string | null;
  first_seen_at: string;
  first_watchlist_at: string | null;
  first_review_ready_at: string | null;
  last_seen_at: string;
  metadata: Record<string, unknown>;
};

export type PaperProspectReport = {
  scannerId: string;
  scannerVersion: number;
  thresholds: {
    observationScore: number;
    watchlistScore: number;
    botReviewScore: number;
  };
  lastSeenAt: string | null;
  counts: {
    watchlist: number;
    reviewReady: number;
    newToExistingLists: number;
    nearMisses: number;
  };
  prospects: PaperProspect[];
  nearMisses: PaperProspect[];
};

export default function usePaperProspects() {
  const [report, setReport] = useState<PaperProspectReport | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    let running = false;

    const refresh = async () => {
      if (running || controller.signal.aborted || document.hidden) return;
      running = true;
      try {
        const response = await fetch("/api/paper-trading/prospects", {
          cache: "no-store",
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Prospect scanner unavailable.");
        if (!controller.signal.aborted) {
          setReport(body);
          setError("");
        }
      } catch (reason) {
        if (!controller.signal.aborted) {
          setError(reason instanceof Error ? reason.message : "Prospect scanner unavailable.");
        }
      } finally {
        running = false;
      }
    };

    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 60_000);
    const onVisible = () => { if (!document.hidden) void refresh(); };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      controller.abort();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return { report, error };
}
