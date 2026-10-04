import { NextResponse } from "next/server";
import { z } from "zod";
import { buildPaperExecutionFailureJournalRow } from "@/lib/paper-order-lifecycle-evidence";
import { createPaperClientOrderId } from "@/lib/paper-order-attribution";
import { ACTIVE_DAILY_CRYPTO_DAY_STRATEGY as strategy } from "@/lib/paper-weekend-crypto-strategy-config";

export const dynamic = "force-dynamic";

const PUBLIC_ORIGIN=process.env.CREATORHUB_PUBLIC_ORIGIN||"https://creatorhub-gray.vercel.app";

const BOT_ID=strategy.botProfileId;
const SUPABASE_URL=process.env.NEXT_PUBLIC_SUPABASE_URL||"https://yufptpfiwdbzzrvhkvux.supabase.co";
const ALPACA_PAPER="https://paper-api.alpaca.markets/v2";

const ledgerSchema=z.object({
  metadata:z.object({executionEnabled:z.boolean().optional(),liveMoneyEnabled:z.boolean().optional()}).passthrough(),
});
const positionSchema=z.object({
  symbol:z.enum(strategy.executionUniverse),
  quantity:z.coerce.number().finite().positive(),
  average_entry:z.coerce.number().finite().positive(),
  protective_stop:z.coerce.number().finite().positive().nullable(),
  take_profit_fraction:z.coerce.number().finite().positive().max(1).nullable(),
  exit_manager_state:z.object({
    plannedAction:z.string().optional(),
    desiredStop:z.coerce.number().finite().positive().optional(),
    partialFraction:z.coerce.number().finite().positive().max(1).optional(),
    partialProfitState:z.string().optional(),
  }).passthrough(),
  metadata:z.record(z.string(),z.unknown()),
});
const orderSchema=z.object({
  client_order_id:z.string(),
  broker_order_id:z.string().nullable(),
  status:z.string(),
  metadata:z.record(z.string(),z.unknown()),
});

type BrokerOrder={id?:string;status?:string;filled_qty?:string;filled_avg_price?:string|null};
type BrokerPosition={symbol?:string;qty?:string;qty_available?:string};

function reply(body:unknown,status=200){
  return NextResponse.json(body,{status,headers:{"Cache-Control":"no-store"}});
}
async function digest(value:string){
  const bytes=new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value)));
  return Array.from(bytes,b=>b.toString(16).padStart(2,"0")).join("");
}
async function authorized(request:Request){
  const expected=process.env.PAPER_WEEKEND_CRYPTO_EXECUTION_TOKEN?.trim()??"";
  const supplied=request.headers.get("x-paper-weekend-execution-token")?.trim()??"";
  if(expected.length<32||supplied.length<32)return false;
  return (await digest(expected))===(await digest(supplied));
}
function num(value:unknown){
  const parsed=typeof value==="number"?value:typeof value==="string"?Number(value):NaN;
  return Number.isFinite(parsed)?parsed:null;
}
function normalize(value:string|undefined){return(value??"").replace("/","").toUpperCase();}
function floorQty(value:number){return Math.floor((value+Number.EPSILON)*1e9)/1e9;}
function qtyString(value:number){return value.toFixed(9).replace(/0+$/,"").replace(/\.$/,"");}
function roundPrice(value:number){return Number(value.toFixed(value>=1000?2:value>=1?4:6));}
function stopFloor(stop:number){return roundPrice(stop*0.997);}
function status(value:unknown){
  const s=typeof value==="string"?value:"submitted";
  if(["filled","partially_filled","canceled","rejected","expired","replaced"].includes(s))return s;
  return"submitted";
}
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));

export async function POST(request:Request){
  if(!(await authorized(request)))return reply({error:"Unauthorized."},401);

  const supabaseSecret=process.env.SUPABASE_SECRET_KEY?.trim()??"";
  const alpacaKey=process.env.ALPACA_API_KEY_ID?.trim()??"";
  const alpacaSecret=process.env.ALPACA_API_SECRET_KEY?.trim()??"";
  if(!supabaseSecret||!alpacaKey||!alpacaSecret)return reply({error:"Daily crypto manager dependencies are not configured."},503);

  const dbHeaders:Record<string,string>={apikey:supabaseSecret,"Content-Type":"application/json"};
  if(supabaseSecret.startsWith("eyJ"))dbHeaders.Authorization=`Bearer ${supabaseSecret}`;
  const db=async(path:string,body?:unknown,method:"GET"|"POST"|"PATCH"="GET",prefer?:string)=>{
    const response=await fetch(`${SUPABASE_URL}/rest/v1/${path}`,{
      method,headers:{...dbHeaders,...(prefer?{Prefer:prefer}:{})},
      ...(body===undefined||method==="GET"?{}:{body:JSON.stringify(body)}),
      cache:"no-store",signal:AbortSignal.timeout(10_000),
    });
    const text=await response.text();
    if(!response.ok)throw new Error(`Daily crypto manager storage returned HTTP ${response.status}.`);
    return text?JSON.parse(text):null;
  };
  const journalFailure=async(input:Parameters<typeof buildPaperExecutionFailureJournalRow>[0])=>{
    try{await db("paper_bot_journal",buildPaperExecutionFailureJournalRow(input),"POST","return=minimal");}catch{}
  };

  const brokerHeaders={
    "APCA-API-KEY-ID":alpacaKey,"APCA-API-SECRET-KEY":alpacaSecret,
    Accept:"application/json","Content-Type":"application/json",
  };
  const alpaca=async(path:string,init:RequestInit={})=>{
    const response=await fetch(`${ALPACA_PAPER}/${path}`,{
      ...init,headers:{...brokerHeaders,...(init.headers??{})},cache:"no-store",signal:AbortSignal.timeout(10_000),
    });
    const text=await response.text();
    const body=text?JSON.parse(text):null;
    if(!response.ok)throw new Error(typeof body?.message==="string"?body.message:`Alpaca HTTP ${response.status}`);
    return body;
  };

  const ledgers=z.array(ledgerSchema).parse(await db(
    `paper_bot_ledgers?select=metadata&bot_id=eq.${BOT_ID}&limit=1`
  ));
  const ledger=ledgers[0];
  if(!ledger?.metadata.executionEnabled)return reply({ok:true,paperOnly:true,action:"none",reason:"executor-disabled"});
  if(ledger.metadata.liveMoneyEnabled)return reply({error:"Live-money mode is not permitted."},423);

  const positions=z.array(positionSchema).parse(await db(
    `paper_bot_positions?select=symbol,quantity,average_entry,protective_stop,take_profit_fraction,exit_manager_state,metadata&bot_id=eq.${BOT_ID}&quantity=gt.0&limit=1`
  ));
  const position=positions[0];
  if(!position)return reply({ok:true,paperOnly:true,action:"none",reason:"no-position"});

  const action=position.exit_manager_state.plannedAction??"hold";
  if(action==="hold")return reply({ok:true,paperOnly:true,action:"hold",symbol:position.symbol});

  const activeSells=z.array(orderSchema).parse(await db(
    `paper_bot_orders?select=client_order_id,broker_order_id,status,metadata&bot_id=eq.${BOT_ID}&side=eq.sell&status=in.(prepared,submitted,partially_filled)&order=created_at.desc&limit=50`
  ));
  const protectiveOrders=activeSells.filter(order=>order.metadata.purpose==="protective-stop");

  const patchOrder=(id:string,values:Record<string,unknown>)=>db(
    `paper_bot_orders?client_order_id=eq.${encodeURIComponent(id)}`,
    {...values,updated_at:new Date().toISOString()},"PATCH","return=minimal"
  );
  const patchPosition=(values:Record<string,unknown>)=>db(
    `paper_bot_positions?bot_id=eq.${BOT_ID}&symbol=eq.${encodeURIComponent(position.symbol)}`,
    {...values,updated_at:new Date().toISOString()},"PATCH","return=minimal"
  );

  const cancelProtection=async()=>{
    for(const order of protectiveOrders){
      if(order.broker_order_id){
        try{
          await alpaca(`orders/${encodeURIComponent(order.broker_order_id)}`,{method:"DELETE"});
        }catch(error){
          const reason=error instanceof Error?error.message.slice(0,180):"Protective-order cancellation failed.";
          await journalFailure({
            botId:BOT_ID,strategyId:strategy.id,strategyVersion:strategy.version,
            symbol:position.symbol,assetClass:"crypto",clientOrderId:order.client_order_id,
            phase:"protective-order-cancel",reason,side:"sell",purpose:"protective-stop",critical:true,
          });
          return false;
        }
      }
      await patchOrder(order.client_order_id,{
        status:"canceled",
        metadata:{...order.metadata,cancelRequestedAt:new Date().toISOString(),cancelReason:"exit-manager-replacement"},
      });
    }
    if(protectiveOrders.some(order=>order.broker_order_id))await sleep(250);
    return true;
  };

  const sellableQty=async()=>{
    for(let index=0;index<10;index++){
      const brokerPositions=await alpaca("positions") as BrokerPosition[];
      const broker=brokerPositions.find(item=>normalize(item.symbol)===normalize(position.symbol));
      const available=floorQty(Math.min(position.quantity,num(broker?.qty_available)??num(broker?.qty)??0));
      if(available>0)return available;
      await sleep(200);
    }
    return 0;
  };

  const createProtection=async(stop:number,quantity:number,reason:string)=>{
    const clientId=createPaperClientOrderId(BOT_ID,strategy.version,crypto.randomUUID());
    const stopPrice=roundPrice(stop);
    const limitPrice=stopFloor(stopPrice);
    await db("paper_bot_orders",{
      client_order_id:clientId,bot_id:BOT_ID,strategy_id:strategy.id,strategy_version:strategy.version,
      symbol:position.symbol,asset_class:"crypto",side:"sell",status:"prepared",
      requested_quantity:quantity,pool_id:"day",entry_trigger:stopPrice,max_entry_price:limitPrice,
      protective_stop:stopPrice,planned_risk_dollars:0,stage_reason:reason,
      metadata:{purpose:"protective-stop",paperOnly:true,estimatedFeeBps:strategy.fees.estimatedTakerFeeBpsPerSide},
    },"POST","return=minimal");

    try{
      const order=await alpaca("orders",{
        method:"POST",body:JSON.stringify({
          symbol:position.symbol,qty:qtyString(quantity),side:"sell",type:"stop_limit",
          time_in_force:"gtc",stop_price:String(stopPrice),limit_price:String(limitPrice),client_order_id:clientId,
        }),
      }) as BrokerOrder;
      await patchOrder(clientId,{status:status(order.status),broker_order_id:order.id??null,submitted_at:new Date().toISOString()});
      return true;
    }catch(error){
      const failureReason=error instanceof Error?error.message.slice(0,180):"Protective stop submission failed.";
      await patchOrder(clientId,{
        status:"error",
        metadata:{purpose:"protective-stop",paperOnly:true,executionError:failureReason},
      });
      await journalFailure({
        botId:BOT_ID,strategyId:strategy.id,strategyVersion:strategy.version,
        symbol:position.symbol,assetClass:"crypto",clientOrderId:clientId,
        phase:"protective-stop-submission",reason:failureReason,side:"sell",purpose:"protective-stop",critical:true,
      });
      return false;
    }
  };

  const emergencyFlatten=async()=>{
    const token=request.headers.get("x-paper-weekend-execution-token")??"";
    const response=await fetch(new URL("/api/paper-trading/bots/weekend-crypto-flatten",request.url),{
      method:"POST",headers:{"x-paper-weekend-execution-token":token},cache:"no-store",signal:AbortSignal.timeout(30_000),
    });
    return response.ok;
  };

  if(action==="repair_stop"||action==="tighten_stop_breakeven"||action==="tighten_stop_trail"){
    const desired=action==="repair_stop"
      ? position.protective_stop
      : position.exit_manager_state.desiredStop;
    if(!(desired&&desired>0))return reply({error:"Exit planner did not provide a valid stop."},409);

    const canceled=await cancelProtection();
    if(!canceled)return reply({error:"Existing protective order could not be canceled; replacement was not submitted.",critical:true},502);
    const available=await sellableQty();
    if(!(available>0))return reply({error:"No sellable broker quantity is available for protection.",critical:true},502);

    const tightened=position.protective_stop?Math.max(position.protective_stop,desired):desired;
    const protectedOkay=await createProtection(tightened,available,`Daily crypto exit manager: ${action}.`);
    if(!protectedOkay){
      const flattened=await emergencyFlatten();
      return reply({error:"Protective stop update failed; emergency PAPER flatten attempted.",critical:true,emergencyFlattenSubmitted:flattened},502);
    }
    await patchPosition({
      protective_stop:roundPrice(tightened),
      exit_manager_state:{
        ...position.exit_manager_state,lastBrokerAction:action,lastBrokerActionAt:new Date().toISOString(),
      },
    });
    return reply({ok:true,paperOnly:true,action,symbol:position.symbol,newStop:roundPrice(tightened)});
  }

  if(action==="partial_profit"){
    const fraction=position.exit_manager_state.partialFraction??position.take_profit_fraction??strategy.risk.firstTakeProfitFraction;
    if(!(fraction>0&&fraction<1))return reply({error:"Partial-profit fraction is invalid."},409);

    const canceled=await cancelProtection();
    if(!canceled)return reply({error:"Existing protective order could not be canceled; partial profit was not submitted.",critical:true},502);
    const available=await sellableQty();
    const partialQty=floorQty(Math.min(position.quantity*fraction,available*fraction));
    if(!(partialQty>0))return reply({error:"No sellable quantity is available for partial profit.",critical:true},502);

    const clientId=createPaperClientOrderId(BOT_ID,strategy.version,crypto.randomUUID());
    await db("paper_bot_orders",{
      client_order_id:clientId,bot_id:BOT_ID,strategy_id:strategy.id,strategy_version:strategy.version,
      symbol:position.symbol,asset_class:"crypto",side:"sell",status:"prepared",
      requested_quantity:partialQty,pool_id:"day",planned_risk_dollars:0,
      stage_reason:"Daily crypto crypto first +2R partial profit.",
      metadata:{purpose:"take-profit-partial",paperOnly:true,estimatedFeeBps:strategy.fees.estimatedTakerFeeBpsPerSide},
    },"POST","return=minimal");

    let partial:BrokerOrder|null=null;
    try{
      partial=await alpaca("orders",{
        method:"POST",body:JSON.stringify({
          symbol:position.symbol,qty:qtyString(partialQty),side:"sell",type:"market",
          time_in_force:"gtc",client_order_id:clientId,
        }),
      }) as BrokerOrder;
      await patchOrder(clientId,{status:status(partial.status),broker_order_id:partial.id??null,submitted_at:new Date().toISOString()});
    }catch(error){
      const failureReason=error instanceof Error?error.message.slice(0,180):"Partial-profit submission failed.";
      await patchOrder(clientId,{
        status:"error",
        metadata:{purpose:"take-profit-partial",paperOnly:true,executionError:failureReason},
      });
      await journalFailure({
        botId:BOT_ID,strategyId:strategy.id,strategyVersion:strategy.version,
        symbol:position.symbol,assetClass:"crypto",clientOrderId:clientId,
        phase:"partial-profit-submission",reason:failureReason,side:"sell",purpose:"take-profit-partial",critical:true,
      });
      const restored=await createProtection(position.protective_stop??position.average_entry,available,"Restore protection after partial-profit submission failure.");
      if(!restored)await emergencyFlatten();
      return reply({error:"Partial-profit order failed; protection restore attempted.",critical:!restored},502);
    }

    const partialBrokerId=partial?.id;
    if(partialBrokerId){
      for(let index=0;index<10;index++){
        if(["filled","canceled","rejected","expired"].includes(partial?.status??""))break;
        await sleep(200);
        try{partial=await alpaca(`orders/${encodeURIComponent(partialBrokerId)}`) as BrokerOrder;}catch{break;}
      }
    }
    const filled=num(partial?.filled_qty)??0;
    if(!(filled>0)){
      if(partialBrokerId){try{await alpaca(`orders/${encodeURIComponent(partialBrokerId)}`,{method:"DELETE"});}catch{}}
      await patchOrder(clientId,{status:"canceled"});
      const restored=await createProtection(position.protective_stop??position.average_entry,available,"Restore protection after unfilled partial profit.");
      if(!restored)await emergencyFlatten();
      return reply({ok:true,paperOnly:true,action:"partial-no-fill",protectionRestored:restored});
    }

    await patchOrder(clientId,{status:"filled"});
    const remaining=await sellableQty();
    if(!(remaining>0)){
      await patchPosition({
        exit_manager_state:{...position.exit_manager_state,partialProfitState:"completed",lastBrokerAction:"partial_profit",lastBrokerActionAt:new Date().toISOString()},
      });
      return reply({ok:true,paperOnly:true,action:"partial-profit",remainingProtected:false,positionClosed:true});
    }

    const feeBps=num(position.metadata.estimatedFeeBps)??strategy.fees.estimatedTakerFeeBpsPerSide;
    const breakEven=position.average_entry/(1-feeBps/10_000);
    const nextStop=Math.max(position.protective_stop??0,breakEven);
    const restored=await createProtection(nextStop,remaining,"Protect remainder after weekend partial profit.");
    if(!restored){
      const flattened=await emergencyFlatten();
      return reply({error:"Partial filled but remainder protection failed; emergency flatten attempted.",critical:true,emergencyFlattenSubmitted:flattened},502);
    }

    await patchPosition({
      protective_stop:roundPrice(nextStop),
      exit_manager_state:{
        ...position.exit_manager_state,partialProfitState:"completed",partialProfitCompletedAt:new Date().toISOString(),
        lastBrokerAction:"partial_profit",lastBrokerActionAt:new Date().toISOString(),
      },
    });
    return reply({ok:true,paperOnly:true,action:"partial-profit",filledQuantity:filled,remainingProtected:true,newStop:roundPrice(nextStop)});
  }

  return reply({ok:true,paperOnly:true,action:"none",reason:"unsupported-or-stale-planner-action"});
}
