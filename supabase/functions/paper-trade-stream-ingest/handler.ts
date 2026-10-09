import {normalizeTradeUpdate} from "./normalize.ts";

const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"no-store"}});
const hex=(bytes:Uint8Array)=>[...bytes].map(x=>x.toString(16).padStart(2,"0")).join("");
const digest=async(s:string)=>hex(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s))));
const equal=(a:string,b:string)=>{
  if(a.length!==b.length)return false;
  let diff=0;
  for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);
  return diff===0;
};
export function createHandler(env:(name:string)=>string|undefined,fetcher:typeof fetch=fetch){
  return async(req:Request)=>{
    if(req.method!=="POST")return json({error:"Method not allowed."},405);
    const configured=env("PAPER_STREAM_INGEST_TOKEN_SHA256")??"";
    if(!/^[a-f0-9]{64}$/.test(configured))
      return json({error:"PAPER stream ingest is not configured."},503);
    const token=req.headers.get("x-paper-stream-token")??"";
    if(!/^[a-f0-9]{64}$/.test(token)||!equal(await digest(token),configured))
      return json({error:"Unauthorized."},401);
    let raw:string;
    try{raw=await req.text();}catch{return json({error:"Invalid request."},400);}
    if(raw.length>250000)return json({error:"PAPER stream batch exceeds the size limit."},413);
    let message:any;
    try{message=JSON.parse(raw);}catch{return json({error:"Invalid JSON."},400);}
    const session=message?.sessionId,connected=message?.connected,
      reconnects=message?.reconnects,events=message?.events;
    if(typeof session!=="string"||
       !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(session)||
       typeof connected!=="boolean"||!Number.isInteger(reconnects)||
       reconnects<0||reconnects>10000000||!Array.isArray(events)||
       events.length>50)
      return json({error:"Malformed broker stream envelope."},422);
    let normalized:Awaited<ReturnType<typeof normalizeTradeUpdate>>[];
    try{
      normalized=[];
      for(const event of events)normalized.push(await normalizeTradeUpdate(event));
    }catch{
      return json({error:"Malformed Alpaca PAPER trade update frame."},422);
    }
    const dbUrl=env("SUPABASE_URL");
    let key="";
    try{key=JSON.parse(env("SUPABASE_SECRET_KEYS")||"{}").default??"";}catch{/* service role fallback */}
    key=key||env("SUPABASE_SERVICE_ROLE_KEY")||"";
    if(!dbUrl||!key)return json({error:"PAPER stream database is unavailable."},503);
    const headers:Record<string,string>={apikey:key,"Content-Type":"application/json"};
    if(key.startsWith("eyJ"))headers.Authorization="Bearer "+key;
    try{
      const response=await fetcher(dbUrl+"/rest/v1/rpc/paper_broker_record_trade_updates",{
        method:"POST",headers,body:JSON.stringify({
          p_events:normalized,p_worker_session_id:session,
          p_connected:connected,p_reconnect_count:reconnects,
        }),signal:AbortSignal.timeout(12000),
      });
      if(!response.ok)throw Error("PAPER stream persistence unavailable.");
      const receipt=await response.json() as {accepted?:number;inserted?:number;duplicates?:number};
      return json({ok:true,accepted:receipt.accepted??normalized.length,
        inserted:receipt.inserted??null,duplicates:receipt.duplicates??null});
    }catch{
      return json({error:"PAPER stream persistence unavailable; retry this batch."},503);
    }
  };
}
