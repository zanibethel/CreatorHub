import test from "node:test";
import assert from "node:assert/strict";
import { playlistPreview } from "../src/lib/youtube-playlist-preview.ts";

const videoOwner = "UC" + "b".repeat(22);
const playlistOwner = "UC" + "a".repeat(22);
const videoId = "AbCdEf123_-";
const item = {
  snippet: {
    title: "Video from another creator",
    channelId: playlistOwner,
    channelTitle: "Playlist holder",
    videoOwnerChannelId: videoOwner,
    videoOwnerChannelTitle: "Actual uploader",
    publishedAt: "2026-10-10T12:00:00Z",
    description: "Licensed video metadata preview",
    thumbnails: { medium: { url: "https://i.ytimg.com/vi/abc/mqdefault.jpg" } },
  },
  contentDetails: {
    videoId,
    videoPublishedAt: "2026-06-01T12:00:00Z",
  },
  status: { privacyStatus: "public" },
};

test("playlist preview attributes metadata to the actual video owner, not playlist owner", () => {
  const result = playlistPreview(item);
  assert.equal(result?.id, videoId);
  assert.equal(result?.channelId, videoOwner);
  assert.equal(result?.channelTitle, "Actual uploader");
  assert.equal(result?.publishedAt, "2026-06-01T12:00:00Z");
  assert.equal(result?.title, "Video from another creator");
});

test("ambiguous, unavailable, or unsafe items are hidden instead of mislabeled", () => {
  assert.equal(playlistPreview({ ...item, snippet: { ...item.snippet, videoOwnerChannelId: undefined } }), null);
  assert.equal(playlistPreview({ ...item, snippet: { ...item.snippet, videoOwnerChannelId: "invalid" } }), null);
  assert.equal(playlistPreview({ ...item, contentDetails: { videoId: "/etc/passwd" } }), null);
  assert.equal(playlistPreview({ ...item, status: { privacyStatus: "private" } }), null);
  assert.equal(playlistPreview({ ...item, snippet: { ...item.snippet, title: "Deleted video" } }), null);
  assert.equal(playlistPreview({ ...item, snippet: { ...item.snippet, thumbnails: { medium: { url: "javascript:alert(1)" } } } })?.thumbnail, null);
});
