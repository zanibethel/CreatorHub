export const dynamic = "force-dynamic";

async function checkClaude() {
  const gatewayToken = process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN;
  if (!gatewayToken) {
    return { configured: false, reachable: false, detail: "No AI Gateway credential is available." };
  }

  try {
    const response = await fetch("https://ai-gateway.vercel.sh/v1/models", {
      headers: { Authorization: `Bearer ${gatewayToken}` },
      cache: "no-store",
    });

    if (!response.ok) {
      return { configured: true, reachable: false, detail: `AI Gateway returned ${response.status}.` };
    }

    const data = await response.json();
    const models = Array.isArray(data?.data) ? data.data : [];
    const claudeAvailable = models.some((model: { id?: string }) => String(model?.id ?? "").startsWith("anthropic/claude"));

    return {
      configured: true,
      reachable: true,
      claudeAvailable,
      detail: claudeAvailable ? "Claude models are available through Vercel AI Gateway." : "AI Gateway is reachable, but no Claude model was found.",
    };
  } catch {
    return { configured: true, reachable: false, detail: "Could not reach Vercel AI Gateway." };
  }
}

async function checkStripe() {
  const stripeSecret = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecret) {
    return { configured: false, reachable: false, detail: "STRIPE_SECRET_KEY is not configured." };
  }

  try {
    const response = await fetch("https://api.stripe.com/v1/account", {
      headers: { Authorization: `Bearer ${stripeSecret}` },
      cache: "no-store",
    });

    if (!response.ok) {
      return { configured: true, reachable: false, detail: `Stripe returned ${response.status}.` };
    }

    const account = await response.json();
    return {
      configured: true,
      reachable: true,
      chargesEnabled: Boolean(account?.charges_enabled),
      payoutsEnabled: Boolean(account?.payouts_enabled),
      detail: "Stripe credentials are valid.",
    };
  } catch {
    return { configured: true, reachable: false, detail: "Could not reach Stripe." };
  }
}

function socialHealth(configured: boolean, provider: string) {
  return {
    configured,
    reachable: configured,
    detail: configured
      ? `${provider} OAuth credentials are configured. Account authorization is available from CreatorHub.`
      : `${provider} developer-app credentials still need to be added.`,
  };
}

export async function GET() {
  const [claude, stripe] = await Promise.all([checkClaude(), checkStripe()]);
  const instagram = socialHealth(Boolean(process.env.INSTAGRAM_APP_ID && process.env.INSTAGRAM_APP_SECRET), "Instagram");
  const tiktok = socialHealth(Boolean(process.env.TIKTOK_CLIENT_KEY && process.env.TIKTOK_CLIENT_SECRET), "TikTok");
  const fanvue = socialHealth(Boolean(process.env.FANVUE_CLIENT_ID && process.env.FANVUE_CLIENT_SECRET), "Fanvue");

  return Response.json(
    {
      ok: Boolean(claude.reachable),
      claude,
      stripe,
      instagram,
      tiktok,
      fanvue,
      checkedAt: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
