import {withPaperCronHeartbeat} from "@/lib/paper-cron-health";
import { NextResponse } from "next/server";
import { z } from "zod";
import { FUSE_PENNY_STRATEGY_V1 as cfg } from "@/lib/paper-fuse-strategy-config";

export const dynamic="force-dynamic";
const DB=process.env.NEXT_PUBLIC_SUPABASE_URL||"https://yufptpfiwdbzzrvhkvux.supabase.co";
// Use the stable production alias, not a deployment-specific cron request host.
const PUBLIC_ORIGIN=process.env.CREATORHUB_PUBLIC_ORIGIN||"https://creatorhub-gray.vercel.app";
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{"Cache-Control":"no-store"}});
const ledgerSchema=z.object({status:z.string(),metadata:z.record(z.string(),z.unknown())});
const previewSchema=z.object({paperOnly:z.literal(true),researchOnly:z.literal(true),
  plans:z.array(z.object({symbol:z.string(),readiness:z.string(),
    eligible:z.boolean(),fuseScore:z.number()}))});

/**
 * Independent five-minute Fuse PAPER pilot driver, permanently inactive
 * unless BOTH Supabase ledger switches are explicitly armed.
 */
async function runPaperCron(request:Request){
  const cron=process.env.CRON_SECRET?.trim()??"";
  if(!cron||request.headers.get("authorization")!=="Bearer "+cron)
    return reply({error:"Unauthorized."},401);
  const service=process.env.SUPABASE_SECRET_KEY?.trim()??"";
  if(!service)return reply({error:"Fuse driver store dependency unavailable."},503);
  const headers:Record<string,string>={apikey:service,Accept:"application/json"};
  if(service.startsWith("eyJ"))headers.Authorization="Bearer "+service;
  try{
    const ledgerResponse=await fetch(DB+"/rest/v1/paper_bot_ledgers?bot_id=eq."+
      cfg.botProfileId+"&select=status,metadata&limit=1",{headers,cache:"no-store",
      signal:AbortSignal.timeout(12000)});
    if(!ledgerResponse.ok)return reply({error:"Fuse driver ledger read failed."},503);
    const ledger=z.array(ledgerSchema).parse(await ledgerResponse.json())[0];
    if(!ledger||ledger.status!=="active"||ledger.metadata.executionEnabled!==true||
      ledger.metadata.fusePilotEnabled!==true||
      typeof ledger.metadata.fusePilotClientOrderId==="string")
      return reply({ok:true,paperOnly:true,action:"none",reason:"fuse-pilot-disabled-or-consumed"});
    const previewResponse=await fetch(new URL("/api/paper-trading/bots/fuse-execution-preview",PUBLIC_ORIGIN),{
      cache:"no-store",signal:AbortSignal.timeout(35000)});
    if(!previewResponse.ok)return reply({ok:false,action:"preview-unavailable",upstreamStatus:previewResponse.status,error:"Fuse driver preview unavailable."},503);
    const preview=previewSchema.parse(await previewResponse.json());
    const eligible=preview.plans.filter(p=>p.eligible&&
      p.readiness==="research-ready"&&p.fuseScore>=cfg.scoring.readyScore)
      .sort((a,b)=>b.fuseScore-a.fuseScore||a.symbol.localeCompare(b.symbol));
    if(!eligible.length)return reply({ok:true,paperOnly:true,action:"none",reason:"no-broker-eligible-setup"});
    const chosen=eligible[0];
    const executed=await fetch(new URL("/api/paper-trading/bots/fuse-execute",PUBLIC_ORIGIN),{
      method:"POST",headers:{Authorization:"Bearer "+cron,"Content-Type":"application/json"},
      body:JSON.stringify({symbol:chosen.symbol}),cache:"no-store",signal:AbortSignal.timeout(60000)});
    const outcome=await executed.json().catch(()=>({error:"Fuse executor returned invalid JSON."}));
    return reply({ok:executed.ok,action:executed.ok?"entry-requested":"entry-blocked",
      paperOnly:true,symbol:chosen.symbol,score:chosen.fuseScore,
      executorStatus:executed.status,outcome},executed.ok?200:executed.status>=400?executed.status:503);
  }catch(error){
    return reply({ok:false,paperOnly:true,action:"driver-error",
      error:error instanceof Error?error.message:"Fuse driver failed closed."},503);
  }
}

export const GET=withPaperCronHeartbeat({job:"fuse-run",botId:"penny-volatility-day-100",expectedMinutes:5},runPaperCron);
