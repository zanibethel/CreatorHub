// Actual PostgreSQL integration checks, run only in CI's disposable postgres:17.
// No connection is ever made to the user's Supabase projects.
import test, { before } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const database = process.env.CLIPPER_TEST_DATABASE_URL;
if (!database) throw new Error("Set CLIPPER_TEST_DATABASE_URL for an isolated disposable test database.");
if (!/^postgres(ql)?:\/\/postgres:postgres@127\.0\.0\.1:5432\/clipper_ci$/.test(database)) {
  throw new Error("Refusing to run Clipper integration tests against any non-CI PostgreSQL database.");
}

function psql(args, allowFailure = false) {
  return new Promise((resolveResult, reject) => {
    const child = spawn("psql", ["-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", "--dbname", database, ...args], {
      env: { ...process.env, PGCONNECT_TIMEOUT: "5" },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      if (exitCode !== 0 && !allowFailure) reject(new Error("psql failed: " + stderr.slice(0, 1200)));
      else resolveResult({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode });
    });
  });
}

async function runSql(statement) {
  const result = await psql(["-c", statement]);
  return result.stdout.trim();
}

async function fileSql(filename) {
  await psql(["-f", resolve(process.cwd(), filename)]);
}

const userA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const userB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const creatorA = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const creatorB = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

before(async () => {
  await fileSql("tests/fixtures/clipper-postgres-bootstrap.sql");
  await runSql("insert into auth.users(id) values ('" + userA + "'),('" + userB + "')");
  await runSql("insert into public.creators(id,user_id) values ('" + creatorA + "','" + userA + "'),('" + creatorB + "','" + userB + "')");
  await fileSql("supabase/migrations/20261019190000_clipper_youtube_saved_channels.sql");
  await fileSql("supabase/migrations/20261020100000_clipper_youtube_api_quota.sql");
  await fileSql("supabase/migrations/20261020110000_clipper_youtube_direct_url_metadata_buckets.sql");
});

function reserve(userId, bucket, userLimit, projectLimit, burstLimit, when) {
  const query = "select public.clipper_youtube_reserve_quota('" + userId +
    "','" + bucket + "'," + userLimit + "," + projectLimit + "," + burstLimit +
    ",'" + when + "'::timestamptz)";
  return runSql(query).then(JSON.parse);
}

test("concurrent independent user reservations cannot exceed shared project or account limits", async () => {
  const when = "2026-10-19T23:15:00Z";
  const pending = Array.from({ length: 20 }, (_, index) =>
    reserve(index % 2 === 0 ? userA : userB, "search.list", 3, 5, 50, when)
  );
  const results = await Promise.all(pending);
  const accepted = results.filter((item) => item.allowed);
  assert.equal(accepted.length, 5);
  assert.equal(results.filter((item) => !item.allowed).length, 15);
  assert.equal(accepted.filter((item) => item.accountUsed > 3).length, 0);
  assert.equal(accepted.filter((item) => item.projectUsed > 5).length, 0);
  assert.equal(await runSql("select used from public.clipper_youtube_project_quota where bucket='search.list' and period_day='2026-10-19'"), "5");
  const counted = Number(await runSql("select sum(used) from public.clipper_youtube_account_quota where bucket='search.list' and period_day='2026-10-19'"));
  assert.equal(counted, 5);
  const counts = (await runSql("select used from public.clipper_youtube_account_quota where bucket='search.list' order by user_id")).split("\n").map(Number);
  assert.equal(counts.length, 2);
  assert.ok(counts.every((count) => count <= 3));
  assert.ok(results.filter((item) => !item.allowed).every((item) => item.reason === "account_limit" || item.reason === "project_limit"));
});

test("the burst limiter blocks additional calls with zero extra counter increments", async () => {
  const when = "2026-10-20T15:05:11Z";
  const first = await reserve(userA, "videos.list", 20, 20, 2, when);
  const second = await reserve(userA, "videos.list", 20, 20, 2, when);
  const third = await reserve(userA, "videos.list", 20, 20, 2, when);
  assert.equal(first.allowed, true);
  assert.equal(second.allowed, true);
  assert.equal(third.allowed, false);
  assert.equal(third.reason, "burst_limit");
  assert.equal(third.projectUsed, 2);
  assert.equal(third.accountUsed, 2);
});

test("Pacific DST rollover resets the correct day, independent of UTC midnight", async () => {
  const dayBefore = await reserve(userA, "playlistItems.list", 1, 1, 10, "2026-11-01T06:59:59Z");
  const dayAfter = await reserve(userA, "playlistItems.list", 1, 1, 10, "2026-11-01T07:00:00Z");
  assert.equal(dayBefore.allowed, true);
  assert.equal(dayAfter.allowed, true);
  const dates = await runSql("select period_day::text from public.clipper_youtube_project_quota where bucket='playlistItems.list' order by period_day");
  assert.equal(dates, "2026-10-31\n2026-11-01");
});

test("only the service role may use the reservation function and ledger tables", async () => {
  const deniedFn = await psql(["-c", "set role authenticated; select public.clipper_youtube_reserve_quota('" + userA + "','search.list',10,10,10)"], true);
  assert.notEqual(deniedFn.exitCode, 0);
  const deniedTable = await psql(["-c", "set role authenticated; select * from public.clipper_youtube_project_quota"], true);
  assert.notEqual(deniedTable.exitCode, 0);
});

test("saved channel bookmarks are separated by authenticated user via RLS", async () => {
  await runSql("insert into public.clipper_youtube_channels(user_id,creator_id,channel_id,channel_title) values ('" +
    userA + "','" + creatorA + "','UC" + "a".repeat(22) + "','A'),('" +
    userB + "','" + creatorB + "','UC" + "b".repeat(22) + "','B')");
  const query = (userId) => "set role authenticated; set app.test_user = '" + userId +
    "'; set app.test_claims = '{\"is_anonymous\":false}'; select channel_title from public.clipper_youtube_channels order by channel_title";
  const rowsA = await runSql(query(userA));
  const rowsB = await runSql(query(userB));
  assert.equal(rowsA.split("\n").at(-1), "A");
  assert.equal(rowsB.split("\n").at(-1), "B");

  const anon = await runSql("set role authenticated; set app.test_user = '" + userA +
    "'; set app.test_claims = '{\"is_anonymous\":true}'; select count(*) from public.clipper_youtube_channels");
  assert.equal(anon.split("\n").at(-1), "0");
});
