import { NextRequest } from "next/server";
import { getUserIdFromAccessToken } from "@/lib/server/aiUsage";
import { runStructuredAi, StructuredAiError } from "@/lib/server/structuredAi";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://yufptpfiwdbzzrvhkvux.supabase.co";
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_JpayDIqb8Gy-hnGSL99fdg_jmKQQNJh";

const chapterSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string" },
    content: { type: "string" },
  },
  required: ["title", "content"],
};

type ChapterResult = { title: string; content: string };

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const userId = token ? await getUserIdFromAccessToken(token) : null;
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const projectId = String(body.projectId ?? "");
  const chapterId = String(body.chapterId ?? "");
  if (!projectId || !chapterId) return Response.json({ error: "Project and chapter are required." }, { status: 400 });

  const [projectResponse, chaptersResponse] = await Promise.all([
    fetch(`${SUPABASE_URL}/rest/v1/ebook_projects?id=eq.${encodeURIComponent(projectId)}&select=id,creator_id,title,topic,target_audience,core_promise,tone,target_word_count`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` }, cache: "no-store",
    }),
    fetch(`${SUPABASE_URL}/rest/v1/ebook_chapters?project_id=eq.${encodeURIComponent(projectId)}&select=id,position,title,summary,status&order=position.asc`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` }, cache: "no-store",
    }),
  ]);
  if (!projectResponse.ok || !chaptersResponse.ok) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const project = (await projectResponse.json())?.[0];
  const chapters = await chaptersResponse.json();
  const chapter = chapters.find((item: { id?: string }) => item.id === chapterId);
  if (!project || !chapter) return Response.json({ error: "Ebook chapter not found." }, { status: 404 });

  const targetChapterWords = Math.max(700, Math.round(Number(project.target_word_count || 12000) / Math.max(1, chapters.length)));
  const prompt = `Draft one ebook chapter in Markdown. Aim for about ${targetChapterWords} words. Make it substantive, readable, and consistent with the brief and full outline. Use short sections, concrete examples, reflection prompts, or action steps when they genuinely help. Do not pad, repeat other chapters, invent facts, fabricate quotations or studies, diagnose readers, or promise guaranteed outcomes. Clearly distinguish illustrative examples from factual claims.\n\nProject:\n${JSON.stringify(project)}\n\nFull outline:\n${JSON.stringify(chapters)}\n\nChapter to draft:\n${JSON.stringify(chapter)}`;

  try {
    const result = await runStructuredAi<ChapterResult>({
      userId,
      creatorId: typeof project.creator_id === "string" ? project.creator_id : null,
      feature: "ebook_chapter_draft",
      systemPrompt: "You are CreatorHub's long-form coauthor. Preserve the creator's ownership and editorial control. Return only schema-valid structured output.",
      prompt,
      schemaName: "creatorhub_ebook_chapter",
      schema: chapterSchema,
      maxOutputTokens: 5000,
      metadata: { ebook_project_id: project.id, ebook_chapter_id: chapter.id },
    });
    return Response.json(result);
  } catch (error) {
    if (error instanceof StructuredAiError) return Response.json({ error: error.message, code: error.code }, { status: error.status });
    console.error("Ebook chapter error", error);
    return Response.json({ error: "CreatorHub could not draft the chapter." }, { status: 503 });
  }
}
