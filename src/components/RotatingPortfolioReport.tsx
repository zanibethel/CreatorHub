"use client";

import { useEffect, useState } from "react";
import { card, colors, secondaryButton } from "@/lib/ui";
import MarketDataPanel from "@/components/MarketDataPanel";

type ReportSlide = "watchlist" | "activity" | "growth" | "targets";

const SLIDES: Array<[ReportSlide, string]> = [
  ["watchlist", "Watchlist"],
  ["activity", "Orders & trades"],
  ["growth", "Portfolio growth"],
  ["targets", "Upcoming targets"],
];

const emptyText = {
  border: "1px dashed " + colors.border,
  borderRadius: 13,
  padding: "20px 14px",
  color: colors.muted,
  textAlign: "center" as const,
  lineHeight: 1.6,
};

function EmptyActivityTable({ title, columns, message }: { title: string; columns: string[]; message: string }) {
  return (
    <section style={{ ...card, marginBottom: 12 }}>
      <h3 style={{ margin: 0, fontSize: 16 }}>{title}</h3>
      <div style={{ overflowX: "auto", marginTop: 10 }}>
        <table style={{ width: "100%", minWidth: 650, borderCollapse: "collapse", textAlign: "left", fontSize: 12 }}>
          <thead><tr style={{ color: colors.muted }}>
            {columns.map((column) => <th key={column} scope="col" style={{ padding: "8px", borderBottom: "1px solid " + colors.border }}>{column}</th>)}
          </tr></thead>
          <tbody><tr><td colSpan={columns.length} style={{ padding: "18px 8px", color: colors.muted, textAlign: "center" }}>{message}</td></tr></tbody>
        </table>
      </div>
    </section>
  );
}

export default function RotatingPortfolioReport() {
  const [active, setActive] = useState<ReportSlide>("watchlist");
  const [rotating, setRotating] = useState(true);

  useEffect(() => {
    if (!rotating) return;
    const timer = window.setInterval(() => {
      setActive((current) => {
        const index = SLIDES.findIndex(([id]) => id === current);
        return SLIDES[(index + 1) % SLIDES.length][0];
      });
    }, 12000);
    return () => window.clearInterval(timer);
  }, [rotating]);

  function selectSlide(slide: ReportSlide) {
    setActive(slide);
    setRotating(false);
  }

  function move(direction: -1 | 1) {
    setActive((current) => {
      const index = SLIDES.findIndex(([id]) => id === current);
      return SLIDES[(index + direction + SLIDES.length) % SLIDES.length][0];
    });
    setRotating(false);
  }

  return (
    <section aria-label="Rotating paper trading report" style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 9 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20 }}>Rotating report</h2>
          <p style={{ margin: "4px 0 0", color: colors.muted, fontSize: 12 }}>
            Switch views any time. Auto-rotation pauses when you choose a view.
          </p>
        </div>
        <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
          <button type="button" onClick={() => move(-1)} style={secondaryButton} aria-label="Previous report">← Previous</button>
          <button type="button" onClick={() => setRotating((value) => !value)} style={secondaryButton} aria-pressed={rotating}>
            {rotating ? "Pause rotation" : "Resume rotation"}
          </button>
          <button type="button" onClick={() => move(1)} style={secondaryButton} aria-label="Next report">Next →</button>
        </div>
      </div>

      <nav aria-label="Report sections" style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 10 }}>
        {SLIDES.map(([id, label]) => (
          <button key={id} type="button" onClick={() => selectSlide(id)} aria-pressed={active === id}
            style={{ ...secondaryButton, borderColor: active === id ? colors.purpleBright : colors.border, background: active === id ? colors.purpleSoft : "transparent", padding: "7px 10px", fontSize: 12 }}>
            {label}
          </button>
        ))}
      </nav>

      <div aria-live="polite">
        {SLIDES.map(([id, label]) => (
          <div key={id} hidden={active !== id} aria-label={label}>
            {id === "watchlist" ? <MarketDataPanel /> : null}
            {id === "activity" ? (
              <div>
                <EmptyActivityTable title="Order history" columns={["Time", "Asset", "Action", "Pool", "Status", "Simulated fill"]} message="No paper orders recorded yet. Pending, partial, filled, canceled, and exited orders will appear here." />
                <EmptyActivityTable title="Completed trades" columns={["Closed", "Asset", "Pool", "Entry → exit", "Net P/L", "Reason"]} message="No completed trades recorded yet." />
              </div>
            ) : null}
            {id === "growth" ? (
              <section style={{ ...card }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "baseline" }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: 17 }}>Portfolio growth</h3>
                    <p style={{ margin: "5px 0 0", color: colors.muted, fontSize: 12 }}>Daily account value after simulated fills, costs, and exits.</p>
                  </div>
                  <span style={{ color: colors.muted, fontSize: 12 }}>Starting test cash: $100</span>
                </div>
                <div role="img" aria-label="Portfolio growth chart is empty until the simulator saves portfolio snapshots" style={{ ...emptyText, marginTop: 12, minHeight: 190, display: "grid", placeItems: "center", backgroundImage: "linear-gradient(to right, transparent 24.8%, " + colors.border + " 25%, transparent 25.2%), linear-gradient(to bottom, transparent 24.8%, " + colors.border + " 25%, transparent 25.2%)", backgroundSize: "100% 100%" }}>
                  No portfolio history yet. The growth line will begin at $100 when the simulator records its first account snapshot.
                </div>
              </section>
            ) : null}
            {id === "targets" ? (
              <div>
                <section style={{ ...card, marginBottom: 12 }}>
                  <h3 style={{ margin: 0, fontSize: 17 }}>Upcoming entries and exits</h3>
                  <p style={{ margin: "5px 0 0", color: colors.muted, fontSize: 12 }}>
                    Pending simulated limit entries and attached target/stop exits for open positions.
                  </p>
                  <div style={{ ...emptyText, marginTop: 12 }}>No target orders or planned sells yet. A signal must pass the setup, market-data, and risk checks before appearing here.</div>
                </section>
                <EmptyActivityTable title="Next order levels" columns={["Asset", "Pool", "Action", "Trigger price", "Expires / review"]} message="Target levels will appear after the strategy creates a qualified paper order." />
              </div>
            ) : null}
          </div>
        ))}
      </div>
      <div style={{ color: colors.muted, textAlign: "right", fontSize: 11, marginTop: 5 }}>
        {SLIDES.findIndex(([id]) => id === active) + 1} / {SLIDES.length} · {rotating ? "Rotates every 12 seconds" : "Paused"}
      </div>
    </section>
  );
}
