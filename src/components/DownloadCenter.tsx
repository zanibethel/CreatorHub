"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase";
import { card, colors, primaryButton, secondaryButton } from "@/lib/ui";

type UploadRow = {
  id: string;
  original_name: string;
  mime_type: string | null;
  size_bytes: number;
  share_token: string;
  share_enabled: boolean;
  created_at: string;
};

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

export default function DownloadCenter({ userId }: { userId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [uploads, setUploads] = useState<UploadRow[]>([]);
  const [message, setMessage] = useState("");

  const loadUploads = useCallback(async () => {
    const { data, error } = await supabase
      .from("creator_uploads")
      .select("id,original_name,mime_type,size_bytes,share_token,share_enabled,created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      setMessage(error.message);
      return;
    }
    setUploads((data ?? []) as UploadRow[]);
  }, [supabase, userId]);

  useEffect(() => {
    void loadUploads();
  }, [loadUploads]);

  function linksFor(token: string) {
    const origin = typeof window === "undefined" ? "" : window.location.origin;
    return {
      access: `${origin}/api/files/${token}/open`,
      download: `${origin}/api/files/${token}/download`,
    };
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setMessage("Download link copied.");
    } catch {
      setMessage("Copy failed. Press and hold the link to copy it.");
    }
  }

  return (
    <section style={{ marginTop: 18 }}>
      <div style={{ color: colors.purpleBright, fontWeight: 900, fontSize: 12, textTransform: "uppercase", letterSpacing: ".08em" }}>
        Your files
      </div>
      <h2 style={{ marginTop: 6 }}>Download or share</h2>
      {message ? <div style={{ ...card, padding: 12, color: colors.muted, marginBottom: 10 }}>{message}</div> : null}

      <div style={{ display: "grid", gap: 10 }}>
        {uploads.map((item) => {
          const links = linksFor(item.share_token);
          return (
            <article key={item.id} style={card}>
              <strong style={{ display: "block", overflowWrap: "anywhere" }}>{item.original_name}</strong>
              <div style={{ color: colors.muted, fontSize: 12, marginTop: 4 }}>
                {formatBytes(Number(item.size_bytes))} · {new Date(item.created_at).toLocaleString()}
              </div>

              {item.share_enabled ? (
                <>
                  <a href={links.download} style={{ color: colors.purpleBright, overflowWrap: "anywhere", display: "block", marginTop: 12, fontSize: 13 }}>
                    {links.download}
                  </a>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                    <a href={links.download} style={{ ...primaryButton, display: "inline-flex", textDecoration: "none" }}>Download</a>
                    <button type="button" style={secondaryButton} onClick={() => void copy(links.download)}>Copy download link</button>
                    <a href={links.access} target="_blank" rel="noreferrer" style={{ ...secondaryButton, display: "inline-flex", textDecoration: "none" }}>Open</a>
                  </div>
                </>
              ) : (
                <div style={{ color: colors.muted, marginTop: 10 }}>Sharing is disabled for this file.</div>
              )}
            </article>
          );
        })}

        {uploads.length === 0 ? (
          <div style={{ ...card, color: colors.muted }}>
            No files yet. <a href="/upload" style={{ color: colors.purpleBright }}>Upload your first file.</a>
          </div>
        ) : null}
      </div>
    </section>
  );
}
