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

type ResumeState = {
  uploadUrl: string;
  storagePath: string;
};

const MAX_FILE_BYTES = 5 * 1024 * 1024 * 1024;
const TUS_CHUNK_BYTES = 6 * 1024 * 1024;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://yufptpfiwdbzzrvhkvux.supabase.co";
const SUPABASE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_JpayDIqb8Gy-hnGSL99fdg_jmKQQNJh";
const TUS_ENDPOINT =
  SUPABASE_URL.replace(".supabase.co", ".storage.supabase.co") + "/storage/v1/upload/resumable";

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

function encodeTusMetadata(value: string) {
  return btoa(value);
}

function resumeKey(userId: string, file: File) {
  return `creatorhub:tus:${userId}:${file.name}:${file.size}:${file.lastModified}`;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

export default function UploadCenter({ userId }: { userId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [uploads, setUploads] = useState<UploadRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [progress, setProgress] = useState<number | null>(null);

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

  async function authHeaders() {
    const {
      data: { session },
      error,
    } = await supabase.auth.getSession();

    if (error || !session?.access_token) {
      throw new Error("Your sign-in session expired. Sign in again and retry.");
    }

    return {
      Authorization: `Bearer ${session.access_token}`,
      apikey: SUPABASE_PUBLISHABLE_KEY,
    };
  }

  async function createTusUpload(file: File, storagePath: string) {
    const metadata = [
      `bucketName ${encodeTusMetadata("creatorhub-uploads")}`,
      `objectName ${encodeTusMetadata(storagePath)}`,
      `contentType ${encodeTusMetadata(file.type || "application/octet-stream")}`,
      `cacheControl ${encodeTusMetadata("3600")}`,
      `metadata ${encodeTusMetadata("{}")}`,
    ].join(",");

    const response = await fetch(TUS_ENDPOINT, {
      method: "POST",
      headers: {
        ...(await authHeaders()),
        "Tus-Resumable": "1.0.0",
        "Upload-Length": String(file.size),
        "Upload-Metadata": metadata,
      },
    });

    if (!response.ok) {
      throw new Error((await response.text()) || "Could not start the resumable upload.");
    }

    const location = response.headers.get("Location");
    if (!location) throw new Error("Storage did not return a resumable upload URL.");

    if (location.startsWith("http")) return location;

    const directStorageOrigin = SUPABASE_URL.replace(".supabase.co", ".storage.supabase.co");
    return `${directStorageOrigin}${location}`;
  }

  async function readTusOffset(uploadUrl: string) {
    try {
      const response = await fetch(uploadUrl, {
        method: "HEAD",
        headers: {
          ...(await authHeaders()),
          "Tus-Resumable": "1.0.0",
        },
      });

      if (!response.ok) return null;

      const offset = Number(response.headers.get("Upload-Offset") || 0);
      return Number.isFinite(offset) && offset >= 0 ? offset : null;
    } catch {
      return null;
    }
  }

  async function patchChunk(uploadUrl: string, file: File, startingOffset: number) {
    const retryDelays = [0, 3000, 5000, 10000, 20000];
    const offset = startingOffset;
    let lastError: Error | null = null;

    for (const delay of retryDelays) {
      if (delay) await sleep(delay);

      const end = Math.min(offset + TUS_CHUNK_BYTES, file.size);
      const chunk = file.slice(offset, end);

      try {
        const response = await fetch(uploadUrl, {
          method: "PATCH",
          headers: {
            ...(await authHeaders()),
            "Tus-Resumable": "1.0.0",
            "Upload-Offset": String(offset),
            "Content-Type": "application/offset+octet-stream",
          },
          body: chunk,
        });

        if (response.ok) {
          const serverOffset = Number(response.headers.get("Upload-Offset") || end);
          return Number.isFinite(serverOffset) ? serverOffset : end;
        }

        lastError = new Error((await response.text()) || "Upload chunk failed.");

        const serverOffset = await readTusOffset(uploadUrl);
        if (serverOffset !== null && serverOffset !== offset) {
          return serverOffset;
        }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error("Upload interrupted.");

        const serverOffset = await readTusOffset(uploadUrl);
        if (serverOffset !== null && serverOffset !== offset) {
          return serverOffset;
        }
      }
    }

    throw lastError ?? new Error("Upload interrupted after several retries.");
  }

  function readResumeState(key: string): ResumeState | null {
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as ResumeState;
      if (!parsed.uploadUrl || !parsed.storagePath) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  function saveResumeState(key: string, state: ResumeState) {
    window.localStorage.setItem(key, JSON.stringify(state));
  }

  async function uploadResumable(file: File) {
    const key = resumeKey(userId, file);
    let state = readResumeState(key);
    let offset = 0;

    if (state) {
      const serverOffset = await readTusOffset(state.uploadUrl);

      if (serverOffset === null || serverOffset > file.size) {
        window.localStorage.removeItem(key);
        state = null;
      } else {
        offset = serverOffset;
        setMessage(offset > 0 ? `Resuming at ${((offset / file.size) * 100).toFixed(1)}%…` : "Resuming upload…");
      }
    }

    if (!state) {
      const cleanName = safeFileName(file.name);
      const storagePath = `${userId}/${crypto.randomUUID()}-${cleanName}`;
      const uploadUrl = await createTusUpload(file, storagePath);
      state = { uploadUrl, storagePath };
      saveResumeState(key, state);
    }

    setProgress(file.size ? Math.min(100, (offset / file.size) * 100) : 0);

    while (offset < file.size) {
      const nextOffset = await patchChunk(state.uploadUrl, file, offset);

      if (nextOffset <= offset) {
        throw new Error("Upload did not advance. Retry the same file to resume.");
      }

      offset = nextOffset;
      const percent = Math.min(100, (offset / file.size) * 100);
      setProgress(percent);
      setMessage(`Uploading… ${percent.toFixed(1)}%`);
    }

    return { key, storagePath: state.storagePath };
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
      setMessage("Files are limited to 5 GB each.");
      return;
    }

    setBusy(true);
    setProgress(0);
    setMessage("Preparing resumable upload…");

    try {
      const { key, storagePath } = await uploadResumable(file);

      setMessage("Upload finished. Creating access links…");

      const { data: row, error: insertError } = await supabase
        .from("creator_uploads")
        .upsert(
          {
            user_id: userId,
            original_name: file.name || safeFileName(file.name),
            storage_path: storagePath,
            mime_type: file.type || null,
            size_bytes: file.size,
          },
          { onConflict: "storage_path" },
        )
        .select("id,original_name,mime_type,size_bytes,share_token,share_enabled,created_at")
        .single();

      if (insertError || !row) {
        throw new Error(
          insertError?.message ??
            "The file finished uploading, but CreatorHub could not create its links. Select the same file and retry; the upload will resume at 100%.",
        );
      }

      window.localStorage.removeItem(key);
      form.reset();
      setUploads((current) => [row as UploadRow, ...current.filter((item) => item.id !== row.id)].slice(0, 20));
      setProgress(100);
      setMessage("Upload complete. The access and download links are ready.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? `${error.message} Select the same file again to resume.`
          : "Upload interrupted. Select the same file again to resume.",
      );
    } finally {
      setBusy(false);
    }
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
        <div style={{ color: colors.muted, fontSize: 12, marginTop: 8 }}>
          Private storage · up to 5 GB per file · resumable 6 MB chunks
        </div>

        {progress !== null ? (
          <div style={{ marginTop: 12 }}>
            <div
              style={{
                height: 10,
                background: "rgba(255,255,255,.08)",
                borderRadius: 999,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${Math.max(0, Math.min(100, progress))}%`,
                  height: "100%",
                  background: colors.purpleBright,
                  transition: "width .15s ease",
                }}
              />
            </div>
            <div style={{ color: colors.muted, fontSize: 11, marginTop: 5 }}>{progress.toFixed(1)}%</div>
          </div>
        ) : null}

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
