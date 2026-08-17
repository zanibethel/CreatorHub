"use client";

import { FormEvent, useState } from "react";
import { createClient } from "@/lib/supabase";
import { card, input, primaryButton } from "@/lib/ui";

export default function AuthPanel() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    });
    setMessage(error?.message ?? "Check your email for your sign-in link.");
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
      <form onSubmit={submit} style={{ ...card, maxWidth: 500 }}>
        <h2>Start testing</h2>
        <input
          style={input}
          type="email"
          required
          placeholder="Email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <button style={{ ...primaryButton, marginTop: 12 }}>Email sign-in link</button>
        {message && <p>{message}</p>}
      </form>
    </main>
  );
}
