import test from "node:test";
import assert from "node:assert/strict";
import {
  validYouTubeId,
  normalizeYouTubeSearch,
  youtubeData,
  YouTubeDiscoveryError,
} from "../src/lib/youtube-discovery.ts";

const channel = "UC" + "a".repeat(22);
const video = "AbCdEf123_-";

test("YouTube IDs are checked before building embed links or saving sources", () => {
  assert.equal(validYouTubeId("channel", channel), true);
  assert.equal(validYouTubeId("video", video), true);
  assert.equal(validYouTubeId("video", "https://evil.example"), false);
  assert.equal(validYouTubeId("channel", "UCsomething-else"), false);
});

test("normalizes search results and excludes malformed IDs or unsafe thumbnails", () => {
  const result = normalizeYouTubeSearch([
    {
      id: { videoId: video },
      snippet: { channelId: channel, title: "Clip", channelTitle: "A channel", thumbnails: { medium: { url: "javascript:alert(1)" } } },
    },
    { id: { videoId: "../../etc/passwd" }, snippet: { channelId: channel } },
    { id: { videoId: "somevideoid" }, snippet: { channelId: "bad" } },
  ], "video");
  assert.equal(result.length, 1);
  assert.equal(result[0].id, video);
  assert.equal(result[0].thumbnail, null);
  assert.equal(result[0].title, "Clip");
});

test("a missing server key is reported without making a network call", async () => {
  const original = process.env.YOUTUBE_DATA_API_KEY;
  const priorFetch = globalThis.fetch;
  delete process.env.YOUTUBE_DATA_API_KEY;
  globalThis.fetch = async () => { throw new Error("fetch should not happen"); };
  try {
    await assert.rejects(youtubeData("search", { part: "snippet" }),
      (error) => error instanceof YouTubeDiscoveryError && error.status === 503);
  } finally {
    if (original === undefined) delete process.env.YOUTUBE_DATA_API_KEY;
    else process.env.YOUTUBE_DATA_API_KEY = original;
    globalThis.fetch = priorFetch;
  }
});

test("API key stays in the upstream request while search results remain normalized", async () => {
  const original = process.env.YOUTUBE_DATA_API_KEY;
  const priorFetch = globalThis.fetch;
  process.env.YOUTUBE_DATA_API_KEY = "server-only-test-value";
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    assert.equal(url.hostname, "www.googleapis.com");
    assert.equal(url.searchParams.get("key"), "server-only-test-value");
    assert.equal(url.searchParams.get("type"), "channel");
    return new Response(JSON.stringify({ items: [{ id: { channelId: channel }, snippet: { title: "Channel" } }] }), { status: 200 });
  };
  try {
    const response = await youtubeData("search", { type: "channel", part: "snippet" });
    assert.equal(normalizeYouTubeSearch(response.items ?? [], "channel")[0].title, "Channel");
    assert.equal(JSON.stringify(response).includes("server-only-test-value"), false);
  } finally {
    if (original === undefined) delete process.env.YOUTUBE_DATA_API_KEY;
    else process.env.YOUTUBE_DATA_API_KEY = original;
    globalThis.fetch = priorFetch;
  }
});
