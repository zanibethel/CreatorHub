"use client";

import { FormEvent, useState } from "react";
import { createClient } from "@/lib/supabase";
import { card, input, primaryButton, secondaryButton } from "@/lib/ui";

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
    const { error } = await supabase.auth.signInAnonymously({
      options: {
        data: {
          preview_mode: true,
        },
      },
    });
    if (error) {
      setMessage(
        error.message.toLowerCase().includes("anonymous")
          ? "Guest mode is built, but Anonymous Sign-Ins still need to be enabled in this Supabase project."
          : error.message,
      );
    }
    setGuestLoading(false);
  }

  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: 28 }}>
      <div style={{ padding: "70px 0 35px" }}>
        <strong style={{ fontSize: 22 }}>CreatorHub</strong>
        <h1 style={{ fontSize: "clamp(42px,8vw,78px)", lineHeight: 0.98 }}>
          Open the app.<br />Know what to do next.
        </h1>
        <p style={{ fontSize: 20, color: "#59606b", maxWidth: 680 }}>
          Learn what works, find growth and monetization opportunities, and turn them into simple actions.
        </p>
      </div>

      <section style={{ ...card, maxWidth: 500, marginBottom: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", color: "#6b7280" }}>
          Fast preview
        </div>
        <h2 style={{ marginBottom: 8 }}>Skip account setup</h2>
        <p style={{ color: "#59606b", marginTop: 0 }}>
          Create a temporary guest session and start testing CreatorHub immediately. No email required.
        </p>
        <button type="button" style={primaryButton} onClick={continueAsGuest} disabled={guestLoading}>
          {guestLoading ? "Starting guest session…" : "Continue as guest"}
        </button>
        <p style={{ color: "#6b7280", fontSize: 13, marginBottom: 0 }}>
          Guest data stays tied to this browser session. Signing out or clearing browser data can make it inaccessible.
        </p>
      </section>

      <form onSubmit={signIn} style={{ ...card, maxWidth: 500 }}>
        <h2>Or use a real account</h2>
        <input style={input} type="email" required placeholder="Email" value={email} onChange={(event) => setEmail(event.target.value)} />
        <input style={input} type="password" minLength={6} required placeholder="Password" value={password} onChange={(event) => setPassword(event.target.value)} />
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
          <button style={primaryButton}>Sign in</button>
          <button type="button" style={secondaryButton} onClick={signUp}>Create account</button>
        </div>
        {message && <p>{message}</p>}
      </form>
    </main>
  );
}
