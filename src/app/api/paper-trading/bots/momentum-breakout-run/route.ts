import { NextResponse } from "next/server";
import { z } from "zod";
import { createPaperClientOrderId } from "@/lib/paper-order-attribution";
import { MOMENTUM_BREAKOUT_STRATEGY_V1 as strategy } from "@/lib/paper-momentum-breakout-strategy-config";

export const dynamic="force-dynamic";

const PUBLIC_ORIGIN=process.env.CREATORHUB_PUBLIC_ORIGIN||"https://creatorhub-gray.vercel.app";
const SUPABASE_URL=process.env.NEXT_PUBLIC_SUPABASE_URL||"https://yufptpfiwdbzzrvhkvux.supabase.co";

const planSchema=z.object({
  symbol:z.string(),state:z.enum(["ready","waiting","blocked"]),selectedForSubmission:z.boolean(),
  scannerScore:z.number().finite(),acceleration:z.number().finite(),
  trigger:z.number().finite().positive().nullable(),maxEntry:z.number().finite().positive().nullable(),
  protectiveStop:z.number().finite().positive().nullable(),takeProfit:z.number().finite().positive().nullable(),
  plannedQuantity:z.number().finite().positive().nullable(),plannedNotional:z.number().finite().positive().nullable(),
  plannedRiskDollars:z.number().finite().nonnegative().nullable(),plannedRiskPct:z.number().finite().nonnegative().nullable(),
});
const readinessSchema=z.object({
  collectedAt:z.string(),paperOnly:z.literal(true),executionEnabled:z.boolean(),submissionReady:z.boolean(),
  selectedSymbol:z.string().nullable(),plans:z.array(planSchema),
});
function reply(body:unknown,status=200){return NextResponse.json(body,{status,headers:{"Cache-Control":"no-store"}});}

export async function GET(request:Request){
  const cronSecret=process.env.CRON_SECRET?.trim()??"";
  if(!cronSecret||request.headers.get("authorization")!==`Bearer ${cronSecret}`)return reply({error:"Unauthorized."},401);
  const token=process.env.PAPER_MOMENTUM_EXECUTION_TOKEN?.trim()??"";
  const supabaseSecret=process.env.SUPABASE_SECRET_KEY?.trim()??"";
  if(token.length<32||!supabaseSecret)return reply({error:"Pulse execution dependencies are not configured."},503);

  const readinessResponse=await fetch(new URL("/api/paper-trading/bots/momentum-breakout-readiness",PUBLIC_ORIGIN),{
    headers:{Authorization:`Bearer ${cronSecret}`},cache:"no-store",signal:AbortSignal.timeout(30_000),
  });
  const body=await readinessResponse.json().catch(()=>({error:"Pulse readiness returned invalid JSON."}));
  if(!readinessResponse.ok)return reply({ok:false,action:"readiness-error",result:body},502);
  const readiness=readinessSchema.parse(body);
  if(!readiness.executionEnabled)return reply({ok:true,action:"none",reason:"pulse-executor-disabled",collectedAt:readiness.collectedAt});

  const selected=readiness.plans.find(plan=>plan.selectedForSubmission&&plan.state==="ready");
  if(!readiness.submissionReady||!selected||!selected.trigger||!selected.maxEntry||!selected.protectiveStop||!selected.takeProfit||!selected.plannedQuantity||!selected.plannedNotional||selected.plannedRiskDollars===null){
    return reply({ok:true,action:"none",reason:"no-selected-ready-pulse-setup",collectedAt:readiness.collectedAt});
  }

  const headers:Record<string,string>={apikey:supabaseSecret,"Content-Type":"application/json",Accept:"application/json"};
  if(supabaseSecret.startsWith("eyJ"))headers.Authorization=`Bearer ${supabaseSecret}`;
  const existingResponse=await fetch(
    `${SUPABASE_URL}/rest/v1/paper_bot_orders?bot_id=eq.${strategy.botProfileId}&symbol=eq.${encodeURIComponent(selected.symbol)}&side=eq.buy&status=in.(prepared,submitted,partially_filled)&select=client_order_id,status&order=created_at.desc&limit=1`,
    {headers,cache:"no-store",signal:AbortSignal.timeout(10_000)},
  );
  if(!existingResponse.ok)return reply({error:"Pulse could not inspect existing orders."},503);
  const existing=z.array(z.object({client_order_id:z.string(),status:z.string()})).parse(await existingResponse.json());
  const expiresAt=new Date(Date.now()+20*60_000).toISOString();

  let clientOrderId=existing[0]?.client_order_id??null;
  if(existing[0]?.status==="submitted"||existing[0]?.status==="partially_filled"){
    return reply({ok:true,action:"none",reason:"pulse-order-already-active",symbol:selected.symbol});
  }

  const stage={
    requested_quantity:selected.plannedQuantity,
    requested_notional:selected.plannedNotional,
    pool_id:"day",
    entry_trigger:selected.trigger,
    max_entry_price:selected.maxEntry,
    protective_stop:selected.protectiveStop,
    planned_risk_dollars:selected.plannedRiskDollars,
    expires_at:expiresAt,
    stage_reason:`Pulse score ${selected.scannerScore.toFixed(0)}; acceleration ${selected.acceleration.toFixed(0)}; live 5m breakout confirmed.`,
    take_profit_price:selected.takeProfit,
    take_profit_fraction:strategy.risk.firstTakeProfitFraction,
    take_profit_r:strategy.risk.firstTakeProfitR,
    protect_winner_at_r:strategy.risk.protectWinnerAtR,
    trail_remainder:strategy.risk.trailRemainder,
    metadata:{
      paperOnly:true,liveMoneyEnabled:false,requiresRevalidation:true,
      orderAuthorizationOrigin:"momentum-breakout-readiness",
      scannerScore:selected.scannerScore,acceleration:selected.acceleration,
    },
    updated_at:new Date().toISOString(),
  };

  if(clientOrderId){
    const update=await fetch(`${SUPABASE_URL}/rest/v1/paper_bot_orders?client_order_id=eq.${encodeURIComponent(clientOrderId)}&status=eq.prepared`,{
      method:"PATCH",headers:{...headers,Prefer:"return=minimal"},body:JSON.stringify(stage),cache:"no-store",signal:AbortSignal.timeout(10_000),
    });
    if(!update.ok)return reply({error:"Pulse could not refresh its prepared order."},503);
  }else{
    clientOrderId=createPaperClientOrderId(strategy.botProfileId,strategy.version);
    const insert=await fetch(`${SUPABASE_URL}/rest/v1/paper_bot_orders`,{
      method:"POST",headers:{...headers,Prefer:"return=minimal"},
      body:JSON.stringify({
        client_order_id:clientOrderId,bot_id:strategy.botProfileId,strategy_id:strategy.id,strategy_version:strategy.version,
        broker_order_id:null,symbol:selected.symbol,asset_class:"stock",side:"buy",status:"prepared",...stage,
      }),cache:"no-store",signal:AbortSignal.timeout(10_000),
    });
    if(!insert.ok)return reply({error:"Pulse could not stage its prepared order."},503);
  }

  const executeResponse=await fetch(new URL("/api/paper-trading/bots/momentum-breakout-execute",PUBLIC_ORIGIN),{
    method:"POST",
    headers:{"Content-Type":"application/json","x-paper-momentum-execution-token":token},
    body:JSON.stringify({symbol:selected.symbol}),
    cache:"no-store",signal:AbortSignal.timeout(30_000),
  });
  const execution=await executeResponse.json().catch(()=>({error:"Pulse executor returned invalid JSON."}));
  if(!executeResponse.ok){
    const expected=[409,423].includes(executeResponse.status);
    return reply({ok:expected,action:expected?"none":"execution-error",symbol:selected.symbol,executorStatus:executeResponse.status,execution},expected?200:502);
  }
  return reply({ok:true,action:"execute",symbol:selected.symbol,execution});
}
