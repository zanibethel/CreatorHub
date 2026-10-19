// Server-only YouTube Data API discovery. Never send YOUTUBE_DATA_API_KEY to the browser.
export type YouTubeKind = "channel" | "video";

export type YouTubeHit = {
  kind: YouTubeKind;
  id: string;
  channelId: string;
  title: string;
  channelTitle: string;
  description: string;
  thumbnail: string | null;
  publishedAt: string | null;
};

type SearchItem = {
  id?: { channelId?: string; videoId?: string };
  snippet?: {
    title?: string;
    description?: string;
    channelId?: string;
    channelTitle?: string;
    publishedAt?: string;
    thumbnails?: Record<string, { url?: string }>;
  };
};

const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export function validYouTubeId(kind: YouTubeKind, id: string): boolean {
  return kind === "channel" ? CHANNEL_ID.test(id) : VIDEO_ID.test(id);
}

export class YouTubeDiscoveryError extends Error {
  constructor(message: string, public readonly status = 502) {
    super(message);
  }
}

export async function youtubeData(
  resource: "search" | "channels",
  parameters: Record<string, string>,
): Promise<{ items?: SearchItem[] }> {
  const key = process.env.YOUTUBE_DATA_API_KEY?.trim();
  if (!key) {
    throw new YouTubeDiscoveryError(
      "YouTube discovery is not configured yet. Add YOUTUBE_DATA_API_KEY to the server environment.",
      503,
    );
  }

  const url = new URL(`https://www.googleapis.com/youtube/v3/${resource}`);
  for (const [name, value] of Object.entries(parameters)) url.searchParams.set(name, value);
  url.searchParams.set("key", key);

  let response: Response;
  try {
    response = await fetch(url, { next: { revalidate: 300 } });
  } catch {
    throw new YouTubeDiscoveryError("Could not reach YouTube. Try again shortly.");
  }

  if (!response.ok) {
    const message = response.status === 403 || response.status === 429
      ? "YouTube search is unavailable or its API quota has been reached."
      : "YouTube could not complete this search.";
    throw new YouTubeDiscoveryError(message, response.status === 403 || response.status === 429 ? 429 : 502);
  }
  return (await response.json()) as { items?: SearchItem[] };
}

export function normalizeYouTubeSearch(items: SearchItem[], kind: YouTubeKind): YouTubeHit[] {
  return items.flatMap((item) => {
    const id = kind === "channel" ? item.id?.channelId : item.id?.videoId;
    const channelId = kind === "channel" ? id : item.snippet?.channelId;
    if (!id || !channelId || !validYouTubeId(kind, id) || !validYouTubeId("channel", channelId)) return [];
    const snippet = item.snippet;
    const candidate = snippet?.thumbnails?.medium?.url ?? snippet?.thumbnails?.default?.url ?? null;
    const thumbnail = candidate?.startsWith("https://") ? candidate : null;
    return [{
      kind,
      id,
      channelId,
      title: snippet?.title ?? "Untitled",
      channelTitle: snippet?.channelTitle ?? "",
      description: snippet?.description ?? "",
      thumbnail,
      publishedAt: snippet?.publishedAt ?? null,
    }];
  });
}
