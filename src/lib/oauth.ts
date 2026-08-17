import { createHash, randomBytes } from "crypto";

export type OAuthProvider = "instagram" | "tiktok" | "fanvue";

export function isOAuthProvider(value: string): value is OAuthProvider {
  return value === "instagram" || value === "tiktok" || value === "fanvue";
}

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

export function pkceChallenge(verifier: string) {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function callbackUrl(origin: string, provider: OAuthProvider) {
  return `${origin}/api/oauth/${provider}/callback`;
}

export function providerConfigured(provider: OAuthProvider) {
  if (provider === "instagram") return Boolean(process.env.INSTAGRAM_APP_ID && process.env.INSTAGRAM_APP_SECRET);
  if (provider === "tiktok") return Boolean(process.env.TIKTOK_CLIENT_KEY && process.env.TIKTOK_CLIENT_SECRET);
  return Boolean(process.env.FANVUE_CLIENT_ID && process.env.FANVUE_CLIENT_SECRET);
}

export function buildAuthorizationUrl(provider: OAuthProvider, origin: string, state: string, verifier?: string) {
  const redirectUri = callbackUrl(origin, provider);

  if (provider === "tiktok") {
    const url = new URL("https://www.tiktok.com/v2/auth/authorize/");
    url.searchParams.set("client_key", process.env.TIKTOK_CLIENT_KEY!);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", process.env.TIKTOK_SCOPES || "user.info.basic");
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("state", state);
    url.searchParams.set("disable_auto_auth", "0");
    return url;
  }

  if (provider === "fanvue") {
    const url = new URL("https://auth.fanvue.com/oauth2/auth");
    url.searchParams.set("client_id", process.env.FANVUE_CLIENT_ID!);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", process.env.FANVUE_SCOPES || "openid offline_access offline read:self");
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", pkceChallenge(verifier!));
    url.searchParams.set("code_challenge_method", "S256");
    return url;
  }

  const url = new URL("https://www.instagram.com/oauth/authorize");
  url.searchParams.set("client_id", process.env.INSTAGRAM_APP_ID!);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set(
    "scope",
    process.env.INSTAGRAM_SCOPES || "instagram_business_basic,instagram_business_content_publish,instagram_business_manage_insights",
  );
  url.searchParams.set("state", state);
  return url;
}
