import { NextResponse } from "next/server";
import { z } from "zod";
import { createPaperClientOrderId } from "@/lib/paper-order-attribution";
import { CRYPTO_IGNITION_STRATEGY_V1 as strategy } from "@/lib/paper-crypto-ignition-strategy-config";

export const dynamic="force-dynamic";

const PUBLIC_ORIGIN=process.env.CREATORHUB_PUBLIC_ORIGIN||"https://creatorhub-gray.vercel.app";
const SUPABASE_URL=process.env.NEXT_PUBLIC_SUPABASE_URL||"https://yufptpfiwdbzzrvhkvux.supabase.co";
const ALPACA_PAPER="https://paper-api.alpaca.markets/v2";
const BOT_ID=strategy.botProfileId;

const requestSchema=z.object({symbol:z.enum(strategy.executionUniverse)}).strict();
const candidateSchema=z.object({
  symbol:z.enum(strategy.executionUniverse),sourceScore:z.number().finite(),
  state:z.enum(["ready","waiting","blocked"]),selectedForSubmission:z.boolean(),
  quoteAgeSeconds:z.number().finite().nonnegative().nullable(),
  trigger:z.number().finite().positive().nullable(),maxEntry:z.number().finite().positive().nullable(),
  protectiveStop:z.number().finite().positive().nullable(),takeProfit:z.number().finite().positive().nullable(),
  plannedQuantity:z.number().finite().positive().nullable(),plannedNotional:z.number().finite().positive().nullable(),
  plannedRiskDollars:z.number().finite().nonnegative().nullable(),plannedRiskPct:z.number().finite().nonnegative().nullable(),
});
const readinessSchema=z.object({
  collectedAt:z.string(),paperOnly:z.literal(true),executionEnabled:z.boolean(),
  submissionReady:z.boolean(),selectedSymbol:z.enum(strategy.executionUniverse).nullable(),
  candidates:z.array(candidateSchema),
});
type BrokerOrder={id?:string;status?:string;symbol?:string;side?:string;qty?:string;filled_qty?:string;filled_avg_price?:string|null};
type BrokerPosition={symbol?:string;qty?:string;qty_available?:string};

function reply(body:unknown,status=200){return NextResponse.json(body,{status,headers:{"Cache-Control":"no-store"}});}
async function digest(value:string){const bytes=new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value)));return Array.from(bytes,b=>b.toString(16).padStart(2,"0")).join("");}
async function authorized(request:Request){
  const expected=process.env.PAPER_CRYPTO_IGNITION_EXECUTION_TOKEN?.trim()??"";
  const supplied=request.headers.get("x-paper-spark-execution-token")?.trim()??"";
  return expected.length>=32&&supplied.length>=32&&(await digest(expected))===(await digest(supplied));
}
function num(value:unknown){const parsed=typeof value==="number"?value:typeof value==="string"?Number(value):NaN;return Number.isFinite(parsed)?parsed:null;}
function normalize(value:string|undefined){return(value??"").replace("/","").toUpperCase();}
function floorQty(value:number){return Math.floor((value+Number.EPSILON)*1e9)/1e9;}
function qtyString(value:number){return value.toFixed(9).replace(/0+$/,"").replace(/\.$/,"");}
function roundPrice(value:number){return Number(value.toFixed(value>=1000?2:value>=1?4:6));}
function stopFloor(stop:number){return roundPrice(stop*0.997);}
function mappedStatus(value:unknown){
  const s=typeof value==="string"?value:"submitted";
  return ["filled","partially_filled","canceled","rejected","expired","replaced"].includes(s)?s:"submitted";
}
function localDate(now=Date.now()){
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"America/Chicago",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date(now));
  const m=Object.fromEntries(parts.map(part=>[part.type,part.value]));
  return `${m.year}-${m.month}-${m.day}`;
}
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));

export async function POST(request:Request){
  if(!(await authorized(request)))return reply({error:"Unauthorized."},401);
  const supabaseSecret=process.env.SUPABASE_SECRET_KEY?.trim()??"";
  const alpacaKey=process.env.ALPACA_API_KEY_ID?.trim()??"";
  const alpacaSecret=process.env.ALPACA_API_SECRET_KEY?.trim()??"";
  if(!supabaseSecret||!alpacaKey||!alpacaSecret)return reply({error:"Spark execution dependencies are not configured."},503);

  let requested:z.infer<typeof requestSchema>;
  try{requested=requestSchema.parse(await request.json());}catch{return reply({error:"A supported Spark symbol is required."},400);}

  const readinessResponse=await fetch(new URL("/api/paper-trading/bots/crypto-ignition-readiness",PUBLIC_ORIGIN),{cache:"no-store",signal:AbortSignal.timeout(20_000)});
  if(!readinessResponse.ok)return reply({error:"Spark final readiness recheck failed."},503);
  const readiness=readinessSchema.parse(await readinessResponse.json());
  const candidate=readiness.candidates.find(item=>item.symbol===requested.symbol);
  if(!readiness.executionEnabled||!readiness.submissionReady||readiness.selectedSymbol!==requested.symbol||candidate?.state!=="ready"||!candidate.selectedForSubmission){
    return reply({error:"Spark entry is not authorized by the current readiness state.",state:candidate?.state??"blocked"},423);
  }
  if(candidate.sourceScore<strategy.setup.minimumSourceScore||candidate.sourceScore>strategy.setup.maximumSourceScore){
    return reply({error:"Spark source score is outside the early-ignition tier."},409);
  }
  if(candidate.quoteAgeSeconds===null||candidate.quoteAgeSeconds>strategy.marketData.maximumQuoteAgeSeconds
    ||!candidate.trigger||!candidate.maxEntry||!candidate.protectiveStop||!candidate.takeProfit
    ||!candidate.plannedNotional||candidate.plannedRiskDollars===null){
    return reply({error:"Spark execution plan is incomplete or stale."},409);
  }

  const dbHeaders:Record<string,string>={apikey:supabaseSecret,"Content-Type":"application/json",Accept:"application/json"};
  if(supabaseSecret.startsWith("eyJ"))dbHeaders.Authorization=`Bearer ${supabaseSecret}`;
  const db=async(path:string,body?:unknown,method:"GET"|"POST"|"PATCH"="GET",prefer?:string)=>{
    const response=await fetch(`${SUPABASE_URL}/rest/v1/${path}`,{
      method,headers:{...dbHeaders,...(prefer?{Prefer:prefer}:{})},
      ...(body===undefined||method==="GET"?{}:{body:JSON.stringify(body)}),
      cache:"no-store",signal:AbortSignal.timeout(10_000),
    });
    const text=await response.text();
    if(!response.ok){
      let detail="";try{detail=text?JSON.parse(text)?.message??"":"";}catch{}
      throw new Error(detail||`Spark storage returned HTTP ${response.status}.`);
    }
    return text?JSON.parse(text):null;
  };
  const brokerHeaders={"APCA-API-KEY-ID":alpacaKey,"APCA-API-SECRET-KEY":alpacaSecret,Accept:"application/json","Content-Type":"application/json"};
  const alpaca=async(path:string,init:RequestInit={})=>{
    const response=await fetch(`${ALPACA_PAPER}/${path}`,{...init,headers:{...brokerHeaders,...(init.headers??{})},cache:"no-store",signal:AbortSignal.timeout(10_000)});
    const text=await response.text(); const body=text?JSON.parse(text):null;
    if(!response.ok)throw new Error(typeof body?.message==="string"?body.message:`PAPER execution venue HTTP ${response.status}`);
    return body;
  };

  const [positionsRaw,openOrdersRaw]=await Promise.all([alpaca("positions"),alpaca("orders?status=open&limit=500&nested=true&direction=desc")]);
  const compact=normalize(requested.symbol);
  const positions=Array.isArray(positionsRaw)?positionsRaw as BrokerPosition[]:[];
  const openOrders=Array.isArray(openOrdersRaw)?openOrdersRaw as BrokerOrder[]:[];
  if(positions.some(position=>normalize(position.symbol)===compact&&Math.abs(num(position.qty)??0)>0))return reply({error:"Shared simulated execution account already has this crypto position."},409);
  if(openOrders.some(order=>normalize(order.symbol)===compact))return reply({error:"Shared simulated execution account already has an open order in this crypto symbol."},409);

  const riskPerUnit=candidate.maxEntry-candidate.protectiveStop;
  if(!(riskPerUnit>0))return reply({error:"Spark risk plan has an invalid stop distance."},409);
  const qtyByNotional=candidate.plannedNotional/candidate.maxEntry;
  const qtyByRisk=candidate.plannedRiskDollars>0?candidate.plannedRiskDollars/riskPerUnit:qtyByNotional;
  const entryQty=floorQty(Math.min(qtyByNotional,qtyByRisk));
  if(!(entryQty>0))return reply({error:"Spark entry quantity is below the supported minimum."},409);
  const claimedNotional=entryQty*candidate.maxEntry;
  if(claimedNotional<strategy.execution.minimumOrderNotionalUsd)return reply({error:"Spark planned order is below the execution minimum."},409);

  const clientOrderId=createPaperClientOrderId(BOT_ID,strategy.version,crypto.randomUUID());
  const expiresAt=new Date(Date.now()+5*60_000).toISOString();
  try{
    await db("rpc/paper_bot_claim_crypto_ignition_entry",{
      p_client_order_id:clientOrderId,p_symbol:requested.symbol,p_requested_notional:claimedNotional,
      p_entry_trigger:candidate.trigger,p_max_entry_price:candidate.maxEntry,p_protective_stop:candidate.protectiveStop,
      p_take_profit_price:candidate.takeProfit,p_planned_risk_dollars:entryQty*riskPerUnit,
      p_session_date:localDate(),p_expires_at:expiresAt,
      p_metadata:{sourceScore:candidate.sourceScore,scannerCollectedAt:readiness.collectedAt,quoteAgeSeconds:candidate.quoteAgeSeconds},
    },"POST");
  }catch(error){return reply({error:error instanceof Error?error.message:"Spark entry claim failed."},409);}

  const patchOrder=(id:string,values:Record<string,unknown>)=>db(
    `paper_bot_orders?client_order_id=eq.${encodeURIComponent(id)}`,
    {...values,updated_at:new Date().toISOString()},"PATCH","return=minimal"
  );

  let entry:BrokerOrder|null=null;
  try{
    entry=await alpaca("orders",{method:"POST",body:JSON.stringify({
      symbol:requested.symbol,qty:qtyString(entryQty),side:"buy",type:"limit",time_in_force:"gtc",
      limit_price:String(roundPrice(candidate.maxEntry)),client_order_id:clientOrderId,
    })}) as BrokerOrder;
    await patchOrder(clientOrderId,{status:mappedStatus(entry.status),broker_order_id:entry.id??null,requested_quantity:entryQty,submitted_at:new Date().toISOString(),
      metadata:{paperOnly:true,executionMode:"paper-crypto-ignition",entryOrderType:"marketable-limit",entryLimitPrice:roundPrice(candidate.maxEntry),estimatedFeeBps:strategy.fees.estimatedTakerFeeBpsPerSide}});
  }catch(error){
    await patchOrder(clientOrderId,{status:"error",metadata:{paperOnly:true,executionMode:"paper-crypto-ignition",executionError:error instanceof Error?error.message.slice(0,180):"Entry submission failed."}});
    return reply({error:"Spark entry submission failed before a confirmed fill."},502);
  }
  if(!entry?.id)return reply({error:"Spark execution venue did not return an entry order ID."},502);

  let finalEntry=entry;
  for(let i=0;i<12;i++){
    if(["filled","canceled","rejected","expired"].includes(finalEntry.status??""))break;
    await sleep(250);
    try{finalEntry=await alpaca(`orders/${encodeURIComponent(entry.id)}`) as BrokerOrder;}catch{break;}
  }
  let filledQty=num(finalEntry.filled_qty)??0;
  if(finalEntry.status!=="filled"){
    try{await alpaca(`orders/${encodeURIComponent(entry.id)}`,{method:"DELETE"});}catch{}
    for(let i=0;i<6;i++){
      await sleep(200);
      try{finalEntry=await alpaca(`orders/${encodeURIComponent(entry.id)}`) as BrokerOrder;filledQty=num(finalEntry.filled_qty)??filledQty;}catch{break;}
      if(["filled","canceled","rejected","expired"].includes(finalEntry.status??""))break;
    }
  }
  await patchOrder(clientOrderId,{status:filledQty>0?(finalEntry.status==="filled"?"filled":"partially_filled"):mappedStatus(finalEntry.status),
    metadata:{paperOnly:true,executionMode:"paper-crypto-ignition",filledQuantityObserved:filledQty,filledAveragePriceObserved:num(finalEntry.filled_avg_price),estimatedFeeBps:strategy.fees.estimatedTakerFeeBpsPerSide}});
  if(!(filledQty>0))return reply({ok:true,paperOnly:true,symbol:requested.symbol,outcome:"no-fill",protectionAttached:false});

  let brokerPosition:BrokerPosition|null=null;
  for(let i=0;i<12;i++){
    try{
      const current=await alpaca("positions") as BrokerPosition[];
      brokerPosition=current.find(item=>normalize(item.symbol)===compact)??null;
      if((num(brokerPosition?.qty_available)??num(brokerPosition?.qty)??0)>0)break;
    }catch{}
    await sleep(250);
  }
  const protectQty=floorQty(num(brokerPosition?.qty_available)??num(brokerPosition?.qty)??0);
  if(!(protectQty>0))return reply({error:"Spark entry filled but sellable quantity could not be confirmed for protection.",critical:true},502);

  const stopClientId=createPaperClientOrderId(BOT_ID,strategy.version,crypto.randomUUID());
  const stopPrice=roundPrice(candidate.protectiveStop);
  const stopLimit=stopFloor(stopPrice);
  await db("paper_bot_orders",{
    client_order_id:stopClientId,bot_id:BOT_ID,strategy_id:strategy.id,strategy_version:strategy.version,
    symbol:requested.symbol,asset_class:"crypto",side:"sell",status:"prepared",requested_quantity:protectQty,
    pool_id:"day",entry_trigger:stopPrice,max_entry_price:stopLimit,protective_stop:stopPrice,planned_risk_dollars:0,
    stage_reason:"Spark protective stop-limit.",take_profit_price:candidate.takeProfit,take_profit_fraction:strategy.risk.firstTakeProfitFraction,
    take_profit_r:strategy.risk.firstTakeProfitR,protect_winner_at_r:strategy.risk.protectWinnerAtR,trail_remainder:true,
    metadata:{purpose:"protective-stop",parentClientOrderId:clientOrderId,paperOnly:true,estimatedFeeBps:strategy.fees.estimatedTakerFeeBpsPerSide},
  },"POST","return=minimal");

  try{
    const stop=await alpaca("orders",{method:"POST",body:JSON.stringify({
      symbol:requested.symbol,qty:qtyString(protectQty),side:"sell",type:"stop_limit",time_in_force:"gtc",
      stop_price:String(stopPrice),limit_price:String(stopLimit),client_order_id:stopClientId,
    })}) as BrokerOrder;
    await patchOrder(stopClientId,{status:mappedStatus(stop.status),broker_order_id:stop.id??null,submitted_at:new Date().toISOString()});
    return reply({ok:true,paperOnly:true,symbol:requested.symbol,outcome:"filled-protected",filledQuantity:filledQty,protectiveQuantity:protectQty,protectionAttached:Boolean(stop.id)});
  }catch(error){
    await patchOrder(stopClientId,{status:"error",metadata:{purpose:"protective-stop",paperOnly:true,executionError:error instanceof Error?error.message.slice(0,180):"Protective stop failed."}});
    const emergencyId=createPaperClientOrderId(BOT_ID,strategy.version,crypto.randomUUID());
    try{
      const flatten=await alpaca("orders",{method:"POST",body:JSON.stringify({
        symbol:requested.symbol,qty:qtyString(protectQty),side:"sell",type:"market",time_in_force:"gtc",client_order_id:emergencyId,
      })}) as BrokerOrder;
      await db("paper_bot_orders",{
        client_order_id:emergencyId,bot_id:BOT_ID,strategy_id:strategy.id,strategy_version:strategy.version,
        symbol:requested.symbol,asset_class:"crypto",side:"sell",status:mappedStatus(flatten.status),broker_order_id:flatten.id??null,
        requested_quantity:protectQty,pool_id:"day",planned_risk_dollars:0,submitted_at:new Date().toISOString(),
        stage_reason:"Spark emergency flatten after protection failure.",metadata:{purpose:"emergency-flatten",paperOnly:true,parentClientOrderId:clientOrderId},
      },"POST","return=minimal");
      return reply({error:"Spark protection failed after fill; emergency simulated flatten submitted.",critical:true,emergencyFlattenSubmitted:Boolean(flatten.id)},502);
    }catch{
      return reply({error:"Spark protection and emergency flatten both failed after a fill.",critical:true,emergencyFlattenSubmitted:false},502);
    }
  }
}
