"use client";

import { useEffect, useMemo, useState } from "react";
import type { Creator } from "@/lib/types";
import { chooseImageModel, imageModeOptions, imageModelOptions, type ImageGenerationMode, type ImageModelOverride } from "@/lib/generation-router";
import { createClient } from "@/lib/supabase";
import { card, colors, input, primaryButton, secondaryButton } from "@/lib/ui";

type Reference = {
  id: string;
  title: string;
  asset_type: string;
  is_primary: boolean;
  prompt_notes: string | null;
  tags: string[] | null;
  signed_url: string | null;
};

type ImageContext = {
  references?: Reference[];
};

type VariationMode = "preserve" | "balanced" | "new-scene";

type GenerationResult = {
  image: string;
  jobId?: string;
  status?: string;
  async?: boolean;
  model: string;
  modelLabel: string;
  mode: string;
  routedBy: string;
  costHint: string;
  aspectRatio: string;
  referenceCount: number;
  referenceTitles: string[];
  referenceFallback?: string | null;
  seed?: number | null;
  variationMode?: VariationMode;
  promptUsed?: string;
  referenceMode?: "none" | "img2img" | "ip-adapter";
  createdAt: string;
};

async function imageSourceToBlob(source: string) {
  if (!source.startsWith("data:")) {
    const response = await fetch(source, { cache: "no-store" });
    if (!response.ok) throw new Error("Could not download the generated image.");
    return response.blob();
  }

  const [header, base64] = source.split(",");
  if (!header || !base64) throw new Error("Generated image data is invalid.");
  const mime = header.match(/data:(.*?);base64/)?.[1] || "image/png";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: mime });
}

export default function CreatorImageStudio({
  creator,
  userId,
  onReferenceSaved,
}: {
  creator: Creator;
  userId: string;
  onReferenceSaved?: () => void | Promise<void>;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<ImageGenerationMode>("auto");
  const [modelOverride, setModelOverride] = useState<ImageModelOverride>("auto");
  const [aspectRatio, setAspectRatio] = useState("4:5");
  const [useReferences, setUseReferences] = useState(true);
  const [variationMode, setVariationMode] = useState<VariationMode>("balanced");
  const [references, setReferences] = useState<Reference[]>([]);
  const [busy, setBusy] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [savingReference, setSavingReference] = useState(false);
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<GenerationResult | null>(null);

  const activeReferenceCount = useReferences ? references.length : 0;
  const routePreview = useMemo(
    () => chooseImageModel(mode, prompt || "general creator visual", activeReferenceCount > 0, modelOverride),
    [mode, prompt, activeReferenceCount, modelOverride],
  );

  const previewReferenceCount =
    routePreview.target === "cooperative"
      ? Math.min(
          activeReferenceCount,
          routePreview.localProfile === "quality" && variationMode !== "preserve" ? 2 : 1,
        )
      : Math.min(activeReferenceCount, 3);
  const generating = busy || Boolean(activeJobId);

  useEffect(() => {
    setPrompt("");
    setResult(null);
    setMessage("");
    setUseReferences(true);
    setVariationMode("balanced");
    setMode("auto");
    setModelOverride("auto");
    setActiveJobId(null);

    let cancelled = false;
    void fetch(`/api/creators/${creator.id}/image-context`, { cache: "no-store" })
      .then(async (response) => {
        const data = (await response.json()) as ImageContext & { error?: string };
        if (!response.ok) throw new Error(data.error || "Could not load saved references.");
        if (!cancelled) setReferences(Array.isArray(data.references) ? data.references : []);
      })
      .catch((error) => {
        if (!cancelled) setMessage(error instanceof Error ? error.message : "Could not load saved references.");
      });

    void fetch(`/api/generate/image/jobs?creatorId=${encodeURIComponent(creator.id)}`, { cache: "no-store" })
      .then(async (response) => {
        const data = (await response.json()) as {
          job?: {
            cooperative_job_id?: string;
            status?: string;
            local_profile?: string;
            variation_mode?: VariationMode;
            seed?: number | null;
          } | null;
        };
        if (!cancelled && response.ok && data.job?.cooperative_job_id) {
          setActiveJobId(data.job.cooperative_job_id);
          if (data.job.variation_mode) setVariationMode(data.job.variation_mode);
          setMessage(
            `Resumed Local ${data.job.local_profile === "quality" ? "Quality" : "Fast"} generation · ${data.job.status || "queued"}…`,
          );
        }
      })
      .catch(() => {
        // Reference loading remains usable even if async-job recovery is unavailable.
      });

    return () => {
      cancelled = true;
    };
  }, [creator.id]);

  useEffect(() => {
    if (!activeJobId) return;

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      try {
        const response = await fetch(`/api/generate/image/jobs/${encodeURIComponent(activeJobId)}`, {
          cache: "no-store",
        });
        const data = (await response.json()) as
          | (GenerationResult & { status?: string; error?: string })
          | { status?: string; error?: string; profile?: string };

        if (cancelled) return;

        if (!response.ok) {
          setMessage("Could not check local generation status. CreatorHub will retry.");
        } else if (data.status === "completed" && "image" in data && data.image) {
          setResult(data as GenerationResult);
          setActiveJobId(null);
          setMessage(
            `Generated with ${(data as GenerationResult).modelLabel} using ${(data as GenerationResult).referenceCount} saved reference image${(data as GenerationResult).referenceCount === 1 ? "" : "s"}.`,
          );
          return;
        } else if (data.status === "failed") {
          setActiveJobId(null);
          setMessage(data.error || "Local generation failed.");
          return;
        } else {
          const profile = "profile" in data && data.profile === "quality" ? "Quality" : "Fast";
          setMessage(`Local ${profile} generation · ${data.status || "queued"}… You can close CreatorHub and come back later.`);
        }
      } catch {
        if (!cancelled) setMessage("Local generation is still running. CreatorHub will retry the status check.");
      }

      if (!cancelled) timeoutId = setTimeout(poll, 3000);
    };

    void poll();
    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [activeJobId]);

  async function generate(promptOverride?: string) {
    const trimmed = (promptOverride ?? prompt).trim();
    if (trimmed.length < 3 || generating) return;

    const requestRoute = chooseImageModel(
      mode,
      trimmed,
      activeReferenceCount > 0,
      modelOverride,
    );

    const referenceText =
      activeReferenceCount > 0 && requestRoute.supportsReferences
        ? ` using ${previewReferenceCount} saved reference image${previewReferenceCount === 1 ? "" : "s"}`
        : activeReferenceCount > 0
          ? " using the saved text profile only"
          : "";

    const chargeNote =
      requestRoute.target === "cooperative"
        ? "This selection has no per-image API charge and will not fall back to a paid hosted model."
        : requestRoute.target === "auto"
          ? "CreatorHub will try local inference first; a hosted fallback can incur AI Gateway charges."
          : "This hosted selection can incur AI Gateway charges.";

    const approved = window.confirm(
      `Generate 1 image with ${requestRoute.label}${referenceText}? Pricing: ${requestRoute.costHint}. ${chargeNote}`,
    );
    if (!approved) return;

    setBusy(true);
    setResult(null);
    setMessage(`Generating with ${requestRoute.label}…`);

    try {
      const response = await fetch("/api/generate/image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          creatorId: creator.id,
          prompt: trimmed,
          mode,
          modelOverride,
          aspectRatio,
          useReferences,
          variationMode,
          confirmedSpend: true,
        }),
      });

      const data = (await response.json()) as GenerationResult & {
        error?: string;
        detail?: string;
        jobId?: string;
        status?: string;
        async?: boolean;
      };
      if (!response.ok) {
        setMessage([data.error, data.detail].filter(Boolean).join(" "));
        return;
      }

      if (response.status === 202 && data.async && data.jobId) {
        setActiveJobId(data.jobId);
        setMessage(`${data.modelLabel} queued on your Mac. You can close CreatorHub and come back later.`);
        return;
      }

      setResult({ ...data, promptUsed: data.promptUsed || trimmed });
      setMessage(
        data.referenceCount > 0
          ? `Generated with ${data.modelLabel} using ${data.referenceCount} saved reference image${data.referenceCount === 1 ? "" : "s"}.`
          : data.referenceFallback || `Generated with ${data.modelLabel}.`,
      );
    } catch {
      setMessage("Could not reach CreatorHub image generation.");
    } finally {
      setBusy(false);
    }
  }

  async function saveGeneratedReference() {
    if (!result || savingReference) return;
    setSavingReference(true);
    setMessage("Saving generated image to the character library…");

    try {
      const blob = await imageSourceToBlob(result.image);
      const extension = blob.type.includes("jpeg") ? "jpg" : blob.type.includes("webp") ? "webp" : "png";
      const key = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : String(Date.now());
      const storagePath = `${userId}/${creator.id}/generated-${Date.now()}-${key}.${extension}`;

      const { error: uploadError } = await supabase.storage
        .from("creator-reference-assets")
        .upload(storagePath, blob, {
          contentType: blob.type,
          cacheControl: "3600",
          upsert: false,
        });
      if (uploadError) throw uploadError;

      const { error: insertError } = await supabase.from("creator_assets").insert({
        user_id: userId,
        creator_id: creator.id,
        asset_type: "character_reference",
        title: `Approved generation · ${new Date(result.createdAt).toLocaleDateString()}`,
        storage_path: storagePath,
        mime_type: blob.type,
        prompt_notes: result.promptUsed || prompt.trim() || null,
        tags: ["generated", "approved"],
        approved: true,
        is_primary: false,
        source: "generated",
        metadata: {
          model: result.model,
          aspect_ratio: result.aspectRatio,
          reference_count: result.referenceCount,
          source_reference_titles: result.referenceTitles,
          variation_mode: result.variationMode || variationMode,
          seed: result.seed ?? null,
        },
      });

      if (insertError) {
        await supabase.storage.from("creator-reference-assets").remove([storagePath]);
        throw insertError;
      }

      setMessage("Saved as an approved character reference for future generations.");
      await onReferenceSaved?.();

      const response = await fetch(`/api/creators/${creator.id}/image-context`, { cache: "no-store" });
      if (response.ok) {
        const context = (await response.json()) as ImageContext;
        setReferences(Array.isArray(context.references) ? context.references : []);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save the generated reference.");
    } finally {
      setSavingReference(false);
    }
  }

  return (
    <section style={{ ...card, marginTop: 22, borderColor: "#5b3a86" }}>
      <div style={{ color: colors.purpleBright, fontWeight: 800, fontSize: 12, textTransform: "uppercase", letterSpacing: ".08em" }}>
        CreatorHub Studio
      </div>
      <h2 style={{ margin: "6px 0" }}>Generate as {creator.name}</h2>
      <p style={{ color: colors.muted, marginTop: 0, lineHeight: 1.55 }}>
        CreatorHub automatically loads this creator&apos;s saved visual profile and approved character references before routing the generation.
      </p>

      {references.length ? (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <strong>{references.length} approved reference{references.length === 1 ? "" : "s"}</strong>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6, color: colors.muted, fontSize: 13 }}>
              <input
                type="checkbox"
                checked={useReferences}
                onChange={(event) => setUseReferences(event.target.checked)}
                disabled={generating}
              />
              Use saved references
            </label>
          </div>
          <div style={{ display: "flex", gap: 8, overflowX: "auto", marginTop: 9, paddingBottom: 4 }}>
            {references.slice(0, 6).map((reference) => (
              <div key={reference.id} style={{ minWidth: 82, width: 82 }}>
                {reference.signed_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={reference.signed_url}
                    alt={reference.title}
                    style={{
                      width: 82,
                      height: 100,
                      objectFit: "cover",
                      borderRadius: 10,
                      border: reference.is_primary ? "2px solid #a855f7" : "1px solid #4a3565",
                    }}
                  />
                ) : null}
                <div style={{ fontSize: 10, color: reference.is_primary ? "#d8b4fe" : colors.muted, marginTop: 4, lineHeight: 1.2 }}>
                  {reference.is_primary ? "Primary · " : ""}{reference.title}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div style={{ marginTop: 12, color: colors.muted, fontSize: 13 }}>
          No approved reference images yet. CreatorHub will use the saved visual description until references are added.
        </div>
      )}

      <label style={{ display: "block", fontWeight: 700, marginTop: 16 }}>
        What should {creator.name} be doing?
        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          style={{ ...input, minHeight: 110, resize: "vertical" }}
          maxLength={2000}
          placeholder="Example: candid nighttime portrait, laughing at something off camera, warm patio lights, premium lifestyle photography."
        />
      </label>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10 }}>
        <label style={{ display: "block", fontWeight: 700 }}>
          Routing
          <select value={mode} onChange={(event) => setMode(event.target.value as ImageGenerationMode)} style={input} disabled={busy || modelOverride !== "auto"}>
            {imageModeOptions().map((option) => (
              <option key={option.value} value={option.value}>{option.label} · {option.detail}</option>
            ))}
          </select>
        </label>

        <label style={{ display: "block", fontWeight: 700 }}>
          Model
          <select
            value={modelOverride}
            onChange={(event) => setModelOverride(event.target.value as ImageModelOverride)}
            style={input}
            disabled={generating}
          >
            {imageModelOptions().map((option) => (
              <option key={option.value} value={option.value}>{option.label} · {option.detail}</option>
            ))}
          </select>
        </label>

        <label style={{ display: "block", fontWeight: 700 }}>
          Aspect ratio
          <select value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value)} style={input} disabled={generating}>
            <option value="1:1">1:1 profile / square</option>
            <option value="4:5">4:5 Instagram portrait</option>
            <option value="9:16">9:16 Story / Reel</option>
            <option value="16:9">16:9 landscape</option>
          </select>
        </label>

        <label style={{ display: "block", fontWeight: 700 }}>
          Variation
          <select
            value={variationMode}
            onChange={(event) => setVariationMode(event.target.value as VariationMode)}
            style={input}
            disabled={generating || !useReferences}
          >
            <option value="preserve">Preserve · stay close to reference pose/composition</option>
            <option value="balanced">Balanced · same identity, meaningful variation</option>
            <option value="new-scene">New scene · change pose/composition/background</option>
          </select>
        </label>
      </div>

      <div style={{ background: colors.purpleSoft, border: `1px solid ${colors.border}`, borderRadius: 12, padding: 12, marginTop: 8 }}>
        <strong>Selected model: {routePreview.label}</strong>
        <div style={{ color: colors.muted, marginTop: 4 }}>
          {modelOverride === "auto" ? "Automatic selection · " : "Manual override · "}{routePreview.reason}
        </div>
        <div style={{ color: colors.muted, marginTop: 4 }}>
          {routePreview.costHint}
          {activeReferenceCount > 0
            ? routePreview.supportsReferences
              ? routePreview.target === "cooperative"
                ? ` · ${previewReferenceCount} identity reference${previewReferenceCount === 1 ? "" : "s"} · ${variationMode.replace("-", " ")} variation`
                : ` · will receive up to ${Math.min(activeReferenceCount, 3)} saved image references`
              : " · saved references fall back to text identity"
            : ""}
        </div>
      </div>

      <div style={{ marginTop: 14, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button
          type="button"
          style={{ ...primaryButton, opacity: generating || prompt.trim().length < 3 ? 0.55 : 1 }}
          disabled={generating || prompt.trim().length < 3}
          onClick={() => void generate()}
        >
          {generating ? "Generating…" : "Generate 1 image"}
        </button>
        <span style={{ color: colors.muted, fontSize: 13 }}>You confirm before any potentially billable generation.</span>
      </div>

      {message ? (
        <p role="status" aria-live="polite" style={{ color: "#d8c8eb", background: "#21172f", border: "1px solid #4d3769", borderRadius: 12, padding: 12 }}>
          {message}
        </p>
      ) : null}

      {result ? (
        <div style={{ marginTop: 16 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={result.image}
            alt={`Generated visual for ${creator.name}`}
            style={{ width: "100%", maxWidth: 720, borderRadius: 16, border: `1px solid ${colors.border}`, display: "block" }}
          />
          <div style={{ marginTop: 8, color: colors.muted, fontSize: 13 }}>
            {result.modelLabel} · {result.aspectRatio} · {result.referenceCount} reference{result.referenceCount === 1 ? "" : "s"}
            {result.variationMode ? ` · ${result.variationMode.replace("-", " ")}` : ""}
            {typeof result.seed === "number" ? ` · seed ${result.seed}` : ""}
            {result.referenceMode === "ip-adapter" ? " · identity-guided" : ""}
            {" · "}{new Date(result.createdAt).toLocaleString()}
          </div>
          {result.referenceTitles?.length ? (
            <div style={{ marginTop: 5, color: colors.muted, fontSize: 12 }}>
              Identity sources: {result.referenceTitles.join(", ")}
            </div>
          ) : null}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
            <button
              type="button"
              style={secondaryButton}
              disabled={generating || (result.promptUsed || prompt).trim().length < 3}
              onClick={() => void generate(result.promptUsed || prompt)}
            >
              Generate another variation
            </button>
            <button type="button" style={secondaryButton} disabled={savingReference} onClick={() => void saveGeneratedReference()}>
              {savingReference ? "Saving…" : "Save as approved reference"}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
