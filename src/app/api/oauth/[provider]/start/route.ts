import { NextRequest, NextResponse } from "next/server";
import {
  buildAuthorizationUrl,
  isOAuthProvider,
  providerConfigured,
  randomToken,
} from "@/lib/oauth";

const providerNames: Record<string, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  fanvue: "Fanvue",
};

function setupPage(name: string, creatorId: string) {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>${name} setup</title></head><body style="font-family:Arial,sans-serif;background:#08070d;margin:0;padding:28px;color:#f7f4ff"><main style="max-width:560px;margin:60px auto;background:#15111f;border:1px solid #3c2a55;border-radius:22px;padding:24px;box-shadow:0 24px 80px rgba(95,43,160,.18)"><div style="font-size:13px;font-weight:800;text-transform:uppercase;color:#b59ad8;letter-spacing:.08em">CreatorHub connection</div><h1>${name}</h1><p style="color:#d2c9df;line-height:1.55">The CreatorHub side of this one-tap connection is ready. We still need the one-time ${name} developer-app credentials before users can authorize their accounts.</p><p style="color:#d2c9df;line-height:1.55">Once those credentials are configured, this same button opens ${name}'s official login/consent screen and returns directly to CreatorHub. Users never copy an authorization code or enter their ${name} password into CreatorHub.</p><button onclick="history.back()" style="border:0;border-radius:999px;padding:12px 18px;background:linear-gradient(135deg,#7c3aed,#a855f7);color:white;font-weight:800">Back to CreatorHub</button><p style="color:#8f84a0;font-size:12px;margin-top:24px">Creator workspace: ${creatorId.replace(/[<>&\"]/g, "")}</p></main></body></html>`;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider: rawProvider } = await params;
  if (!isOAuthProvider(rawProvider)) return new Response("Unsupported provider", { status: 404 });

  const provider = rawProvider;
  const name = providerNames[provider];
  const creatorId = request.nextUrl.searchParams.get("creator_id") ?? "";
  if (!creatorId) return new Response("Missing creator workspace", { status: 400 });

  if (!providerConfigured(provider)) {
    return new Response(setupPage(name, creatorId), {
      status: 503,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  const state = randomToken();
  const verifier = provider === "fanvue" ? randomToken(48) : "";
  const response = NextResponse.redirect(buildAuthorizationUrl(provider, request.nextUrl.origin, state, verifier));

  const cookieOptions = {
    httpOnly: true,
    secure: true,
    sameSite: "lax" as const,
    path: `/api/oauth/${provider}`,
    maxAge: 10 * 60,
  };
  response.cookies.set(`ch_oauth_${provider}_state`, state, cookieOptions);
  response.cookies.set(`ch_oauth_${provider}_creator`, creatorId, cookieOptions);
  if (verifier) response.cookies.set(`ch_oauth_${provider}_verifier`, verifier, cookieOptions);

  return response;
}
