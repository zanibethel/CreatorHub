const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://yufptpfiwdbzzrvhkvux.supabase.co";

export const DEFAULT_MONTHLY_TOKEN_LIMIT = 250_000;
export const DEFAULT_MONTHLY_COST_LIMIT_MICROUSD = 2_500_000;

export type AiBudgetContext = {
  userId: string;
  creatorId?: string | null;
  feature: string;
  model: string;
};

type UsageRow = {
  total_tokens?: number | null;
  estimated_cost_microusd?: number | null;
};

type LimitRow = {
  monthly_token_limit?: number | null;
  monthly_cost_limit_microusd?: number | null;
};

function getAdminHeaders() {
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret) throw new Error("SUPABASE_SECRET_KEY is not configured.");
  return {
    apikey: secret,
    Authorization: `Bearer ${secret}`,
    "Content-Type": "application/json",
  };
}

export async function getUserIdFromAccessToken(token: string) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "",
      Authorization: `Bearer ${token}`,
    },
    cache: "no-store",
  });
  if (!response.ok) return null;
  const user = await response.json();
  return typeof user?.id === "string" ? user.id : null;
}

export function estimateTokens(text: string) {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function estimateClaudeSonnetCostMicrousd(inputTokens: number, outputTokens: number) {
  return Math.max(0, Math.round(inputTokens * 3 + outputTokens * 15));
}

export async function checkAiBudget(context: AiBudgetContext, estimatedInputTokens: number, reservedOutputTokens: number) {
  const headers = getAdminHeaders();
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  const [limitsResponse, usageResponse] = await Promise.all([
    fetch(`${SUPABASE_URL}/rest/v1/ai_usage_limits?user_id=eq.${encodeURIComponent(context.userId)}&select=monthly_token_limit,monthly_cost_limit_microusd`, {
      headers,
      cache: "no-store",
    }),
    fetch(`${SUPABASE_URL}/rest/v1/ai_usage_events?user_id=eq.${encodeURIComponent(context.userId)}&created_at=gte.${encodeURIComponent(monthStart.toISOString())}&status=eq.completed&select=total_tokens,estimated_cost_microusd`, {
      headers,
      cache: "no-store",
    }),
  ]);

  if (!limitsResponse.ok || !usageResponse.ok) throw new Error("Could not read AI usage limits.");

  const limitRows = (await limitsResponse.json()) as LimitRow[];
  const usageRows = (await usageResponse.json()) as UsageRow[];
  const limits = limitRows[0] ?? {};
  const monthlyTokenLimit = Number(limits.monthly_token_limit ?? DEFAULT_MONTHLY_TOKEN_LIMIT);
  const monthlyCostLimitMicrousd = Number(limits.monthly_cost_limit_microusd ?? DEFAULT_MONTHLY_COST_LIMIT_MICROUSD);
  const tokensUsed = usageRows.reduce((sum, row) => sum + Number(row.total_tokens ?? 0), 0);
  const costUsedMicrousd = usageRows.reduce((sum, row) => sum + Number(row.estimated_cost_microusd ?? 0), 0);
  const reservedTokens = estimatedInputTokens + reservedOutputTokens;
  const reservedCostMicrousd = estimateClaudeSonnetCostMicrousd(estimatedInputTokens, reservedOutputTokens);

  return {
    allowed: tokensUsed + reservedTokens <= monthlyTokenLimit && costUsedMicrousd + reservedCostMicrousd <= monthlyCostLimitMicrousd,
    monthlyTokenLimit,
    monthlyCostLimitMicrousd,
    tokensUsed,
    costUsedMicrousd,
    reservedTokens,
    reservedCostMicrousd,
  };
}

export async function recordAiUsage(
  context: AiBudgetContext,
  inputTokens: number,
  outputTokens: number,
  status: "completed" | "failed" | "blocked" = "completed",
  metadata: Record<string, unknown> = {},
) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/ai_usage_events`, {
    method: "POST",
    headers: { ...getAdminHeaders(), Prefer: "return=minimal" },
    body: JSON.stringify({
      user_id: context.userId,
      creator_id: context.creatorId ?? null,
      feature: context.feature,
      model: context.model,
      input_tokens: Math.max(0, Math.round(inputTokens)),
      output_tokens: Math.max(0, Math.round(outputTokens)),
      estimated_cost_microusd: estimateClaudeSonnetCostMicrousd(inputTokens, outputTokens),
      status,
      metadata,
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    console.error("Could not record AI usage", response.status, detail);
  }
}
