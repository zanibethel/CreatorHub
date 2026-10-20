import test from "node:test";
import assert from "node:assert/strict";
import { parseYouTubeUrl, YouTubeUrlError } from "../src/lib/youtube-url.ts";
import { quotaBucket, youtubeQuotaLimits } from "../src/lib/clipper-youtube-quota.ts";

const videoId = "dQw4w9WgXcQ";
const channelId = "UC" + "a".repeat(22);
const playlistId = "PL1234567890ABCDE123456";
const validCases = [
  ["https://www.youtube.com/watch?v=" + videoId, { kind: "video", videoId }],
  ["https://m.youtube.com/watch?v=" + videoId + "&feature=share", { kind: "video", videoId }],
  ["http://youtube.com/shorts/" + videoId + "?si=x", { kind: "video", videoId }],
  ["https://youtube.com/live/" + videoId, { kind: "video", videoId }],
  ["https://youtu.be/" + videoId + "?si=example", { kind: "video", videoId }],
  ["https://www.youtu.be/" + videoId, { kind: "video", videoId }],
  ["https://youtube.com/embed/" + videoId, { kind: "video", videoId }],
  ["https://youtube.com/watch?v=" + videoId + "&list=" + playlistId, { kind: "video", videoId }],
  ["https://youtube.com/channel/" + channelId, { kind: "channel", channelId }],
  ["https://www.youtube.com/@GoogleDevelopers", { kind: "handle", handle: "@GoogleDevelopers" }],
  ["https://youtube.com/@my.creator-name", { kind: "handle", handle: "@my.creator-name" }],
  ["https://youtube.com/playlist?list=" + playlistId, { kind: "playlist", playlistId }],
  ["https://youtube.com/watch?list=" + playlistId, { kind: "playlist", playlistId }],
];
test("parses all supported YouTube URL starting points without a network call", () => {
  for (const [input, expected] of validCases) {
    assert.deepEqual(parseYouTubeUrl(input), expected, input);
  }
});

const badCases = [
  "",
  "https://youtube.com.evil.example/watch?v=" + videoId,
  "https://evil.example/redirect?to=https://youtube.com/watch?v=" + videoId,
  "https://youtube.com@evil.example/watch?v=" + videoId,
  "https://u:p@youtube.com/watch?v=" + videoId,
  "https://youtube.com:444/watch?v=" + videoId,
  "file:///etc/passwd",
  "javascript:alert(1)",
  "https://youtu.be.evil.example/" + videoId,
  "https://youtu.be/" + videoId + "/../../admin",
  "https://youtube.com/watch?v=" + videoId + "&v=abcdefghijk",
  "https://youtube.com/watch?v=invalid",
  "https://youtube.com/shorts/abcdef",
  "https://youtube.com/redirect?q=https://evil.example/",
  "https://youtube.com/%40googledevelopers",
  "https://youtube.com/playlist?list=bad",
  "https://youtube.com/playlist?list=" + playlistId + "&list=OTHER12345",
  "https://youtube.com/channel/INVALID",
  "https://youtube.com/@",
  "https://youtube.com/@a",
  "https://youtube.com/watch?v=" + videoId + "%2fhidden",
  "https://youtube.com/watch?v=" + videoId + "#fragment".repeat(2500),
];
test("rejects arbitrary destinations, malformed links, unsafe paths and duplicate IDs", () => {
  for (const input of badCases) {
    assert.throws(() => parseYouTubeUrl(input), YouTubeUrlError, input);
  }
});

test("quota maps all direct URL lookup types to independently counted metadata methods", () => {
  assert.equal(quotaBucket("channels"), "channels.list");
  assert.equal(quotaBucket("videos"), "videos.list");
  assert.equal(quotaBucket("playlistItems"), "playlistItems.list");
  const caps = ["channels.list", "videos.list", "playlistItems.list"].map(
    (bucket) => youtubeQuotaLimits(bucket, {}).projectLimit,
  );
  // Defaults reserve headroom inside the shared 10k other-operations API unit budget.
  assert.deepEqual(caps, [3000, 3000, 3000]);
  assert.equal(caps.reduce((a, b) => a + b, 0), 9000);
});
