import { NextRequest } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { parseYouTubeUrl, YouTubeUrlError } from "@/lib/youtube-url";
import { quotaPublicFields, reserveYouTubeApiCall, YouTubeQuotaError } from "@/lib/clipper-youtube-quota-server";
import { youtubeData, validYouTubeId, YouTubeDiscoveryError, type YouTubeHit } from "@/lib/youtube-discovery";
import { playlistPreview, type PlaylistItem } from "@/lib/youtube-playlist-preview";

export const dynamic = "force-dynamic";

type Snippet = {
  title?: string;
  channelId?: string;
  channelTitle?: string;
  videoOwnerChannelId?: string;
  description?: string;
  publishedAt?: string;
  thumbnails?: Record<string, { url?: string }>;
  resourceId?: { videoId?: string };
};
type VideoRow = {
  id?: string;
  snippet?: Snippet;
  status?: { embeddable?: boolean; privacyStatus?: string };
};
type ChannelRow = { id?: string; snippet?: Snippet };

function imageUrl(snippet?: Snippet): string | null {
  const url = snippet?.thumbnails?.medium?.url ?? snippet?.thumbnails?.default?.url ?? null;
  return url?.startsWith("https://") ? url : null;
}

function asVideoHit(videoId: string, snippet?: Snippet): YouTubeHit | null {
  if (!validYouTubeId("video", videoId) || !snippet?.channelId ||
      !validYouTubeId("channel", snippet.channelId)) return null;
  return {
    kind: "video",
    id: videoId,
    channelId: snippet.channelId,
    title: snippet.title ?? "Untitled",
    channelTitle: snippet.channelTitle ?? "",
    description: snippet.description ?? "",
    thumbnail: imageUrl(snippet),
    publishedAt: snippet.publishedAt ?? null,
  };
}

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || user.is_anonymous) {
    return Response.json({ error: "Sign in to open YouTube links." }, { status: 401 });
  }
  const { data: access } = await supabase.from("creatorhub_account_access")
    .select("access_level").eq("user_id", user.id).maybeSingle();
  if (access?.access_level !== "full") {
    return Response.json({ error: "Full CreatorHub access is required." }, { status: 403 });
  }
  const body = await request.json().catch(() => null);
  const creatorId = typeof body?.creatorId === "string" ? body.creatorId : "";
  const { data: creator } = await supabase.from("creators")
    .select("id").eq("id", creatorId).eq("user_id", user.id).maybeSingle();
  if (!creator) return Response.json({ error: "Creator workspace not found." }, { status: 403 });

  let parsed: ReturnType<typeof parseYouTubeUrl>;
  try {
    if (typeof body?.url !== "string") throw new YouTubeUrlError("Provide a YouTube URL.");
    parsed = parseYouTubeUrl(body.url);
  } catch (error) {
    return Response.json({
      error: error instanceof YouTubeUrlError ? error.message : "Invalid YouTube URL.",
    }, { status: 400 });
  }

  try {
    if (parsed.kind === "video") {
      const response = await youtubeData("videos", {
        part: "snippet,status", id: parsed.videoId,
      }, () => reserveYouTubeApiCall(user.id, "videos"));
      const video = (response.items as unknown as VideoRow[] | undefined)?.find((item) => item.id === parsed.videoId);
      if (!video || video.status?.embeddable === false || video.status?.privacyStatus === "private") {
        return Response.json({ error: "This video is unavailable for public preview." }, { status: 404 });
      }
      const hit = asVideoHit(parsed.videoId, video.snippet);
      if (!hit) return Response.json({ error: "Could not resolve video metadata." }, { status: 404 });
      return Response.json({ kind: "video", item: hit }, { headers: { "Cache-Control": "private, no-store" } });
    }

    if (parsed.kind === "channel" || parsed.kind === "handle") {
      const params: Record<string, string> = parsed.kind === "handle"
        ? { part: "snippet", forHandle: parsed.handle }
        : { part: "snippet", id: parsed.channelId };
      const response = await youtubeData("channels", params, () => reserveYouTubeApiCall(user.id, "channels"));
      const row = (response.items as unknown as ChannelRow[] | undefined)?.[0];
      if (!row?.id || !validYouTubeId("channel", row.id)) {
        return Response.json({ error: "YouTube channel was not found." }, { status: 404 });
      }
      const hit: YouTubeHit = {
        kind: "channel", id: row.id, channelId: row.id,
        title: row.snippet?.title ?? "YouTube channel",
        channelTitle: row.snippet?.title ?? "YouTube channel",
        description: row.snippet?.description ?? "",
        thumbnail: imageUrl(row.snippet), publishedAt: row.snippet?.publishedAt ?? null,
      };
      return Response.json({ kind: "channel", item: hit }, { headers: { "Cache-Control": "private, no-store" } });
    }

    // One bounded first page; further pagination belongs to a separate pass.
    const response = await youtubeData("playlistItems", {
      part: "snippet,contentDetails", playlistId: parsed.playlistId, maxResults: "12",
    }, () => reserveYouTubeApiCall(user.id, "playlistItems"));
    const rows = (response.items as unknown as PlaylistItem[] | undefined) ?? [];
    const items = rows.flatMap((row) => {
      // Playlist ownership differs from video ownership; omit ambiguous rows.
      const hit = playlistPreview(row);
      return hit ? [hit] : [];
    });
    return Response.json({ kind: "playlist", playlistId: parsed.playlistId, items }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    const status = error instanceof YouTubeDiscoveryError ? error.status : 502;
    const quota = error instanceof YouTubeQuotaError && error.quota
      ? quotaPublicFields(error.quota) : undefined;
    return Response.json({
      error: error instanceof YouTubeDiscoveryError ? error.message : "Could not resolve YouTube link.",
      ...(quota ? { quota } : {}),
    }, { status });
  }
}
