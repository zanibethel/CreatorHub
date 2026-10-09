import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import vm from "node:vm";
import ts from "typescript";

function load(path) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { exports, URL, TextEncoder, crypto: webcrypto, AbortSignal, require: name => { throw new Error(name); } });
  return exports;
}

const collector = load("../supabase/functions/paper-report-sync/collector.ts");
const stamp = "2026-10-03T19:30:00Z";
const json = value => Response.json(value);

test("bracket child legs inherit the tagged parent bot attribution", async () => {
  const parentClient = "chb-sw3-v1-abc123-fixture02";
  const root = {
    id:"parent-bracket-id", client_order_id:parentClient, symbol:"QQQ", asset_class:"us_equity",
    side:"buy", type:"market", order_class:"bracket", status:"filled", qty:"0.03",
    filled_qty:"0.03", filled_avg_price:"755", submitted_at:stamp, filled_at:stamp,
    legs:[
      {id:"take-profit-child",client_order_id:"alpaca-auto-tp",symbol:"QQQ",asset_class:"us_equity",side:"sell",type:"limit",order_class:"bracket",status:"new",qty:"0.03",filled_qty:"0",submitted_at:stamp},
      {id:"stop-child",client_order_id:"alpaca-auto-stop",symbol:"QQQ",asset_class:"us_equity",side:"sell",type:"stop",order_class:"bracket",status:"new",qty:"0.03",filled_qty:"0",submitted_at:stamp},
    ],
  };
  const fill = {id:"child-fill",order_id:"stop-child",symbol:"QQQ",side:"sell",qty:"0.03",price:"727",cum_qty:"0.03",leaves_qty:"0",transaction_time:stamp};
  const account = {id:"paper-account",equity:"100000",cash:"100000",last_equity:"100000",currency:"USD"};

  const fetcher = url => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith("/account")) return json(account);
    if (parsed.pathname.endsWith("/positions")) return json([]);
    if (parsed.pathname.endsWith("/orders") && parsed.searchParams.get("status")==="open") return json([]);
    if (parsed.pathname.endsWith("/orders") && parsed.searchParams.get("status")==="all") {
      assert.equal(parsed.searchParams.get("nested"),"true");
      return json([root]);
    }
    if (parsed.pathname.endsWith("/FILL")) return json([fill]);
    throw new Error("Unexpected fixture URL");
  };

  const { brokerActivity } = await collector.collectPaperReport("key","secret",fetcher);
  assert.equal(brokerActivity.orders.length,3);
  const stop = brokerActivity.orders.find(order => order.brokerOrderId === "stop-child");
  assert.equal(stop.attributionClientOrderId,parentClient);
  assert.equal(stop.parentBrokerOrderId,"parent-bracket-id");
  assert.equal(stop.clientOrderId,"alpaca-auto-stop");
  assert.equal(stop.canceledAt,null);
  assert.equal(stop.replacedAt,null);
  assert.equal(stop.updatedAt,null);
  assert.equal(brokerActivity.fills.length,1);
  assert.equal(brokerActivity.fills[0].brokerOrderId,"stop-child");
});
