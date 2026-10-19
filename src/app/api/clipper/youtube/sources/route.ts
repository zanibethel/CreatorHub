import { NextRequest } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { validYouTubeId, youtubeData, YouTubeDiscoveryError } from "@/lib/youtube-discovery";

export const dynamic = "force-dynamic";

async function workspaceFor(creatorId: string) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || user.is_anonymous) {
    return { error: Response.json({ error: "Sign in to manage saved channels." }, { status: 401 }) };
  }
  const { data: access } = await supabase.from("creatorhub_account_access")
    .select("access_level").eq("user_id", user.id).maybeSingle();
  if (access?.access_level !== "full") {
    return { error: Response.json({ error: "Full CreatorHub access is required." }, { status: 403 }) };
  }
  const { data: creator } = await supabase.from("creators")
    .select("id").eq("id", creatorId).eq("user_id", user.id).maybeSingle();
  if (!creator) {
    return { error: Response.json({ error: "Creator workspace not found." }, { status: 403 }) };
  }
  return { supabase, userId: user.id };
}

export async function GET(request: NextRequest) {
  const creatorId = request.nextUrl.searchParams.get("creatorId") ?? "";
  const context = await workspaceFor(creatorId);
  if ("error" in context) return context.error;

  const { data, error } = await context.supabase.from("clipper_youtube_channels")
    .select("channel_id,channel_title,thumbnail_url,created_at")
    .eq("user_id", context.userId).eq("creator_id", creatorId)
    .order("created_at", { ascending: false }).limit(100);
  if (error) return Response.json({ error: "Could not load saved channels." }, { status: 500 });
  return Response.json({ channels: data ?? [] }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const creatorId = typeof body.creatorId === "string" ? body.creatorId : "";
  const channelId = typeof body.channelId === "string" ? body.channelId : "";
  const context = await workspaceFor(creatorId);
  if ("error" in context) return context.error;
  if (!validYouTubeId("channel", channelId)) {
    return Response.json({ error: "Invalid YouTube channel." }, { status: 400 });
  }

  try {
    // Resolve metadata from YouTube instead of trusting client-supplied names/URLs.
    const data = await youtubeData("channels", { part: "snippet", id: channelId });
    const item = (data.items as unknown as Array<{
      id?: string;
      snippet?: { title?: string; thumbnails?: Record<string, { url?: string }> };
    }> | undefined)?.find((row) => row.id === channelId);
    if (!item) return Response.json({ error: "Channel not found on YouTube." }, { status: 404 });
    const candidate = item.snippet?.thumbnails?.medium?.url ?? item.snippet?.thumbnails?.default?.url ?? "";
    const thumbnail = candidate.startsWith("https://") ? candidate : null;

    const { error } = await context.supabase.from("clipper_youtube_channels").upsert({
      user_id: context.userId,
      creator_id: creatorId,
      channel_id: channelId,
      channel_title: item.snippet?.title ?? "YouTube channel",
      thumbnail_url: thumbnail,
    }, { onConflict: "creator_id,channel_id" });
    if (error) return Response.json({ error: "Could not save channel. The Clipper database migration may be pending." }, { status: 500 });
    return Response.json({ saved: true });
  } catch (error) {
    const status = error instanceof YouTubeDiscoveryError ? error.status : 502;
    return Response.json({
      error: error instanceof YouTubeDiscoveryError ? error.message : "Channel lookup failed.",
    }, { status });
  }
}

export async function DELETE(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const creatorId = typeof body.creatorId === "string" ? body.creatorId : "";
  const channelId = typeof body.channelId === "string" ? body.channelId : "";
  const context = await workspaceFor(creatorId);
  if ("error" in context) return context.error;
  if (!validYouTubeId("channel", channelId)) {
    return Response.json({ error: "Invalid YouTube channel." }, { status: 400 });
  }
  const { error } = await context.supabase.from("clipper_youtube_channels")
    .delete().eq("user_id", context.userId).eq("creator_id", creatorId).eq("channel_id", channelId);
  if (error) return Response.json({ error: "Could not remove channel." }, { status: 500 });
  return Response.json({ removed: true });
}
