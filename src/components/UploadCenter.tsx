"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase";
import { card, colors, input, primaryButton, secondaryButton } from "@/lib/ui";

type UploadRow = {
  id: string;
  original_name: string;
  mime_type: string | null;
  size_bytes: number;
  share_token: string;
  share_enabled: boolean;
  created_at: string;
};

const MAX_FILE_BYTES = 250 * 1024 * 1024;

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function safeFileName(name: string) {
  const cleaned = name.trim().replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-");
  return cleaned.slice(0, 160) || "upload";
}

export default function UploadCenter({ userId }: { userId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [uploads, setUploads] = useState<UploadRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const loadUploads = useCallback(async () => {
    const { data, error } = await supabase
      .from("creator_uploads")
      .select("id,original_name,mime_type,size_bytes,share_token,share_enabled,created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(20);

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

  async function copyLink(url: string, label: string) {
    try {
      await navigator.clipboard.writeText(url);
      setMessage(`${label} link copied.`);
    } catch {
      setMessage("Copy failed. Press and hold the link to copy it.");
    }
  }

  async function uploadFile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    const form = event.currentTarget;
    const data = new FormData(form);
    const file = data.get("file") as File | null;

    if (!file || file.size <= 0) {
      setMessage("Choose a file first.");
      return;
    }

    if (file.size > MAX_FILE_BYTES) {
      setMessage("For this first version, files are limited to 250 MB each.");
      return;
    }

    setBusy(true);
    setMessage("Uploading…");

    const cleanName = safeFileName(file.name);
    const storagePath = `${userId}/${crypto.randomUUID()}-${cleanName}`;

    const { error: uploadError } = await supabase.storage
      .from("creatorhub-uploads")
      .upload(storagePath, file, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });

    if (uploadError) {
      setBusy(false);
      setMessage(uploadError.message);
      return;
    }

    const { data: row, error: insertError } = await supabase
      .from("creator_uploads")
      .insert({
        user_id: userId,
        original_name: file.name || cleanName,
        storage_path: storagePath,
        mime_type: file.type || null,
        size_bytes: file.size,
      })
      .select("id,original_name,mime_type,size_bytes,share_token,share_enabled,created_at")
      .single();

    if (insertError || !row) {
      await supabase.storage.from("creatorhub-uploads").remove([storagePath]);
      setBusy(false);
      setMessage(insertError?.message ?? "The file uploaded, but CreatorHub could not create its share links.");
      return;
    }

    form.reset();
    setUploads((current) => [row as UploadRow, ...current].slice(0, 20));
    setBusy(false);
    setMessage("Upload complete. The access and download links are ready.");
  }

  return (
    <section>
      <form onSubmit={uploadFile} style={{ ...card, marginTop: 16 }}>
        <div style={{ color: colors.purpleBright, fontWeight: 900, fontSize: 12, textTransform: "uppercase", letterSpacing: ".08em" }}>
          Upload
        </div>
        <h2 style={{ marginBottom: 8 }}>Send a file through CreatorHub</h2>
        <p style={{ color: colors.muted, marginTop: 0, lineHeight: 1.5 }}>
          Upload once, then open or download the file from another device using the links CreatorHub gives you.
        </p>
        <input name="file" required type="file" style={input} />
        <div style={{ color: colors.muted, fontSize: 12, marginTop: 8 }}>Private storage · up to 250 MB per file in this first version</div>
        <button disabled={busy} style={{ ...primaryButton, marginTop: 14 }}>
          {busy ? "Uploading…" : "Upload file"}
        </button>
      </form>

      {message ? (
        <div style={{ ...card, marginTop: 12, padding: 14, color: colors.muted }}>{message}</div>
      ) : null}

      <section style={{ marginTop: 22 }}>
        <div style={{ color: colors.purpleBright, fontWeight: 900, fontSize: 12, textTransform: "uppercase", letterSpacing: ".08em" }}>
          Recent files
        </div>
        <h2 style={{ marginTop: 6 }}>Access from another device</h2>

        <div style={{ display: "grid", gap: 10 }}>
          {uploads.map((item) => {
            const links = linksFor(item.share_token);
            return (
              <article key={item.id} style={card}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "start", flexWrap: "wrap" }}>
                  <div style={{ minWidth: 0 }}>
                    <strong style={{ display: "block", overflowWrap: "anywhere" }}>{item.original_name}</strong>
                    <div style={{ color: colors.muted, fontSize: 12, marginTop: 4 }}>
                      {formatBytes(Number(item.size_bytes))} · {new Date(item.created_at).toLocaleString()}
                    </div>
                  </div>
                  <span style={{ color: item.share_enabled ? colors.purpleBright : colors.muted, fontSize: 12, fontWeight: 800 }}>
                    {item.share_enabled ? "Links active" : "Links disabled"}
                  </span>
                </div>

                {item.share_enabled ? (
                  <>
                    <div style={{ marginTop: 14 }}>
                      <div style={{ color: colors.muted, fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".06em" }}>Access URL</div>
                      <a href={links.access} target="_blank" rel="noreferrer" style={{ color: colors.purpleBright, overflowWrap: "anywhere", fontSize: 13 }}>
                        {links.access}
                      </a>
                    </div>
                    <div style={{ marginTop: 10 }}>
                      <div style={{ color: colors.muted, fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".06em" }}>Download URL</div>
                      <a href={links.download} target="_blank" rel="noreferrer" style={{ color: colors.purpleBright, overflowWrap: "anywhere", fontSize: 13 }}>
                        {links.download}
                      </a>
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
                      <button type="button" style={secondaryButton} onClick={() => void copyLink(links.access, "Access")}>Copy access link</button>
                      <button type="button" style={secondaryButton} onClick={() => void copyLink(links.download, "Download")}>Copy download link</button>
                      <a href={links.access} target="_blank" rel="noreferrer" style={{ ...primaryButton, textDecoration: "none", display: "inline-flex" }}>Open</a>
                    </div>
                  </>
                ) : null}
              </article>
            );
          })}

          {uploads.length === 0 ? (
            <div style={{ ...card, color: colors.muted }}>No files uploaded yet.</div>
          ) : null}
        </div>
      </section>
    </section>
  );
}
