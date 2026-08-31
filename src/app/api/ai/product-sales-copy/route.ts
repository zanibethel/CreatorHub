import { NextRequest } from "next/server";
import { checkAiBudget, estimateTokens, getUserIdFromAccessToken, recordAiUsage } from "@/lib/server/aiUsage";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://yufptpfiwdbzzrvhkvux.supabase.co";
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_JpayDIqb8Gy-hnGSL99fdg_jmKQQNJh";
const MODEL = "anthropic/claude-sonnet-4.6";
const MAX_OUTPUT_TOKENS = 1600;

const schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    headline: { type: "string" },
    subheadline: { type: "string" },
    bullets: { type: "array", minItems: 3, maxItems: 6, items: { type: "string" } },
    cta: { type: "string" },
    short_caption: { type: "string" },
    reel_hooks: { type: "array", minItems: 3, maxItems: 5, items: { type: "string" } }
  },
  required: ["headline", "subheadline", "bullets", "cta", "short_caption", "reel_hooks"]
};

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const userId = await getUserIdFromAccessToken(token);
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const productId = String(body.productId ?? "");
  if (!productId) return Response.json({ error: "Product is required." }, { status: 400 });

  const productResponse = await fetch(`${SUPABASE_URL}/rest/v1/products?id=eq.${encodeURIComponent(productId)}&select=id,creator_id,title,description,price_cents,currency,product_type`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!productResponse.ok) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const products = await productResponse.json();
  const product = products?.[0];
  if (!product) return Response.json({ error: "Product not found." }, { status: 404 });

  const gatewayToken = process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN;
  if (!gatewayToken) return Response.json({ error: "CreatorHub AI is not available in this environment yet." }, { status: 503 });

  const prompt = `Create conversion-focused sales copy for this CreatorHub product. Be clear, specific, credible, and useful. Do not invent features or outcomes. Avoid fake urgency and exaggerated income/health claims. The creator will use this copy on a public sales page and in social promotion.\n\nProduct:\n${JSON.stringify(product)}`;
  const systemPrompt = "You are CreatorHub's product conversion strategist. Return only schema-valid structured output.";
  const context = {
    userId,
    creatorId: typeof product.creator_id === "string" ? product.creator_id : null,
    feature: "product_sales_copy",
    model: MODEL,
  };
  const estimatedInputTokens = estimateTokens(`${systemPrompt}\n${prompt}`);

  let budget;
  try {
    budget = await checkAiBudget(context, estimatedInputTokens, MAX_OUTPUT_TOKENS);
  } catch (error) {
    console.error("AI budget check failed", error);
    return Response.json({ error: "CreatorHub could not verify AI usage limits." }, { status: 503 });
  }

  if (!budget.allowed) {
    await recordAiUsage(context, 0, 0, "blocked", {
      reason: "monthly_limit",
      tokens_used: budget.tokensUsed,
      monthly_token_limit: budget.monthlyTokenLimit,
      cost_used_microusd: budget.costUsedMicrousd,
      monthly_cost_limit_microusd: budget.monthlyCostLimitMicrousd,
    });
    return Response.json({
      error: "Monthly CreatorHub AI allowance reached.",
      code: "AI_USAGE_LIMIT_REACHED",
      usage: {
        tokensUsed: budget.tokensUsed,
        monthlyTokenLimit: budget.monthlyTokenLimit,
      },
    }, { status: 429 });
  }

  const response = await fetch("https://ai-gateway.vercel.sh/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${gatewayToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      user: userId,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_schema", json_schema: { name: "creatorhub_product_sales_copy", strict: true, schema } },
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    console.error("AI Gateway error", response.status, detail);
    await recordAiUsage(context, 0, 0, "failed", { gateway_status: response.status });
    if (response.status === 402) return Response.json({ error: "CreatorHub's AI budget is currently exhausted." }, { status: 503 });
    if (response.status === 429) return Response.json({ error: "CreatorHub AI is temporarily rate limited. Try again shortly." }, { status: 429 });
    return Response.json({ error: "Claude could not generate product copy right now." }, { status: 502 });
  }

  const data = await response.json();
  const inputTokens = Number(data?.usage?.prompt_tokens ?? estimatedInputTokens);
  const outputTokens = Number(data?.usage?.completion_tokens ?? 0);
  await recordAiUsage(context, inputTokens, outputTokens, "completed", { product_id: product.id });

  const raw = data?.choices?.[0]?.message?.content;
  if (!raw) return Response.json({ error: "Claude returned no content." }, { status: 502 });
  try {
    return Response.json(JSON.parse(raw));
  } catch {
    return Response.json({ error: "Claude returned invalid structured output." }, { status: 502 });
  }
}
