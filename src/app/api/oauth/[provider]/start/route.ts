import { NextRequest } from "next/server";

const providerNames: Record<string, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  fanvue: "Fanvue",
};

export async function GET(request: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const name = providerNames[provider];
  if (!name) return new Response("Unsupported provider", { status: 404 });

  const creatorId = request.nextUrl.searchParams.get("creator_id") ?? "";

  const configured = provider === "instagram"
    ? Boolean(process.env.INSTAGRAM_APP_ID && process.env.INSTAGRAM_APP_SECRET)
    : provider === "tiktok"
      ? Boolean(process.env.TIKTOK_CLIENT_KEY && process.env.TIKTOK_CLIENT_SECRET)
      : Boolean(process.env.FANVUE_CLIENT_ID && process.env.FANVUE_CLIENT_SECRET);

  if (!configured) {
    return new Response(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>${name} setup</title></head><body style="font-family:Arial,sans-serif;background:#f6f7f9;margin:0;padding:28px;color:#15171a"><main style="max-width:560px;margin:60px auto;background:white;border:1px solid #e5e7eb;border-radius:18px;padding:24px"><div style="font-size:13px;font-weight:800;text-transform:uppercase;color:#6b7280">CreatorHub connection</div><h1>${name}</h1><p>The one-tap connection flow is built into CreatorHub, but the CreatorHub developer app credentials for ${name} have not been configured yet.</p><p>Once configured, this same button will open ${name}'s official login/consent screen and return you directly to CreatorHub automatically. No auth-code copying or password entry inside CreatorHub.</p><button onclick="history.back()" style="border:0;border-radius:999px;padding:12px 18px;background:#111;color:white;font-weight:700">Back to CreatorHub</button><p style="color:#9ca3af;font-size:12px;margin-top:24px">Creator workspace: ${creatorId.replace(/[<>&\"]/g, "")}</p></main></body></html>`, {
      status: 503,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  return new Response(`${name} OAuth credentials are configured. Provider-specific authorization exchange is the next implementation step.`, { status: 501 });
}
