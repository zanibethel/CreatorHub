import type { YouTubeHit } from "./youtube-discovery";

type PlaylistSnippet = {
  title?: string;
  channelId?: string;
  channelTitle?: string;
  videoOwnerChannelId?: string;
  videoOwnerChannelTitle?: string;
  description?: string;
  publishedAt?: string;
  thumbnails?: Record<string, { url?: string }>;
  resourceId?: { videoId?: string };
};

export type PlaylistItem = {
  snippet?: PlaylistSnippet;
  contentDetails?: { videoId?: string; videoPublishedAt?: string };
  status?: { privacyStatus?: string };
};

/** Only videos with verified ownership metadata can be shown/saved by channel. */
export function playlistPreview(item: PlaylistItem): YouTubeHit | null {
  const snippet = item.snippet;
  const videoId = item.contentDetails?.videoId ?? snippet?.resourceId?.videoId;
  const ownerId = snippet?.videoOwnerChannelId;
  if (!videoId || !/^[A-Za-z0-9_-]{11}$/.test(videoId) ||
      !ownerId || !/^UC[A-Za-z0-9_-]{22}$/.test(ownerId) ||
      /^(Private video|Deleted video)$/i.test(snippet?.title ?? "") ||
      item.status?.privacyStatus === "private") return null;

  const image = snippet?.thumbnails?.medium?.url ?? snippet?.thumbnails?.default?.url ?? null;
  return {
    kind: "video",
    id: videoId,
    channelId: ownerId,
    channelTitle: snippet?.videoOwnerChannelTitle ?? "",
    title: snippet?.title ?? "Untitled",
    description: snippet?.description ?? "",
    publishedAt: item.contentDetails?.videoPublishedAt ?? null,
    thumbnail: image?.startsWith("https://") ? image : null,
  };
}
