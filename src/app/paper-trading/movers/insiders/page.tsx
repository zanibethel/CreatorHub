"use client";

import { useEffect, useState } from "react";

type Transaction = {
  issuer_ticker: string; issuer_name: string;
  owner_name: string; owner_role: string;
  filing_date: string; filing_accepted_at_raw: string | null;
  observed_at: string; transaction_date: string;
  classification: "reported_purchase" | "reported_sale" | "other_reported_transaction";
  transaction_code: string; acquire_dispose: string;
  shares: number; price_per_share: number | null; reported_notional_usd: number | null;
  ownership_form: string | null; plan_10b5_1: boolean | null; source_url: string;
};
type Scan = {
  collected_at: string; status: string; symbols_checked: number;
  filings_checked: number; rows_saved_or_deduplicated: number; source_failures: string[];
};
type Report = { transactions: Transaction[]; scanRuns: Scan[] };

const money = (v: number | null) => v === null ? "Not reported"
  : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(v));
const time = (v: string) => new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Chicago", month: "short", day: "numeric", year: "numeric",
  hour: "numeric", minute: "2-digit",
}).format(new Date(v));

export default function MidasInsiderResearchPage() {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/paper-trading/market-movers/insiders", {
      signal: controller.signal, cache: "no-store",
    }).then(async response => {
      if (!response.ok) throw new Error("Midas research source unavailable");
      return response.json() as Promise<Report>;
    }).then(data => { if (!controller.signal.aborted) setReport(data); })
      .catch(() => { if (!controller.signal.aborted) setError("SEC research feed is temporarily unavailable"); });
    return () => controller.abort();
  }, []);

  return <main style={{
    background: "#090d12", color: "#e7eff7", minHeight: "100vh",
    padding: "32px clamp(16px, 5vw, 64px)", fontFamily: "system-ui, sans-serif",
  }}>
    <nav style={{ display: "flex", gap: 20, flexWrap: "wrap", marginBottom: 20 }}>
      <a href="/paper-trading/movers" style={{ color: "#93d8ff" }}>← Midas</a>
      <a href="/paper-trading/historical-patterns" style={{ color: "#93d8ff" }}>Historical Pattern Lab</a>
    </nav>
    <h1 style={{ fontSize: "clamp(26px,4vw,40px)", marginBottom: 6 }}>Midas · SEC Insider Research</h1>
    <p style={{ color: "#b6c8d9", maxWidth: 860, lineHeight: 1.65 }}>
      Publicly reported changes in insider ownership, observed by Midas after filing.
      A reported purchase may be a private transaction rather than stock bought on an exchange.
      Grants, exercises, and tax-withholding are never counted as open-market buying.
      This evidence has <strong>no trading authority or proven predictive score.</strong>
    </p>
    {error && <p role="alert" style={{ color: "#ffb5b5" }}>{error}</p>}
    {!report && !error && <p style={{ color: "#99b4c7" }}>Loading evidence…</p>}
    {report && <section style={{
      border: "1px solid #314355", borderRadius: 12, background: "#141e29", padding: 18, margin: "22px 0",
    }}>
      <h2 style={{ marginTop: 0, fontSize: 17 }}>SEC collection status</h2>
      {report.scanRuns.length ? <>
        <p style={{ color: "#c4d4e0" }}>
          Latest run: {time(report.scanRuns[0].collected_at)} · {report.scanRuns[0].status}
          {" · "}{report.scanRuns[0].symbols_checked} companies checked
          {" · "}{report.scanRuns[0].filings_checked} filings inspected
        </p>
        {report.scanRuns[0].source_failures?.length > 0 && <p style={{ color: "#ffc3a5", fontSize: 13 }}>
          Source limitations: {report.scanRuns[0].source_failures.slice(0, 3).join(" · ")}
        </p>}
      </> : <p style={{ color: "#ffcca8" }}>
        No SEC ingestion run verified yet. Research collection requires configured SEC contact identification
        and a successful public-source scan; no purchases should be inferred from an empty feed.
      </p>}
    </section>}
    {report && <p style={{ color: "#adbecd" }}>
      {report.transactions.length} most recently ingested transaction rows · Public Form 4 Table I
    </p>}
    {report && report.transactions.length === 0 && <p style={{ color: "#b5c6d5" }}>
      No SEC transactions ingested yet. This is not evidence that insiders made no purchases or sales.
    </p>}
    <div style={{ display: "grid", gap: 12 }}>
      {report?.transactions.map((entry, index) => {
        const buy = entry.classification === "reported_purchase";
        const sell = entry.classification === "reported_sale";
        const label = buy ? "Reported purchase (P)" : sell ? "Reported sale (S)"
          : `Other reported transaction (${entry.transaction_code})`;
        return <article key={`${entry.source_url}:${index}`} style={{
          padding: 18, borderRadius: 12, border: "1px solid #293a4a", background: "#131b25",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <strong style={{ fontSize: 19 }}>{entry.issuer_ticker} · {entry.owner_name}</strong>
            <span style={{ color: buy ? "#62ddb1" : sell ? "#ff9b9b" : "#b9cbd9" }}>{label}</span>
          </div>
          <p style={{ color: "#adbfce", fontSize: 13 }}>{entry.owner_role || "Role unreported"} · {entry.issuer_name}</p>
          <p style={{ margin: "10px 0" }}>
            <strong>{new Intl.NumberFormat("en-US").format(Number(entry.shares))} shares</strong>
            {" · "}Reported price {entry.price_per_share === null ? "not specified"
              : money(entry.price_per_share)}
            {" · "}Notional {money(entry.reported_notional_usd)}
          </p>
          <p style={{ color: "#aebdcc", fontSize: 12, lineHeight: 1.7 }}>
            Transaction: {entry.transaction_date} · Filed: {entry.filing_date}
            <br />First observed by Midas: {time(entry.observed_at)}
            <br />Ownership: {entry.ownership_form === "D" ? "Direct"
              : entry.ownership_form === "I" ? "Indirect" : "Not specified"}
            {" · "}10b5-1 plan flag: {entry.plan_10b5_1 === null ? "Not reported"
              : entry.plan_10b5_1 ? "Yes" : "No"}
          </p>
          <a href={entry.source_url} target="_blank" rel="noopener noreferrer" style={{ color: "#93d8ff" }}>
            Inspect original SEC filing ↗
          </a>
        </article>;
      })}
    </div>
    <p style={{ maxWidth: 850, marginTop: 28, color: "#96abbd", fontSize: 13, lineHeight: 1.7 }}>
      Source scope: only selected companies and the latest two eligible unamended Form 4 filings
      per collection run. Multi-owner filings and derivative transactions are omitted in v1 to
      avoid unsupported individual attribution. An SEC filing can be published days after a transaction,
      so research features must respect the first observed timestamp. This is not comprehensive insider coverage.
    </p>
  </main>;
}
