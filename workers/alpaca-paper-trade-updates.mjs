#!/usr/bin/env node
// Persistent, read-only Alpaca PAPER account-order event subscriber.
// Node >=22. This process NEVER submits/replaces/cancels a broker order.
import {mkdir,readdir,readFile,open,unlink} from "node:fs/promises";
import {randomUUID,createHash} from "node:crypto";
import {resolve,join} from "node:path";
import {pathToFileURL} from "node:url";

export const PAPER_WS="wss://paper-api.alpaca.markets/stream";
export const PAPER_INGEST="https://yufptpfiwdbzzrvhkvux.supabase.co/functions/v1/paper-trade-stream-ingest";
const MAX_BACKLOG=20000;
const log=(kind,detail)=>console.log(new Date().toISOString(),kind,detail);
export function parseFrames(data){
  const value=typeof data==="string"?data:
    data instanceof ArrayBuffer?new TextDecoder().decode(data):
    ArrayBuffer.isView(data)?new TextDecoder().decode(data):
    null;
  if(value===null)throw Error("Unexpected PAPER WebSocket frame encoding.");
  const parsed=JSON.parse(value);
  return Array.isArray(parsed)?parsed:[parsed];
}
export function requirePaperConfig(env=process.env){
  const key=env.ALPACA_PAPER_API_KEY_ID;
  const secret=env.ALPACA_PAPER_API_SECRET_KEY;
  const token=env.PAPER_STREAM_INGEST_TOKEN;
  const ingest=env.PAPER_STREAM_INGEST_URL||PAPER_INGEST;
  const dir=resolve(env.PAPER_STREAM_SPOOL_DIR||"./.paper-stream-spool");
  if(!key||!secret||!token||!/^[a-f0-9]{64}$/.test(token))
    throw Error("Configure Alpaca PAPER keys and the dedicated 64-hex PAPER_STREAM_INGEST_TOKEN.");
  if(ingest!==PAPER_INGEST)throw Error("PAPER ingestion must use the allowlisted CreatorHub Supabase endpoint.");
  if(typeof WebSocket!=="function")throw Error("Use Node >=22 with native WebSocket support.");
  return {key,secret,token,ingest,dir};
}

// Persist only the fields the private server-side normalizer needs. Alpaca
// order frames can include broker account IDs, assets and other account data:
// none of those belong in crash-recoverable local event files.
export function privateFrame(frame){
  const data=frame?.data,order=data?.order;
  if(frame?.stream!=="trade_updates"||!data||!order||
     typeof data.event!=="string"||typeof order.id!=="string"||
     typeof order.symbol!=="string")
    throw Error("Malformed Alpaca PAPER trade update before durable storage.");
  const take=(source,keys)=>{
    const out={};
    for(const key of keys)if(Object.hasOwn(source,key))out[key]=source[key];
    return out;
  };
  return {stream:"trade_updates",data:{
    ...take(data,["event","execution_id","event_id","timestamp","at","qty","price","position_qty"]),
    order:take(order,["id","client_order_id","symbol","side","status","type","order_class",
      "qty","filled_qty","stop_price","limit_price","updated_at","canceled_at",
      "replaced_at","filled_at","cancel_requested_at","replaces","replaced_by"]),
  }};
}
export function makeOrderedProcessor(processFrame,onFailure){
  let pending=Promise.resolve(),broken=false;
  return {
    push(value){
      pending=pending.then(async()=>{
        if(!broken)await processFrame(value);
      }).catch(error=>{
        broken=true;
        onFailure(error);
      });
      return pending;
    },
    drain(){return pending;},
  };
}
// A lock from an earlier Linux/Android boot cannot belong to a currently
// running process. Use the kernel's boot UUID for narrowly-scoped reboot
// recovery, never PID checks (PIDs can be reused). On restricted devices,
// unreadable boot identity leaves lock recovery manual and fail-closed.
export function recoverablePriorBootLock(previousBootId,currentBootId){
  return typeof previousBootId==="string"&&
    /^[a-f0-9-]{36}$/.test(previousBootId)&&
    typeof currentBootId==="string"&&
    /^[a-f0-9-]{36}$/.test(currentBootId)&&
    previousBootId!==currentBootId;
}
async function linuxBootId(){
  try{return (await readFile("/proc/sys/kernel/random/boot_id","utf8")).trim().toLowerCase();}
  catch{return null;}
}
export async function acquireWorkerLock(dir){
  await mkdir(dir,{recursive:true,mode:0o700});
  const path=join(dir,".paper-trade-stream.lock");
  const id=randomUUID(),bootId=await linuxBootId();
  let file;
  try{file=await open(path,"wx",0o600);}
  catch(error){
    if(error?.code!=="EEXIST")throw error;
    const owner=await readFile(path,"utf8").catch(()=>null);
    let existing;
    try{existing=JSON.parse(owner??"");}catch{existing=null;}
    if(!recoverablePriorBootLock(existing?.bootId,bootId))
      throw Error("PAPER stream lock exists; confirm prior worker is stopped before manual recovery.");
    // The old kernel boot is conclusively gone. Recheck the identical lock
    // text immediately before deleting it; never delete a changed owner.
    if(await readFile(path,"utf8").catch(()=>null)!==owner)
      throw Error("PAPER stream lock changed during reboot recovery.");
    await unlink(path);
    file=await open(path,"wx",0o600);
  }
  try{await file.writeFile(JSON.stringify({pid:process.pid,id,bootId}));await file.sync();}
  finally{await file.close();}
  return async()=>{
    try{
      const present=JSON.parse(await readFile(path,"utf8"));
      if(present.id===id)await unlink(path);
    }catch(error){if(error?.code!=="ENOENT")throw error;}
  };
}

const fileName=frame=>{
  const hash=createHash("sha256").update(JSON.stringify(frame)).digest("hex");
  return new Date().toISOString().replace(/[:.]/g,"-")+"-"+hash+"-"+randomUUID()+".json";
};
export async function persistFrame(dir,frame){
  await mkdir(dir,{recursive:true,mode:0o700});
  if((await readdir(dir)).length>=MAX_BACKLOG)throw Error("PAPER stream durable queue full: operator recovery required.");
  const safe=privateFrame(frame);
  const filename=join(dir,fileName(safe));
  const fd=await open(filename,"wx",0o600);
  try{await fd.writeFile(JSON.stringify(safe));await fd.sync();}finally{await fd.close();}
  return filename;
}
export async function queued(dir){
  await mkdir(dir,{recursive:true,mode:0o700});
  return (await readdir(dir)).filter(x=>/^[0-9TZ-]+-[a-f0-9]{64}-[a-f0-9-]{36}\.json$/.test(x)).sort();
}
export async function flushOnce(config,{session,connected,reconnects}){
  const names=(await queued(config.dir)).slice(0,50);
  const frames=[];
  for(const name of names)frames.push(JSON.parse(await readFile(join(config.dir,name),"utf8")));
  const res=await fetch(config.ingest,{
    method:"POST",
    headers:{"Content-Type":"application/json","x-paper-stream-token":config.token},
    body:JSON.stringify({sessionId:session,connected,reconnects,events:frames}),
    signal:AbortSignal.timeout(12000),
  });
  if(!res.ok)throw Error("PAPER stream ingest returned HTTP "+res.status);
  const response=await res.json();
  if(response.ok!==true||response.accepted!==frames.length)
    throw Error("PAPER stream ingest acknowledgment was incomplete.");
  // Remove durable event files only AFTER the database confirms the batch.
  for(const name of names)await unlink(join(config.dir,name));
  return names.length;
}
export async function run(config=requirePaperConfig()){
  await mkdir(config.dir,{recursive:true,mode:0o700});
  const releaseLock=await acquireWorkerLock(config.dir);
  const session=randomUUID();
  let connected=false,reconnects=0,stopping=false,socket=null,flushing=false;
  const sync=async(force=false)=>{
    if(flushing)return;
    flushing=true;
    try{
      if(!force&&(await queued(config.dir)).length===0)return;
      let count=0;
      do{
        count=await flushOnce(config,{session,connected,reconnects});
      }while(count===50);
    }catch(error){log("INGEST_UNAVAILABLE",error.message);}
    finally{flushing=false;}
  };
  const drainTimer=setInterval(()=>void sync(),1000);
  const heartbeatTimer=setInterval(()=>void sync(true),20000);
  const shutdown=()=>{
    stopping=true;connected=false;
    clearInterval(drainTimer);clearInterval(heartbeatTimer);
    socket?.close();
  };
  process.once("SIGINT",shutdown);
  process.once("SIGTERM",shutdown);
  try{
  while(!stopping){
    try{
      socket=new WebSocket(PAPER_WS);
      socket.binaryType="arraybuffer";
      let failure=null,subscribed=false;
      // The WebSocket event dispatcher does not await asynchronous callbacks:
      // queue received frames so every disk write finishes in arrival order.
      const processor=makeOrderedProcessor(async event=>{
        const data=typeof Blob!=="undefined"&&event.data instanceof Blob?
          await event.data.arrayBuffer():event.data;
        for(const frame of parseFrames(data)){
          if(frame?.stream==="authorization"){
            if(frame.data?.status!=="authorized")throw Error("PAPER broker stream auth failed.");
            socket.send(JSON.stringify({action:"listen",data:{streams:["trade_updates"]}}));
          }else if(frame?.stream==="listening"){
            if(!frame.data?.streams?.includes("trade_updates"))
              throw Error("Alpaca PAPER trade_updates subscription not acknowledged.");
            subscribed=true;connected=true;void sync(true);
            log("SUBSCRIBED","Alpaca PAPER trade_updates; no order mutation permissions used.");
          }else if(frame?.stream==="trade_updates"){
            // The socket can close while queued frames are still being
            // fsynced. Persist events accepted under this subscribed session
            // even after health.connected is set false by its close callback.
            if(!subscribed)throw Error("Trade event arrived before PAPER subscription acknowledgment.");
            await persistFrame(config.dir,frame);
            void sync();
          }
        }
      },error=>{
        failure=error;connected=false;socket.close();
      });
      await new Promise(done=>{
        socket.addEventListener("open",()=>{
          socket.send(JSON.stringify({action:"auth",key:config.key,secret:config.secret}));
        });
        socket.addEventListener("message",event=>void processor.push(event));
        socket.addEventListener("error",()=>{failure??=Error("PAPER WebSocket transport error.");});
        socket.addEventListener("close",()=>{connected=false;done();});
      });
      await processor.drain();
      if(failure)log("STREAM_DISCONNECTED",failure.message);
    }catch(error){connected=false;log("STREAM_FAILURE",error.message);}
    void sync(true);
    if(stopping)break;
    reconnects++;
    const wait=Math.min(60000,1000*2**Math.min(6,reconnects))+
      Math.floor(Math.random()*500);
    await new Promise(r=>setTimeout(r,wait));
  }
  }finally{
    clearInterval(drainTimer);clearInterval(heartbeatTimer);
    connected=false;
    // Commit the offline heartbeat before unlocking when possible.
    await sync(true);
    await releaseLock();
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  run().catch(error=>{console.error("PAPER stream worker stopped:",error.message);process.exitCode=1;});
}
