import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  quotaBucket, youtubeQuotaLimits, pacificQuotaDay, parseReservation,
} from "../src/lib/clipper-youtube-quota.ts";

test("default limits separate user budgets from shared platform caps", () => {
  assert.deepEqual(youtubeQuotaLimits("search.list", {}), {
    accountLimit: 5, projectLimit: 90, burstLimit: 3,
  });
  assert.deepEqual(youtubeQuotaLimits("channels.list", {}), {
    accountLimit: 50, projectLimit: 3000, burstLimit: 10,
  });
  assert.equal(quotaBucket("search"), "search.list");
  assert.equal(quotaBucket("channels"), "channels.list");
});

test("invalid env limits fail back to safe defaults and overrides are bounded", () => {
  const limits = youtubeQuotaLimits("search.list", {
    CLIPPER_YOUTUBE_SEARCH_ACCOUNT_DAILY: "0",
    CLIPPER_YOUTUBE_SEARCH_PROJECT_DAILY: "NaN",
    CLIPPER_YOUTUBE_SEARCH_PER_MINUTE: "-8",
  });
  assert.deepEqual(limits, { accountLimit: 5, projectLimit: 90, burstLimit: 3 });
  assert.deepEqual(youtubeQuotaLimits("search.list", {
    CLIPPER_YOUTUBE_SEARCH_ACCOUNT_DAILY: "7",
    CLIPPER_YOUTUBE_SEARCH_PROJECT_DAILY: "70000",
    CLIPPER_YOUTUBE_SEARCH_PER_MINUTE: "999",
  }), { accountLimit: 7, projectLimit: 10000, burstLimit: 100 });
});

test("Pacific day boundary follows DST rather than UTC or a fixed -8 offset", () => {
  assert.equal(pacificQuotaDay(new Date("2026-03-08T07:59:59Z")), "2026-03-07");
  assert.equal(pacificQuotaDay(new Date("2026-03-08T08:00:00Z")), "2026-03-08");
  assert.equal(pacificQuotaDay(new Date("2026-11-01T06:59:59Z")), "2026-10-31");
  assert.equal(pacificQuotaDay(new Date("2026-11-01T07:00:00Z")), "2026-11-01");
});

test("quota results must be complete and from the expected operation", () => {
  const receipt = {
    allowed: false, reason: "project_limit", bucket: "search.list",
    accountUsed: 2, accountLimit: 5,
    projectUsed: 90, projectLimit: 90,
    burstUsed: 1, burstLimit: 3,
    resetsAt: "2026-10-20T07:00:00Z", retryAt: "2026-10-20T07:00:00Z",
  };
  assert.deepEqual(parseReservation(receipt, "search.list"), receipt);
  assert.equal(parseReservation(receipt, "channels.list"), null);
  assert.equal(parseReservation({ ...receipt, accountUsed: "2" }, "search.list"), null);
  assert.equal(parseReservation({ ...receipt, reason: "invalid" }, "search.list"), null);
  assert.equal(parseReservation({ ...receipt, retryAt: "not-a-date" }, "search.list"), null);
});

test("SQL reservation implements serialized shared/account/burst checks with locked server-only data", () => {
  const sql = readFileSync(new URL("../supabase/migrations/20261020100000_clipper_youtube_api_quota.sql", import.meta.url), "utf8");
  assert.match(sql, /security definer/i);
  assert.match(sql, /set search_path = ''/);
  assert.equal(sql.includes("America/Los_Angeles"), true);
  assert.match(sql, /on conflict do nothing/);
  assert.equal((sql.match(/for update;/g) ?? []).length, 3);
  assert.match(sql, /when v_project_used >= p_project_limit/);
  assert.match(sql, /when v_account_used >= p_account_limit/);
  assert.match(sql, /when v_burst_used >= p_burst_limit/);
  assert.match(sql, /revoke all on function public\.clipper_youtube_reserve_quota\(/);
  assert.match(sql, /to service_role;/);
  assert.match(sql, /if v_reason is null then/);
  assert.match(sql, /used = used \+ 1/);
});

test("concurrent gate simulation shares one project pool, not one pool per user/workspace", async () => {
  const limits = youtubeQuotaLimits("search.list", {
    CLIPPER_YOUTUBE_SEARCH_ACCOUNT_DAILY: "2",
    CLIPPER_YOUTUBE_SEARCH_PROJECT_DAILY: "3",
    CLIPPER_YOUTUBE_SEARCH_PER_MINUTE: "100",
  });
  const accounts = new Map();
  let project = 0;
  // This simulates a serialized DB reservation for API contract tests.
  // Postgres-level concurrency is independently required before deployment.
  let chain = Promise.resolve();
  const reserve = (userId) => {
    const task = chain.then(() => {
      const prior = accounts.get(userId) ?? 0;
      if (project >= limits.projectLimit) return "project_limit";
      if (prior >= limits.accountLimit) return "account_limit";
      project += 1;
      accounts.set(userId, prior + 1);
      return "allowed";
    });
    chain = task.then(() => {}, () => {});
    return task;
  };
  // account A has two creator workspaces but only one account pool
  const result = await Promise.all([
    reserve("account-a"), reserve("account-a"), reserve("account-a"),
    reserve("account-b"), reserve("account-b"), reserve("account-b"),
  ]);
  assert.deepEqual(result, ["allowed", "allowed", "account_limit", "allowed", "project_limit", "project_limit"]);
  assert.equal(project, 3);
  assert.equal(accounts.get("account-a"), 2);
  assert.equal(accounts.get("account-b"), 1);
});

test("second migration exposes only reviewed 1-unit lookup buckets with service-role permissions", () => {
  const sql = readFileSync(new URL("../supabase/migrations/20261020110000_clipper_youtube_direct_url_metadata_buckets.sql", import.meta.url), "utf8");
  for (const bucket of ["channels.list", "videos.list", "playlistItems.list"]) {
    assert.match(sql, new RegExp(bucket.replace(".", "\\.")));
  }
  assert.match(sql, /security definer/i);
  assert.equal(sql.includes("America/Los_Angeles"), true);
  assert.match(sql, /from public, anon, authenticated/i);
  assert.match(sql, /to service_role/i);
  assert.equal((sql.match(/for update;/g) ?? []).length, 3);
});
