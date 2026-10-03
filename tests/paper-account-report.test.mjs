import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';
import { z } from 'zod';

function module(path, imports = {}, globals = {}) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const exports = {};
  vm.runInNewContext(code, {exports, Request, Response, URL, AbortSignal, TextEncoder, crypto:webcrypto, ...globals,
    require: name => { if (name in imports) return imports[name]; throw new Error(`Unexpected import: ${name}`); }});
  return exports;
}
const collector = module('../supabase/functions/paper-report-sync/collector.ts');
const marks = module('../supabase/functions/paper-report-sync/marks.ts');
const handler = module('../supabase/functions/paper-report-sync/handler.ts', {'./collector.ts':collector,'./marks.ts':marks});
const schemas = module('../src/lib/account-report.ts', {zod:{z}});
const stamp = '2026-10-03T08:00:00Z';
const json = value => Response.json(value);
const fixtures = {
  account: {id:'private-account-id',equity:'100000',cash:'99990',last_equity:'99995',currency:'USD',account_number:'private-number',email:'private-email'},
  positions: [{symbol:'SPY',side:'long',qty:'0.01',avg_entry_price:'600',market_value:'6.10',unrealized_pl:'0.10',asset_id:'private-asset'}],
  orders: [{id:'private-order',client_order_id:'chb-div-v1-abc123-fixture01',symbol:'SPY',asset_class:'us_equity',side:'buy',type:'limit',order_class:'simple',status:'partially_filled',qty:'1',filled_qty:'0.2',filled_avg_price:'600',limit_price:'600',stop_price:null,submitted_at:stamp,filled_at:null}],
  fills: [{id:'private-fill',order_id:'private-order',symbol:'SPY',side:'buy',qty:'0.2',price:'600',transaction_time:stamp}],
};
function alpaca(url) {
  const path = new URL(url).pathname;
  if (path.endsWith('/account')) return json(fixtures.account);
  if (path.endsWith('/positions')) return json(fixtures.positions);
  if (path.endsWith('/orders')) return json(fixtures.orders);
  if (path.endsWith('/FILL')) return json(fixtures.fills);
  throw new Error('Unexpected Alpaca URL');
}

test('collector uses only GETs on the fixed paper host and strips broker identifiers', async () => {
  const requests = [];
  const {report,sourceKey,brokerActivity} = await collector.collectPaperReport('test-key','test-secret',(url, options) => {
    requests.push({url,options}); return alpaca(url);
  });
  assert.equal(report.account.equity,100000,'does not scale the broker balance to the $100 virtual challenge');
  assert.equal(report.orders[0].status,'partially_filled');
  assert.equal(report.fills[0].quantity,0.2);
  assert.equal(report.orders[0].stop,null);
  assert.match(sourceKey,/^[a-f0-9]{64}$/);
  assert.equal(requests.length,5);
  for (const {url,options} of requests) {
    assert.equal(new URL(url).origin,'https://paper-api.alpaca.markets');
    assert.equal(options.method,'GET');
    assert.equal(options.headers['APCA-API-SECRET-KEY'],'test-secret');
  }
  assert.doesNotMatch(JSON.stringify(report),/private-|test-key|test-secret|account_number|order_id|client_order_id/);
  assert.equal(brokerActivity.orders.length,1);
  assert.equal(brokerActivity.orders[0].clientOrderId,'chb-div-v1-abc123-fixture01');
  assert.equal(brokerActivity.orders[0].brokerOrderId,'private-order');
  assert.equal(brokerActivity.fills[0].fillActivityId,'private-fill');
  assert.ok(schemas.paperAccountSchema.safeParse(report).success);
});
test('missing collector keys make no brokerage calls', async () => {
  await assert.rejects(collector.collectPaperReport('','',()=>{throw new Error('Must not fetch');}),/collector secrets/);
});
test('an unauthorized account blocks publication even if other sources return data', async () => {
  await assert.rejects(collector.collectPaperReport('key','secret',url => new URL(url).pathname.endsWith('/account') ? new Response('',{status:401}) : alpaca(url)),/401/);
});
test('failed sections stay unknown instead of reporting an empty account', async () => {
  const {report} = await collector.collectPaperReport('key','secret',url => new URL(url).pathname.endsWith('/positions') ? new Response('',{status:503}) : alpaca(url));
  assert.equal(report.positions,null);
  assert.match(report.errors.positions,/503/);
  assert.equal(report.fills.length,1);
});
test('public report schema strips unexpected private fields at every record level', async () => {
  const {report} = await collector.collectPaperReport('key','secret',alpaca);
  report.secret = 'private-secret'; report.account.id = 'private-account'; report.orders[0].client_order_id = 'private-client';
  const parsed = schemas.paperAccountSchema.parse(report);
  assert.doesNotMatch(JSON.stringify(parsed),/private-/);
});

test('scheduler rejects missing and invalid tokens before database or brokerage access', async () => {
  const run = handler.createHandler(()=>undefined,()=>{throw new Error('Must not fetch');});
  assert.equal((await run(new Request('https://example.test',{method:'POST'}))).status,401);
  assert.equal((await run(new Request('https://example.test',{method:'GET'}))).status,405);
});
const token = 'a'.repeat(64);
const hash = Buffer.from(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(token))).toString('hex');
const env = name => ({SUPABASE_URL:'https://database.test',SUPABASE_SERVICE_ROLE_KEY:'eyJ-fixture',ALPACA_PAPER_API_KEY_ID:'key',ALPACA_PAPER_API_SECRET_KEY:'secret'})[name];
const scheduledRequest = () => new Request('https://example.test',{method:'POST',headers:{'x-paper-report-token':token}});
test('well-formed but incorrect scheduler tokens cannot trigger collection', async () => {
  let calls = 0;
  const run = handler.createHandler(env,()=>{calls++; return json([{cron_token_hash:'wrong'}]);});
  assert.equal((await run(scheduledRequest())).status,401);
  assert.equal(calls,1);
});
test('a busy or recently collected report skips all brokerage calls', async () => {
  const run = handler.createHandler(env,url => url.includes('paper_report_state') ? json([{cron_token_hash:hash}]) : json(false));
  const result = await (await run(scheduledRequest())).json();
  assert.equal(result.skipped,true);
});
test('missing scheduler credentials record setup_required even when the RPC returns no body', async () => {
  let failure;
  const run = handler.createHandler(name => name.startsWith('ALPACA_') ? undefined : env(name),(url,options) => {
    if (url.includes('paper_report_state')) return json([{cron_token_hash:hash}]);
    if (url.endsWith('paper_report_claim_refresh')) return json(true);
    if (url.endsWith('paper_report_record_failure')) { failure=JSON.parse(options.body); return new Response(null,{status:204}); }
    throw new Error('Missing keys must not call Alpaca or save a snapshot');
  });
  const response = await run(scheduledRequest());
  assert.equal(response.status,503);
  assert.equal((await response.json()).setupRequired,true);
  assert.equal(failure.p_status,'setup_required');
});
test('authorized collection saves only the sanitized snapshot while reconciling tagged broker IDs privately', async () => {
  let saved, reconciled;
  const run = handler.createHandler(env,(url,options) => {
    if (url.startsWith('https://paper-api')) return alpaca(url);
    if (url.includes('paper_report_state')) return json([{cron_token_hash:hash}]);
    if (url.endsWith('paper_report_claim_refresh')) return json(true);
    if (url.endsWith('paper_bot_reconcile_broker_activity')) {reconciled = JSON.parse(options.body); return json({ordersSeen:1,fillsAdded:1});}
    if (url.endsWith('paper_bot_link_prepared_orders')) return json(1);
    if (url.endsWith('paper_bot_apply_unapplied_fills')) return json({fillsApplied:1,botsUpdated:['default-diverse']});
    if (url.includes('paper_bot_positions?select=symbol,asset_class')) return json([]);
    if (url.endsWith('paper_bot_mark_to_market')) return json({botsMarked:0});
    if (url.endsWith('paper_report_save_snapshot')) {saved = JSON.parse(options.body); return new Response(null,{status:204});}
    throw new Error('Unexpected database call');
  });
  const response = await run(scheduledRequest());
  assert.equal(response.status,200);
  assert.equal(saved.p_payload.account.equity,100000);
  assert.doesNotMatch(JSON.stringify(saved),/private-|clientOrderId|brokerOrderId|fillActivityId/);
  assert.equal(reconciled.p_orders[0].clientOrderId,'chb-div-v1-abc123-fixture01');
  assert.equal(reconciled.p_orders[0].brokerOrderId,'private-order');
  assert.equal(reconciled.p_fills[0].fillActivityId,'private-fill');
  assert.doesNotMatch(JSON.stringify(await response.json()),/equity|cash|quantity|account_id|secret|clientOrderId|brokerOrderId/);
});
test('collector failures record a retry without overwriting the prior snapshot', async () => {
  let failure;
  const run = handler.createHandler(env,(url,options) => {
    if (url.startsWith('https://paper-api')) return new Response('',{status:401});
    if (url.includes('paper_report_state')) return json([{cron_token_hash:hash}]);
    if (url.endsWith('paper_report_claim_refresh')) return json(true);
    if (url.endsWith('paper_report_record_failure')) {failure=JSON.parse(options.body); return new Response(null,{status:204});}
    throw new Error('Must not save a failed snapshot');
  });
  assert.equal((await run(scheduledRequest())).status,502);
  assert.equal(failure.p_status,'error');
});

test('public snapshot endpoint projects saved data without private state or source identifiers', async () => {
  const {report} = await collector.collectPaperReport('key','secret',alpaca);
  report.account.account_number = 'private-number';
  const api = module('../src/app/api/paper-trading/account-report/route.ts', {
    'next/server':{NextResponse:Response}, '@/lib/account-report':schemas,
  }, {process:{env:{SUPABASE_SECRET_KEY:'database-secret'}}, fetch: url => url.includes('paper_report_state')
    ? json([{payload:report,source_key:'private-source',cron_token_hash:'private-hash',status:'ready',last_attempt_at:stamp,next_sync_at:stamp}])
    : json([{collected_at:stamp,equity:100000}])});
  const response = await api.GET();
  assert.equal(response.status,200);
  assert.match(response.headers.get('cache-control'),/s-maxage=5/);
  const result = await response.json();
  assert.equal(result.snapshot.account.equity,100000);
  assert.equal(result.history[0].equity,100000);
  assert.doesNotMatch(JSON.stringify(result),/private-|database-secret|source_key|cron_token_hash/);
});
test('unconfigured public report storage never attempts a privileged database fetch', async () => {
  const api = module('../src/app/api/paper-trading/account-report/route.ts', {
    'next/server':{NextResponse:Response}, '@/lib/account-report':schemas,
  }, {process:{env:{}}, fetch:()=>{throw new Error('Must not fetch');}});
  assert.equal((await api.GET()).status,503);
});

test('account polling refreshes every 15 seconds, pauses when hidden and aborts on cleanup', async () => {
  let cleanup, tick, visibility, interval, calls=0, pendingResolve, activeSignal;
  const doc={hidden:false,addEventListener:(name,fn)=>{visibility=fn;},removeEventListener:()=>{visibility=null;}};
  const hook=module('../src/components/useAccountReport.ts',{react:{useState:value=>[value,()=>{}],useEffect:fn=>{cleanup=fn();}}},{
    AbortController, document:doc,
    window:{setInterval:(fn,ms)=>{tick=fn;interval=ms;return 1;},clearInterval:()=>{tick=null;}},
    fetch:(url,options)=>{calls++;activeSignal=options.signal;return new Promise(resolve=>{pendingResolve=resolve;});},
  });
  hook.default();
  assert.equal(interval,15000);
  assert.equal(calls,1);
  tick(); assert.equal(calls,1,'pending requests must not overlap');
  pendingResolve(json({snapshot:null,status:'pending'}));
  await new Promise(resolve=>setImmediate(resolve));
  doc.hidden=true;tick();assert.equal(calls,1);
  doc.hidden=false;visibility();assert.equal(calls,2);
  cleanup();assert.equal(activeSignal.aborted,true);assert.equal(tick,null);assert.equal(visibility,null);
  pendingResolve(json({snapshot:null,status:'pending'}));
  await new Promise(resolve=>setImmediate(resolve));
});
