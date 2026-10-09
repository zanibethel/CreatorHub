import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createHash,webcrypto} from "node:crypto";
import vm from "node:vm";
import ts from "typescript";
import {parseFrames,persistFrame,queued,flushOnce,requirePaperConfig,
  PAPER_WS,PAPER_INGEST} from "../workers/alpaca-paper-trade-updates.mjs";

const source=path=>readFileSync(new URL(path,import.meta.url),"utf8");
const load=(path,imports={})=>{
  const exports={};
  const js=ts.transpileModule(source(path),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
  }).outputText;
  vm.runInNewContext(js,{
    exports,Request,Response,URL,AbortSignal,TextEncoder,crypto:webcrypto,
    require:n=>{if(n in imports)return imports[n];throw Error("Unknown import "+n);},
  });
  return exports;
};
const normal=load("../supabase/functions/paper-trade-stream-ingest/normalize.ts");
const handler=load("../supabase/functions/paper-trade-stream-ingest/handler.ts",{"./normalize.ts":normal});
const migration=source("../supabase/migrations/20261009191000_paper_trade_updates_durable.sql");
const rawToken="a".repeat(64),hash=createHash("sha256").update(rawToken).digest("hex");
const session="12345678-1234-4321-8123-123456789abc";
const endpoint="https://ingest.test";
const event={
  stream:"trade_updates",
  data:{
    event:"partial_fill",execution_id:"fill-123",
    timestamp:"2026-10-09T16:31:40.893978321Z",
    qty:"2",price:"4.37",position_qty:"2",
    order:{id:"20aa439e-bd0f-4cb9-9ded-f2a3ec14fdba",
      client_order_id:"broker-child-uuid",symbol:"RXRX",
      side:"sell",status:"partially_filled",type:"limit",
      order_class:"bracket",qty:"4",filled_qty:"2",
      limit_price:"4.37",updated_at:"2026-10-09T16:31:40.894111999Z",
      account_id:"private-broker-account-id",secret:"DO_NOT_STORE"},
  },
};
const response=(status,body)=>Response.json(body,{status});
test("normalize PAPER fill/cancel events, preserve nanoseconds, never store private broker account payload",async()=>{
  const a=await normal.normalizeTradeUpdate(event);
  const b=await normal.normalizeTradeUpdate(JSON.parse(JSON.stringify(event)));
  assert.equal(a.eventHash,b.eventHash);
  assert.match(a.eventHash,/^[a-f0-9]{64}$/);
  assert.equal(a.eventTimestampRaw,"2026-10-09T16:31:40.893978321Z");
  assert.equal(a.eventFillQuantity,"2");
  assert.equal(a.positionQuantity,"2");
  assert.doesNotMatch(JSON.stringify(a),/private-broker-account-id|DO_NOT_STORE|secret/);
  const cancel=structuredClone(event);
  cancel.data.event="canceled";
  cancel.data.order.status="canceled";
  cancel.data.order.canceled_at="2026-10-09T16:31:40.895316177Z";
  const c=await normal.normalizeTradeUpdate(cancel);
  assert.notEqual(c.eventHash,a.eventHash);
  assert.equal(c.details.canceledAt,"2026-10-09T16:31:40.895316177Z");
  await assert.rejects(normal.normalizeTradeUpdate({...event,stream:"trade_updates_live"}),/Only Alpaca PAPER/);
});
test("endpoint refuses unconfigured or invalid credentials before touching private database",async()=>{
  let called=0;
  const fetcher=async()=>{called++;throw Error("Must not access DB");};
  const config=name=>name==="PAPER_STREAM_INGEST_TOKEN_SHA256"?hash:undefined;
  const post=(token,body)=>new Request(endpoint,{method:"POST",
    headers:{"x-paper-stream-token":token,"Content-Type":"application/json"},
    body:JSON.stringify(body)});
  const body={sessionId:session,connected:true,reconnects:0,events:[event]};
  assert.equal((await handler.createHandler(()=>undefined,fetcher)(post(rawToken,body))).status,503);
  assert.equal((await handler.createHandler(config,fetcher)(post("f".repeat(64),body))).status,401);
  assert.equal((await handler.createHandler(config,fetcher)(post(rawToken,{...body,events:new Array(51).fill(event)}))).status,422);
  assert.equal((await handler.createHandler(config,fetcher)(post(rawToken,{...body,events:[{bad:true}]}))).status,422);
  assert.equal(called,0);
});
test("authorized endpoint persists only normalized events with service role and returns broker ACK",async()=>{
  let dbCall=null;
  const config=name=>({
    PAPER_STREAM_INGEST_TOKEN_SHA256:hash,
    SUPABASE_URL:"https://database.test",
    SUPABASE_SERVICE_ROLE_KEY:"eyJ-private-test-key",
  })[name];
  const fetcher=async(url,options)=>{
    dbCall={url,headers:options.headers,body:JSON.parse(options.body)};
    return response(200,{accepted:1,inserted:1,duplicates:0});
  };
  const req=new Request(endpoint,{method:"POST",headers:{"x-paper-stream-token":rawToken},
    body:JSON.stringify({sessionId:session,connected:true,reconnects:0,events:[event]})});
  const res=await handler.createHandler(config,fetcher)(req);
  assert.equal(res.status,200);
  assert.equal((await res.json()).accepted,1);
  assert.equal(dbCall.url,"https://database.test/rest/v1/rpc/paper_broker_record_trade_updates");
  assert.equal(dbCall.body.p_events[0].symbol,"RXRX");
  assert.equal(dbCall.body.p_events[0].event,"partial_fill");
  assert.doesNotMatch(JSON.stringify(dbCall.body),/private-broker-account-id|DO_NOT_STORE/);
  assert.equal(dbCall.headers.Authorization,"Bearer eyJ-private-test-key");
});
test("append-only event database and private health enforce service-only access and stale-heartbeat checks",()=>{
  assert.match(migration,/CREATE TABLE IF NOT EXISTS public\.paper_broker_trade_updates/);
  assert.match(migration,/PRIMARY KEY CHECK/);
  assert.match(migration,/ON CONFLICT \(event_hash\) DO NOTHING/);
  assert.match(migration,/GRANT EXECUTE ON FUNCTION public\.paper_broker_record_trade_updates[\s\S]*?TO service_role/);
  assert.match(migration,/REVOKE ALL ON public\.paper_broker_trade_updates FROM PUBLIC,anon,authenticated/);
  assert.match(migration,/last_heartbeat_at>now\(\)-interval '75 seconds'/);
  assert.doesNotMatch(migration,/UPDATE public\.paper_bot_ledgers|DELETE FROM public\.paper_bot_positions|place_stock_order/);
});
test("PAPER stream worker uses only fixed PAPER websocket and pinned private ingest origin",()=>{
  assert.equal(PAPER_WS,"wss://paper-api.alpaca.markets/stream");
  assert.match(PAPER_INGEST,/\/functions\/v1\/paper-trade-stream-ingest$/);
  const env={ALPACA_PAPER_API_KEY_ID:"paper-key",ALPACA_PAPER_API_SECRET_KEY:"paper-secret",
    PAPER_STREAM_INGEST_TOKEN:rawToken};
  assert.equal(requirePaperConfig(env).ingest,PAPER_INGEST);
  assert.throws(()=>requirePaperConfig({...env,PAPER_STREAM_INGEST_URL:"https://example.com/steal"}),/allowlisted/);
  assert.throws(()=>requirePaperConfig({...env,PAPER_STREAM_INGEST_TOKEN:"bad"}),/dedicated/);
  assert.equal(parseFrames(new TextEncoder().encode(JSON.stringify([event])).buffer)[0].data.event,"partial_fill");
});
test("durable disk queue keeps unacknowledged broker frames until database says accepted",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"paper-stream-"));
  const prev=globalThis.fetch;
  try{
    await persistFrame(dir,event);
    assert.equal((await queued(dir)).length,1);
    const cfg={dir,token:rawToken,ingest:PAPER_INGEST};
    let requests=0;
    globalThis.fetch=async()=>{requests++;return response(503,{error:"unavailable"});};
    await assert.rejects(flushOnce(cfg,{session,connected:true,reconnects:0}),/503/);
    assert.equal((await queued(dir)).length,1);
    globalThis.fetch=async(url,options)=>{
      requests++;
      assert.equal(url,PAPER_INGEST);
      assert.equal(options.headers["x-paper-stream-token"],rawToken);
      assert.equal(JSON.parse(options.body).events.length,1);
      return response(200,{ok:true,accepted:1,inserted:1,duplicates:0});
    };
    assert.equal(await flushOnce(cfg,{session,connected:true,reconnects:0}),1);
    assert.equal((await queued(dir)).length,0);
    assert.equal(requests,2);
  }finally{globalThis.fetch=prev;await rm(dir,{recursive:true,force:true});}
});
