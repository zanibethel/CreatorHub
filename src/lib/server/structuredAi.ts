import { checkAiBudget, estimateTokens, recordAiUsage } from "@/lib/server/aiUsage";

export class StructuredAiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
  }
}

type StructuredAiInput = {
  userId: string;
  creatorId: string | null;
  feature: string;
  systemPrompt: string;
  prompt: string;
  schemaName: string;
  schema: Record<string, unknown>;
  maxOutputTokens: number;
  metadata?: Record<string, unknown>;
};

const MODEL = "anthropic/claude-sonnet-4.6";

export async function runStructuredAi<T>(input: StructuredAiInput): Promise<T> {
  const gatewayToken = process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN;
  if (!gatewayToken) throw new StructuredAiError("CreatorHub AI is not available in this environment yet.", 503);

  const context = {
    userId: input.userId,
    creatorId: input.creatorId,
    feature: input.feature,
    model: MODEL,
  };
  const estimatedInputTokens = estimateTokens(`${input.systemPrompt}\n${input.prompt}`);
  const budget = await checkAiBudget(context, estimatedInputTokens, input.maxOutputTokens);

  if (!budget.allowed) {
    await recordAiUsage(context, 0, 0, "blocked", { reason: "monthly_limit", ...input.metadata });
    throw new StructuredAiError("Monthly CreatorHub AI allowance reached.", 429, "AI_USAGE_LIMIT_REACHED");
  }

  const response = await fetch("https://ai-gateway.vercel.sh/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${gatewayToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: input.maxOutputTokens,
      user: input.userId,
      messages: [
        { role: "system", content: input.systemPrompt },
        { role: "user", content: input.prompt },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: input.schemaName, strict: true, schema: input.schema },
      },
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    console.error("AI Gateway error", response.status, detail);
    await recordAiUsage(context, 0, 0, "failed", { gateway_status: response.status, ...input.metadata });
    if (response.status === 429) throw new StructuredAiError("CreatorHub AI is temporarily rate limited. Try again shortly.", 429);
    if (response.status === 402) throw new StructuredAiError("CreatorHub's AI budget is currently exhausted.", 503);
    throw new StructuredAiError("Claude could not complete this ebook task right now.", 502);
  }

  const data = await response.json();
  const inputTokens = Number(data?.usage?.prompt_tokens ?? estimatedInputTokens);
  const outputTokens = Number(data?.usage?.completion_tokens ?? 0);
  await recordAiUsage(context, inputTokens, outputTokens, "completed", input.metadata);

  const raw = data?.choices?.[0]?.message?.content;
  if (!raw) throw new StructuredAiError("Claude returned no content.", 502);
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new StructuredAiError("Claude returned invalid structured output.", 502);
  }
}
