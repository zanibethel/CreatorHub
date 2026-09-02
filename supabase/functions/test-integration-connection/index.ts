import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function fromBase64(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function deriveKey(secret: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["decrypt"]);
}

async function decrypt(value: string, secret: string) {
  const [version, ivValue, ciphertextValue] = value.split(".");
  if (version !== "v1" || !ivValue || !ciphertextValue) throw new Error("Unsupported encrypted token format.");
  const key = await deriveKey(secret);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(ivValue) },
    key,
    fromBase64(ciphertextValue),
  );
  return new TextDecoder().decode(plaintext);
}

async function providerProfile(provider: string, accessToken: string) {
  if (provider === "instagram") {
    const url = new URL("https://graph.instagram.com/me");
    url.searchParams.set("fields", "id,username");
    url.searchParams.set("access_token", accessToken);
    const response = await fetch(url, { headers: { "Cache-Control": "no-store" } });
    return { response, profile: await response.json() };
  }
  if (provider === "tiktok") {
    const response = await fetch("https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,avatar_url", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const body = await response.json();
    return { response, profile: body?.data?.user ?? body };
  }
  if (provider === "fanvue") {
    const response = await fetch("https://api.fanvue.com/users/me", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "X-Fanvue-API-Version": "2025-06-26",
      },
    });
    return { response, profile: await response.json() };
  }
  throw new Error("Unsupported provider.");
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405, headers: corsHeaders });

  const authHeader = request.headers.get("Authorization") ?? "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const publishableKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const userClient = createClient(supabaseUrl, publishableKey, { global: { headers: { Authorization: authHeader } } });
  const { data: { user }, error: userError } = await userClient.auth.getUser();
  if (userError || !user || user.is_anonymous) return Response.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });

  const body = await request.json();
  const connectionId = String(body.connection_id ?? "");
  if (!connectionId) return Response.json({ error: "connection_id is required" }, { status: 400, headers: corsHeaders });

  const { data: connection } = await userClient.from("integration_connections")
    .select("id,provider")
    .eq("id", connectionId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!connection) return Response.json({ error: "Connection not found" }, { status: 404, headers: corsHeaders });

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const { data: secret } = await admin.from("integration_secrets")
    .select("access_token_ciphertext")
    .eq("connection_id", connection.id)
    .maybeSingle();
  if (!secret?.access_token_ciphertext) return Response.json({ error: "Stored token not found" }, { status: 404, headers: corsHeaders });

  try {
    const accessToken = await decrypt(secret.access_token_ciphertext, serviceRoleKey);
    const { response, profile } = await providerProfile(connection.provider, accessToken);
    if (!response.ok) {
      await admin.from("integration_connections").update({ status: "error", updated_at: new Date().toISOString() }).eq("id", connection.id);
      return Response.json({ error: `${connection.provider} returned ${response.status}. Reconnect the account.` }, { status: 502, headers: corsHeaders });
    }

    const externalId = String(profile?.id ?? profile?.uuid ?? profile?.open_id ?? "") || null;
    const externalName = profile?.username
      ? `@${profile.username}`
      : profile?.display_name || profile?.displayName || "Connected account";
    await admin.from("integration_connections").update({
      status: "connected",
      external_account_id: externalId,
      external_account_name: externalName,
      last_refreshed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", connection.id);

    return Response.json({ ok: true, provider: connection.provider, account_name: externalName }, {
      headers: { ...corsHeaders, "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("Connection test failed", connection.provider, error);
    await admin.from("integration_connections").update({ status: "error", updated_at: new Date().toISOString() }).eq("id", connection.id);
    return Response.json({ error: "Connection test failed. Reconnect the account." }, { status: 500, headers: corsHeaders });
  }
});
