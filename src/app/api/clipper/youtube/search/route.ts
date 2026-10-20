import { NextRequest } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { reserveYouTubeApiCall, quotaPublicFields, YouTubeQuotaError } from "@/lib/clipper-youtube-quota-server";
import { normalizeYouTubeSearch, validYouTubeId, youtubeData, YouTubeDiscoveryError } from "@/lib/youtube-discovery";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || user.is_anonymous) return Response.json({ error: "Sign in to search YouTube." }, { status: 401 });
  const { data: access } = await supabase.from("creatorhub_account_access")
    .select("access_level").eq("user_id", user.id).maybeSingle();
  if (access?.access_level !== "full") return Response.json({ error: "Full CreatorHub access is required." }, { status: 403 });
  const creatorId = request.nextUrl.searchParams.get("creatorId") ?? "";
  const { data: creator } = await supabase.from("creators")
    .select("id").eq("id", creatorId).eq("user_id", user.id).maybeSingle();
  if (!creator) return Response.json({ error: "Creator workspace not found." }, { status: 403 });

  const kind = request.nextUrl.searchParams.get("type");
  const query = (request.nextUrl.searchParams.get("q") ?? "").trim();
  const channelId = (request.nextUrl.searchParams.get("channelId") ?? "").trim();
  if (kind !== "channel" && kind !== "video") {
    return Response.json({ error: "Choose channels or videos." }, { status: 400 });
  }
  if (query.length > 120 || (query.length < 2 && !(kind === "video" && validYouTubeId("channel", channelId)))) {
    return Response.json({ error: "Enter at least two characters to search." }, { status: 400 });
  }
  if (channelId && (kind !== "video" || !validYouTubeId("channel", channelId))) {
    return Response.json({ error: "Invalid channel ID." }, { status: 400 });
  }

  try {
    const params: Record<string, string> = {
      part: "snippet",
      type: kind,
      maxResults: "12",
      safeSearch: "moderate",
    };
    if (query) params.q = query;
    if (channelId) params.channelId = channelId;
    if (kind === "video") params.videoEmbeddable = "true";
    const data = await youtubeData("search", params, () => reserveYouTubeApiCall(user.id, "search"));
    return Response.json({ items: normalizeYouTubeSearch(data.items ?? [], kind) }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    const status = error instanceof YouTubeDiscoveryError ? error.status : 502;
    const message = error instanceof YouTubeDiscoveryError ? error.message : "YouTube search failed.";
    const quota = error instanceof YouTubeQuotaError && error.quota
      ? quotaPublicFields(error.quota) : undefined;
    return Response.json({ error: message, ...(quota ? { quota } : {}) }, { status });
  }
}
