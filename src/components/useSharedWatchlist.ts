"use client";
import { useEffect, useState } from "react";
import { DEFAULT_PAPER_WATCHLIST, watchlistSchema } from "@/lib/paper-watchlist";
export default function useSharedWatchlist() {
  const [watchlist,setWatchlist] = useState(DEFAULT_PAPER_WATCHLIST);
  const [error,setError] = useState("");
  useEffect(() => {
    const controller = new AbortController(); let running = false;
    const refresh = async () => {
      if (running || document.hidden || controller.signal.aborted) return;
      running = true;
      try {
        const response = await fetch("/api/paper-trading/watchlist",{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15_000)])});
        if (!response.ok) throw new Error("Shared watchlist unavailable; showing the last known selection.");
        const parsed = watchlistSchema.parse(await response.json());
        if (!controller.signal.aborted) {setWatchlist(parsed);setError("");}
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Shared watchlist unavailable.");
      } finally {running=false;}
    };
    const visible=()=>{if (!document.hidden) void refresh();};
    void refresh();const timer=window.setInterval(()=>void refresh(),60_000);
    document.addEventListener("visibilitychange",visible);
    return ()=>{controller.abort();window.clearInterval(timer);document.removeEventListener("visibilitychange",visible);};
  },[]);
  return {watchlist,error};
}
