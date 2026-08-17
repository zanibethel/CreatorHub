import { NextRequest } from "next/server";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://yufptpfiwdbzzrvhkvux.supabase.co";
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_JpayDIqb8Gy-hnGSL99fdg_jmKQQNJh";

const recommendationSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    creator_summary: { type: "string" },
    recommendations: {
      type: "array",
      minItems: 1,
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          summary: { type: "string" },
          reason: { type: "string" },
          goal: { type: "string", enum: ["growth", "engagement", "monetization", "learning"] },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          effort_minutes: { type: "integer", minimum: 5, maximum: 240 }
        },
        required: ["title", "summary", "reason", "goal", "confidence", "effort_minutes"]
      }
    }
  },
  required: ["creator_summary", "recommendations"]
};

async function verifySupabaseUser(token: string) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${token}`
    },
    cache: "no-store"
  });
  return response.ok;
}

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token || !(await verifySupabaseUser(token))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const gatewayToken = process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN;
  if (!gatewayToken) {
    return Response.json({ error: "CreatorHub AI is not available in this environment yet." }, { status: 503 });
  }

  const body = await request.json();
  const creator = body.creator ?? {};
  const content = Array.isArray(body.content) ? body.content.slice(0, 30) : [];

  const prompt = `You are the CreatorHub Creator Operator.\n\nYour job is to recommend the next highest-value actions for this creator. Do not chase vanity metrics blindly. Prefer evidence from this creator over generic advice. Distinguish growth content from monetization content. Do not recommend monetizing every post. Never invent metrics. If evidence is weak, say so. Keep recommendations simple enough to execute.\n\nCreator:\n${JSON.stringify(creator)}\n\nRecent content and metrics:\n${JSON.stringify(content)}\n\nReturn at most 3 recommendations. For a brand-new creator with little history, prioritize useful baseline experiments that help CreatorHub learn quickly.`;

  const response = await fetch("https://ai-gateway.vercel.sh/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${gatewayToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "openai/gpt-5.6-sol",
      messages: [
        { role: "system", content: "You are CreatorHub's creator strategy engine. Return only schema-valid structured output." },
        { role: "user", content: prompt }
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "creatorhub_recommendations",
          strict: true,
          schema: recommendationSchema
        }
      }
    })
  });

  if (!response.ok) {
    const detail = await response.text();
    console.error("AI Gateway error", response.status, detail);
    return Response.json({ error: "CreatorHub AI could not generate recommendations right now." }, { status: 502 });
  }

  const data = await response.json();
  const raw = data?.choices?.[0]?.message?.content;
  if (!raw) return Response.json({ error: "CreatorHub AI returned no content." }, { status: 502 });

  try {
    return Response.json(JSON.parse(raw));
  } catch {
    return Response.json({ error: "CreatorHub AI returned an invalid structured response." }, { status: 502 });
  }
}
