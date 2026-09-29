"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase";
import { card, colors, input, primaryButton, secondaryButton } from "@/lib/ui";

type AssetType = "profile_photo" | "character_reference" | "style_reference" | "brand_asset";

type CreatorAsset = {
  id: string;
  asset_type: AssetType;
  title: string;
  storage_path: string;
  mime_type: string | null;
  prompt_notes: string | null;
  tags: string[] | null;
  approved: boolean;
  is_primary: boolean;
  source: string;
  created_at: string;
  preview_url?: string;
};

const assetLabels: Record<AssetType, string> = {
  profile_photo: "Profile photo",
  character_reference: "Character reference",
  style_reference: "Style reference",
  brand_asset: "Brand asset",
};

function safeFilename(value: string) {
  const ext = value.split(".").pop()?.toLowerCase() || "jpg";
  return ["jpg", "jpeg", "png", "webp"].includes(ext) ? ext : "jpg";
}

function parseTags(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 12);
}

export default function CreatorReferenceLibrary({
  userId,
  creatorId,
  creatorName,
}: {
  userId: string;
  creatorId: string;
  creatorName: string;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [assets, setAssets] = useState<CreatorAsset[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const loadAssets = useCallback(async () => {
    const { data, error } = await supabase
      .from("creator_assets")
      .select("id,asset_type,title,storage_path,mime_type,prompt_notes,tags,approved,is_primary,source,created_at")
      .eq("creator_id", creatorId)
      .order("is_primary", { ascending: false })
      .order("created_at", { ascending: false });

    if (error) {
      setMessage(error.message);
      return;
    }

    const rows = (data ?? []) as CreatorAsset[];
    const withPreviews = await Promise.all(
      rows.map(async (asset) => {
        const { data: signed } = await supabase.storage
          .from("creator-reference-assets")
          .createSignedUrl(asset.storage_path, 60 * 60);
        return { ...asset, preview_url: signed?.signedUrl || "" };
      }),
    );
    setAssets(withPreviews);
  }, [creatorId, supabase]);

  useEffect(() => {
    void loadAssets();
  }, [loadAssets]);

  async function uploadAsset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    const form = event.currentTarget;
    const values = new FormData(form);
    const file = values.get("file");
    if (!(file instanceof File) || !file.size) {
      setMessage("Choose an image first.");
      return;
    }
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setMessage("Use a JPG, PNG, or WebP image.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setMessage("Reference images must be 10 MB or smaller.");
      return;
    }

    const type = String(values.get("assetType") || "character_reference") as AssetType;
    const title = String(values.get("title") || "").trim() || assetLabels[type];
    const promptNotes = String(values.get("promptNotes") || "").trim().slice(0, 3000);
    const tags = parseTags(String(values.get("tags") || ""));
    const makePrimary = values.get("makePrimary") === "on" || assets.length === 0;
    const ext = safeFilename(file.name);
    const key = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : String(Date.now());
    const storagePath = `${userId}/${creatorId}/${Date.now()}-${key}.${ext}`;

    setBusy(true);
    setMessage("Saving reference image…");

    try {
      const { error: uploadError } = await supabase.storage
        .from("creator-reference-assets")
        .upload(storagePath, file, {
          contentType: file.type,
          cacheControl: "3600",
          upsert: false,
        });
      if (uploadError) throw uploadError;

      if (makePrimary) {
        const { error: clearError } = await supabase
          .from("creator_assets")
          .update({ is_primary: false, updated_at: new Date().toISOString() })
          .eq("creator_id", creatorId)
          .eq("is_primary", true);
        if (clearError) throw clearError;
      }

      const { error: insertError } = await supabase.from("creator_assets").insert({
        user_id: userId,
        creator_id: creatorId,
        asset_type: type,
        title,
        storage_path: storagePath,
        mime_type: file.type,
        prompt_notes: promptNotes || null,
        tags,
        approved: true,
        is_primary: makePrimary,
        source: "upload",
      });
      if (insertError) {
        await supabase.storage.from("creator-reference-assets").remove([storagePath]);
        throw insertError;
      }

      form.reset();
      await loadAssets();
      setMessage(makePrimary ? "Reference saved and set as the primary character reference." : "Reference saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save the reference image.");
    } finally {
      setBusy(false);
    }
  }

  async function makePrimary(asset: CreatorAsset) {
    if (busy || asset.is_primary) return;
    setBusy(true);
    setMessage("Updating primary reference…");
    try {
      const { error: clearError } = await supabase
        .from("creator_assets")
        .update({ is_primary: false, updated_at: new Date().toISOString() })
        .eq("creator_id", creatorId)
        .eq("is_primary", true);
      if (clearError) throw clearError;

      const { error } = await supabase
        .from("creator_assets")
        .update({ is_primary: true, approved: true, updated_at: new Date().toISOString() })
        .eq("id", asset.id)
        .eq("creator_id", creatorId);
      if (error) throw error;

      await loadAssets();
      setMessage(`${asset.title} is now the primary character reference.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update the primary reference.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleApproved(asset: CreatorAsset) {
    if (busy) return;
    if (asset.is_primary && asset.approved) {
      setMessage("Choose another primary reference before disabling this one.");
      return;
    }
    setBusy(true);
    const next = !asset.approved;
    const { error } = await supabase
      .from("creator_assets")
      .update({ approved: next, updated_at: new Date().toISOString() })
      .eq("id", asset.id)
      .eq("creator_id", creatorId);
    setBusy(false);
    if (error) return setMessage(error.message);
    await loadAssets();
    setMessage(next ? "Reference approved for future generations." : "Reference removed from generation context.");
  }

  async function removeAsset(asset: CreatorAsset) {
    if (busy) return;
    if (!window.confirm(`Remove "${asset.title}" from ${creatorName}'s reference library?`)) return;
    setBusy(true);
    setMessage("Removing reference…");
    try {
      const { error: storageError } = await supabase.storage
        .from("creator-reference-assets")
        .remove([asset.storage_path]);
      if (storageError) throw storageError;

      const { error } = await supabase.from("creator_assets").delete().eq("id", asset.id).eq("creator_id", creatorId);
      if (error) throw error;

      if (asset.is_primary) {
        const { data: replacement } = await supabase
          .from("creator_assets")
          .select("id")
          .eq("creator_id", creatorId)
          .eq("approved", true)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (replacement?.id) {
          await supabase.from("creator_assets").update({ is_primary: true }).eq("id", replacement.id);
        }
      }

      await loadAssets();
      setMessage("Reference removed.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not remove the reference.");
    } finally {
      setBusy(false);
    }
  }

  const approvedCount = assets.filter((asset) => asset.approved).length;

  return (
    <section style={{ ...card, marginTop: 22, borderColor: "#5b3a86" }}>
      <div style={{ color: colors.purpleBright, fontWeight: 800, fontSize: 12, textTransform: "uppercase", letterSpacing: ".08em" }}>
        Character & brand library
      </div>
      <h2 style={{ margin: "6px 0" }}>{creatorName} reference images</h2>
      <p style={{ color: colors.muted, marginTop: 0, lineHeight: 1.55 }}>
        Save approved photos here so CreatorHub can reuse the same visual identity in future image-generation workflows.
        The primary image is the strongest identity reference; other approved images add useful angles, expressions, outfits, and lighting.
      </p>

      <form onSubmit={uploadAsset} style={{ marginTop: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 10 }}>
          <label style={{ fontWeight: 700 }}>
            Reference type
            <select name="assetType" defaultValue="character_reference" style={input} disabled={busy}>
              <option value="profile_photo">Profile photo</option>
              <option value="character_reference">Character reference</option>
              <option value="style_reference">Style reference</option>
              <option value="brand_asset">Brand asset</option>
            </select>
          </label>
          <label style={{ fontWeight: 700 }}>
            Title
            <input name="title" style={input} placeholder="Nighttime laughing portrait" maxLength={120} disabled={busy} />
          </label>
        </div>

        <label style={{ display: "block", fontWeight: 700, marginTop: 8 }}>
          Image
          <input name="file" type="file" accept="image/jpeg,image/png,image/webp" style={{ ...input, padding: 10 }} disabled={busy} />
        </label>

        <label style={{ display: "block", fontWeight: 700, marginTop: 8 }}>
          Generation notes
          <textarea
            name="promptNotes"
            style={{ ...input, minHeight: 88, resize: "vertical" }}
            placeholder="What should future generations preserve from this image?"
            maxLength={3000}
            disabled={busy}
          />
        </label>

        <label style={{ display: "block", fontWeight: 700, marginTop: 8 }}>
          Tags
          <input name="tags" style={input} placeholder="nighttime, laughing, profile, warm lights" disabled={busy} />
        </label>

        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, color: colors.muted }}>
          <input name="makePrimary" type="checkbox" disabled={busy} />
          Make this the primary character reference
        </label>

        <button type="submit" style={{ ...primaryButton, marginTop: 12, opacity: busy ? 0.6 : 1 }} disabled={busy}>
          {busy ? "Saving…" : "Add reference image"}
        </button>
      </form>

      <div style={{ marginTop: 18, color: colors.muted, fontSize: 13 }}>
        {assets.length} saved · {approvedCount} approved for generation context
      </div>

      {assets.length ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))", gap: 12, marginTop: 12 }}>
          {assets.map((asset) => (
            <article key={asset.id} style={{ border: "1px solid #4a3565", borderRadius: 16, overflow: "hidden", background: "rgba(13,10,21,.52)" }}>
              {asset.preview_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={asset.preview_url}
                  alt={asset.title}
                  style={{ display: "block", width: "100%", aspectRatio: "4 / 5", objectFit: "cover", background: "#160f20" }}
                />
              ) : (
                <div style={{ aspectRatio: "4 / 5", display: "grid", placeItems: "center", color: colors.muted }}>Preview unavailable</div>
              )}
              <div style={{ padding: 12 }}>
                <div style={{ display: "flex", gap: 7, flexWrap: "wrap", alignItems: "center" }}>
                  <strong>{asset.title}</strong>
                  {asset.is_primary ? (
                    <span style={{ fontSize: 11, fontWeight: 800, padding: "4px 7px", borderRadius: 999, color: "#f3e8ff", background: "#53317c", border: "1px solid #8b5cf6" }}>
                      Primary
                    </span>
                  ) : null}
                  <span style={{ fontSize: 11, color: colors.muted }}>{assetLabels[asset.asset_type]}</span>
                </div>

                {asset.prompt_notes ? <p style={{ color: colors.muted, fontSize: 13, lineHeight: 1.45 }}>{asset.prompt_notes}</p> : null}
                {Array.isArray(asset.tags) && asset.tags.length ? (
                  <div style={{ color: "#c4a7ef", fontSize: 12, marginTop: 6 }}>{asset.tags.map((tag) => `#${tag}`).join(" ")}</div>
                ) : null}

                <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginTop: 10 }}>
                  {!asset.is_primary ? (
                    <button type="button" style={secondaryButton} disabled={busy} onClick={() => void makePrimary(asset)}>
                      Make primary
                    </button>
                  ) : null}
                  <button type="button" style={secondaryButton} disabled={busy} onClick={() => void toggleApproved(asset)}>
                    {asset.approved ? "Exclude from generation" : "Approve for generation"}
                  </button>
                  <button type="button" style={secondaryButton} disabled={busy} onClick={() => void removeAsset(asset)}>
                    Remove
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div style={{ marginTop: 14, padding: 14, border: "1px dashed #4a3565", borderRadius: 14, color: colors.muted }}>
          No references yet. Add the strongest face/identity image first, then add alternate expressions or lighting.
        </div>
      )}

      {message ? (
        <p role="status" aria-live="polite" style={{ color: "#d8c8eb", background: "#21172f", border: "1px solid #4d3769", borderRadius: 12, padding: 12, marginBottom: 0 }}>
          {message}
        </p>
      ) : null}
    </section>
  );
}
