// These are the same canonical ID shapes used in YouTube discovery, kept
// local so URL parsing remains a standalone pure module for tests.
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;
function validYouTubeId(kind: "video" | "channel", id: string) {
  return kind === "video" ? VIDEO_ID.test(id) : CHANNEL_ID.test(id);
}

export type YouTubeUrlSelection =
  | { kind: "video"; videoId: string }
  | { kind: "channel"; channelId: string }
  | { kind: "handle"; handle: string }
  | { kind: "playlist"; playlistId: string };

const PLAYLIST_ID = /^[a-zA-Z0-9_-]{10,120}$/;
const HANDLE = /^@[a-zA-Z0-9._-]{3,30}$/;
const HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be", "www.youtu.be"]);

export class YouTubeUrlError extends Error {}

function validatePlaylistId(value: string | null): string {
  if (!value || !PLAYLIST_ID.test(value)) throw new YouTubeUrlError("Invalid YouTube playlist ID.");
  return value;
}

function exactlyOne(params: URLSearchParams, key: string): string | null {
  const values = params.getAll(key);
  if (values.length > 1) throw new YouTubeUrlError("The YouTube link contains duplicate identifiers.");
  return values[0] ?? null;
}

export function parseYouTubeUrl(source: string): YouTubeUrlSelection {
  const raw = source.trim();
  if (!raw || raw.length > 2048) throw new YouTubeUrlError("Enter a valid YouTube link (maximum 2048 characters).");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new YouTubeUrlError("Enter a complete YouTube URL starting with https://.");
  }
  if (!["https:", "http:"].includes(url.protocol) ||
      !HOSTS.has(url.hostname.toLowerCase()) || url.username || url.password || url.port) {
    throw new YouTubeUrlError("Only direct YouTube URLs are supported.");
  }
  if (url.searchParams.has("redirect") || url.pathname.includes("%") || url.pathname.includes("\\") ||
      url.pathname.includes("//")) {
    throw new YouTubeUrlError("Unsupported or encoded YouTube URL path.");
  }

  const path = url.pathname.split("/").filter(Boolean);
  const isShort = url.hostname.toLowerCase().endsWith("youtu.be");
  if (isShort) {
    if (path.length !== 1 || !validYouTubeId("video", path[0])) {
      throw new YouTubeUrlError("Invalid YouTube short link.");
    }
    return { kind: "video", videoId: path[0] };
  }
  if (path.length === 1 && path[0] === "watch") {
    const videoId = exactlyOne(url.searchParams, "v");
    if (videoId !== null) {
      if (!validYouTubeId("video", videoId)) throw new YouTubeUrlError("Invalid YouTube video ID.");
      return { kind: "video", videoId };
    }
    return { kind: "playlist", playlistId: validatePlaylistId(exactlyOne(url.searchParams, "list")) };
  }
  if (path.length === 2 && ["shorts", "live", "embed"].includes(path[0])) {
    if (!validYouTubeId("video", path[1])) throw new YouTubeUrlError("Invalid YouTube video ID.");
    return { kind: "video", videoId: path[1] };
  }
  if (path.length === 1 && path[0] === "playlist") {
    return { kind: "playlist", playlistId: validatePlaylistId(exactlyOne(url.searchParams, "list")) };
  }
  const channelTab = path.length === 2 && ["videos", "shorts", "live", "featured", "playlists"].includes(path[1]);
  if (path[0] === "channel" && (path.length === 2 || (path.length === 3 && ["videos", "shorts", "live", "featured", "playlists"].includes(path[2])))) {
    if (!validYouTubeId("channel", path[1])) throw new YouTubeUrlError("Invalid YouTube channel ID.");
    return { kind: "channel", channelId: path[1] };
  }
  if ((path.length === 1 || channelTab) && path[0].startsWith("@")) {
    if (!HANDLE.test(path[0])) throw new YouTubeUrlError("Unsupported YouTube handle.");
    return { kind: "handle", handle: path[0] };
  }
  throw new YouTubeUrlError("Supported YouTube links: videos, Shorts, channels, @handles, and playlists.");
}
