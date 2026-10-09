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
const fileName=frame=>{
  const hash=createHash("sha256").update(JSON.stringify(frame)).digest("hex");
  return new Date().toISOString().replace(/[:.]/g,"-")+"-"+hash+"-"+randomUUID()+".json";
};
export async function persistFrame(dir,frame){
  await mkdir(dir,{recursive:true,mode:0o700});
  if((await readdir(dir)).length>=MAX_BACKLOG)throw Error("PAPER stream durable queue full: operator recovery required.");
  const filename=join(dir,fileName(frame));
  const fd=await open(filename,"wx",0o600);
  try{await fd.writeFile(JSON.stringify(frame));await fd.sync();}finally{await fd.close();}
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
    void sync(true);
  };
  process.once("SIGINT",shutdown);
  process.once("SIGTERM",shutdown);
  while(!stopping){
    try{
      socket=new WebSocket(PAPER_WS);
      socket.binaryType="arraybuffer";
      let failure=null;
      await new Promise(done=>{
        socket.addEventListener("open",()=>{
          socket.send(JSON.stringify({action:"auth",key:config.key,secret:config.secret}));
        });
        socket.addEventListener("message",async(event)=>{
          try{
            const data=typeof Blob!=="undefined"&&event.data instanceof Blob?
              await event.data.arrayBuffer():event.data;
            for(const frame of parseFrames(data)){
              if(frame?.stream==="authorization"){
                if(frame.data?.status!=="authorized")throw Error("PAPER broker stream auth failed.");
                socket.send(JSON.stringify({action:"listen",data:{streams:["trade_updates"]}}));
              }else if(frame?.stream==="listening"){
                if(!frame.data?.streams?.includes("trade_updates"))
                  throw Error("Alpaca PAPER trade_updates subscription not acknowledged.");
                connected=true;void sync(true);
                log("SUBSCRIBED","Alpaca PAPER trade_updates; no order mutation permissions used.");
              }else if(frame?.stream==="trade_updates"){
                if(!connected)throw Error("Trade event arrived before PAPER subscription acknowledgment.");
                await persistFrame(config.dir,frame);
                void sync();
              }
            }
          }catch(error){
            failure=error;connected=false;socket.close();
          }
        });
        socket.addEventListener("error",()=>{failure??=Error("PAPER WebSocket transport error.");});
        socket.addEventListener("close",()=>{connected=false;done();});
      });
      if(failure)log("STREAM_DISCONNECTED",failure.message);
    }catch(error){connected=false;log("STREAM_FAILURE",error.message);}
    void sync(true);
    if(stopping)break;
    reconnects++;
    const wait=Math.min(60000,1000*2**Math.min(6,reconnects))+
      Math.floor(Math.random()*500);
    await new Promise(r=>setTimeout(r,wait));
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  run().catch(error=>{console.error("PAPER stream worker stopped:",error.message);process.exitCode=1;});
}
