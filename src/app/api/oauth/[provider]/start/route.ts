import { NextRequest, NextResponse } from "next/server";
import {
  buildAuthorizationUrl,
  isOAuthProvider,
  providerConfigured,
  randomToken,
} from "@/lib/oauth";
import { createServerSupabaseClient } from "@/lib/supabase-server";

const providerNames: Record<string, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  fanvue: "Fanvue",
};

function setupPage(name: string) {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>${name} setup</title></head><body style="font-family:Arial,sans-serif;background:#08070d;margin:0;padding:28px;color:#f7f4ff"><main style="max-width:560px;margin:60px auto;background:#15111f;border:1px solid #3c2a55;border-radius:22px;padding:24px;box-shadow:0 24px 80px rgba(95,43,160,.18)"><div style="font-size:13px;font-weight:800;text-transform:uppercase;color:#b59ad8;letter-spacing:.08em">CreatorHub connection</div><h1>${name}</h1><p style="color:#d2c9df;line-height:1.55">CreatorHub's OAuth flow is ready. The one-time ${name} developer-app credentials still need to be configured before account authorization can begin.</p><p style="color:#d2c9df;line-height:1.55">After setup, this button opens ${name}'s official consent screen and returns directly to CreatorHub. Creator passwords and authorization codes are never entered into CreatorHub manually.</p><button onclick="history.back()" style="border:0;border-radius:999px;padding:12px 18px;background:linear-gradient(135deg,#7c3aed,#a855f7);color:white;font-weight:800">Back to CreatorHub</button></main></body></html>`;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider: rawProvider } = await params;
  if (!isOAuthProvider(rawProvider)) return new Response("Unsupported provider", { status: 404 });

  const provider = rawProvider;
  const name = providerNames[provider];
  const creatorId = request.nextUrl.searchParams.get("creator_id") ?? "";
  if (!creatorId) return new Response("Missing creator workspace", { status: 400 });

  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/?connection_status=signin_required", request.nextUrl.origin));

  const { data: creator } = await supabase
    .from("creators")
    .select("id")
    .eq("id", creatorId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!creator) return new Response("Creator workspace not found", { status: 403 });

  if (!providerConfigured(provider)) {
    return new Response(setupPage(name), {
      status: 503,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
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
