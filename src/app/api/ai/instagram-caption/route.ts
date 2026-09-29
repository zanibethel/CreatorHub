import { NextRequest } from "next/server";
import { getUserIdFromAccessToken } from "@/lib/server/aiUsage";
import { runStructuredAi, StructuredAiError } from "@/lib/server/structuredAi";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://yufptpfiwdbzzrvhkvux.supabase.co";
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_JpayDIqb8Gy-hnGSL99fdg_jmKQQNJh";

const schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    caption: { type: "string" },
    hashtags: {
      type: "array",
      minItems: 0,
      maxItems: 8,
      items: { type: "string" },
    },
  },
  required: ["caption", "hashtags"],
};

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const userId = await getUserIdFromAccessToken(token);
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const creatorId = typeof body.creatorId === "string" ? body.creatorId : "";
  const topic = typeof body.topic === "string" ? body.topic.trim().slice(0, 1200) : "";
  if (!creatorId || !topic) {
    return Response.json({ error: "Creator and post idea are required." }, { status: 400 });
  }

  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/creators?id=eq.${encodeURIComponent(creatorId)}&user_id=eq.${encodeURIComponent(userId)}&select=id,name,description,niche,target_audience,tone,visual_description,persona_lore,boundaries,content_pillars,preferred_platforms`,
    {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` },
      cache: "no-store",
    },
  );
  if (!response.ok) return Response.json({ error: "Could not read creator profile." }, { status: 502 });
  const creator = (await response.json())?.[0];
  if (!creator) return Response.json({ error: "Creator workspace not found." }, { status: 404 });

  try {
    const result = await runStructuredAi<{ caption: string; hashtags: string[] }>({
      userId,
      creatorId,
      feature: "instagram_caption",
      systemPrompt:
        "You are CreatorHub's Instagram copy strategist. Write natural, specific captions that sound human and fit the creator's established tone. Do not invent claims, experiences, products, results, sponsorships, or facts. Avoid engagement bait, fake urgency, and excessive hashtags. Return only schema-valid structured output.",
      prompt: `Creator profile: ${JSON.stringify(creator)}\n\nPost idea/context: ${topic}\n\nDraft one Instagram caption with a clear opening and concise CTA when appropriate. Add only relevant hashtags.`,
      schemaName: "creatorhub_instagram_caption",
      schema,
      maxOutputTokens: 600,
      metadata: { creator_id: creatorId },
    });
    return Response.json(result);
  } catch (error) {
    if (error instanceof StructuredAiError) {
      return Response.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error("Instagram caption generation failed", error);
    return Response.json({ error: "CreatorHub could not draft the caption right now." }, { status: 502 });
  }
}
