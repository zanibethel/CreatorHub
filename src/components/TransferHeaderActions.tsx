"use client";

import Link from "next/link";
import { secondaryButton } from "@/lib/ui";

export default function TransferHeaderActions({ fullAccess }: { fullAccess: boolean }) {
  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.assign("/upload");
  }

  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <Link href="/upload" style={{ ...secondaryButton, display: "inline-flex", textDecoration: "none" }}>Upload</Link>
      <Link href="/download" style={{ ...secondaryButton, display: "inline-flex", textDecoration: "none" }}>Downloads</Link>
      <Link href="/password" style={{ ...secondaryButton, display: "inline-flex", textDecoration: "none" }}>Password</Link>
      {fullAccess ? (
        <Link href="/" style={{ ...secondaryButton, display: "inline-flex", textDecoration: "none" }}>CreatorHub</Link>
      ) : null}
      <button type="button" style={secondaryButton} onClick={() => void signOut()}>Sign out</button>
    </div>
  );
}
