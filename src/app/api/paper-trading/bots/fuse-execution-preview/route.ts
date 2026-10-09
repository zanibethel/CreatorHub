import { NextResponse } from "next/server";
import { z } from "zod";
import { fuseBracketPreview } from "@/lib/paper-fuse-bracket";
import { FUSE_PENNY_STRATEGY_V1 as cfg } from "@/lib/paper-fuse-strategy-config";

export const dynamic="force-dynamic";
const DB_URL=process.env.NEXT_PUBLIC_SUPABASE_URL||"https://yufptpfiwdbzzrvhkvux.supabase.co";
const planSchema=z.object({
  symbol:z.string(),readiness:z.string(),blockers:z.array(z.string()),
  quoteAgeSeconds:z.number().nullable(),bid:z.number().nullable(),ask:z.number().nullable(),
  entryTrigger:z.number().nullable(),maximumEntry:z.number().nullable(),plannedShares:z.number(),
  fuseScore:z.number(),plan:z.object({stopPrice:z.number().nullable(),exitPrice:z.number().nullable()}),
});
const readinessSchema=z.object({
  paperOnly:z.literal(true),researchOnly:z.literal(true),submissionReady:z.literal(false),
  plans:z.array(planSchema),
});
const ledgerSchema=z.object({
  status:z.string(),equity:z.coerce.number(),buying_power:z.coerce.number().nullable(),
  metadata:z.record(z.string(),z.unknown()),
});
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{"Cache-Control":"no-store"}});

/** Read-only broker-plan preview. This endpoint never stages or submits an order. */
export async function GET(request:Request){
  const dbKey=process.env.SUPABASE_SECRET_KEY?.trim()??"";
  if(!dbKey)return reply({error:"Fuse read-only preview dependencies missing."},503);
  const headers:Record<string,string>={apikey:dbKey,Accept:"application/json"};
  if(dbKey.startsWith("eyJ"))headers.Authorization="Bearer "+dbKey;
  try{
    const [readyResponse,ledgerResponse]=await Promise.all([
      fetch(new URL("/api/paper-trading/bots/fuse-readiness",request.url),{
        cache:"no-store",signal:AbortSignal.timeout(30_000),
      }),
      fetch(DB_URL+"/rest/v1/paper_bot_ledgers?bot_id=eq."+
        cfg.botProfileId+"&select=status,equity,buying_power,metadata&limit=1",{
          headers,cache:"no-store",signal:AbortSignal.timeout(12_000),
        }),
    ]);
    if(!readyResponse.ok||!ledgerResponse.ok)
      return reply({error:"Fuse broker preview could not load current research and ledger."},503);
    const ready=readinessSchema.parse(await readyResponse.json());
    const ledger=z.array(ledgerSchema).parse(await ledgerResponse.json())[0];
    if(!ledger||ledger.status!=="active")return reply({error:"Fuse active ledger missing."},503);
    const evaluations=ready.plans.map(plan=>({
      symbol:plan.symbol,readiness:plan.readiness,fuseScore:plan.fuseScore,
      ...fuseBracketPreview(plan,{equity:ledger.equity,buyingPower:ledger.buying_power??ledger.equity}),
    }));
    const executionEnabled=ledger.metadata.executionEnabled===true;
    const pilotEnabled=ledger.metadata.fusePilotEnabled===true;
    const pilotClaimed=typeof ledger.metadata.fusePilotClientOrderId==="string";
    const pilotArmed=executionEnabled&&pilotEnabled&&!pilotClaimed;
    return reply({
      paperOnly:true,researchOnly:true,brokerOrdersSubmitted:false,
      // The preview never submits orders, but its activation state must
      // accurately reflect the ledger to avoid a misleading dashboard.
      executionEnabled,pilotEnabled,pilotClaimed,pilotArmed,submissionReady:false,
      executionActivationRequired:!pilotArmed,assetAndOrderCollisionPreflightRequired:true,
      protectedExitManagerRequired:true,
      ledger:{equity:ledger.equity,buyingPower:ledger.buying_power??ledger.equity},
      eligiblePreviewCount:evaluations.filter(row=>row.eligible).length,
      plans:evaluations,
    });
  }catch(error){
    return reply({error:error instanceof Error?error.message:"Fuse preview unavailable."},503);
  }
}
