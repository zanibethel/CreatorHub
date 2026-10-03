import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const exports = {};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../src/lib/market-monitor.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports, AbortController, setTimeout, clearTimeout });
const { createMarketMonitor, mergeMarketSnapshot, quoteAge } = exports;
const snapshot = { collectedAt: "2026-10-03T07:30:00Z", stocks: {}, stockBars: {}, crypto: [], errors: {} };
const settle = async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); };

function harness(load = async () => snapshot) {
  let visible = true, now = 1_000_000, nextId = 0;
  const timers = new Map(), requests = [], snapshots = [], errors = [], statuses = [];
  const monitor = createMarketMonitor({
    load: (signal, history) => { requests.push({ signal, history }); return load(signal, history); },
    onSnapshot: value => snapshots.push(value), onError: error => errors.push(error),
    onStatus: status => statuses.push(status), onLoading: () => {},
    isVisible: () => visible, now: () => now,
    setTimer: (fn, delay) => { const id = ++nextId; timers.set(id, {fn, delay}); return id; },
    clearTimer: id => timers.delete(id),
  });
  return { monitor, requests, snapshots, errors, statuses, timers,
    hide: () => { visible = false; monitor.visibilityChanged(); },
    show: () => { visible = true; monitor.visibilityChanged(); },
    async tick() { const [id, timer] = [...timers][0]; timers.delete(id); now += timer.delay; timer.fn(); await settle(); },
  };
}

test("polls every 15s and fetches history only every five minutes", async () => {
  const h = harness(); h.monitor.setEnabled(true); await settle();
  assert.equal(h.requests[0].history, true);
  assert.equal([...h.timers.values()][0].delay, 15_000);
  await h.tick(); assert.equal(h.requests[1].history, false);
  for (let i = 0; i < 19; i++) await h.tick();
  assert.equal(h.requests.at(-1).history, true);
  h.monitor.dispose(); assert.equal(h.timers.size, 0);
});

test("hidden pages stop polling and refresh when made visible", async () => {
  const h = harness(); h.monitor.setEnabled(true); await settle();
  h.hide(); assert.equal(h.timers.size, 0); assert.equal(h.statuses.at(-1), "hidden");
  h.show(); await settle(); assert.equal(h.requests.length, 2); assert.equal(h.timers.size, 1);
  h.monitor.setEnabled(false); assert.equal(h.timers.size, 0);
});

test("prevents overlapping requests and ignores results after disposal", async () => {
  let finish;
  const h = harness(() => new Promise(resolve => { finish = resolve; }));
  h.monitor.setEnabled(true); await h.monitor.refresh();
  assert.equal(h.requests.length, 1);
  h.monitor.dispose(); assert.equal(h.requests[0].signal.aborted, true);
  finish(snapshot); await settle();
  assert.equal(h.snapshots.length, 0); assert.equal(h.timers.size, 0);
});

test("failures back off to at most two minutes and manual retry recovers", async () => {
  let failing = true;
  const h = harness(async () => { if (failing) throw new Error("Feed unavailable"); return snapshot; });
  h.monitor.setEnabled(true); await settle();
  assert.equal([...h.timers.values()][0].delay, 30_000);
  await h.tick(); assert.equal([...h.timers.values()][0].delay, 60_000);
  await h.tick(); assert.equal([...h.timers.values()][0].delay, 120_000);
  await h.tick(); assert.equal([...h.timers.values()][0].delay, 120_000);
  failing = false; await h.monitor.refresh();
  assert.equal(h.errors.at(-1), ""); assert.equal([...h.timers.values()][0].delay, 15_000);
  h.monitor.dispose();
});

test("invalid configuration and expired sign-in halt automatic retries", async () => {
  for (const status of [400, 401]) {
    const h = harness(async () => { throw Object.assign(new Error("Check settings"), {status}); });
    h.monitor.setEnabled(true); await settle();
    assert.equal(h.statuses.at(-1), "blocked"); assert.equal(h.timers.size, 0);
    h.monitor.dispose();
  }
});

test("quote-only snapshots preserve charts but do not preserve missing quotes", () => {
  const previous = { ...snapshot, stockBars: {SPY: [{close:100}]}, crypto: [{product:"BTC-USD", candles:[{close:99}]}] };
  const next = { ...snapshot, historyIncluded:false, crypto:[{product:"BTC-USD", candles:[], bestBid:{price:101}}] };
  const merged = mergeMarketSnapshot(previous,next);
  assert.equal(merged.stockBars.SPY[0].close,100); assert.equal(merged.crypto[0].candles[0].close,99);
  assert.equal(merged.crypto[0].bestBid.price,101);
  assert.equal(mergeMarketSnapshot(previous,{...next,crypto:[]}).crypto.length,0);
});

test("quotes with old, missing, or implausibly future timestamps are marked stale", () => {
  const now = Date.parse(snapshot.collectedAt);
  assert.equal(quoteAge(snapshot.collectedAt,now).stale,false);
  assert.equal(quoteAge(snapshot.collectedAt,now+60_000).stale,true);
  assert.equal(quoteAge(null,now).stale,true);
  assert.equal(quoteAge("bad-date",now).stale,true);
  assert.equal(quoteAge(new Date(now+120_000).toISOString(),now).stale,true);
});
