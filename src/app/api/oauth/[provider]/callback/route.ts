import { NextRequest, NextResponse } from "next/server";
import { callbackUrl, isOAuthProvider } from "@/lib/oauth";
import { createServerSupabaseClient } from "@/lib/supabase-server";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://yufptpfiwdbzzrvhkvux.supabase.co";
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_JpayDIqb8Gy-hnGSL99fdg_jmKQQNJh";

function appRedirect(request: NextRequest, provider: string, status: string) {
  const url = new URL("/", request.nextUrl.origin);
  url.searchParams.set("connection", provider);
  url.searchParams.set("connection_status", status);
  return NextResponse.redirect(url);
}

async function exchangeTikTok(code: string, redirectUri: string) {
  const response = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: process.env.TIKTOK_CLIENT_KEY!,
      client_secret: process.env.TIKTOK_CLIENT_SECRET!,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error_description || data?.error || "TikTok token exchange failed");
  return data;
}

async function exchangeFanvue(code: string, redirectUri: string, verifier: string) {
  const response = await fetch("https://auth.fanvue.com/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: process.env.FANVUE_CLIENT_ID!,
      client_secret: process.env.FANVUE_CLIENT_SECRET!,
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error_description || data?.error || "Fanvue token exchange failed");
  return data;
}

async function exchangeInstagram(code: string, redirectUri: string) {
  const form = new FormData();
  form.set("client_id", process.env.INSTAGRAM_APP_ID!);
  form.set("client_secret", process.env.INSTAGRAM_APP_SECRET!);
  form.set("grant_type", "authorization_code");
  form.set("redirect_uri", redirectUri);
  form.set("code", code);
  const response = await fetch("https://api.instagram.com/oauth/access_token", { method: "POST", body: form });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error_message || data?.error?.message || "Instagram token exchange failed");
  return data;
}

async function getInstagramProfile(accessToken: string) {
  const url = new URL("https://graph.instagram.com/me");
  url.searchParams.set("fields", "id,username");
  url.searchParams.set("access_token", accessToken);
  const response = await fetch(url, { cache: "no-store" });
  return response.ok ? response.json() : null;
}

async function getTikTokProfile(accessToken: string) {
  const response = await fetch("https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,avatar_url", {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!response.ok) return null;
  const body = await response.json();
  return body?.data?.user ?? null;
}

function fanvueSubject(idToken?: string) {
  if (!idToken) return null;
  try {
    const payload = idToken.split(".")[1];
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"))?.sub ?? null;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider: rawProvider } = await params;
  if (!isOAuthProvider(rawProvider)) return new Response("Unsupported provider", { status: 404 });
  const provider = rawProvider;

  const oauthError = request.nextUrl.searchParams.get("error");
  if (oauthError) return appRedirect(request, provider, "cancelled");

  const code = request.nextUrl.searchParams.get("code") ?? "";
  const state = request.nextUrl.searchParams.get("state") ?? "";
  const expectedState = request.cookies.get(`ch_oauth_${provider}_state`)?.value ?? "";
  const creatorId = request.cookies.get(`ch_oauth_${provider}_creator`)?.value ?? "";
  const verifier = request.cookies.get(`ch_oauth_${provider}_verifier`)?.value ?? "";

  if (!code || !state || !expectedState || state !== expectedState || !creatorId) {
    return appRedirect(request, provider, "invalid_state");
  }

  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  const { data: { session } } = await supabase.auth.getSession();
  if (userError || !user || !session?.access_token) return appRedirect(request, provider, "signin_required");

  const { data: creator } = await supabase.from("creators").select("id").eq("id", creatorId).eq("user_id", user.id).single();
  if (!creator) return appRedirect(request, provider, "invalid_creator");

  try {
    const redirectUri = callbackUrl(request.nextUrl.origin, provider);
    let tokens: any;
    let externalId: string | null = null;
    let externalName: string | null = null;
    let scopes: string[] = [];

    if (provider === "tiktok") {
      tokens = await exchangeTikTok(code, redirectUri);
      externalId = tokens.open_id ?? null;
      scopes = String(tokens.scope ?? "").split(",").filter(Boolean);
      const profile = await getTikTokProfile(tokens.access_token);
      externalName = profile?.display_name ?? "TikTok account";
      externalId = profile?.open_id ?? externalId;
    } else if (provider === "fanvue") {
      if (!verifier) throw new Error("Missing Fanvue PKCE verifier");
      tokens = await exchangeFanvue(code, redirectUri, verifier);
      externalId = fanvueSubject(tokens.id_token);
      externalName = "Fanvue account";
      scopes = String(tokens.scope ?? "").split(/\s+/).filter(Boolean);
    } else {
      tokens = await exchangeInstagram(code, redirectUri);
      externalId = String(tokens.user_id ?? "") || null;
      const profile = await getInstagramProfile(tokens.access_token);
      externalName = profile?.username ? `@${profile.username}` : "Instagram account";
      externalId = profile?.id ?? externalId;
      scopes = (process.env.INSTAGRAM_SCOPES || "instagram_business_basic,instagram_business_content_publish,instagram_business_manage_insights").split(",");
    }

    const existing = await supabase
      .from("integration_connections")
      .select("id")
      .eq("user_id", user.id)
      .eq("creator_id", creatorId)
      .eq("provider", provider)
      .maybeSingle();

    let connectionId = existing.data?.id as string | undefined;
    const connectionValues = {
      user_id: user.id,
      creator_id: creatorId,
      provider,
      status: "connected",
      external_account_id: externalId,
      external_account_name: externalName,
      scopes,
      metadata: { token_type: tokens.token_type ?? "Bearer" },
      connected_at: new Date().toISOString(),
      last_refreshed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    if (connectionId) {
      const { error } = await supabase.from("integration_connections").update(connectionValues).eq("id", connectionId);
      if (error) throw error;
    } else {
      const { data, error } = await supabase.from("integration_connections").insert(connectionValues).select("id").single();
      if (error) throw error;
      connectionId = data.id;
    }

    const expiresAt = tokens.expires_in
      ? new Date(Date.now() + Number(tokens.expires_in) * 1000).toISOString()
      : null;

    const saveResponse = await fetch(`${SUPABASE_URL}/functions/v1/save-integration-tokens-v2`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        apikey: SUPABASE_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        connection_id: connectionId,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token ?? null,
        token_expires_at: expiresAt,
      }),
    });
    if (!saveResponse.ok) {
      await supabase.from("integration_connections").update({ status: "error" }).eq("id", connectionId);
      throw new Error("Secure token storage failed");
    }

    const response = appRedirect(request, provider, "connected");
    response.cookies.delete(`ch_oauth_${provider}_state`);
    response.cookies.delete(`ch_oauth_${provider}_creator`);
    response.cookies.delete(`ch_oauth_${provider}_verifier`);
    return response;
  } catch (error) {
    console.error(`${provider} OAuth callback failed`, error);
    return appRedirect(request, provider, "error");
  }
}
