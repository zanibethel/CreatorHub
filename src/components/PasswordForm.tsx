"use client";

import { FormEvent, useState } from "react";
import { card, colors, input, primaryButton } from "@/lib/ui";

export default function PasswordForm() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;

    if (password.length < 6) {
      setMessage("Use at least 6 characters.");
      return;
    }

    if (password !== confirm) {
      setMessage("The passwords do not match.");
      return;
    }

    setBusy(true);
    setMessage("");

    const response = await fetch("/api/auth/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      setBusy(false);
      setMessage(data?.error || "Could not update the password.");
      return;
    }

    setPassword("");
    setConfirm("");
    setBusy(false);
    setMessage("Password updated. You can use it to sign in on the other device now.");
  }

  return (
    <form onSubmit={submit} style={{ ...card, marginTop: 18 }}>
      <div style={{ color: colors.purpleBright, fontWeight: 900, fontSize: 12, textTransform: "uppercase", letterSpacing: ".08em" }}>
        Account password
      </div>
      <h2 style={{ marginBottom: 8 }}>Set a new password</h2>
      <p style={{ color: colors.muted, marginTop: 0, lineHeight: 1.5 }}>
        This changes the password for this signed-in File Transfer account. Use the new password on your other device.
      </p>
      <input
        style={input}
        type="password"
        minLength={6}
        required
        autoComplete="new-password"
        placeholder="New password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />
      <input
        style={input}
        type="password"
        minLength={6}
        required
        autoComplete="new-password"
        placeholder="Confirm new password"
        value={confirm}
        onChange={(event) => setConfirm(event.target.value)}
      />
      <button disabled={busy} style={{ ...primaryButton, marginTop: 14 }}>
        {busy ? "Updating…" : "Update password"}
      </button>
      {message ? <p style={{ color: colors.muted, lineHeight: 1.5 }}>{message}</p> : null}
    </form>
  );
}
