"use client";

import { FormEvent, useState } from "react";
import { createClient } from "@/lib/supabase";
import { card, colors, input, primaryButton, secondaryButton } from "@/lib/ui";

export default function AuthPanel() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [guestLoading, setGuestLoading] = useState(false);

  async function signIn(event: FormEvent) {
    event.preventDefault();
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setMessage(error?.message ?? "Signed in.");
  }

  async function signUp() {
    const supabase = createClient();
    const { error } = await supabase.auth.signUp({ email, password });
    setMessage(error?.message ?? "Account created. If email confirmation is enabled, confirm it before signing in.");
  }

  async function continueAsGuest() {
    setGuestLoading(true);
    setMessage("");
    const supabase = createClient();
    const { error } = await supabase.auth.signInAnonymously({ options: { data: { preview_mode: true } } });
    if (error) {
      setMessage(error.message.toLowerCase().includes("anonymous")
        ? "Guest mode is built, but Anonymous Sign-Ins still need to be enabled in this Supabase project."
        : error.message);
    }
    setGuestLoading(false);
  }

  return (
    <main style={{ maxWidth: 980, margin: "0 auto", padding: 28 }}>
      <div style={{ padding: "72px 0 38px" }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: 999, background: colors.purpleSoft, border: `1px solid ${colors.border}`, color: colors.purpleBright, fontWeight: 800, fontSize: 13 }}>
          CREATORHUB
        </div>
        <h1 style={{ fontSize: "clamp(44px,8vw,82px)", lineHeight: 0.95, letterSpacing: "-.045em", marginBottom: 20 }}>
          Open the app.<br /><span style={{ color: colors.purpleBright }}>Know what to do next.</span>
        </h1>
        <p style={{ fontSize: 20, color: colors.muted, maxWidth: 680, lineHeight: 1.55 }}>
          Learn what works, find growth and monetization opportunities, and turn them into simple actions you can approve.
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 14, alignItems: "start" }}>
        <section style={{ ...card }}>
          <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", color: colors.purpleBright }}>Fast preview</div>
          <h2 style={{ marginBottom: 8 }}>Skip account setup</h2>
          <p style={{ color: colors.muted, marginTop: 0, lineHeight: 1.5 }}>Create a temporary guest session and start testing CreatorHub immediately. No email required.</p>
          <button type="button" style={primaryButton} onClick={continueAsGuest} disabled={guestLoading}>{guestLoading ? "Starting guest session…" : "Continue as guest"}</button>
          <p style={{ color: colors.muted, fontSize: 13, marginBottom: 0 }}>Guest data stays tied to this browser session. Signing out or clearing browser data can make it inaccessible.</p>
        </section>

        <form onSubmit={signIn} style={{ ...card }}>
          <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", color: colors.muted }}>Account</div>
          <h2>Use a real account</h2>
          <input style={input} type="email" required placeholder="Email" value={email} onChange={(event) => setEmail(event.target.value)} />
          <input style={input} type="password" minLength={6} required placeholder="Password" value={password} onChange={(event) => setPassword(event.target.value)} />
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
            <button style={primaryButton}>Sign in</button>
            <button type="button" style={secondaryButton} onClick={signUp}>Create account</button>
          </div>
          {message && <p style={{ color: colors.muted }}>{message}</p>}
        </form>
      </div>
    </main>
  );
}
