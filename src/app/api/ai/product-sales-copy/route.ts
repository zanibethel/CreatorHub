import { NextRequest } from "next/server";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://yufptpfiwdbzzrvhkvux.supabase.co";
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_JpayDIqb8Gy-hnGSL99fdg_jmKQQNJh";

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

  const body = await request.json();
  const productId = String(body.productId ?? "");
  if (!productId) return Response.json({ error: "Product is required." }, { status: 400 });

  const productResponse = await fetch(`${SUPABASE_URL}/rest/v1/products?id=eq.${encodeURIComponent(productId)}&select=id,title,description,price_cents,currency,product_type`, {
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

  const response = await fetch("https://ai-gateway.vercel.sh/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${gatewayToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "anthropic/claude-sonnet-4.6",
      messages: [
        { role: "system", content: "You are CreatorHub's product conversion strategist. Return only schema-valid structured output." },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_schema", json_schema: { name: "creatorhub_product_sales_copy", strict: true, schema } },
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    console.error("AI Gateway error", response.status, detail);
    return Response.json({ error: "Claude could not generate product copy right now." }, { status: 502 });
  }

  const data = await response.json();
  const raw = data?.choices?.[0]?.message?.content;
  if (!raw) return Response.json({ error: "Claude returned no content." }, { status: 502 });
  try {
    return Response.json(JSON.parse(raw));
  } catch {
    return Response.json({ error: "Claude returned invalid structured output." }, { status: 502 });
  }
}
