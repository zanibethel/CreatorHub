"use client";

import { useState } from "react";
import { primaryButton } from "@/lib/ui";

export default function ProductBuyButton({ slug, label }: { slug: string; label: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function startCheckout() {
    setBusy(true);
    setError("");
    const response = await fetch("/api/checkout/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug }),
    });
    const data = await response.json();
    if (!response.ok || !data.url) {
      setBusy(false);
      setError(data.error ?? "Could not start checkout.");
      return;
    }
    window.location.href = data.url;
  }

  return (
    <div>
      <button onClick={startCheckout} disabled={busy} style={{ ...primaryButton, width: "100%", fontSize: 16, padding: "14px 18px" }}>
        {busy ? "Opening secure checkout…" : label}
      </button>
      {error && <p style={{ marginBottom: 0, fontSize: 13, opacity: .75 }}>{error}</p>}
    </div>
  );
}
