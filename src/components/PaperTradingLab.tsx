"use client";

import Link from "next/link";
import { useState } from "react";
import { card, colors, secondaryButton } from "@/lib/ui";

type Pool = { id: string; name: string; horizon: string; allocation: number; note?: string };

const INITIAL_CASH = 1000;
const POOLS: Pool[] = [
  { id: "day", name: "Day trades", horizon: "Same session", allocation: 20 },
  { id: "multi-day", name: "Multi-day swings", horizon: "Several days", allocation: 40 },
  { id: "multi-week", name: "Multi-week swings", horizon: "Several weeks", allocation: 40 },
  { id: "inverse", name: "Inverse ETF sleeve", horizon: "Daily reset monitoring", allocation: 0, note: "Allocation not set" },
];

const money = (value: number) => new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", maximumFractionDigits: 2,
}).format(value);

export default function PaperTradingLab() {
  const [activeTab, setActiveTab] = useState<"overview" | "rules">("overview");
  const pools = POOLS.map((pool) => ({
    ...pool,
    budget: INITIAL_CASH * pool.allocation / 100,
    tradeCap: INITIAL_CASH * pool.allocation / 100 * 0.09,
  }));

  return (
    <main style={{ maxWidth: 1180, margin: "0 auto", padding: "24px 18px 52px" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 22 }}>
        <div>
          <Link href="/" style={{ color: colors.muted, textDecoration: "none", fontSize: 13 }}>← CreatorHub</Link>
          <h1 style={{ margin: "10px 0 5px", fontSize: "clamp(30px,5vw,44px)", letterSpacing: "-.04em" }}>Paper Trading Lab</h1>
          <div style={{ color: colors.muted }}>Portfolio report and rule-based trade simulation</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
          <span style={{ border: "1px solid #855c23", color: "#f4c67b", background: "#241b12", borderRadius: 999, padding: "8px 12px", fontWeight: 800, fontSize: 12 }}>
            PAPER ONLY
          </span>
          <button type="button" disabled style={{ ...secondaryButton, opacity: 0.55, cursor: "not-allowed" }} title="Live market data is not connected yet">Refresh report</button>
        </div>
      </header>

      <section style={{ ...card, borderColor: "#7256a6", marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <div>
            <div style={{ color: colors.purpleBright, fontWeight: 900, letterSpacing: ".08em", textTransform: "uppercase", fontSize: 11 }}>Data connection required</div>
            <p style={{ margin: "7px 0 0", color: colors.text, lineHeight: 1.55 }}>
              This preview has no live quotes, order book, or connected portfolio. It has not generated signals or simulated orders.
            </p>
          </div>
          <div style={{ color: colors.muted, fontSize: 13 }}>Last market check: <strong style={{ color: colors.text }}>Not connected</strong></div>
        </div>
      </section>

      <nav aria-label="Paper trading views" style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        {([ ["overview", "Overview"], ["rules", "Strategy rules"] ] as const).map(([id, label]) => (
          <button key={id} type="button" onClick={() => setActiveTab(id)} aria-pressed={activeTab === id}
            style={{ ...secondaryButton, borderColor: activeTab === id ? colors.purpleBright : colors.border, background: activeTab === id ? colors.purpleSoft : "transparent" }}>
            {label}
          </button>
        ))}
      </nav>

      {activeTab === "overview" ? (
        <>
          <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10, marginBottom: 14 }}>
            {[
              ["Virtual starting balance", money(INITIAL_CASH)],
              ["Available to simulate", money(INITIAL_CASH)],
              ["Open paper positions", "0"],
              ["Return", "—"],
            ].map(([label, value]) => (
              <div key={label} style={{ ...card, padding: 15 }}>
                <div style={{ color: colors.muted, fontSize: 12 }}>{label}</div>
                <div style={{ fontWeight: 900, fontSize: 24, marginTop: 6 }}>{value}</div>
              </div>
            ))}
          </section>

          <section style={{ ...card, marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "baseline", marginBottom: 14 }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 20 }}>Capital pools</h2>
                <p style={{ margin: "5px 0 0", color: colors.muted, fontSize: 13 }}>Virtual budgets use the $1,000 test balance. Maximum position is 9% of each pool.</p>
              </div>
              <span style={{ color: colors.muted, fontSize: 12 }}>Current allocation: {pools.reduce((sum, pool) => sum + pool.allocation, 0)}%</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(205px,1fr))", gap: 9 }}>
              {pools.map((pool) => (
                <article key={pool.id} style={{ border: `1px solid ${colors.border}`, background: "rgba(7,5,11,.35)", borderRadius: 14, padding: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "start" }}>
                    <strong>{pool.name}</strong>
                    <span style={{ color: colors.purpleBright, fontWeight: 900 }}>{pool.allocation}%</span>
                  </div>
                  <div style={{ color: colors.muted, fontSize: 12, marginTop: 4 }}>{pool.horizon}</div>
                  <div style={{ marginTop: 13, fontSize: 21, fontWeight: 900 }}>{money(pool.budget)}</div>
                  <div style={{ color: colors.muted, fontSize: 12, marginTop: 3 }}>Per-trade cap: {money(pool.tradeCap)}</div>
                  {pool.note ? <div style={{ color: "#f4c67b", fontSize: 11, marginTop: 8 }}>{pool.note}; percentage must be assigned before simulation.</div> : null}
                </article>
              ))}
            </div>
            <p style={{ color: colors.muted, fontSize: 12, lineHeight: 1.5, margin: "12px 0 0" }}>
              Crypto assets can compete for room in any pool; they do not receive a separate allocation. The inverse ETF sleeve is currently unallocated, so the shown 20/40/40 split remains the full 100% allocation until revised.
            </p>
          </section>

          <section style={{ ...card, marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
              <h2 style={{ margin: 0, fontSize: 20 }}>Signals and simulated orders</h2>
              <span style={{ color: colors.muted, fontSize: 12 }}>No market feed connected</span>
            </div>
            <div style={{ marginTop: 12, border: `1px dashed ${colors.border}`, borderRadius: 13, padding: "22px 14px", color: colors.muted, textAlign: "center", lineHeight: 1.6 }}>
              When a data source is configured, this area will show qualified entry alerts, their evidence score, limit-order status, and simulated exits. No trades will be recorded from this preview.
            </div>
          </section>

          <section style={{ ...card, marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 20 }}>Open orders and positions</h2>
                <p style={{ margin: "5px 0 0", color: colors.muted, fontSize: 13 }}>
                  Current simulator state at the latest report update. Pending and partial entries stay distinct from filled positions.
                </p>
              </div>
              <span style={{ color: colors.muted, fontSize: 12 }}>No order ledger connected</span>
            </div>
            <div style={{ overflowX: "auto", marginTop: 13 }}>
              <table style={{ width: "100%", minWidth: 760, borderCollapse: "collapse", textAlign: "left", fontSize: 12 }}>
                <thead>
                  <tr style={{ color: colors.muted }}>
                    {["Placed", "Asset", "Pool", "Status", "Limit / average fill", "Filled / requested", "Stop / target"].map((heading) => (
                      <th key={heading} scope="col" style={{ padding: "9px 8px", borderBottom: `1px solid ${colors.border}`, fontWeight: 700 }}>{heading}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr><td colSpan={7} style={{ padding: "20px 8px", color: colors.muted, textAlign: "center", lineHeight: 1.6 }}>
                    No open orders or positions yet. Once paper simulation is connected, this list will include pending, partially filled, and filled positions with their linked exit levels.
                  </td></tr>
                </tbody>
              </table>
            </div>
          </section>

          <section style={{ ...card, marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 20 }}>Previous trades</h2>
                <p style={{ margin: "5px 0 0", color: colors.muted, fontSize: 13 }}>
                  Closed paper trades, with realized result and the reason the strategy entered and exited.
                </p>
              </div>
              <span style={{ color: colors.muted, fontSize: 12 }}>No trade history connected</span>
            </div>
            <div style={{ overflowX: "auto", marginTop: 13 }}>
              <table style={{ width: "100%", minWidth: 760, borderCollapse: "collapse", textAlign: "left", fontSize: 12 }}>
                <thead>
                  <tr style={{ color: colors.muted }}>
                    {["Closed", "Asset", "Pool", "Side", "Entry → exit", "Net P/L", "Signal / exit reason"].map((heading) => (
                      <th key={heading} scope="col" style={{ padding: "9px 8px", borderBottom: `1px solid ${colors.border}`, fontWeight: 700 }}>{heading}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr><td colSpan={7} style={{ padding: "20px 8px", color: colors.muted, textAlign: "center", lineHeight: 1.6 }}>
                    No completed trades yet. Closed trades will appear here with timestamps, entry and exit prices, costs, net profit or loss, and the recorded signal rationale.
                  </td></tr>
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : (
        <section style={{ ...card }}>
          <h2 style={{ margin: "0 0 12px", fontSize: 20 }}>Entry and exit gates</h2>
          <div style={{ display: "grid", gap: 9 }}>
            {[
              ["Setup evidence", "Price and volume conditions, volatility, related assets, and timestamped news update a calibrated score. Evidence can raise or lower it."],
              ["Order-book check", "Spread, depth, persistent displayed liquidity, and executed trades may confirm or reject an entry when a supported feed is available."],
              ["Limit entry", "A paper limit order is created only after setup, risk, and book gates pass. It expires or is reassessed if it does not fill."],
              ["Linked exits", "Only after a simulated fill, attach the configured stop and profit target. Simulated fills include spread and slippage assumptions."],
              ["Hard limits", "At most 9% of the assigned pool per trade, with a separate maximum-loss budget and a portfolio-wide exposure limit."],
            ].map(([title, description]) => (
              <div key={title} style={{ borderLeft: `3px solid ${colors.purple}`, padding: "4px 0 4px 12px" }}>
                <strong>{title}</strong><div style={{ color: colors.muted, fontSize: 13, lineHeight: 1.55, marginTop: 3 }}>{description}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      <footer style={{ color: colors.muted, fontSize: 11, marginTop: 14, lineHeight: 1.5 }}>
        Simulation preview only. No broker credentials are requested and no real orders are placed. Market data and hourly refresh are not configured.
      </footer>
    </main>
  );
}
