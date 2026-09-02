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

export function oauthOrigin(requestOrigin: string) {
  const configured = (process.env.OAUTH_REDIRECT_ORIGIN || process.env.NEXT_PUBLIC_APP_URL || "").trim();
  if (!configured) return requestOrigin.replace(/\/$/, "");
  try {
    const url = new URL(configured);
    if (url.protocol !== "https:" && url.hostname !== "localhost") throw new Error("OAuth origin must use HTTPS.");
    return url.origin;
  } catch {
    throw new Error("OAUTH_REDIRECT_ORIGIN or NEXT_PUBLIC_APP_URL is invalid.");
  }
}

export function providerConfigured(provider: OAuthProvider) {
  if (provider === "instagram") return Boolean(process.env.INSTAGRAM_APP_ID && process.env.INSTAGRAM_APP_SECRET);
  if (provider === "tiktok") return Boolean(process.env.TIKTOK_CLIENT_KEY && process.env.TIKTOK_CLIENT_SECRET);
  return Boolean(process.env.FANVUE_CLIENT_ID && process.env.FANVUE_CLIENT_SECRET);
}

export function providerScopes(provider: OAuthProvider) {
  if (provider === "instagram") {
    return process.env.INSTAGRAM_SCOPES || "instagram_business_basic,instagram_business_content_publish";
  }
  if (provider === "tiktok") return process.env.TIKTOK_SCOPES || "user.info.basic";
  return process.env.FANVUE_SCOPES || "openid offline_access offline read:self";
}

export function buildAuthorizationUrl(provider: OAuthProvider, origin: string, state: string, verifier?: string) {
  const redirectUri = callbackUrl(origin, provider);

  if (provider === "tiktok") {
    const url = new URL("https://www.tiktok.com/v2/auth/authorize/");
    url.searchParams.set("client_key", process.env.TIKTOK_CLIENT_KEY!);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", providerScopes(provider));
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("state", state);
    return url;
  }

  if (provider === "fanvue") {
    if (!verifier) throw new Error("Fanvue requires a PKCE verifier.");
    const url = new URL("https://auth.fanvue.com/oauth2/auth");
    url.searchParams.set("client_id", process.env.FANVUE_CLIENT_ID!);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", providerScopes(provider));
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", pkceChallenge(verifier));
    url.searchParams.set("code_challenge_method", "S256");
    return url;
  }

  const url = new URL("https://www.instagram.com/oauth/authorize");
  url.searchParams.set("client_id", process.env.INSTAGRAM_APP_ID!);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", providerScopes(provider));
  url.searchParams.set("state", state);
  return url;
}
