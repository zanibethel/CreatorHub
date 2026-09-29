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
  creator?: {
    name?: unknown;
    niche?: unknown;
    tone?: unknown;
  };
};

const MODES = new Set<ImageGenerationMode>(["auto", "economy", "balanced", "premium"]);
const RATIOS = new Set(["1:1", "4:5", "9:16", "16:9"]);

function cleanString(value: unknown, max = 2_000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

async function authenticatedUser() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;
  if (user.is_anonymous && process.env.VERCEL_ENV !== "preview") return null;
  return user;
}

function creatorContext(body: GenerateBody) {
  const name = cleanString(body.creator?.name, 120);
  const niche = cleanString(body.creator?.niche, 200);
  const tone = cleanString(body.creator?.tone, 200);
  const context = [
    name ? `Creator: ${name}.` : "",
    niche ? `Niche: ${niche}.` : "",
    tone ? `Tone: ${tone}.` : "",
  ].filter(Boolean);

  return context.length ? `${context.join(" ")}\n\n` : "";
}

export async function POST(request: Request) {
  const user = await authenticatedUser();
  if (!user) {
    return Response.json(
      { error: "Sign in with a permanent account, or use guest mode on a Vercel preview." },
      { status: 401 },
    );
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

  const prompt = cleanString(body.prompt);
  if (prompt.length < 3) {
    return Response.json({ error: "Prompt must be at least 3 characters." }, { status: 400 });
  }

  const requestedMode = cleanString(body.mode, 20) as ImageGenerationMode;
  const mode = MODES.has(requestedMode) ? requestedMode : "auto";
  const rawRatio = cleanString(body.aspectRatio, 10);
  const aspectRatio = RATIOS.has(rawRatio) ? rawRatio : "4:5";
  const selected = chooseImageModel(mode, prompt);

  const finalPrompt = `${creatorContext(body)}${prompt}`;

  try {
    const result = await generateImage({
      model: selected.model,
      prompt: finalPrompt,
      aspectRatio: aspectRatio as `${number}:${number}`,
      n: 1,
    });

    const image = result.images[0];
    if (!image?.base64) {
      return Response.json(
        { error: "The selected image model completed without returning image data." },
        { status: 502 },
      );
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
        createdAt: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Image generation failed.";
    const freeTierBlocked = /free tier users do not have access|upgrade to paid credits/i.test(message);
    return Response.json(
      {
        error: freeTierBlocked
          ? "This image model requires paid AI Gateway credits."
          : "CreatorHub could not generate this image.",
        detail: freeTierBlocked
          ? "No charge was made. Add AI Gateway credits in Vercel, or choose another eligible model, then retry."
          : message.slice(0, 500),
        model: selected.model,
      },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
