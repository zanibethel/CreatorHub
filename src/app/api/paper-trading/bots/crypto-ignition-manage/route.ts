import { NextResponse } from "next/server";
import { z } from "zod";
import { createPaperClientOrderId } from "@/lib/paper-order-attribution";
import { CRYPTO_IGNITION_STRATEGY_V1 as strategy } from "@/lib/paper-crypto-ignition-strategy-config";

export const dynamic="force-dynamic";

const BOT_ID=strategy.botProfileId;
const SUPABASE_URL=process.env.NEXT_PUBLIC_SUPABASE_URL||"https://yufptpfiwdbzzrvhkvux.supabase.co";
const ALPACA_PAPER="https://paper-api.alpaca.markets/v2";
const ALPACA_DATA="https://data.alpaca.markets";

const ledgerSchema=z.object({metadata:z.object({executionEnabled:z.boolean().optional(),liveMoneyEnabled:z.boolean().optional()}).passthrough()});
const positionSchema=z.object({
  symbol:z.enum(strategy.executionUniverse),quantity:z.coerce.number().finite().positive(),
  average_entry:z.coerce.number().finite().positive(),protective_stop:z.coerce.number().finite().positive().nullable(),
  initial_protective_stop:z.coerce.number().finite().positive().nullable(),
  take_profit_fraction:z.coerce.number().finite().positive().max(1).nullable(),
  exit_manager_state:z.record(z.string(),z.unknown()),metadata:z.record(z.string(),z.unknown()),
});
const orderSchema=z.object({client_order_id:z.string(),broker_order_id:z.string().nullable(),status:z.string(),metadata:z.record(z.string(),z.unknown())});
type BrokerOrder={id?:string;status?:string;filled_qty?:string;filled_avg_price?:string|null};
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
function mappedStatus(value:unknown){const s=typeof value==="string"?value:"submitted";return ["filled","partially_filled","canceled","rejected","expired","replaced"].includes(s)?s:"submitted";}
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));

export async function POST(request:Request){
  if(!(await authorized(request)))return reply({error:"Unauthorized."},401);
  const supabaseSecret=process.env.SUPABASE_SECRET_KEY?.trim()??"";
  const alpacaKey=process.env.ALPACA_API_KEY_ID?.trim()??"";
  const alpacaSecret=process.env.ALPACA_API_SECRET_KEY?.trim()??"";
  if(!supabaseSecret||!alpacaKey||!alpacaSecret)return reply({error:"Spark manager dependencies are not configured."},503);

  const dbHeaders:Record<string,string>={apikey:supabaseSecret,"Content-Type":"application/json",Accept:"application/json"};
  if(supabaseSecret.startsWith("eyJ"))dbHeaders.Authorization=`Bearer ${supabaseSecret}`;
  const db=async(path:string,body?:unknown,method:"GET"|"POST"|"PATCH"="GET",prefer?:string)=>{
    const response=await fetch(`${SUPABASE_URL}/rest/v1/${path}`,{method,headers:{...dbHeaders,...(prefer?{Prefer:prefer}:{})},
      ...(body===undefined||method==="GET"?{}:{body:JSON.stringify(body)}),cache:"no-store",signal:AbortSignal.timeout(10_000)});
    const text=await response.text(); if(!response.ok)throw new Error(`Spark manager storage returned HTTP ${response.status}.`); return text?JSON.parse(text):null;
  };
  const brokerHeaders={"APCA-API-KEY-ID":alpacaKey,"APCA-API-SECRET-KEY":alpacaSecret,Accept:"application/json","Content-Type":"application/json"};
  const alpaca=async(path:string,init:RequestInit={})=>{
    const response=await fetch(`${ALPACA_PAPER}/${path}`,{...init,headers:{...brokerHeaders,...(init.headers??{})},cache:"no-store",signal:AbortSignal.timeout(10_000)});
    const text=await response.text();const body=text?JSON.parse(text):null;if(!response.ok)throw new Error(typeof body?.message==="string"?body.message:`PAPER execution venue HTTP ${response.status}`);return body;
  };

  const ledger=z.array(ledgerSchema).parse(await db(`paper_bot_ledgers?select=metadata&bot_id=eq.${BOT_ID}&limit=1`))[0];
  if(!ledger?.metadata.executionEnabled)return reply({ok:true,paperOnly:true,action:"none",reason:"executor-disabled"});
  if(ledger.metadata.liveMoneyEnabled)return reply({error:"Live-money mode is not permitted."},423);

  const position=z.array(positionSchema).parse(await db(
    `paper_bot_positions?select=symbol,quantity,average_entry,protective_stop,initial_protective_stop,take_profit_fraction,exit_manager_state,metadata&bot_id=eq.${BOT_ID}&quantity=gt.0&limit=1`
  ))[0];
  if(!position)return reply({ok:true,paperOnly:true,action:"none",reason:"no-position"});

  const quoteResponse=await fetch(`${ALPACA_DATA}/v1beta3/crypto/us/latest/quotes?symbols=${encodeURIComponent(position.symbol)}`,{
    headers:{"APCA-API-KEY-ID":alpacaKey,"APCA-API-SECRET-KEY":alpacaSecret,Accept:"application/json"},
    cache:"no-store",signal:AbortSignal.timeout(10_000),
  });
  if(!quoteResponse.ok)return reply({error:"Spark manager could not read a current quote."},503);
  const quotePayload=await quoteResponse.json() as {quotes?:Record<string,{bp?:number,ap?:number,t?:string}>};
  const quote=quotePayload.quotes?.[position.symbol];
  const bid=num(quote?.bp),ask=num(quote?.ap);
  const mark=bid&&ask?(bid+ask)/2:bid??ask;
  if(!(mark&&mark>0))return reply({error:"Spark manager does not have a valid current mark."},503);

  const initialStop=position.initial_protective_stop??position.protective_stop;
  if(!(initialStop&&initialStop<position.average_entry))return reply({error:"Spark position is missing a valid initial risk reference."},409);
  const riskPerUnit=position.average_entry-initialStop;
  const rMultiple=(mark-position.average_entry)/riskPerUnit;

  const activeSells=z.array(orderSchema).parse(await db(
    `paper_bot_orders?select=client_order_id,broker_order_id,status,metadata&bot_id=eq.${BOT_ID}&side=eq.sell&status=in.(prepared,submitted,partially_filled)&order=created_at.desc&limit=50`
  ));
  const protection=activeSells.filter(order=>order.metadata.purpose==="protective-stop");
  const patchOrder=(id:string,values:Record<string,unknown>)=>db(`paper_bot_orders?client_order_id=eq.${encodeURIComponent(id)}`,{...values,updated_at:new Date().toISOString()},"PATCH","return=minimal");
  const patchPosition=(values:Record<string,unknown>)=>db(`paper_bot_positions?bot_id=eq.${BOT_ID}&symbol=eq.${encodeURIComponent(position.symbol)}`,{...values,updated_at:new Date().toISOString()},"PATCH","return=minimal");

  const brokerSellable=async()=>{
    for(let i=0;i<10;i++){
      const brokerPositions=await alpaca("positions") as BrokerPosition[];
      const current=brokerPositions.find(item=>normalize(item.symbol)===normalize(position.symbol));
      const available=floorQty(Math.min(position.quantity,num(current?.qty_available)??num(current?.qty)??0));
      if(available>0)return available;
      await sleep(200);
    }
    return 0;
  };
  const cancelProtection=async()=>{
    for(const order of protection){
      if(order.broker_order_id){try{await alpaca(`orders/${encodeURIComponent(order.broker_order_id)}`,{method:"DELETE"});}catch{return false;}}
      await patchOrder(order.client_order_id,{status:"canceled",metadata:{...order.metadata,cancelReason:"spark-manager-replacement",cancelRequestedAt:new Date().toISOString()}});
    }
    if(protection.some(order=>order.broker_order_id))await sleep(250);
    return true;
  };
  const createProtection=async(stop:number,qty:number,reason:string)=>{
    const clientId=createPaperClientOrderId(BOT_ID,strategy.version,crypto.randomUUID());
    const stopPrice=roundPrice(stop),limitPrice=stopFloor(stopPrice);
    await db("paper_bot_orders",{
      client_order_id:clientId,bot_id:BOT_ID,strategy_id:strategy.id,strategy_version:strategy.version,
      symbol:position.symbol,asset_class:"crypto",side:"sell",status:"prepared",requested_quantity:qty,pool_id:"day",
      entry_trigger:stopPrice,max_entry_price:limitPrice,protective_stop:stopPrice,planned_risk_dollars:0,
      stage_reason:reason,metadata:{purpose:"protective-stop",paperOnly:true,estimatedFeeBps:strategy.fees.estimatedTakerFeeBpsPerSide},
    },"POST","return=minimal");
    try{
      const order=await alpaca("orders",{method:"POST",body:JSON.stringify({
        symbol:position.symbol,qty:qtyString(qty),side:"sell",type:"stop_limit",time_in_force:"gtc",
        stop_price:String(stopPrice),limit_price:String(limitPrice),client_order_id:clientId,
      })}) as BrokerOrder;
      await patchOrder(clientId,{status:mappedStatus(order.status),broker_order_id:order.id??null,submitted_at:new Date().toISOString()});
      return true;
    }catch(error){
      await patchOrder(clientId,{status:"error",metadata:{purpose:"protective-stop",paperOnly:true,executionError:error instanceof Error?error.message.slice(0,180):"Protection submission failed."}});
      return false;
    }
  };
  const emergencyFlatten=async(qty:number)=>{
    if(!(qty>0))return false;
    const id=createPaperClientOrderId(BOT_ID,strategy.version,crypto.randomUUID());
    try{
      const order=await alpaca("orders",{method:"POST",body:JSON.stringify({
        symbol:position.symbol,qty:qtyString(qty),side:"sell",type:"market",time_in_force:"gtc",client_order_id:id,
      })}) as BrokerOrder;
      await db("paper_bot_orders",{
        client_order_id:id,bot_id:BOT_ID,strategy_id:strategy.id,strategy_version:strategy.version,
        symbol:position.symbol,asset_class:"crypto",side:"sell",status:mappedStatus(order.status),broker_order_id:order.id??null,
        requested_quantity:qty,pool_id:"day",planned_risk_dollars:0,submitted_at:new Date().toISOString(),
        stage_reason:"Spark emergency flatten after protection failure.",metadata:{purpose:"emergency-flatten",paperOnly:true},
      },"POST","return=minimal");
      return Boolean(order.id);
    }catch{return false;}
  };

  const partialState=String(position.exit_manager_state.partialProfitState??position.metadata.partialProfitState??"");
  if(rMultiple<strategy.risk.protectWinnerAtR){
    return reply({ok:true,paperOnly:true,action:"hold",symbol:position.symbol,rMultiple,mark});
  }

  if(rMultiple>=strategy.risk.firstTakeProfitR&&partialState!=="completed"){
    if(!(await cancelProtection()))return reply({error:"Spark could not cancel protection before partial profit.",critical:true},502);
    const available=await brokerSellable();
    const fraction=position.take_profit_fraction??strategy.risk.firstTakeProfitFraction;
    const partialQty=floorQty(Math.min(position.quantity,available)*fraction);
    if(!(partialQty>0))return reply({error:"Spark has no sellable quantity for partial profit.",critical:true},502);

    const clientId=createPaperClientOrderId(BOT_ID,strategy.version,crypto.randomUUID());
    await db("paper_bot_orders",{
      client_order_id:clientId,bot_id:BOT_ID,strategy_id:strategy.id,strategy_version:strategy.version,
      symbol:position.symbol,asset_class:"crypto",side:"sell",status:"prepared",requested_quantity:partialQty,pool_id:"day",
      planned_risk_dollars:0,stage_reason:"Spark first +2R partial profit.",metadata:{purpose:"take-profit-partial",paperOnly:true},
    },"POST","return=minimal");

    let order:BrokerOrder|null=null;
    try{
      order=await alpaca("orders",{method:"POST",body:JSON.stringify({
        symbol:position.symbol,qty:qtyString(partialQty),side:"sell",type:"market",time_in_force:"gtc",client_order_id:clientId,
      })}) as BrokerOrder;
      await patchOrder(clientId,{status:mappedStatus(order.status),broker_order_id:order.id??null,submitted_at:new Date().toISOString()});
    }catch{
      const restored=await createProtection(position.protective_stop??initialStop,available,"Restore Spark protection after partial-profit failure.");
      if(!restored)await emergencyFlatten(available);
      return reply({error:"Spark partial-profit submission failed; protection restore attempted.",critical:!restored},502);
    }
    if(order?.id){
      for(let i=0;i<10;i++){
        if(["filled","canceled","rejected","expired"].includes(order.status??""))break;
        await sleep(200);try{order=await alpaca(`orders/${encodeURIComponent(order.id)}`) as BrokerOrder;}catch{break;}
      }
    }
    const filled=num(order?.filled_qty)??0;
    if(!(filled>0)){
      if(order?.id){try{await alpaca(`orders/${encodeURIComponent(order.id)}`,{method:"DELETE"});}catch{}}
      await patchOrder(clientId,{status:"canceled"});
      const restored=await createProtection(position.protective_stop??initialStop,available,"Restore Spark protection after unfilled partial profit.");
      if(!restored)await emergencyFlatten(available);
      return reply({ok:true,paperOnly:true,action:"partial-no-fill",protectionRestored:restored});
    }

    await patchOrder(clientId,{status:"filled"});
    const remaining=await brokerSellable();
    if(remaining>0){
      const nextStop=Math.max(position.protective_stop??initialStop,position.average_entry);
      const restored=await createProtection(nextStop,remaining,"Spark protects remainder at break-even after +2R trim.");
      if(!restored){
        const flattened=await emergencyFlatten(remaining);
        return reply({error:"Spark partial filled but remainder protection failed; emergency flatten attempted.",critical:true,emergencyFlattenSubmitted:flattened},502);
      }
      await patchPosition({protective_stop:roundPrice(nextStop),exit_manager_state:{...position.exit_manager_state,partialProfitState:"completed",partialProfitCompletedAt:new Date().toISOString(),lastBrokerAction:"partial_profit",lastBrokerActionAt:new Date().toISOString(),markPrice:mark,rMultiple}});
    }
    return reply({ok:true,paperOnly:true,action:"partial-profit",symbol:position.symbol,filledQuantity:filled,remainingProtected:remaining>0,rMultiple});
  }

  const currentStop=position.protective_stop??initialStop;
  const breakEven=Math.max(currentStop,position.average_entry);
  const trailingStop=rMultiple>=strategy.risk.firstTakeProfitR
    ? Math.max(breakEven,mark-riskPerUnit)
    : breakEven;
  const materialIncrease=trailingStop>currentStop*(1+0.001);
  if(!materialIncrease)return reply({ok:true,paperOnly:true,action:"hold",symbol:position.symbol,rMultiple,mark,currentStop});

  if(!(await cancelProtection()))return reply({error:"Spark could not cancel the existing protective order.",critical:true},502);
  const available=await brokerSellable();
  if(!(available>0))return reply({error:"Spark has no sellable quantity for replacement protection.",critical:true},502);
  const restored=await createProtection(trailingStop,available,rMultiple>=2?"Spark trails remainder one R behind mark.":"Spark protects winner at break-even.");
  if(!restored){
    const flattened=await emergencyFlatten(available);
    return reply({error:"Spark protection replacement failed; emergency flatten attempted.",critical:true,emergencyFlattenSubmitted:flattened},502);
  }
  await patchPosition({protective_stop:roundPrice(trailingStop),exit_manager_state:{...position.exit_manager_state,lastBrokerAction:"tighten_stop",lastBrokerActionAt:new Date().toISOString(),markPrice:mark,rMultiple,desiredStop:roundPrice(trailingStop)}});
  return reply({ok:true,paperOnly:true,action:"tighten-stop",symbol:position.symbol,newStop:roundPrice(trailingStop),rMultiple,mark});
}
