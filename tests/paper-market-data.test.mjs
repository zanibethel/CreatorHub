import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../src/app/api/paper-trading/market-data/route.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const json = value => Response.json(value);

function route({ env = {}, fetch } = {}) {
  const exports = {};
  vm.runInNewContext(compiled, {
    exports, Request, Response, URL, URLSearchParams, AbortSignal,
    process: { env }, fetch,
    require: name => {
      if (name === "next/server") return { NextResponse: Response };
      if (name === "@/lib/live-stock-market-data") return {
        fetchPreferredStockQuotes: async symbols => {
          if (!env.ALPACA_API_KEY_ID || !env.ALPACA_API_SECRET_KEY) throw new Error("Stock quote keys are not configured.");
          const response = await fetch(`https://data.alpaca.markets/v2/stocks/quotes/latest?symbols=${encodeURIComponent(symbols.join(","))}`);
          if (!response.ok) throw new Error(`Market quotes HTTP ${response.status}`);
          const payload = await response.json();
          return {
            source: "alpaca-iex", providerError: null,
            quotes: Object.fromEntries(symbols.map(symbol => {
              const quote = payload.quotes?.[symbol];
              return [symbol, quote ? { bid: quote.bp, ask: quote.ap, time: quote.t } : null];
            })),
          };
        },
      };
      throw new Error(`Unexpected import ${name}`);
    },
  });
  return query => exports.GET(new Request(`https://example.test/api/paper-trading/market-data?${query}`));
}

const timestamp = "2026-10-03T07:00:00Z";
function cryptoFetch(url) {
  const parsed = new URL(url);
  if (parsed.pathname.endsWith("/PreTrade")) return json({ result: {
    bids: [{ price: "98", qty: "1", publication_ts: timestamp }, { price: "99", qty: "2", publication_ts: timestamp }],
    asks: [{ price: "102", qty: "1", publication_ts: timestamp }, { price: "101", qty: "2", publication_ts: timestamp }],
  } });
  if (parsed.pathname.endsWith("/OHLC")) return json({ result: { XXBTZUSD: [
    [1791010800, "1", "1", "1", "99", "1", "1", 1],
    [1791014400, "1", "1", "1", "100", "1", "1", 1],
    [1791018000, "1", "1", "1", "101", "1", "1", 1],
  ], last: 1791018000 } });
  throw new Error(`Unexpected network request ${url}`);
}

test("public report can fetch market data without a session or auth client", async () => {
  const response = await route({ fetch: cryptoFetch })("crypto=BTC-USD");
  assert.equal(response.status, 200);
  assert.equal((await response.json()).crypto[0].bestBid.price, 99);
});

test("rejects malformed, empty, and oversized watchlists before fetching", async () => {
  const get = route({ fetch: () => { throw new Error("Must not fetch"); } });
  for (const query of ["stocks=", "stocks=../secret", "crypto=BTC-EUR", `stocks=${Array.from({length:21},(_,i) => `A${i}`).join(",")}`]) {
    assert.equal((await get(query)).status, 400);
  }
});

test("missing stock keys do not discard usable crypto data", async () => {
  const response = await route({ fetch: cryptoFetch })("stocks=SPY&crypto=BTC-USD");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json();
  assert.match(body.errors.stocks, /keys are not configured/);
  assert.equal(body.crypto[0].bestBid.price, 99);
  assert.equal(body.crypto[0].bestAsk.price, 101);
  assert.equal(body.crypto[0].candles.length, 2, "excludes current incomplete crypto candle");
});

test("one unsupported crypto pair does not discard other pairs", async () => {
  const get = route({ fetch: url => new URL(url).searchParams.get("symbol") === "BAD/USD"
    ? json({ error: ["Unknown asset pair"] }) : cryptoFetch(url) });
  const response = await get("crypto=BTC-USD,BAD-USD");
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.crypto.length, 1);
  assert.match(body.errors["BAD-USD"], /Unknown asset pair/);
});

test("total provider failure reports an error instead of an empty successful snapshot", async () => {
  const response = await route({ fetch: () => new Response("", { status: 503 }) })("crypto=BTC-USD");
  assert.equal(response.status, 502);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match((await response.json()).errors["BTC-USD"], /503/);
});

test("stock history follows pagination for later symbols and uses an explicit date range", async () => {
  const requests = [];
  const response = await route({ env: { ALPACA_API_KEY_ID: "fixture-key", ALPACA_API_SECRET_KEY: "fixture-secret" }, fetch: url => {
    const parsed = new URL(url); requests.push(parsed);
    if (parsed.pathname.endsWith("/latest")) return json({ quotes: { SPY: { bp: 100, ap: 101, t: timestamp } } });
    return parsed.searchParams.has("page_token")
      ? json({ bars: { QQQ: [{ t: timestamp, c: 200 }] } })
      : json({ bars: { SPY: [{ t: timestamp, c: 100 }] }, next_page_token: "next-page" });
  } })("stocks=SPY,QQQ");
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.stockBars.QQQ[0].close, 200);
  assert.equal(requests.filter(url => url.pathname.endsWith("/bars")).length, 2);
  assert.ok(requests.find(url => url.pathname.endsWith("/bars")).searchParams.has("start"));
});

test("fast monitor refreshes skip historical requests", async () => {
  const urls = [];
  const response = await route({ fetch: url => { urls.push(url); return cryptoFetch(url); } })("crypto=BTC-USD&history=0");
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.historyIncluded, false);
  assert.equal(body.crypto[0].candles.length, 0);
  assert.equal(urls.length, 1);
  assert.ok(new URL(urls[0]).pathname.endsWith("/PreTrade"));
});

test("crypto history failure does not suppress an available order book", async () => {
  const response = await route({ fetch: url => new URL(url).pathname.endsWith("/OHLC")
    ? new Response("", {status:503}) : cryptoFetch(url) })("crypto=BTC-USD");
  const body = await response.json();
  assert.equal(response.status,200);
  assert.equal(body.crypto[0].bestBid.price,99);
  assert.match(body.errors["BTC-USD history"], /503/);
});

test('monitors all 16 stock candidates without truncating after ten', async () => {
 const symbols=['SPY','QQQ','IWM','XLV','AAPL','JPM','XOM','GLD','NVDA','SH','DIA','MSFT','AMZN','GOOGL','META','PSQ'];
 const get=route({env:{ALPACA_API_KEY_ID:'key',ALPACA_API_SECRET_KEY:'secret'},fetch:url=>{
  const asked=new URL(url).searchParams.get('symbols').split(',');
  return json({quotes:Object.fromEntries(asked.map(s=>[s,{bp:100,ap:101,t:timestamp}]))});
 }});
 const response=await get(`stocks=${symbols.join(',')}&history=0`);assert.equal(response.status,200);
 assert.equal(Object.keys((await response.json()).stocks).length,16);
});
