import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const executor=readFileSync(new URL("../src/app/api/paper-trading/bots/momentum-breakout-execute/route.ts",import.meta.url),"utf8");
const pilot=readFileSync(new URL("../supabase/migrations/20261009052000_shared_stock_symbol_reservations_phase1.sql",import.meta.url),"utf8");

test("Pulse uses stable public origin for protected internal readiness and risk-manager calls",()=>{
  assert.match(executor,/const PUBLIC_ORIGIN=process\.env\.CREATORHUB_PUBLIC_ORIGIN\|\|"https:\/\/creatorhub-gray\.vercel\.app"/);
  for(const route of ["momentum-breakout-readiness","momentum-breakout-manage"]){
    assert.ok(executor.includes('new URL("/api/paper-trading/bots/'+route+'",PUBLIC_ORIGIN)'));
    assert.ok(!executor.includes('new URL("/api/paper-trading/bots/'+route+'",request.url)'));
  }
});

test("Pulse bracket and fractional entry both require the existing atomic shared symbol and one-shot ledger claim",()=>{
  const detect=executor.indexOf('const fractional=orderMode==="fractional-simple-protected";');
  const firstBrokerScan=executor.indexOf("const initialVenue=await verifyBrokerVenue();");
  const fractionalManager=executor.indexOf('if(fractional){\n    // An independent');
  const pilotClaim=executor.indexOf("paper_pulse_claim_fractional_pilot");
  const localClaim=executor.indexOf('const claim=await fetch(');
  const lastBrokerScan=executor.indexOf('const finalVenue=await verifyBrokerVenue();');
  const brokerBuy=executor.indexOf('const response=await fetch(`${ALPACA_PAPER}/orders`');
  assert.ok(detect>0&&firstBrokerScan>detect&&fractionalManager>firstBrokerScan);
  assert.ok(pilotClaim>fractionalManager&&localClaim>pilotClaim);
  assert.ok(lastBrokerScan>localClaim&&brokerBuy>lastBrokerScan);
  assert.match(executor,/if\(!readiness\.fractionalExecutionEnabled\)[\s\S]*?Pulse shared one-entry PAPER stock pilot is not armed/);
  assert.match(executor,/if\(!reserved\)return reply/);
  assert.match(pilot,/paper_pulse_claim_fractional_pilot[\s\S]*?paper_stock_symbol_claim\(/);
  assert.match(pilot,/fractionalPilotClientOrderId/);
});

test("Every stock entry aborts on uncertain physical ownership, broker-session closure and pagination ambiguity",()=>{
  const scan=executor.slice(executor.indexOf("const verifyBrokerVenue=async"),executor.indexOf("const initialVenue=await verifyBrokerVenue()"));
  assert.match(scan,/asset\.symbol!==parsed\.symbol/);
  assert.match(scan,/asset\.class!=="us_equity"/);
  assert.match(scan,/fractional&&asset\.fractionable!==true/);
  assert.match(scan,/clock\.is_open!==true/);
  assert.match(scan,/positions\.length>=500\|\|orders\.length>=500/);
  assert.match(scan,/positions\.some\(p=>p\.symbol===parsed\.symbol\)/);
  assert.match(scan,/orders\.some\(o=>o\.symbol===parsed\.symbol\)/);
  assert.match(executor,/no broker buy attempted/);
  assert.match(executor,/Keep the pilot\/reservation claimed if this fails/);
});
