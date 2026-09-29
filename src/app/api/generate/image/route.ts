import { generateImage } from "ai";
import { chooseImageModel, type ImageGenerationMode } from "@/lib/generation-router";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type GenerateBody = {
  prompt?: unknown;
  mode?: unknown;
  aspectRatio?: unknown;
  confirmedSpend?: unknown;
  creatorId?: unknown;
  useReferences?: unknown;
};

const MODES = new Set<ImageGenerationMode>(["auto", "economy", "balanced", "premium"]);
const RATIOS = new Set(["1:1", "4:5", "9:16", "16:9"]);

function cleanString(value: unknown, max = 2_000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function safeList(value: unknown) {
  return Array.isArray(value) ? value.map((item) => cleanString(item, 300)).filter(Boolean).slice(0, 12) : [];
}

function creatorPrompt(creator: Record<string, unknown>, prompt: string, usingReferences: boolean) {
  const sections = [
    creator.name ? `Creator: ${cleanString(creator.name, 120)}.` : "",
    creator.visual_description ? `Visual identity: ${cleanString(creator.visual_description, 2_000)}` : "",
    creator.tone ? `Tone: ${cleanString(creator.tone, 500)}` : "",
    creator.persona_lore ? `Persona continuity: ${cleanString(creator.persona_lore, 1_500)}` : "",
    safeList(creator.boundaries).length ? `Boundaries: ${safeList(creator.boundaries).join("; ")}` : "",
    usingReferences
      ? "Reference-image instruction: preserve the same adult character identity, facial structure, hair color, eye color, and overall body proportions from the supplied approved CreatorHub references. Treat the primary reference as the strongest identity anchor. The requested scene, expression, clothing, pose, and lighting may change unless the prompt says otherwise."
      : "Identity instruction: use the saved visual description consistently. No pixel-level reference image is available for this generation.",
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
  const rawRatio = cleanString(body.aspectRatio, 10);
  const aspectRatio = RATIOS.has(rawRatio) ? rawRatio : "4:5";
  const selected = chooseImageModel(mode, prompt, references.length > 0);

  const referenceImages: Uint8Array[] = [];
  const referenceTitles: string[] = [];

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
    }
  }

  const finalPrompt = creatorPrompt(creator as Record<string, unknown>, prompt, referenceImages.length > 0);
  const promptInput =
    referenceImages.length > 0
      ? { text: finalPrompt, images: referenceImages }
      : finalPrompt;

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
            ? "The selected Economy model does not accept reference images, so CreatorHub used the saved visual profile as a text fallback."
            : null,
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
