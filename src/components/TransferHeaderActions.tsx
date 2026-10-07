"use client";

import { secondaryButton } from "@/lib/ui";

export default function TransferHeaderActions({ fullAccess }: { fullAccess: boolean }) {
  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.assign("/upload");
  }

  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <a href="/upload" style={{ ...secondaryButton, display: "inline-flex", textDecoration: "none" }}>Upload</a>
      <a href="/download" style={{ ...secondaryButton, display: "inline-flex", textDecoration: "none" }}>Downloads</a>
      {fullAccess ? (
        <a href="/" style={{ ...secondaryButton, display: "inline-flex", textDecoration: "none" }}>CreatorHub</a>
      ) : null}
      <button type="button" style={secondaryButton} onClick={() => void signOut()}>Sign out</button>
    </div>
  );
}
