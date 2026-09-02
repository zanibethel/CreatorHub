import { NextRequest } from "next/server";
import { getUserIdFromAccessToken } from "@/lib/server/aiUsage";
import { runStructuredAi, StructuredAiError } from "@/lib/server/structuredAi";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://yufptpfiwdbzzrvhkvux.supabase.co";
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_JpayDIqb8Gy-hnGSL99fdg_jmKQQNJh";

const outlineSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string" },
    subtitle: { type: "string" },
    positioning: { type: "string" },
    chapters: {
      type: "array",
      minItems: 5,
      maxItems: 20,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          summary: { type: "string" },
        },
        required: ["title", "summary"],
      },
    },
  },
  required: ["title", "subtitle", "positioning", "chapters"],
};

type OutlineResult = {
  title: string;
  subtitle: string;
  positioning: string;
  chapters: Array<{ title: string; summary: string }>;
};

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const userId = token ? await getUserIdFromAccessToken(token) : null;
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const projectId = String(body.projectId ?? "");
  if (!projectId) return Response.json({ error: "Ebook project is required." }, { status: 400 });

  const projectResponse = await fetch(`${SUPABASE_URL}/rest/v1/ebook_projects?id=eq.${encodeURIComponent(projectId)}&select=id,creator_id,title,topic,target_audience,core_promise,tone,target_word_count,distribution_mode`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!projectResponse.ok) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const project = (await projectResponse.json())?.[0];
  if (!project) return Response.json({ error: "Ebook project not found." }, { status: 404 });

  const prompt = `Design a commercially useful ebook outline from this creator-approved brief. The outline must deliver the promise progressively, avoid repetitive chapters, and give every chapter a distinct job. Use credible, practical language. Do not invent research, quotes, credentials, or guaranteed outcomes. The creator will review and edit this before drafting.\n\nBrief:\n${JSON.stringify(project)}`;

  try {
    const result = await runStructuredAi<OutlineResult>({
      userId,
      creatorId: typeof project.creator_id === "string" ? project.creator_id : null,
      feature: "ebook_outline",
      systemPrompt: "You are CreatorHub's developmental editor and ethical digital-product strategist. Return only schema-valid structured output.",
      prompt,
      schemaName: "creatorhub_ebook_outline",
      schema: outlineSchema,
      maxOutputTokens: 2200,
      metadata: { ebook_project_id: project.id },
    });
    return Response.json(result);
  } catch (error) {
    if (error instanceof StructuredAiError) return Response.json({ error: error.message, code: error.code }, { status: error.status });
    console.error("Ebook outline error", error);
    return Response.json({ error: "CreatorHub could not generate the outline." }, { status: 503 });
  }
}
