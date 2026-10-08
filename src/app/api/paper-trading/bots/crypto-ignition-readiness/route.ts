import { NextResponse } from "next/server";
import { z } from "zod";
import { buildSparkScanJournalRows } from "@/lib/paper-crypto-ignition-scan-journal";
import { evaluateCryptoIgnitionCandidate } from "@/lib/paper-crypto-ignition-readiness";
import { CRYPTO_IGNITION_STRATEGY_V1 as strategy } from "@/lib/paper-crypto-ignition-strategy-config";

export const dynamic="force-dynamic";

const PUBLIC_ORIGIN=process.env.CREATORHUB_PUBLIC_ORIGIN||"https://creatorhub-gray.vercel.app";
const SUPABASE_URL=process.env.NEXT_PUBLIC_SUPABASE_URL||"https://yufptpfiwdbzzrvhkvux.supabase.co";

const sourceCandidateSchema=z.object({
  symbol:z.string(),score:z.coerce.number().finite(),bid:z.coerce.number().finite().positive().nullable(),
  ask:z.coerce.number().finite().positive().nullable(),spreadPct:z.coerce.number().finite().nonnegative().nullable(),
  quoteAgeSeconds:z.coerce.number().finite().nonnegative().nullable(),fastMomentumPct:z.coerce.number().finite().nullable(),
  slowMomentumPct:z.coerce.number().finite().nullable(),atrPct:z.coerce.number().finite().nonnegative().nullable(),
  trigger:z.coerce.number().finite().positive().nullable(),maxEntry:z.coerce.number().finite().positive().nullable(),
  trackingBars:z.array(z.object({
    t:z.string(),o:z.coerce.number().finite().positive(),h:z.coerce.number().finite().positive(),
    l:z.coerce.number().finite().positive(),c:z.coerce.number().finite().positive(),v:z.coerce.number().finite().nonnegative().optional(),
  })),
});
const sourceSchema=z.object({candidates:z.array(sourceCandidateSchema)});
const ledgerSchema=z.object({
  status:z.enum(["active","planned","paused"]),equity:z.coerce.number().finite().nonnegative(),
  buying_power:z.coerce.number().finite().nullable(),open_planned_risk_pct:z.coerce.number().finite().nullable(),
  daily_realized_loss_pct:z.coerce.number().finite().nullable(),metadata:z.object({executionEnabled:z.boolean().optional()}).passthrough(),
});
const positionSchema=z.object({bot_id:z.string(),symbol:z.string(),quantity:z.coerce.number().finite().positive()});
const orderSchema=z.object({status:z.string(),created_at:z.string()});

function reply(body:unknown,status=200){return NextResponse.json(body,{status,headers:{"Cache-Control":"no-store"}});}
function chicagoDate(value:number){
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"America/Chicago",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date(value));
  const map=Object.fromEntries(parts.map(part=>[part.type,part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

export async function GET(request:Request){
  const supabaseSecret=process.env.SUPABASE_SECRET_KEY?.trim()??"";
  if(!supabaseSecret)return reply({error:"Spark storage is not configured."},503);
  const dbHeaders:Record<string,string>={apikey:supabaseSecret,Accept:"application/json"};
  if(supabaseSecret.startsWith("eyJ"))dbHeaders.Authorization=`Bearer ${supabaseSecret}`;
  const db=async(path:string)=>{
    const response=await fetch(`${SUPABASE_URL}/rest/v1/${path}`,{headers:dbHeaders,cache:"no-store",signal:AbortSignal.timeout(10_000)});
    if(!response.ok)throw new Error(`Spark storage returned HTTP ${response.status}.`);
    return response.json();
  };

  try{
    const now=Date.now();
    const sourceResponse=await fetch(new URL("/api/paper-trading/bots/weekend-crypto-readiness",PUBLIC_ORIGIN),{
      cache:"no-store",signal:AbortSignal.timeout(20_000),
    });
    if(!sourceResponse.ok)return reply({error:"Spark could not read Flash source readiness."},503);
    const source=sourceSchema.parse(await sourceResponse.json());
    const cutoff=encodeURIComponent(new Date(now-36*60*60*1000).toISOString());
    const [ledgerRaw,positionsRaw,ordersRaw]=await Promise.all([
      db(`paper_bot_ledgers?bot_id=eq.${strategy.botProfileId}&select=status,equity,buying_power,open_planned_risk_pct,daily_realized_loss_pct,metadata&limit=1`),
      db("paper_bot_positions?select=bot_id,symbol,quantity&quantity=gt.0"),
      db(`paper_bot_orders?bot_id=eq.${strategy.botProfileId}&side=eq.buy&created_at=gte.${cutoff}&select=status,created_at&limit=100`),
    ]);
    const ledger=z.array(ledgerSchema).parse(ledgerRaw)[0];
    if(!ledger)return reply({error:"Spark virtual ledger is not configured."},503);
    const positions=z.array(positionSchema).parse(positionsRaw);
    const orders=z.array(orderSchema).parse(ordersRaw);
    const counted=new Set(["submitted","partially_filled","filled","closed","replaced"]);
    const today=chicagoDate(now);
    const dailyNewEntries=orders.filter(order=>counted.has(order.status)&&chicagoDate(Date.parse(order.created_at))===today).length;
    const ownPositions=positions.filter(position=>position.bot_id===strategy.botProfileId);
    const occupiedByOther=new Set(positions.filter(position=>position.bot_id!==strategy.botProfileId).map(position=>position.symbol));
    const executionEnabled=ledger.metadata.executionEnabled===true;

    const candidates=source.candidates
      .filter(candidate=>strategy.universe.includes(candidate.symbol as typeof strategy.universe[number]))
      .map(candidate=>evaluateCryptoIgnitionCandidate({
        source:candidate,
        ledger:{
          active:ledger.status==="active",equity:ledger.equity,buyingPower:ledger.buying_power??ledger.equity,
          openRiskPct:ledger.open_planned_risk_pct??0,dailyRealizedLossPct:ledger.daily_realized_loss_pct??0,
          openPositions:ownPositions.length,dailyNewEntries,executionEnabled,
        },
        symbolOccupiedByOtherBot:occupiedByOther.has(candidate.symbol),
      }))
      .sort((a,b)=>b.sourceScore-a.sourceScore||(b.fastMomentumPct??-999)-(a.fastMomentumPct??-999));

    const ready=candidates.filter(candidate=>candidate.state==="ready");
    if(ready[0]&&executionEnabled)ready[0].selectedForSubmission=true;

    const cronSecret=process.env.CRON_SECRET?.trim()??"";
    const isCron=Boolean(cronSecret&&request.headers.get("authorization")===`Bearer ${cronSecret}`);
    if(isCron){
      const response=await fetch(`${SUPABASE_URL}/rest/v1/paper_bot_journal`,{
        method:"POST",
        headers:{...dbHeaders,"Content-Type":"application/json",Prefer:"return=minimal"},
        body:JSON.stringify(buildSparkScanJournalRows(strategy.botProfileId,{
          collectedAt:new Date(now).toISOString(),strategyId:strategy.id,
          strategyVersion:strategy.version,executionEnabled,candidates,
        })),
        cache:"no-store",signal:AbortSignal.timeout(10_000),
      });
      if(!response.ok)throw new Error(`Spark journal returned HTTP ${response.status}.`);
    }

    return reply({
      collectedAt:new Date(now).toISOString(),strategyId:strategy.id,strategyVersion:strategy.version,paperOnly:true,
      executionEnabled,submissionReady:Boolean(executionEnabled&&ready[0]?.selectedForSubmission),
      selectedSymbol:ready[0]?.symbol??null,
      researchOnly:!executionEnabled,
      dailyEntriesRemaining:Math.max(0,strategy.cadence.maximumNewEntriesPerDay-dailyNewEntries),
      openPositionSlotsRemaining:Math.max(0,strategy.cadence.maximumOpenPositions-ownPositions.length),
      candidates,
    });
  }catch(error){
    return reply({error:error instanceof Error?error.message:"Spark readiness unavailable."},503);
  }
}
