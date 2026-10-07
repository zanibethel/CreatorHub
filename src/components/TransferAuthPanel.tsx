"use client";

import { FormEvent, useState } from "react";
import { card, colors, input, primaryButton, secondaryButton } from "@/lib/ui";

export default function TransferAuthPanel({ destination = "/upload" }: { destination?: "/upload" | "/download" }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function postAuth(path: string) {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, destination }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data?.error || "Authentication failed.");
    }

    return data as { ok?: boolean; session?: boolean; message?: string };
  }

  async function signIn(event: FormEvent) {
    event.preventDefault();
    if (busy) return;

    setBusy(true);
    setMessage("");

    try {
      await postAuth("/api/auth/login");
      window.location.assign(destination);
    } catch (error) {
      setBusy(false);
      setMessage(error instanceof Error ? error.message : "Sign in failed.");
    }
  }

  async function signUp() {
    if (busy) return;

    if (!email || password.length < 6) {
      setMessage("Enter an email and a password with at least 6 characters.");
      return;
    }

    setBusy(true);
    setMessage("");

    try {
      const data = await postAuth("/api/auth/signup");

      if (data.session) {
        window.location.assign(destination);
        return;
      }

      setBusy(false);
      setMessage(data.message || "Account created. Check your email if confirmation is required, then come back here and sign in.");
    } catch (error) {
      setBusy(false);
      setMessage(error instanceof Error ? error.message : "Account creation failed.");
    }
  }

  return (
    <main style={{ maxWidth: 620, margin: "0 auto", padding: 24 }}>
      <div style={{ padding: "54px 0 24px" }}>
        <div style={{ display: "inline-flex", padding: "7px 11px", borderRadius: 999, background: colors.purpleSoft, border: `1px solid ${colors.border}`, color: colors.purpleBright, fontWeight: 900, fontSize: 12, letterSpacing: ".08em" }}>
          FILE TRANSFER
        </div>
        <h1 style={{ fontSize: "clamp(38px,8vw,62px)", lineHeight: 1, marginBottom: 14 }}>
          Upload. Share. <span style={{ color: colors.purpleBright }}>Download.</span>
        </h1>
        <p style={{ color: colors.muted, lineHeight: 1.6, fontSize: 17 }}>
          A simple private file-transfer account. No CreatorHub testing tools or dashboards are shown on this account.
        </p>
      </div>

      <form onSubmit={signIn} style={card}>
        <div style={{ color: colors.purpleBright, fontWeight: 900, fontSize: 12, textTransform: "uppercase", letterSpacing: ".08em" }}>
          Sign in or create an account
        </div>
        <input style={input} type="email" required autoComplete="email" placeholder="Email" value={email} onChange={(event) => setEmail(event.target.value)} />
        <input style={input} type="password" required minLength={6} autoComplete="current-password" placeholder="Password" value={password} onChange={(event) => setPassword(event.target.value)} />
        <div style={{ display: "flex", gap: 9, flexWrap: "wrap", marginTop: 14 }}>
          <button disabled={busy} style={primaryButton}>{busy ? "Working…" : "Sign in"}</button>
          <button disabled={busy} type="button" style={secondaryButton} onClick={() => void signUp()}>Create account</button>
        </div>
        {message ? <p style={{ color: colors.muted, lineHeight: 1.5 }}>{message}</p> : null}
      </form>
    </main>
  );
}
