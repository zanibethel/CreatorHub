"use client";

import { useEffect, useMemo, useState } from "react";
import { BotMascot } from "@/components/BotMascot";

type Evidence = {
  asset_class: "stock" | "crypto";
  symbol: string;
  signal_kind: string;
  observed_at: string;
  event_at: string;
  available_at: string;
  score: number;
  confidence: number;
  direction: string;
  actor_class: "unattributed";
  source_name: string;
  evidence: Record<string, string | number | boolean | null>;
};
type Report = { observations: Evidence[]; collectedAt: string; status: string };

const time = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit", timeZoneName: "short",
  }).format(date);
};
const amount = (value: unknown) => typeof value === "number"
  ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value)
  : "Not available";

export default function MarketMoverIntelligencePage() {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const response = await fetch("/api/paper-trading/market-movers", {
          cache: "no-store", signal: controller.signal,
        });
        if (!response.ok) throw new Error("The market-mover evidence feed is unavailable.");
        const data = await response.json() as Report;
        if (!controller.signal.aborted) { setReport(data); setError(""); }
      } catch {
        if (!controller.signal.aborted) setError("Unable to refresh market-mover evidence.");
      }
    };
    void load();
    const timer = setInterval(() => void load(), 90_000);
    return () => { controller.abort(); clearInterval(timer); };
  }, []);

  const latest = useMemo(() => {
    const seen = new Set<string>();
    return (report?.observations ?? []).filter(row => {
      const key = `${row.asset_class}:${row.symbol}:${row.signal_kind}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 30);
  }, [report]);

  return <main style={{
    color: "#e7eff7", background: "#090d12", minHeight: "100vh",
    padding: "32px clamp(16px, 5vw, 64px)", fontFamily: "system-ui, sans-serif",
  }}>
    <nav style={{ marginBottom: 24, display: "flex", gap: 22, flexWrap: "wrap" }}>
      <a href="/paper-trading" style={{ color: "#93d8ff" }}>← Bot Lab</a>
      <a href="/paper-trading/signals" style={{ color: "#93d8ff" }}>Signal Desk</a>
      <a href="/paper-trading/movers/insiders" style={{ color: "#93d8ff" }}>SEC Insider History</a>
    </nav>
    <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap", marginBottom: 20 }}><BotMascot botId="midas" size="profile"/><div><h1 style={{ fontSize: "clamp(25px, 4vw, 38px)", marginBottom: 8 }}>Midas · Market Mover Intelligence</h1><p style={{color:"#5ddfdf"}}>Institutional & whale intelligence · research-only mascot</p></div></div>
    <p style={{ maxWidth: 820, color: "#b5c2d0", lineHeight: 1.65 }}>
      Research-only evidence of unusual market activity. Current inputs sample displayed crypto
      order-book depth and individual stock prints from a limited exchange feed.
      They <strong>do not identify buyers, prove that a whale purchased, or authorize trades.</strong>
    </p>
    <p style={{ color: "#9db1c3", fontSize: 13 }}>
      Status: Observational v1 · Scores are provisional strength indicators, not win probabilities
      or additions to bot execution scores.
    </p>
    {error && <p role="alert" style={{ color: "#ff9e9e" }}>{error}</p>}
    {!report && !error && <p style={{ color: "#9db1c3" }}>Loading recorded observations…</p>}
    {report && <p style={{ color: "#a3b4c3" }}>
      {latest.length} symbols/signals · Latest read: {time(report.collectedAt)}
    </p>}
    {report && !latest.length && <p style={{ color: "#bed4e6" }}>
      No observations recorded in the last seven days. The scheduled sampling job may not
      have run yet, no recent prospects may qualify, or the market-data source may be unavailable.
    </p>}
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,320px),1fr))", gap: 16 }}>
      {latest.map(row => {
        const buy = row.direction === "buy-side-depth";
        const sell = row.direction === "sell-side-depth";
        const quality = row.asset_class === "crypto"
          ? String(row.evidence.quality_status ?? "legacy")
          : "unattributed-print";
        const confirmed = quality === "confirmed";
        const highlight = confirmed ? (buy ? "#57d7b0" : sell ? "#ff8c8c" : "#b6c9da") : "#b6c9da";
        const statusLabel = quality === "confirmed" ? "Repeated quality checks passed"
          : quality === "watching" ? "Watching · needs another separate scan"
          : quality === "rejected" ? "Excluded · unreliable displayed depth"
          : quality === "legacy" ? "Historical · predates quality checks"
          : "Unattributed trade print";
        const reason = String(row.evidence.quality_reason ?? "").split(",").filter(Boolean)
          .map(value => value.replaceAll("-", " ")).join(" · ");
        return <article key={`${row.asset_class}:${row.symbol}:${row.signal_kind}`} style={{
          background: "#131b25", border: "1px solid #263444", borderRadius: 12, padding: 18,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            <strong style={{ fontSize: 20 }}>{row.symbol}</strong>
            <span style={{ color: "#aabaca", fontSize: 12 }}>{row.asset_class.toUpperCase()}</span>
          </div>
          <p style={{ color: highlight, margin: "10px 0" }}>
            {statusLabel}
          </p>
          <p style={{ color: "#aabaca", fontSize: 13, margin: "6px 0" }}>
            {buy ? "More displayed bid-side depth" : sell ? "More displayed ask-side depth" :
              row.direction === "balanced-depth" ? "Relatively balanced displayed depth" : "Unattributed large print"}
          </p>
          {reason && !confirmed ? <p style={{ color: "#b9a9a5", fontSize: 12 }}>
            Quality check: {reason}
          </p> : null}
          <div style={{ display: "flex", gap: 20, margin: "14px 0" }}>
            <div><strong style={{ fontSize: 28 }}>{Number(row.score).toFixed(0)}</strong><div style={{ color: "#aabaca", fontSize: 12 }}>Eligible research score / 100</div></div>
            <div><strong style={{ fontSize: 28 }}>{Number(row.confidence).toFixed(0)}</strong><div style={{ color: "#aabaca", fontSize: 12 }}>Evidence confidence / 100</div></div>
          </div>
          {row.signal_kind === "crypto-book-depth"
            ? <p style={{ color: "#d5e1eb", fontSize: 14 }}>
              Bid depth {amount(row.evidence.bid_depth_usd)} · Ask depth {amount(row.evidence.ask_depth_usd)}
              {" · "}Imbalance {String(row.evidence.imbalance_pct ?? "—")}%
            </p>
            : <p style={{ color: "#d5e1eb", fontSize: 14 }}>
              Largest sampled trade {amount(row.evidence.largest_print_usd)}
              {" · "}Median multiple {String(row.evidence.largest_to_median_ratio ?? "—")}×
            </p>}
          <p style={{ color: "#a7b6c5", fontSize: 12, lineHeight: 1.6 }}>
            {row.source_name} · Buyer identity unknown
            <br />Event {time(row.event_at)}
            <br />Observed {time(row.observed_at)}
          </p>
        </article>;
      })}
    </div>
    <footer style={{ color: "#9eafbe", marginTop: 32, maxWidth: 900, fontSize: 13, lineHeight: 1.65 }}>
      Visible limit and important caveat: crypto depth is a single-venue snapshot, not a record
      of executed purchases. Stock prints are sampled from IEX and do not identify the trade initiator.
      A large displayed order can disappear without trading. SEC institutional/insider filings and
      verified on-chain wallet behavior are planned separate research sources, not yet ingested here.
      Historical comparison must use each record&apos;s availability time to prevent look-ahead bias.
      Crypto scores are held at zero unless the two-sided liquidity, spread, level concentration,
      and separate-scan checks pass. Confirmed describes repeated displayed depth only — not
      confirmed purchases or predictive success. Old ungated scores remain visible as historical
      raw evidence, but no longer count as eligible.
    </footer>
  </main>;
}
