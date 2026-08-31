"use client";

import { useEffect, useState } from "react";
import { card, colors, primaryButton } from "@/lib/ui";

export default function ProductSuccess({ sessionId }: { sessionId: string }) {
  const [state, setState] = useState<{ loading: boolean; error?: string; title?: string; downloadUrl?: string }>({ loading: true });

  useEffect(() => {
    if (!sessionId) {
      setState({ loading: false, error: "Missing checkout session." });
      return;
    }
    void fetch(`/api/checkout/verify?session_id=${encodeURIComponent(sessionId)}`, { cache: "no-store" })
      .then(async (response) => ({ ok: response.ok, data: await response.json() }))
      .then(({ ok, data }) => setState(ok ? { loading: false, title: data.title, downloadUrl: data.downloadUrl } : { loading: false, error: data.error ?? "Could not verify payment." }))
      .catch(() => setState({ loading: false, error: "Could not verify payment." }));
  }, [sessionId]);

  return (
    <section style={{ ...card, padding: 28 }}>
      {state.loading && <><h1>Confirming your purchase…</h1><p style={{ color: colors.muted }}>CreatorHub is verifying the Stripe payment and preparing your secure download.</p></>}
      {!state.loading && state.error && <><h1>Purchase needs attention</h1><p style={{ color: colors.muted }}>{state.error}</p></>}
      {!state.loading && state.downloadUrl && <>
        <div style={{ color: colors.purpleBright, fontWeight: 800, fontSize: 12, textTransform: "uppercase", letterSpacing: ".08em" }}>Payment confirmed</div>
        <h1>{state.title}</h1>
        <p style={{ color: colors.muted }}>Your secure download is ready. This link expires in 15 minutes; revisit this purchase confirmation page to generate a fresh one.</p>
        <a href={state.downloadUrl} style={{ ...primaryButton, display: "inline-block", textDecoration: "none", marginTop: 8 }}>Download ebook</a>
      </>}
    </section>
  );
}
