import { NextResponse } from "next/server";
import { z } from "zod";
import { advancePaperCounterfactual, counterfactualPatch, type PaperCounterfactualState } from "@/lib/paper-counterfactual";
import { CRYPTO_IGNITION_STRATEGY_V1 as strategy } from "@/lib/paper-crypto-ignition-strategy-config";

export const dynamic="force-dynamic";

const PUBLIC_ORIGIN=process.env.CREATORHUB_PUBLIC_ORIGIN||"https://creatorhub-gray.vercel.app";
const SUPABASE_URL=process.env.NEXT_PUBLIC_SUPABASE_URL||"https://yufptpfiwdbzzrvhkvux.supabase.co";
const BOT_ID=strategy.botProfileId;

const barSchema=z.object({t:z.string(),o:z.number().positive(),h:z.number().positive(),l:z.number().positive(),c:z.number().positive()}).passthrough();
const candidateSchema=z.object({
  symbol:z.string(),sourceScore:z.number(),state:z.enum(["ready","waiting","blocked"]),selectedForSubmission:z.boolean(),
  bid:z.number().positive().nullable(),ask:z.number().positive().nullable(),spreadPct:z.number().nonnegative().nullable(),
  trigger:z.number().positive().nullable(),maxEntry:z.number().positive().nullable(),protectiveStop:z.number().positive().nullable(),
  takeProfit:z.number().positive().nullable(),plannedRiskDollars:z.number().nonnegative().nullable(),
  blockers:z.array(z.string()),waitingOn:z.array(z.string()),trackingBars:z.array(barSchema),
});
const readinessSchema=z.object({
  collectedAt:z.string(),strategyId:z.string(),strategyVersion:z.number().int().positive(),
  paperOnly:z.literal(true),executionEnabled:z.boolean(),submissionReady:z.boolean(),
  selectedSymbol:z.string().nullable(),researchOnly:z.boolean(),candidates:z.array(candidateSchema),
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
function localDate(value:string|number){
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"America/Chicago",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date(value));
  const map=Object.fromEntries(parts.map(part=>[part.type,part.value]));
  return `${map.year}-${map.month}-${map.day}`;
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
  const session=localDate(readiness.collectedAt);
  const activeResponse=await fetch(
    `${SUPABASE_URL}/rest/v1/paper_bot_counterfactuals?select=*&bot_id=eq.${BOT_ID}&status=in.(watching,triggered)&order=decision_at.asc`,
    {headers,cache:"no-store",signal:AbortSignal.timeout(10_000)},
  );
  if(!activeResponse.ok)throw new Error(`Spark counterfactual read HTTP ${activeResponse.status}`);
  const active=z.array(rowSchema).parse(await activeResponse.json());
  const activeKeys=new Set(active.map(row=>row.setup_key));

  const seeds=readiness.candidates.flatMap(candidate=>{
    const scoreInTier=candidate.sourceScore>=strategy.setup.minimumSourceScore&&candidate.sourceScore<=strategy.setup.maximumSourceScore;
    const actualSubmission=readiness.executionEnabled&&readiness.submissionReady&&readiness.selectedSymbol===candidate.symbol;
    if(!scoreInTier||actualSubmission||!candidate.trigger||!candidate.maxEntry||!candidate.protectiveStop||candidate.protectiveStop>=candidate.maxEntry)return [];
    const key=`spark:${readiness.strategyId}:v${readiness.strategyVersion}:${session}:${candidate.symbol}`;
    if(activeKeys.has(key))return [];
    return [{
      setup_key:key,bot_id:BOT_ID,strategy_id:readiness.strategyId,strategy_version:readiness.strategyVersion,
      symbol:candidate.symbol,asset_class:"crypto",source_event_type:candidate.state==="blocked"?"rejected":"candidate",
      decision_state:candidate.state,decision_at:readiness.collectedAt,session_key:session,status:"watching",score:candidate.sourceScore,
      trigger_price:candidate.trigger,max_entry_price:candidate.maxEntry,protective_stop:candidate.protectiveStop,
      planned_take_profit:candidate.takeProfit,last_bar_at:candidate.trackingBars.at(-1)?.t??null,
      blockers:candidate.blockers,warnings:candidate.waitingOn,
      metadata:{source:"spark-5m-runner",paperOnly:true,initialBid:candidate.bid,initialAsk:candidate.ask,initialSpreadPct:candidate.spreadPct,
        plannedRiskDollars:candidate.plannedRiskDollars,trackingPolicy:"first-60-79-study-per-symbol-per-day"},
    }];
  });
  if(seeds.length){
    const response=await fetch(`${SUPABASE_URL}/rest/v1/paper_bot_counterfactuals?on_conflict=setup_key`,{
      method:"POST",headers:{...headers,Prefer:"resolution=ignore-duplicates,return=minimal"},body:JSON.stringify(seeds),
      cache:"no-store",signal:AbortSignal.timeout(10_000),
    });
    if(!response.ok)throw new Error(`Spark counterfactual seed HTTP ${response.status}`);
  }

  let updates=0;
  for(const row of active){
    const candidate=readiness.candidates.find(item=>item.symbol===row.symbol);
    if(!candidate)continue;
    const result=advancePaperCounterfactual(toState(row),candidate.trackingBars,{expire:row.session_key!==null&&row.session_key!==session});
    if(!result.changed)continue;
    const response=await fetch(`${SUPABASE_URL}/rest/v1/paper_bot_counterfactuals?id=eq.${row.id}`,{
      method:"PATCH",headers:{...headers,Prefer:"return=minimal"},body:JSON.stringify(counterfactualPatch(result.state)),
      cache:"no-store",signal:AbortSignal.timeout(10_000),
    });
    if(!response.ok)throw new Error(`Spark counterfactual update HTTP ${response.status}`);
    updates++;
  }
  return {ok:true,seeds:seeds.length,updates};
}

export async function GET(request:Request){
  const cronSecret=process.env.CRON_SECRET?.trim()??"";
  if(!cronSecret||request.headers.get("authorization")!==`Bearer ${cronSecret}`)return reply({error:"Unauthorized."},401);
  const token=process.env.PAPER_CRYPTO_IGNITION_EXECUTION_TOKEN?.trim()??"";
  if(token.length<32)return reply({error:"Spark execution token is not configured."},503);

  const readinessResponse=await fetch(new URL("/api/paper-trading/bots/crypto-ignition-readiness",PUBLIC_ORIGIN),{
    headers:{Authorization:`Bearer ${cronSecret}`},cache:"no-store",signal:AbortSignal.timeout(25_000),
  });
  if(!readinessResponse.ok)return reply({error:"Spark readiness check failed."},503);
  const readiness=readinessSchema.parse(await readinessResponse.json());
  let counterfactualTracking={ok:false,seeds:0,updates:0};
  try{counterfactualTracking=await persistCounterfactuals(readiness);}catch{}

  if(readiness.executionEnabled){
    const manageResponse=await fetch(new URL("/api/paper-trading/bots/crypto-ignition-manage",PUBLIC_ORIGIN),{
      method:"POST",headers:{"x-paper-spark-execution-token":token},cache:"no-store",signal:AbortSignal.timeout(30_000),
    });
    const manage=await manageResponse.json().catch(()=>({error:"Spark manager returned invalid JSON."}));
    if(!manageResponse.ok)return reply({ok:false,action:"manager-error",result:manage,counterfactualTracking},502);
    if(!["none","hold"].includes(manage.action??"none"))return reply({ok:true,action:"manage",result:manage,counterfactualTracking});
  }

  if(!readiness.executionEnabled)return reply({ok:true,action:"none",reason:"spark-executor-disabled",researchOnly:true,counterfactualTracking});
  if(!readiness.submissionReady||!readiness.selectedSymbol)return reply({ok:true,action:"none",reason:"no-selected-ready-spark-setup",counterfactualTracking});

  const executeResponse=await fetch(new URL("/api/paper-trading/bots/crypto-ignition-execute",PUBLIC_ORIGIN),{
    method:"POST",headers:{"Content-Type":"application/json","x-paper-spark-execution-token":token},
    body:JSON.stringify({symbol:readiness.selectedSymbol}),cache:"no-store",signal:AbortSignal.timeout(35_000),
  });
  const execution=await executeResponse.json().catch(()=>({error:"Spark executor returned invalid JSON."}));
  if(!executeResponse.ok){
    const expected=[409,423].includes(executeResponse.status);
    return reply({ok:expected,action:expected?"none":"execution-error",symbol:readiness.selectedSymbol,executorStatus:executeResponse.status,execution,counterfactualTracking},expected?200:502);
  }
  return reply({ok:true,action:"execute",symbol:readiness.selectedSymbol,execution,counterfactualTracking});
}
