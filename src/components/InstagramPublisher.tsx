"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase";
import { card, input, primaryButton, secondaryButton } from "@/lib/ui";

type Props = {
  userId: string;
  creatorId: string;
  connectionId: string;
  accountName: string;
  onClose: () => void;
};

type PublishResult = {
  ok?: boolean;
  media_id?: string;
  permalink?: string | null;
  account_name?: string | null;
  error?: string;
};

async function fitImageForInstagram(file: File) {
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("Could not read that image."));
      element.src = objectUrl;
    });

    const targetWidth = 1080;
    const targetHeight = 1350;
    const targetRatio = targetWidth / targetHeight;
    const sourceRatio = image.naturalWidth / image.naturalHeight;

    let sx = 0;
    let sy = 0;
    let sw = image.naturalWidth;
    let sh = image.naturalHeight;

    if (sourceRatio > targetRatio) {
      sw = image.naturalHeight * targetRatio;
      sx = (image.naturalWidth - sw) / 2;
    } else if (sourceRatio < targetRatio) {
      sh = image.naturalWidth / targetRatio;
      sy = (image.naturalHeight - sh) / 2;
    }

    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image processing is not available in this browser.");
    context.drawImage(image, sx, sy, sw, sh, 0, 0, targetWidth, targetHeight);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
    if (!blob) throw new Error("Could not prepare the image for Instagram.");
    return new File([blob], "instagram-post.jpg", { type: "image/jpeg" });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export default function InstagramPublisher({
  userId,
  creatorId,
  connectionId,
  accountName,
  onClose,
}: Props) {
  const supabase = useMemo(() => createClient(), []);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [caption, setCaption] = useState("");
  const [topic, setTopic] = useState("");
  const [stage, setStage] = useState("");
  const [error, setError] = useState("");
  const [permalink, setPermalink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [captionBusy, setCaptionBusy] = useState(false);

  useEffect(() => {
    if (!file) {
      setPreview("");
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  async function draftCaption() {
    if (!topic.trim() || captionBusy) return;
    setCaptionBusy(true);
    setError("");
    setStage("Drafting caption with CreatorHub AI…");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Your CreatorHub session expired. Sign in again.");
      const response = await fetch("/api/ai/instagram-caption", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ creatorId, topic: topic.trim() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not draft the caption.");
      const hashtags = Array.isArray(data.hashtags)
        ? data.hashtags
            .map((item: unknown) => String(item).trim())
            .filter(Boolean)
            .map((item: string) => (item.startsWith("#") ? item : `#${item.replace(/\s+/g, "")}`))
        : [];
      setCaption([String(data.caption || "").trim(), hashtags.join(" ")].filter(Boolean).join("\n\n"));
      setStage("Caption drafted. Edit anything you want before publishing.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not draft the caption.");
      setStage("");
    } finally {
      setCaptionBusy(false);
    }
  }

  async function publish() {
    if (!file || busy) return;
    if (!window.confirm(`Publish this image to ${accountName} now? This creates a real public Instagram post.`)) return;

    setBusy(true);
    setError("");
    setPermalink(null);

    let uploadedPath = "";
    try {
      setStage("Preparing 4:5 Instagram image…");
      const prepared = await fitImageForInstagram(file);
      const safeId = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : String(Date.now());
      uploadedPath = `${userId}/${creatorId}/${Date.now()}-${safeId}.jpg`;

      setStage("Uploading image to CreatorHub…");
      const { error: uploadError } = await supabase.storage
        .from("creatorhub-social")
        .upload(uploadedPath, prepared, {
          contentType: "image/jpeg",
          cacheControl: "3600",
          upsert: false,
        });
      if (uploadError) throw uploadError;

      const { data: publicData } = supabase.storage.from("creatorhub-social").getPublicUrl(uploadedPath);
      const imageUrl = publicData.publicUrl;
      if (!imageUrl) throw new Error("CreatorHub could not create the Instagram image URL.");

      setStage(`Publishing to ${accountName}…`);
      const { data, error: functionError } = await supabase.functions.invoke<PublishResult>("publish-instagram-image", {
        body: {
          creator_id: creatorId,
          connection_id: connectionId,
          image_url: imageUrl,
          asset_path: uploadedPath,
          caption: caption.trim(),
          confirmed_publish: true,
        },
      });

      if (functionError || data?.error || !data?.ok) {
        throw new Error(data?.error || functionError?.message || "Instagram publishing failed.");
      }

      setPermalink(data.permalink || null);
      setStage(`Published successfully to ${data.account_name || accountName}.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Instagram publishing failed.");
      setStage("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={{ ...card, marginTop: 14, borderColor: "#6d43a2" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "start", flexWrap: "wrap" }}>
        <div>
          <div style={{ color: "#c4a7ef", fontWeight: 800, fontSize: 12, textTransform: "uppercase", letterSpacing: ".08em" }}>
            Instagram publisher
          </div>
          <h3 style={{ margin: "5px 0", color: "#fff" }}>Create a post for {accountName}</h3>
          <p style={{ margin: 0, color: "#bbb2c8", lineHeight: 1.45 }}>
            V1 publishes one image at a time. CreatorHub fits uploads to a 4:5 JPEG before sending them to Instagram.
          </p>
        </div>
        <button type="button" style={secondaryButton} disabled={busy} onClick={onClose}>Close</button>
      </div>

      <label style={{ display: "block", marginTop: 16, fontWeight: 700 }}>
        Image
        <input
          type="file"
          accept="image/*"
          disabled={busy}
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          style={{ ...input, padding: 10 }}
        />
      </label>

      {preview ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={preview}
          alt="Instagram post preview"
          style={{ display: "block", width: "100%", maxWidth: 420, aspectRatio: "4 / 5", objectFit: "cover", borderRadius: 14, marginTop: 12, border: "1px solid #4a3565" }}
        />
      ) : null}

      <label style={{ display: "block", marginTop: 16, fontWeight: 700 }}>
        What is this post about? <span style={{ color: "#9f95ac", fontWeight: 400 }}>(for AI caption drafting)</span>
        <textarea
          value={topic}
          onChange={(event) => setTopic(event.target.value)}
          disabled={busy || captionBusy}
          placeholder="Example: Introducing CreatorHub and documenting our first direct Instagram publishing test."
          maxLength={1200}
          style={{ ...input, minHeight: 86, resize: "vertical" }}
        />
      </label>

      <button
        type="button"
        style={{ ...secondaryButton, marginTop: 8, opacity: !topic.trim() || captionBusy ? 0.55 : 1 }}
        disabled={!topic.trim() || captionBusy || busy}
        onClick={() => void draftCaption()}
      >
        {captionBusy ? "Drafting…" : "Draft caption with AI"}
      </button>

      <label style={{ display: "block", marginTop: 16, fontWeight: 700 }}>
        Caption
        <textarea
          value={caption}
          onChange={(event) => setCaption(event.target.value)}
          disabled={busy}
          placeholder="Write or generate your caption…"
          maxLength={2200}
          style={{ ...input, minHeight: 140, resize: "vertical" }}
        />
      </label>

      {stage ? (
        <p role="status" aria-live="polite" style={{ color: "#d8c8eb", background: "#21172f", border: "1px solid #4d3769", borderRadius: 12, padding: 12 }}>
          {stage}
        </p>
      ) : null}

      {error ? (
        <div style={{ color: "#ffd5df", background: "#2a1720", border: "1px solid #70404d", borderRadius: 12, padding: 12, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
          {error}
        </div>
      ) : null}

      {permalink ? (
        <p style={{ marginTop: 10 }}>
          <a href={permalink} target="_blank" rel="noreferrer" style={{ color: "#d8b4fe", fontWeight: 800 }}>
            Open published post on Instagram →
          </a>
        </p>
      ) : null}

      <button
        type="button"
        style={{ ...primaryButton, marginTop: 12, opacity: !file || busy ? 0.55 : 1 }}
        disabled={!file || busy}
        onClick={() => void publish()}
      >
        {busy ? "Publishing…" : `Publish to ${accountName}`}
      </button>
      <div style={{ color: "#9f95ac", fontSize: 12, marginTop: 8 }}>
        Nothing is posted until you explicitly confirm the Publish button.
      </div>
    </section>
  );
}
