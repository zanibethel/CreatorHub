import { NextResponse } from "next/server";
import { z } from "zod";
import { createPaperClientOrderId } from "@/lib/paper-order-attribution";
import { advancePaperCounterfactual, counterfactualPatch, type PaperCounterfactualState } from "@/lib/paper-counterfactual";
import { MOMENTUM_BREAKOUT_STRATEGY_V1 as strategy } from "@/lib/paper-momentum-breakout-strategy-config";

export const dynamic="force-dynamic";

const PUBLIC_ORIGIN=process.env.CREATORHUB_PUBLIC_ORIGIN||"https://creatorhub-gray.vercel.app";
const SUPABASE_URL=process.env.NEXT_PUBLIC_SUPABASE_URL||"https://yufptpfiwdbzzrvhkvux.supabase.co";

const barSchema=z.object({t:z.string(),o:z.number().positive(),h:z.number().positive(),l:z.number().positive(),c:z.number().positive()}).passthrough();
const planSchema=z.object({
  symbol:z.string(),state:z.enum(["ready","waiting","blocked"]),selectedForSubmission:z.boolean(),
  scannerScore:z.number().finite(),acceleration:z.number().finite(),
  bid:z.number().positive().nullable(),ask:z.number().positive().nullable(),spreadPct:z.number().nonnegative().nullable(),
  trigger:z.number().finite().positive().nullable(),maxEntry:z.number().finite().positive().nullable(),
  protectiveStop:z.number().finite().positive().nullable(),takeProfit:z.number().finite().positive().nullable(),
  plannedQuantity:z.number().finite().positive().nullable(),plannedNotional:z.number().finite().positive().nullable(),
  plannedRiskDollars:z.number().finite().nonnegative().nullable(),plannedRiskPct:z.number().finite().nonnegative().nullable(),
  blockers:z.array(z.string()),waitingOn:z.array(z.string()),marketOpen:z.boolean(),trackingBars:z.array(barSchema),
});
const readinessSchema=z.object({
  collectedAt:z.string(),paperOnly:z.literal(true),executionEnabled:z.boolean(),submissionReady:z.boolean(),
  selectedSymbol:z.string().nullable(),plans:z.array(planSchema),
});
const rowSchema=z.object({
  id:z.coerce.number().int().positive(),setup_key:z.string(),bot_id:z.string(),strategy_id:z.string().nullable(),
  strategy_version:z.coerce.number().int().positive().nullable(),symbol:z.string(),asset_class:z.string(),
  decision_at:z.string(),session_key:z.string().nullable(),status:z.enum(["watching","triggered","completed","expired","ambiguous","superseded"]),
  score:z.coerce.number().finite().nullable(),trigger_price:z.coerce.number().positive(),max_entry_price:z.coerce.number().positive(),
  protective_stop:z.coerce.number().positive(),planned_take_profit:z.coerce.number().positive().nullable(),
  assumed_entry_price:z.coerce.number().positive().nullable(),risk_per_unit:z.coerce.number().positive().nullable(),
  one_r_price:z.coerce.number().positive().nullable(),two_r_price:z.coerce.number().positive().nullable(),
  triggered_at:z.string().nullable(),stop_hit_at:z.string().nullable(),one_r_hit_at:z.string().nullable(),two_r_hit_at:z.string().nullable(),
  first_outcome:z.string().nullable(),peak_price:z.coerce.number().positive().nullable(),trough_price:z.coerce.number().positive().nullable(),
  last_bar_at:z.string().nullable(),mark_count:z.coerce.number().int().nonnegative(),mfe_r:z.coerce.number(),mae_r:z.coerce.number(),
  blockers:z.array(z.string()),warnings:z.array(z.string()),metadata:z.record(z.string(),z.unknown()),
});

function reply(body:unknown,status=200){return NextResponse.json(body,{status,headers:{"Cache-Control":"no-store"}});}
function easternSession(value:string|number){
  const parts=new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit",weekday:"short",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date(value));
  const m=Object.fromEntries(parts.map(part=>[part.type,part.value]));
  const date=`${m.year}-${m.month}-${m.day}`; const minutes=Number(m.hour)*60+Number(m.minute);
  return {date,marketOpen:!["Sat","Sun"].includes(m.weekday)&&minutes>=570&&minutes<960,afterClose:minutes>=960};
}
function toState(row:z.infer<typeof rowSchema>):PaperCounterfactualState{
  return {
    id:row.id,setupKey:row.setup_key,botId:row.bot_id,strategyId:row.strategy_id,strategyVersion:row.strategy_version,
    symbol:row.symbol,assetClass:row.asset_class,decisionAt:row.decision_at,sessionKey:row.session_key,status:row.status,
    score:row.score,triggerPrice:row.trigger_price,maxEntryPrice:row.max_entry_price,protectiveStop:row.protective_stop,
    plannedTakeProfit:row.planned_take_profit,assumedEntryPrice:row.assumed_entry_price,riskPerUnit:row.risk_per_unit,
    oneRPrice:row.one_r_price,twoRPrice:row.two_r_price,triggeredAt:row.triggered_at,stopHitAt:row.stop_hit_at,
    oneRHitAt:row.one_r_hit_at,twoRHitAt:row.two_r_hit_at,firstOutcome:row.first_outcome,peakPrice:row.peak_price,
    troughPrice:row.trough_price,lastBarAt:row.last_bar_at,markCount:row.mark_count,mfeR:row.mfe_r,maeR:row.mae_r,
    blockers:row.blockers,warnings:row.warnings,metadata:row.metadata,
  };
}

async function persistCounterfactuals(readiness:z.infer<typeof readinessSchema>){
  const secret=process.env.SUPABASE_SECRET_KEY?.trim()??"";
  if(!secret)return {ok:false,seeds:0,updates:0};
  const headers:Record<string,string>={apikey:secret,"Content-Type":"application/json",Accept:"application/json"};
  if(secret.startsWith("eyJ"))headers.Authorization=`Bearer ${secret}`;
  const session=easternSession(readiness.collectedAt);

  const activeResponse=await fetch(
    `${SUPABASE_URL}/rest/v1/paper_bot_counterfactuals?select=*&bot_id=eq.${strategy.botProfileId}&status=in.(watching,triggered)&order=decision_at.asc`,
    {headers,cache:"no-store",signal:AbortSignal.timeout(10_000)},
  );
  if(!activeResponse.ok)throw new Error(`Pulse counterfactual read HTTP ${activeResponse.status}`);
  const active=z.array(rowSchema).parse(await activeResponse.json());
  const activeKeys=new Set(active.map(row=>row.setup_key));

  const seeds=readiness.plans.flatMap(plan=>{
    const actualSubmission=readiness.executionEnabled&&readiness.submissionReady&&readiness.selectedSymbol===plan.symbol;
    if(!plan.marketOpen||actualSubmission||!plan.trigger||!plan.maxEntry||!plan.protectiveStop||plan.protectiveStop>=plan.maxEntry)return [];
    const key=`pulse:${strategy.id}:v${strategy.version}:${session.date}:${plan.symbol}`;
    if(activeKeys.has(key))return [];
    return [{
      setup_key:key,bot_id:strategy.botProfileId,strategy_id:strategy.id,strategy_version:strategy.version,
      symbol:plan.symbol,asset_class:"stock",source_event_type:plan.state==="blocked"?"rejected":"candidate",
      decision_state:plan.state,decision_at:readiness.collectedAt,session_key:session.date,status:"watching",score:plan.scannerScore,
      trigger_price:plan.trigger,max_entry_price:plan.maxEntry,protective_stop:plan.protectiveStop,planned_take_profit:plan.takeProfit,
      last_bar_at:plan.trackingBars.at(-1)?.t??null,blockers:plan.blockers,warnings:plan.waitingOn,
      metadata:{source:"pulse-5m-runner",paperOnly:true,initialBid:plan.bid,initialAsk:plan.ask,initialSpreadPct:plan.spreadPct,
        plannedRiskDollars:plan.plannedRiskDollars,acceleration:plan.acceleration,trackingPolicy:"first-pulse-study-per-symbol-per-session"},
    }];
  });
  if(seeds.length){
    const response=await fetch(`${SUPABASE_URL}/rest/v1/paper_bot_counterfactuals?on_conflict=setup_key`,{
      method:"POST",headers:{...headers,Prefer:"resolution=ignore-duplicates,return=minimal"},body:JSON.stringify(seeds),
      cache:"no-store",signal:AbortSignal.timeout(10_000),
    });
    if(!response.ok)throw new Error(`Pulse counterfactual seed HTTP ${response.status}`);
  }

  let updates=0;
  for(const row of active){
    const plan=readiness.plans.find(item=>item.symbol===row.symbol);
    if(!plan)continue;
    const expire=(row.session_key!==null&&row.session_key!==session.date)||(row.session_key===session.date&&session.afterClose);
    const result=advancePaperCounterfactual(toState(row),plan.trackingBars,{expire});
    if(!result.changed)continue;
    const response=await fetch(`${SUPABASE_URL}/rest/v1/paper_bot_counterfactuals?id=eq.${row.id}`,{
      method:"PATCH",headers:{...headers,Prefer:"return=minimal"},body:JSON.stringify(counterfactualPatch(result.state)),
      cache:"no-store",signal:AbortSignal.timeout(10_000),
    });
    if(!response.ok)throw new Error(`Pulse counterfactual update HTTP ${response.status}`);
    updates++;
  }
  return {ok:true,seeds:seeds.length,updates};
}

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
  let counterfactualTracking={ok:false,seeds:0,updates:0};
  try{counterfactualTracking=await persistCounterfactuals(readiness);}catch{}

  if(!readiness.executionEnabled)return reply({ok:true,action:"none",reason:"pulse-executor-disabled",collectedAt:readiness.collectedAt,counterfactualTracking});

  const selected=readiness.plans.find(plan=>plan.selectedForSubmission&&plan.state==="ready");
  if(!readiness.submissionReady||!selected||!selected.trigger||!selected.maxEntry||!selected.protectiveStop||!selected.takeProfit||!selected.plannedQuantity||!selected.plannedNotional||selected.plannedRiskDollars===null){
    return reply({ok:true,action:"none",reason:"no-selected-ready-pulse-setup",collectedAt:readiness.collectedAt,counterfactualTracking});
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
    return reply({ok:true,action:"none",reason:"pulse-order-already-active",symbol:selected.symbol,counterfactualTracking});
  }

  const stage={
    requested_quantity:selected.plannedQuantity,requested_notional:selected.plannedNotional,pool_id:"day",
    entry_trigger:selected.trigger,max_entry_price:selected.maxEntry,protective_stop:selected.protectiveStop,
    planned_risk_dollars:selected.plannedRiskDollars,expires_at:expiresAt,
    stage_reason:`Pulse score ${selected.scannerScore.toFixed(0)}; acceleration ${selected.acceleration.toFixed(0)}; live 5m breakout confirmed.`,
    take_profit_price:selected.takeProfit,take_profit_fraction:strategy.risk.firstTakeProfitFraction,
    take_profit_r:strategy.risk.firstTakeProfitR,protect_winner_at_r:strategy.risk.protectWinnerAtR,trail_remainder:strategy.risk.trailRemainder,
    metadata:{paperOnly:true,liveMoneyEnabled:false,requiresRevalidation:true,orderAuthorizationOrigin:"momentum-breakout-readiness",
      scannerScore:selected.scannerScore,acceleration:selected.acceleration},
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
      body:JSON.stringify({client_order_id:clientOrderId,bot_id:strategy.botProfileId,strategy_id:strategy.id,strategy_version:strategy.version,
        broker_order_id:null,symbol:selected.symbol,asset_class:"stock",side:"buy",status:"prepared",...stage}),
      cache:"no-store",signal:AbortSignal.timeout(10_000),
    });
    if(!insert.ok)return reply({error:"Pulse could not stage its prepared order."},503);
  }

  const executeResponse=await fetch(new URL("/api/paper-trading/bots/momentum-breakout-execute",PUBLIC_ORIGIN),{
    method:"POST",headers:{"Content-Type":"application/json","x-paper-momentum-execution-token":token},
    body:JSON.stringify({symbol:selected.symbol}),cache:"no-store",signal:AbortSignal.timeout(30_000),
  });
  const execution=await executeResponse.json().catch(()=>({error:"Pulse executor returned invalid JSON."}));
  if(!executeResponse.ok){
    const expected=[409,423].includes(executeResponse.status);
    return reply({ok:expected,action:expected?"none":"execution-error",symbol:selected.symbol,executorStatus:executeResponse.status,execution,counterfactualTracking},expected?200:502);
  }
  return reply({ok:true,action:"execute",symbol:selected.symbol,execution,counterfactualTracking});
}
