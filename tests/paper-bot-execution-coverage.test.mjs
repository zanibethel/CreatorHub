import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (filename) => readFileSync(path.join(root, filename), "utf8");
const exists = (filename) => existsSync(path.join(root, filename));
const cron = JSON.parse(read("vercel.json")).crons;
const cronPaths = cron.map((job) => job.path);
const profiles = read("src/lib/paper-bot-profiles.ts");

const automated = [
  { name:"Harbor", id:"three-trade-weekly-swing-100", runner:"swing-run", executor:"swing-execute", readiness:"swing-readiness", cadence:"*/5 * * * 1-5" },
  { name:"Flash", id:"weekend-crypto-day-100", runner:"weekend-crypto-run", executor:"weekend-crypto-execute", readiness:"weekend-crypto-readiness", cadence:"*/5 * * * *" },
  { name:"Pulse", id:"momentum-breakout-100", runner:"momentum-breakout-run", executor:"momentum-breakout-execute", readiness:"momentum-breakout-readiness", cadence:"*/5 * * * 1-5" },
  { name:"Spark", id:"crypto-ignition-100", runner:"crypto-ignition-run", executor:"crypto-ignition-execute", readiness:"crypto-ignition-readiness", cadence:"*/5 * * * *" },
];

const research = [
  { name:"Fuse", id:"penny-volatility-day-100", readiness:"fuse-readiness", cadence:"*/5 * * * 1-5" },
  { name:"Orbit", id:"crypto-swing-100", readiness:"crypto-swing-readiness", cadence:"*/15 * * * *" },
  { name:"Coil", id:"squeeze-breakout-100", readiness:"squeeze-breakout-readiness", cadence:"*/5 * * * 1-5" },
];

test("all eight unique bot profiles remain represented", () => {
  const ids = [...automated, ...research, { name:"Atlas", id:"default-diverse" }].map((bot) => bot.id);
  assert.equal(new Set(ids).size, 8);
  for (const id of ids) assert.ok(profiles.includes('id: "' + id + '"'), `Missing profile for ${id}`);
});

test("scheduled jobs have unique paths and keep the wider intelligence workloads", () => {
  assert.equal(new Set(cronPaths).size, cronPaths.length, "Duplicate cron path may conflict or run twice");
  for (const suffix of ["prospects/scan", "squeeze/scan", "market-movers/scan", "historical-patterns/run", "historical-patterns/intraday/run"]) {
    assert.ok(cronPaths.includes("/api/paper-trading/" + suffix), `Lost critical scanner: ${suffix}`);
  }
});

for (const bot of automated) {
  test(`${bot.name}: five-minute scheduled paper-only execution remains wired`, () => {
    const prefix = "src/app/api/paper-trading/bots/";
    const job = cron.find((entry) => entry.path === "/api/paper-trading/bots/" + bot.runner);
    assert.ok(job, `${bot.name} runner is not scheduled`);
    assert.equal(job.schedule, bot.cadence);
    for (const route of [bot.runner, bot.readiness, bot.executor]) {
      assert.ok(exists(prefix + route + "/route.ts"), `${bot.name} is missing ${route}`);
    }
    const run = read(prefix + bot.runner + "/route.ts");
    const execute = read(prefix + bot.executor + "/route.ts");
    assert.match(run, /CRON_SECRET/);
    assert.match(run, /executionEnabled/);
    assert.match(execute, /paperOnly|paper-api\.alpaca\.markets|SWING_PAPER_BROKER_HOST/i);
    assert.doesNotMatch(execute, /https:\/\/api\.alpaca\.markets/);
  });
}

for (const bot of research) {
  test(`${bot.name}: scanning stays scheduled but orders stay disarmed until an executor exists`, () => {
    const prefix = "src/app/api/paper-trading/bots/";
    const job = cron.find((entry) => entry.path === "/api/paper-trading/bots/" + bot.readiness);
    assert.ok(job, `${bot.name} research route missing from schedule`);
    assert.equal(job.schedule, bot.cadence);
    assert.ok(exists(prefix + bot.readiness + "/route.ts"));
    assert.ok(!exists(prefix + bot.name.toLowerCase() + "-execute/route.ts"),
      `${bot.name} executor was introduced: validate protection and update this coverage contract`);
    assert.ok(profiles.includes(`codename: "${bot.name}"`));
    const snippet = profiles.slice(profiles.indexOf(`codename: "${bot.name}"`));
    assert.match(snippet.slice(0, 1600), /executionState: "research"/);
  });
}

test("Atlas is explicitly tracked as unscheduled, not falsely counted among autonomous executors", () => {
  assert.ok(profiles.includes('id: "default-diverse"'));
  assert.ok(!cronPaths.some((job) => job.includes("atlas-run") || job.includes("default-diverse-run")));
});
