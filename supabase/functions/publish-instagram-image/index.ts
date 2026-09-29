import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const GRAPH_VERSION = "v26.0";
const GRAPH_BASE = `https://graph.instagram.com/${GRAPH_VERSION}`;

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

function safeText(value: unknown, max = 2200) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function metaMessage(body: any) {
  return safeText(
    body?.error?.error_user_msg ||
      body?.error?.message ||
      body?.error_description ||
      "Instagram rejected the publish request.",
    500,
  );
}

async function metaPost(path: string, values: Record<string, string>) {
  const response = await fetch(`${GRAPH_BASE}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(values),
  });
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

async function waitForContainer(containerId: string, accessToken: string) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const url = new URL(`${GRAPH_BASE}/${containerId}`);
    url.searchParams.set("fields", "status_code,status");
    url.searchParams.set("access_token", accessToken);
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) return;
    const body = await response.json().catch(() => ({}));
    const status = String(body?.status_code ?? "").toUpperCase();
    if (status === "FINISHED") return;
    if (status === "ERROR" || status === "EXPIRED") {
      throw new Error(safeText(body?.status, 500) || "Instagram could not process this image.");
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405, headers: corsHeaders });
  }

  const authHeader = request.headers.get("Authorization") ?? "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: userError } = await userClient.auth.getUser();
  if (userError || !user || user.is_anonymous) {
    return Response.json({ error: "Sign in with a permanent CreatorHub account first." }, { status: 401, headers: corsHeaders });
  }

  const body = await request.json().catch(() => ({}));
  if (body.confirmed_publish !== true) {
    return Response.json({ error: "Publishing requires explicit confirmation." }, { status: 409, headers: corsHeaders });
  }

  const creatorId = safeText(body.creator_id, 100);
  const connectionId = safeText(body.connection_id, 100);
  const imageUrl = safeText(body.image_url, 3000);
  const assetPath = safeText(body.asset_path, 1000);
  const caption = safeText(body.caption, 2200);

  if (!creatorId || !connectionId || !imageUrl || !assetPath) {
    return Response.json({ error: "creator_id, connection_id, image_url, and asset_path are required." }, { status: 400, headers: corsHeaders });
  }

  let parsedImageUrl: URL;
  try {
    parsedImageUrl = new URL(imageUrl);
  } catch {
    return Response.json({ error: "Image URL is invalid." }, { status: 400, headers: corsHeaders });
  }
  if (
    parsedImageUrl.protocol !== "https:" ||
    parsedImageUrl.hostname !== new URL(supabaseUrl).hostname ||
    !parsedImageUrl.pathname.includes("/storage/v1/object/public/creatorhub-social/")
  ) {
    return Response.json({ error: "Publish images must come from CreatorHub social storage." }, { status: 400, headers: corsHeaders });
  }

  const { data: connection, error: connectionError } = await userClient
    .from("integration_connections")
    .select("id,provider,status,external_account_id,external_account_name,scopes")
    .eq("id", connectionId)
    .eq("creator_id", creatorId)
    .eq("user_id", user.id)
    .eq("provider", "instagram")
    .maybeSingle();

  if (connectionError || !connection || connection.status !== "connected") {
    return Response.json({ error: "Instagram connection is not available. Reconnect the account." }, { status: 404, headers: corsHeaders });
  }
  if (!connection.external_account_id) {
    return Response.json({ error: "Instagram account ID is missing. Reconnect the account." }, { status: 409, headers: corsHeaders });
  }
  if (!Array.isArray(connection.scopes) || !connection.scopes.includes("instagram_business_content_publish")) {
    return Response.json({ error: "This Instagram connection does not have content-publishing permission. Reconnect it." }, { status: 403, headers: corsHeaders });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const { data: secret } = await admin
    .from("integration_secrets")
    .select("access_token_ciphertext")
    .eq("connection_id", connection.id)
    .maybeSingle();

  if (!secret?.access_token_ciphertext) {
    return Response.json({ error: "Stored Instagram token was not found. Reconnect the account." }, { status: 404, headers: corsHeaders });
  }

  const { data: post, error: postError } = await admin
    .from("social_posts")
    .insert({
      user_id: user.id,
      creator_id: creatorId,
      connection_id: connection.id,
      provider: "instagram",
      status: "publishing",
      asset_path: assetPath,
      asset_url: imageUrl,
      caption,
      metadata: { graph_version: GRAPH_VERSION, account_name: connection.external_account_name },
    })
    .select("id")
    .single();

  if (postError || !post) {
    return Response.json({ error: "CreatorHub could not create the publishing record." }, { status: 500, headers: corsHeaders });
  }

  try {
    const accessToken = await decrypt(secret.access_token_ciphertext, serviceRoleKey);

    const created = await metaPost(`${connection.external_account_id}/media`, {
      image_url: imageUrl,
      caption,
      access_token: accessToken,
    });
    if (!created.response.ok || !created.body?.id) {
      throw new Error(metaMessage(created.body));
    }

    const containerId = String(created.body.id);
    await waitForContainer(containerId, accessToken);

    const published = await metaPost(`${connection.external_account_id}/media_publish`, {
      creation_id: containerId,
      access_token: accessToken,
    });
    if (!published.response.ok || !published.body?.id) {
      throw new Error(metaMessage(published.body));
    }

    const mediaId = String(published.body.id);
    let permalink: string | null = null;
    try {
      const detailUrl = new URL(`${GRAPH_BASE}/${mediaId}`);
      detailUrl.searchParams.set("fields", "id,permalink,media_type,timestamp");
      detailUrl.searchParams.set("access_token", accessToken);
      const detailResponse = await fetch(detailUrl, { cache: "no-store" });
      const detail = await detailResponse.json().catch(() => ({}));
      permalink = typeof detail?.permalink === "string" ? detail.permalink : null;
    } catch {
      // The publish succeeded even if the optional permalink lookup does not.
    }

    await admin.from("social_posts").update({
      status: "published",
      external_media_id: mediaId,
      permalink,
      published_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      error_message: null,
    }).eq("id", post.id);

    await admin.from("integration_connections").update({
      last_refreshed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", connection.id);

    return Response.json({
      ok: true,
      post_id: post.id,
      media_id: mediaId,
      permalink,
      account_name: connection.external_account_name,
    }, { headers: { ...corsHeaders, "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? safeText(error.message, 500) : "Instagram publishing failed.";
    console.error("Instagram publish failed", { connectionId: connection.id, postId: post.id, message });
    await admin.from("social_posts").update({
      status: "error",
      error_message: message,
      updated_at: new Date().toISOString(),
    }).eq("id", post.id);
    return Response.json({ error: message || "Instagram publishing failed." }, { status: 502, headers: corsHeaders });
  }
});
