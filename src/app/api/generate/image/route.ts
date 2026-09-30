import { generateImage } from "ai";
import {
  chooseImageModel,
  type ImageGenerationMode,
  type ImageModelOverride,
} from "@/lib/generation-router";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type GenerateBody = {
  prompt?: unknown;
  mode?: unknown;
  modelOverride?: unknown;
  aspectRatio?: unknown;
  confirmedSpend?: unknown;
  creatorId?: unknown;
  useReferences?: unknown;
  variationMode?: unknown;
};

const MODES = new Set<ImageGenerationMode>(["auto", "economy", "balanced", "premium"]);
const MODEL_OVERRIDES = new Set<ImageModelOverride>([
  "auto",
  "cooperative-local",
  "cooperative-local-fast",
  "cooperative-local-quality",
  "recraft-v4.1-flash",
  "gpt-image-2.5-flare",
  "gpt-image-2.5-sunburst",
]);
const RATIOS = new Set(["1:1", "4:5", "9:16", "16:9"]);
const VARIATION_MODES = new Set(["preserve", "balanced", "new-scene"]);

function cleanString(value: unknown, max = 2_000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function safeList(value: unknown) {
  return Array.isArray(value) ? value.map((item) => cleanString(item, 300)).filter(Boolean).slice(0, 12) : [];
}

function creatorPrompt(
  creator: Record<string, unknown>,
  prompt: string,
  usingReferences: boolean,
  variationMode: "preserve" | "balanced" | "new-scene",
) {
  const sections = [
    creator.name ? `Creator: ${cleanString(creator.name, 120)}.` : "",
    creator.visual_description ? `Visual identity: ${cleanString(creator.visual_description, 2_000)}` : "",
    creator.tone ? `Tone: ${cleanString(creator.tone, 500)}` : "",
    creator.persona_lore ? `Persona continuity: ${cleanString(creator.persona_lore, 1_500)}` : "",
    safeList(creator.boundaries).length ? `Boundaries: ${safeList(creator.boundaries).join("; ")}` : "",
    usingReferences
      ? "Reference-image instruction: preserve the same adult character identity, facial structure, hair color, eye color, and overall body proportions from the supplied approved CreatorHub references. Treat the primary reference as the strongest identity anchor."
      : "Identity instruction: use the saved visual description consistently. No pixel-level reference image is available for this generation.",
    usingReferences && variationMode === "preserve"
      ? "Variation instruction: stay close to the primary reference composition and pose while applying the requested changes."
      : usingReferences && variationMode === "new-scene"
        ? "Variation instruction: preserve identity, but do not preserve the reference pose, framing, background, or composition. Create a genuinely new scene that follows the generation request."
        : usingReferences
          ? "Variation instruction: preserve identity while allowing meaningful changes to pose, framing, expression, clothing, lighting, and setting when requested."
          : "",
  ].filter(Boolean);

  return `${sections.join("\n")}\n\nGeneration request:\n${prompt}`;
}

export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user || user.is_anonymous) {
    return Response.json({ error: "Sign in with a permanent CreatorHub account first." }, { status: 401 });
  }

  let body: GenerateBody;
  try {
    body = (await request.json()) as GenerateBody;
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (body.confirmedSpend !== true) {
    return Response.json(
      { error: "Image generation requires explicit confirmation because it can incur model charges." },
      { status: 409 },
    );
  }

  const creatorId = cleanString(body.creatorId, 100);
  const prompt = cleanString(body.prompt);
  if (!creatorId) return Response.json({ error: "Creator is required." }, { status: 400 });
  if (prompt.length < 3) return Response.json({ error: "Prompt must be at least 3 characters." }, { status: 400 });

  const { data: creator, error: creatorError } = await supabase
    .from("creators")
    .select("id,name,niche,target_audience,tone,visual_description,persona_lore,boundaries,content_pillars")
    .eq("id", creatorId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (creatorError || !creator) {
    return Response.json({ error: "Creator workspace not found." }, { status: 404 });
  }

  const wantsReferences = body.useReferences !== false;
  let references: Array<{ id: string; title: string; storage_path: string; is_primary: boolean; prompt_notes: string | null }> = [];

  if (wantsReferences) {
    const { data } = await supabase
      .from("creator_assets")
      .select("id,title,storage_path,is_primary,prompt_notes")
      .eq("creator_id", creatorId)
      .eq("user_id", user.id)
      .eq("approved", true)
      .in("asset_type", ["profile_photo", "character_reference", "style_reference"])
      .order("is_primary", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(3);

    references = data ?? [];
  }

  const requestedMode = cleanString(body.mode, 20) as ImageGenerationMode;
  const mode = MODES.has(requestedMode) ? requestedMode : "auto";
  const requestedModelOverride = cleanString(body.modelOverride, 40) as ImageModelOverride;
  const modelOverride = MODEL_OVERRIDES.has(requestedModelOverride) ? requestedModelOverride : "auto";
  const rawRatio = cleanString(body.aspectRatio, 10);
  const aspectRatio = RATIOS.has(rawRatio) ? rawRatio : "4:5";
  const requestedVariationMode = cleanString(body.variationMode, 20);
  const variationMode = VARIATION_MODES.has(requestedVariationMode)
    ? (requestedVariationMode as "preserve" | "balanced" | "new-scene")
    : "balanced";
  const selected = chooseImageModel(mode, prompt, references.length > 0, modelOverride);

  const referenceImages: Uint8Array[] = [];
  const referenceTitles: string[] = [];
  const referenceRemoteUrls: Array<{ url: string; title: string }> = [];

  if (selected.supportsReferences && references.length > 0) {
    for (const reference of references) {
      const { data: signed, error } = await supabase.storage
        .from("creator-reference-assets")
        .createSignedUrl(reference.storage_path, 15 * 60);

      if (error || !signed?.signedUrl) continue;

      const imageResponse = await fetch(signed.signedUrl, { cache: "no-store" });
      if (!imageResponse.ok) continue;

      const contentType = imageResponse.headers.get("content-type") || "";
      if (!contentType.startsWith("image/")) continue;

      const bytes = new Uint8Array(await imageResponse.arrayBuffer());
      if (!bytes.length || bytes.byteLength > 20 * 1024 * 1024) continue;

      referenceImages.push(bytes);
      referenceTitles.push(reference.title);
      referenceRemoteUrls.push({ url: signed.signedUrl, title: reference.title });
    }
  }

  const finalPrompt = creatorPrompt(
    creator as Record<string, unknown>,
    prompt,
    referenceImages.length > 0,
    variationMode,
  );
  const promptInput =
    referenceImages.length > 0
      ? { text: finalPrompt, images: referenceImages }
      : finalPrompt;

  const cooperativeUrl = process.env.COOPERATIVE_INFERENCE_URL?.replace(/\\\/+$/, "");
  const cooperativeSecret = process.env.COOPERATIVE_INFERENCE_SECRET;
  const shouldTryCooperative = selected.target === "auto";

  if (selected.target === "cooperative") {
    if (!cooperativeUrl || !cooperativeSecret) {
      return Response.json(
        {
          error: "CoOperative local image generation is not configured.",
          detail: "The async local queue needs the CoOperative inference connection.",
        },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }

    try {
      const response = await fetch(`${cooperativeUrl}/api/inference/jobs`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${cooperativeSecret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          clientOwnerRef: user.id,
          prompt: finalPrompt,
          aspectRatio,
          profile: selected.localProfile || "fast",
          referenceUrls: referenceRemoteUrls,
          variationMode,
        }),
        cache: "no-store",
      });

      const payload = (await response.json().catch(() => null)) as
        | {
            jobId?: string;
            status?: string;
            detail?: string;
            error?: string;
            seed?: number;
            variationMode?: "preserve" | "balanced" | "new-scene";
          }
        | null;

      if (!response.ok || !payload?.jobId) {
        return Response.json(
          {
            error: payload?.error || "Could not queue local image generation.",
            detail: payload?.detail || `CoOperative returned HTTP ${response.status}.`,
          },
          { status: 502, headers: { "Cache-Control": "no-store" } },
        );
      }

      const { error: jobError } = await supabase.from("creator_image_jobs").insert({
        user_id: user.id,
        creator_id: creatorId,
        cooperative_job_id: payload.jobId,
        status: "queued",
        prompt,
        model_override: modelOverride,
        local_profile: selected.localProfile || "fast",
        aspect_ratio: aspectRatio,
        use_references: wantsReferences,
        variation_mode: variationMode,
        seed: typeof payload.seed === "number" ? payload.seed : null,
      });

      if (jobError) {
        console.error("CreatorHub could not persist async image job", {
          jobId: payload.jobId,
          detail: jobError.message.slice(0, 500),
        });
      }

      return Response.json(
        {
          ok: true,
          async: true,
          jobId: payload.jobId,
          status: "queued",
          model: selected.model,
          modelLabel: selected.label,
          mode: selected.mode,
          routedBy: "cooperative-async-queue",
          costHint: "local inference · no per-image API charge",
          aspectRatio,
          referenceCount: Math.min(
            referenceRemoteUrls.length,
            selected.localProfile === "quality" && variationMode !== "preserve" ? 2 : 1,
          ),
          referenceTitles: referenceTitles.slice(
            0,
            selected.localProfile === "quality" && variationMode !== "preserve" ? 2 : 1,
          ),
          seed: payload.seed ?? null,
          variationMode: payload.variationMode || variationMode,
          promptUsed: prompt,
          createdAt: new Date().toISOString(),
        },
        { status: 202, headers: { "Cache-Control": "no-store" } },
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Could not queue local image generation.";
      return Response.json(
        { error: "Could not queue local image generation.", detail: detail.slice(0, 500) },
        { status: 502, headers: { "Cache-Control": "no-store" } },
      );
    }
  }

  if (shouldTryCooperative) {
    if (cooperativeUrl && cooperativeSecret) {
      try {
        const response = await fetch(`${cooperativeUrl}/api/inference/image`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${cooperativeSecret}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            prompt: finalPrompt,
            aspectRatio,
            profile: selected.localProfile || "fast",
            referenceUrls: referenceRemoteUrls,
            variationMode,
          }),
          cache: "no-store",
        });

        const payload = (await response.json().catch(() => null)) as
          | {
              dataUrl?: string;
              model?: string;
              provider?: string;
              worker?: string;
              referencesUsed?: number;
              profile?: "fast" | "quality";
              detail?: string;
              seed?: number;
              variationMode?: "preserve" | "balanced" | "new-scene";
            }
          | null;

        if (response.ok && payload?.dataUrl) {
          return Response.json(
            {
              ok: true,
              image: payload.dataUrl,
              model: payload.model || "cooperative-worker",
              modelLabel: payload.model
                ? `Local ${payload.profile === "quality" ? "Quality" : "Fast"} · ${payload.model}`
                : `CoOperative AI · Local ${payload.profile === "quality" ? "Quality" : "Fast"}`,
              mode: selected.mode,
              routedBy: `cooperative-${payload.worker || payload.provider || "worker"}`,
              costHint:
                payload.worker === "local"
                  ? "local inference · no per-image API charge"
                  : "CoOperative-managed inference",
              aspectRatio,
              referenceCount: payload.referencesUsed ?? referenceImages.length,
              referenceTitles: referenceTitles.slice(0, payload.referencesUsed ?? referenceImages.length),
              referenceFallback: null,
              seed: payload.seed ?? null,
              variationMode: payload.variationMode || variationMode,
              promptUsed: prompt,
              createdAt: new Date().toISOString(),
            },
            { headers: { "Cache-Control": "no-store" } },
          );
        }

        const detail = payload?.detail?.slice(0, 500) || `CoOperative returned HTTP ${response.status}.`;
        console.warn("CoOperative inference unavailable; falling back to AI Gateway", {
          status: response.status,
          detail,
        });
      } catch (cooperativeError) {
        const detail =
          cooperativeError instanceof Error ? cooperativeError.message.slice(0, 500) : "unknown error";

        console.warn("CoOperative inference request failed; falling back to AI Gateway", { detail });
      }
    }
  }

  try {
    const result = await generateImage({
      model: selected.model,
      prompt: promptInput,
      aspectRatio: aspectRatio as `${number}:${number}`,
      n: 1,
    });

    const image = result.images[0];
    if (!image?.base64) {
      return Response.json({ error: "The selected image model completed without returning image data." }, { status: 502 });
    }

    return Response.json(
      {
        ok: true,
        image: `data:${image.mediaType || "image/png"};base64,${image.base64}`,
        model: selected.model,
        modelLabel: selected.label,
        mode: selected.mode,
        routedBy: selected.routedBy,
        costHint: selected.costHint,
        aspectRatio,
        referenceCount: referenceImages.length,
        referenceTitles,
        referenceFallback:
          wantsReferences && references.length > 0 && !selected.supportsReferences
            ? "The selected model does not accept reference images, so CreatorHub used the saved visual profile as a text fallback."
            : null,
        seed: null,
        variationMode,
        promptUsed: prompt,
        createdAt: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Image generation failed.";
    const cause =
      error && typeof error === "object" && "cause" in error
        ? (error as { cause?: unknown }).cause
        : null;
    const causeMessage =
      cause instanceof Error
        ? cause.message
        : cause && typeof cause === "object" && "message" in cause
          ? String((cause as { message?: unknown }).message ?? "")
          : "";
    const detailText = [message, causeMessage].filter(Boolean).join(" · ");
    const freeTierBlocked = /free tier users do not have access|upgrade to paid credits/i.test(detailText);

    console.error("CreatorHub image generation failed", {
      model: selected.model,
      referenceCount: referenceImages.length,
      message: message.slice(0, 500),
      cause: causeMessage.slice(0, 500),
    });

    return Response.json(
      {
        error: freeTierBlocked ? "This image model requires paid AI Gateway credits." : "CreatorHub could not generate this image.",
        detail: freeTierBlocked
          ? "No charge was made. Add AI Gateway credits in Vercel or choose another eligible model, then retry."
          : (causeMessage || message).slice(0, 500),
        model: selected.model,
        referenceCount: referenceImages.length,
      },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
