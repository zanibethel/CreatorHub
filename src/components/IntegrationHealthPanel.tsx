"use client";

import { useEffect, useState } from "react";
import { card, colors } from "@/lib/ui";

type HealthItem = {
  configured?: boolean;
  reachable?: boolean;
  claudeAvailable?: boolean;
  chargesEnabled?: boolean;
  payoutsEnabled?: boolean;
  detail?: string;
};

type HealthResponse = {
  ok?: boolean;
  claude?: HealthItem;
  stripe?: HealthItem;
  checkedAt?: string;
};

function statusFor(item?: HealthItem, type?: "claude" | "stripe") {
  if (!item?.configured) return { label: "Needs setup", good: false };
  if (!item.reachable) return { label: "Error", good: false };
  if (type === "claude" && item.claudeAvailable === false) return { label: "Needs setup", good: false };
  return { label: "Connected", good: true };
}

export default function IntegrationHealthPanel() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState("");

  async function loadHealth() {
    try {
      setError("");
      const response = await fetch("/api/system/integration-health", { cache: "no-store" });
      if (!response.ok) throw new Error(`Health check returned ${response.status}.`);
      setHealth((await response.json()) as HealthResponse);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load integration health.");
    }
  }

  useEffect(() => { void loadHealth(); }, []);

  const items = [
    { id: "claude", name: "Claude", item: health?.claude, status: statusFor(health?.claude, "claude") },
    { id: "stripe", name: "Stripe", item: health?.stripe, status: statusFor(health?.stripe, "stripe") },
  ];

  return (
    <section style={{ ...card, marginTop: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "start", flexWrap: "wrap" }}>
        <div>
          <div style={{ color: colors.purpleBright, fontWeight: 800, fontSize: 12, textTransform: "uppercase", letterSpacing: ".08em" }}>System health</div>
          <h2 style={{ margin: "6px 0" }}>Core integrations</h2>
          <p style={{ color: colors.muted, marginTop: 0 }}>Live server-side checks. Secret keys are never sent to the browser.</p>
        </div>
        <button
          type="button"
          onClick={() => void loadHealth()}
          style={{ border: "1px solid #4a3565", background: "#21172f", color: "#f3e8ff", borderRadius: 10, padding: "9px 12px", fontWeight: 800, cursor: "pointer" }}
        >
          Refresh
        </button>
      </div>

      {error ? <p style={{ color: "#f8c7d4" }}>{error}</p> : null}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12 }}>
        {items.map(({ id, name, item, status }) => (
          <div key={id} style={{ border: "1px solid #4a3565", background: "rgba(13,10,21,.52)", borderRadius: 16, padding: 15 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
              <strong>{name}</strong>
              <span style={{ fontSize: 12, fontWeight: 900, borderRadius: 999, padding: "5px 9px", border: `1px solid ${status.good ? "#8b5cf6" : "#6b566f"}`, background: status.good ? "#53317c" : "#2a2235", color: "#f3e8ff" }}>{health ? status.label : "Checking…"}</span>
            </div>
            <p style={{ color: colors.muted, marginBottom: 0, lineHeight: 1.45 }}>{item?.detail ?? "Checking production configuration…"}</p>
          </div>
        ))}
      </div>

      {health?.checkedAt ? <div style={{ color: colors.muted, fontSize: 12, marginTop: 12 }}>Checked {new Date(health.checkedAt).toLocaleString()}</div> : null}
    </section>
  );
}
