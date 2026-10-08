import {NextResponse} from "next/server";
import {createAdminSupabaseClient} from "@/lib/supabase-admin";
import {createPaperClientOrderId} from "@/lib/paper-order-attribution";
import {buildAtlasStockExecutionPlan,atlasExecutionPool,type AtlasExecutionReferencePlan} from "@/lib/paper-atlas-execution-plan";
import {atlasDayPositionAction,atlasDaySession} from "@/lib/paper-atlas-day-manager";
import {GET as runAtlasAudit} from "@/app/api/paper-trading/bots/atlas-decision-audit/route";
import {GET as readOnlyMarketSnapshot} from "@/app/api/paper-trading/market-data/route";

export const dynamic="force-dynamic";

const ALPACA_PAPER="https://paper-api.alpaca.markets/v2";
const BOT_ID="default-diverse";
const STRATEGY_ID="paper-medium-high-v1";
const STRATEGY_VERSION=1;
const POOL_BLOCKER="Current pool allocation capacity must be checked before order authorization.";
const EXECUTION_MODE="atlas-fractional-day-v1";
const EXECUTION_ARMED=true;
const ACTIVE_STATUSES=["prepared","submitted","partially_filled"];

type CandidateRow={
  symbol:string;asset_class:string;occurred_at:string;score:number|string|null;
  qualification:string|null;blockers:unknown;metadata:Record<string,unknown>;
};
type OrderRow={
  client_order_id:string;broker_order_id:string|null;status:string;symbol:string;asset_class:string;
  side:string;requested_notional:number|string|null;requested_quantity:number|string|null;
  pool_id:string|null;entry_trigger:number|string|null;max_entry_price:number|string|null;
  protective_stop:number|string|null;planned_risk_dollars:number|string|null;
  take_profit_price:number|string|null;take_profit_fraction:number|string|null;take_profit_r:number|string|null;
  expires_at:string|null;submitted_at:string|null;created_at:string;metadata:Record<string,unknown>|null;
};
type BrokerOrder={
  id?:string;client_order_id?:string;status?:string;symbol?:string;side?:string;type?:string;
  filled_qty?:string;filled_avg_price?:string|null;
};
type BrokerAsset={
  id?:string;class?:string;symbol?:string;status?:string;tradable?:boolean;fractionable?:boolean;
};
type BrokerPosition={
  symbol?:string;qty?:string;qty_available?:string;avg_entry_price?:string;market_value?:string;
};
type BrokerClock={is_open?:boolean;timestamp?:string;next_close?:string};
type MarketSnapshot={stocks?:Record<string,{bid?:number|null;ask?:number|null;timestamp?:string|null}>};

function reply(body:unknown,status=200){
  return NextResponse.json(body,{status,headers:{"Cache-Control":"no-store"}});
}
function numeric(value:unknown){
  const n=typeof value==="number"?value:typeof value==="string"&&value.trim()?Number(value):NaN;
  return Number.isFinite(n)?n:null;
}
function normalize(value:string|undefined){
  return (value??"").replace(/[\/\-]/g,"").toUpperCase();
}
function floorQty(value:number){
  return Math.floor((value+Number.EPSILON)*1_000_000_000)/1_000_000_000;
}
function qtyString(value:number){
  return value.toFixed(9).replace(/0+$/,"").replace(/\.$/,"");
}
function roundPrice(value:number){
  return Number(value.toFixed(value>=1?2:6));
}
function mappedStatus(value:unknown){
  const status=typeof value==="string"?value:"submitted";
  return ["filled","partially_filled","canceled","rejected","expired","replaced"].includes(status)?status:"submitted";
}
function isTerminal(value:unknown){
  return ["filled","canceled","rejected","expired","replaced"].includes(typeof value==="string"?value:"");
}
function objectValue(value:unknown):Record<string,unknown>{
  return value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
}
function inputObject(row:CandidateRow){
  return objectValue(row.metadata?.inputProvenance);
}
function referencePlan(row:CandidateRow):AtlasExecutionReferencePlan|null{
  const v=objectValue(row.metadata?.referencePlan);
  if(!Object.keys(v).length)return null;
  return {
    entryTrigger:numeric(v.entryTrigger),stopPrice:numeric(v.stopPrice),exitPrice:numeric(v.exitPrice),
    riskDollars:numeric(v.riskDollars),uncappedPositionValue:numeric(v.uncappedPositionValue),
  };
}
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));

export async function GET(request:Request){
  const cronSecret=process.env.CRON_SECRET?.trim()??"";
  if(!cronSecret||request.headers.get("authorization")!==`Bearer ${cronSecret}`)
    return reply({error:"Unauthorized."},401);

  const alpacaKey=process.env.ALPACA_API_KEY_ID?.trim()??"";
  const alpacaSecret=process.env.ALPACA_API_SECRET_KEY?.trim()??"";
  if(!process.env.SUPABASE_SECRET_KEY||!alpacaKey||!alpacaSecret)
    return reply({error:"Atlas PAPER execution dependencies are not configured."},503);

  const auditRequest=new Request(new URL("/api/paper-trading/bots/atlas-decision-audit",request.url),{
    headers:{authorization:`Bearer ${cronSecret}`}
  });
  const auditResponse=await runAtlasAudit(auditRequest);
  const auditBody=await auditResponse.json().catch(()=>({}));
  if(!auditResponse.ok)return reply({error:"Atlas audit failed; execution skipped.",audit:auditBody},503);
  if(!EXECUTION_ARMED)return reply({ok:true,paperOnly:true,action:"none",reason:"executor-disarmed",audit:auditBody});

  const db=createAdminSupabaseClient();
  const brokerHeaders={
    "APCA-API-KEY-ID":alpacaKey,"APCA-API-SECRET-KEY":alpacaSecret,
    Accept:"application/json","Content-Type":"application/json",
  };
  const broker=async(path:string,init:RequestInit={})=>{
    const response=await fetch(`${ALPACA_PAPER}/${path}`,{
      ...init,headers:{...brokerHeaders,...(init.headers??{})},
      cache:"no-store",signal:AbortSignal.timeout(10_000),
    });
    const text=await response.text();
    let body:unknown=null;
    try{body=text?JSON.parse(text):null;}catch{body=null;}
    return {response,body};
  };
  const lookupByClientId=async(clientOrderId:string)=>{
    const result=await broker(`orders:by_client_order_id?client_order_id=${encodeURIComponent(clientOrderId)}`);
    if(result.response.status===404)return null;
    if(!result.response.ok)throw new Error(`Atlas broker lookup returned HTTP ${result.response.status}.`);
    return result.body as BrokerOrder;
  };
  const pollOrder=async(order:BrokerOrder,iterations=10)=>{
    let current=order;
    for(let i=0;i<iterations;i++){
      if(isTerminal(current.status))break;
      const id=current.id;
      if(!id)break;
      await sleep(200);
      const result=await broker(`orders/${encodeURIComponent(id)}`);
      if(!result.response.ok)break;
      current=result.body as BrokerOrder;
    }
    return current;
  };
  const submitSimple=async(body:Record<string,unknown>,clientOrderId:string)=>{
    try{
      const result=await broker("orders",{method:"POST",body:JSON.stringify(body)});
      if(result.response.ok){
        const order=result.body as BrokerOrder;
        return {order,rejected:false,detail:""};
      }
      const existing=await lookupByClientId(clientOrderId).catch(()=>null);
      if(existing)return {order:existing,rejected:false,detail:""};
      const detail=typeof (result.body as {message?:unknown})?.message==="string"
        ?String((result.body as {message:string}).message).slice(0,180)
        :`Broker returned HTTP ${result.response.status}.`;
      return {order:null,rejected:result.response.status>=400&&result.response.status<500,detail};
    }catch(error){
      const existing=await lookupByClientId(clientOrderId).catch(()=>null);
      if(existing)return {order:existing,rejected:false,detail:""};
      return {order:null,rejected:false,detail:error instanceof Error?error.message.slice(0,180):"Broker outcome unconfirmed."};
    }
  };
  const patchOrder=async(clientOrderId:string,values:Record<string,unknown>)=>{
    const {error}=await db.from("paper_bot_orders").update({...values,updated_at:new Date().toISOString()})
      .eq("client_order_id",clientOrderId).eq("bot_id",BOT_ID);
    if(error)throw new Error("Atlas order update failed.");
  };
  const currentPositions=async()=>{
    const result=await broker("positions");
    if(!result.response.ok)throw new Error("Atlas could not read broker positions.");
    return Array.isArray(result.body)?result.body as BrokerPosition[]:[];
  };
  const findBrokerPosition=async(symbol:string)=>{
    const positions=await currentPositions();
    return positions.find(p=>normalize(p.symbol)===normalize(symbol))??null;
  };
  const marketQuote=async(symbol:string)=>{
    const url=new URL("/api/paper-trading/market-data",request.url);
    url.searchParams.set("stocks",symbol);url.searchParams.set("crypto","");
    const response=await readOnlyMarketSnapshot(new Request(url));
    if(!response.ok)return null;
    const market=await response.json() as MarketSnapshot;
    const quote=market.stocks?.[symbol];
    if(!quote)return null;
    const bid=numeric(quote.bid),ask=numeric(quote.ask);
    const mark=bid&&ask?(bid+ask)/2:bid??ask;
    return {bid,ask,mark,timestamp:quote.timestamp??null};
  };

  const clockResult=await broker("clock");
  if(!clockResult.response.ok)return reply({error:"Atlas could not verify the stock market session."},503);
  const clock=clockResult.body as BrokerClock;
  const nowMs=clock.timestamp&&Number.isFinite(Date.parse(clock.timestamp))?Date.parse(clock.timestamp):Date.now();
  const nextCloseMs=clock.next_close&&Number.isFinite(Date.parse(clock.next_close))?Date.parse(clock.next_close):null;
  const session=atlasDaySession({marketOpen:clock.is_open===true,nowMs,nextCloseMs});
  const sessionDate=(clock.timestamp??new Date(nowMs).toISOString()).slice(0,10);

  const orderSelect="client_order_id,broker_order_id,status,symbol,asset_class,side,requested_notional,requested_quantity,pool_id,entry_trigger,max_entry_price,protective_stop,planned_risk_dollars,take_profit_price,take_profit_fraction,take_profit_r,expires_at,submitted_at,created_at,metadata";
  const {data:recentOrderRows,error:recentOrderError}=await db.from("paper_bot_orders").select(orderSelect)
    .eq("bot_id",BOT_ID).eq("strategy_id",STRATEGY_ID).eq("strategy_version",STRATEGY_VERSION)
    .order("created_at",{ascending:false}).limit(100);
  if(recentOrderError)return reply({error:"Atlas order history unavailable."},503);
  let recentOrders=(recentOrderRows??[]) as unknown as OrderRow[];

  const syncSellOrder=async(order:OrderRow)=>{
    const metadata=objectValue(order.metadata);
    let observed=await lookupByClientId(order.client_order_id).catch(()=>null);
    if(!observed&&["prepared","submitted"].includes(order.status)&&metadata.executionMode===EXECUTION_MODE){
      const qty=numeric(order.requested_quantity);
      const kind=metadata.brokerOrderType;
      if(qty&&qty>0&&(kind==="stop"||kind==="market")&&session.marketOpen){
        const body:Record<string,unknown>={
          symbol:order.symbol,qty:qtyString(qty),side:"sell",type:kind,
          time_in_force:"day",client_order_id:order.client_order_id,extended_hours:false,
        };
        if(kind==="stop"){
          const stop=numeric(order.protective_stop)??numeric(order.entry_trigger);
          if(!stop)return order;
          body.stop_price=String(roundPrice(stop));
        }
        const submitted=await submitSimple(body,order.client_order_id);
        if(submitted.order)observed=submitted.order;
        else if(submitted.rejected){
          await patchOrder(order.client_order_id,{status:"rejected",last_reconciled_at:new Date().toISOString(),
            metadata:{...metadata,brokerSubmissionRejected:true,brokerLookupConfirmedMissing:true,executionError:submitted.detail}});
          return {...order,status:"rejected"};
        }else{
          await patchOrder(order.client_order_id,{status:"submitted",metadata:{...metadata,brokerLookupPending:true,executionError:submitted.detail}});
          return {...order,status:"submitted"};
        }
      }
    }
    if(!observed)return order;
    observed=await pollOrder(observed,2);
    const status=mappedStatus(observed.status);
    const now=new Date().toISOString();
    const merged={...metadata,brokerObservedStatus:observed.status??status,
      filledQuantityObserved:numeric(observed.filled_qty)??0,
      filledAveragePriceObserved:numeric(observed.filled_avg_price),brokerLookupPending:false};
    await patchOrder(order.client_order_id,{broker_order_id:observed.id??order.broker_order_id,status,
      last_reconciled_at:now,submitted_at:order.submitted_at??now,metadata:merged});
    return {...order,broker_order_id:observed.id??order.broker_order_id,status,metadata:merged};
  };

  const activeSells=recentOrders.filter(o=>o.side==="sell"&&ACTIVE_STATUSES.includes(o.status)
    &&objectValue(o.metadata).executionMode===EXECUTION_MODE);
  for(const sell of activeSells)await syncSellOrder(sell);

  const {data:refreshedRows,error:refreshError}=await db.from("paper_bot_orders").select(orderSelect)
    .eq("bot_id",BOT_ID).eq("strategy_id",STRATEGY_ID).eq("strategy_version",STRATEGY_VERSION)
    .order("created_at",{ascending:false}).limit(100);
  if(refreshError)return reply({error:"Atlas refreshed order history unavailable."},503);
  recentOrders=(refreshedRows??[]) as unknown as OrderRow[];

  const entryOrders=recentOrders.filter(o=>o.side==="buy"&&o.pool_id==="day"
    &&objectValue(o.metadata).purpose==="entry"&&objectValue(o.metadata).executionMode===EXECUTION_MODE);
  const protectiveOrdersFor=(symbol:string)=>recentOrders.filter(o=>o.side==="sell"&&o.symbol===symbol
    &&ACTIVE_STATUSES.includes(o.status)&&objectValue(o.metadata).purpose==="protective-stop"
    &&objectValue(o.metadata).executionMode===EXECUTION_MODE);

  const cancelProtection=async(symbol:string)=>{
    const protections=protectiveOrdersFor(symbol);
    for(const local of protections){
      let observed=await lookupByClientId(local.client_order_id).catch(()=>null);
      const brokerId=observed?.id??local.broker_order_id;
      if(brokerId&&!isTerminal(observed?.status)){
        await broker(`orders/${encodeURIComponent(brokerId)}`,{method:"DELETE"});
        await sleep(150);
        observed=await lookupByClientId(local.client_order_id).catch(()=>observed);
      }
      if(observed?.status==="filled"){
        await patchOrder(local.client_order_id,{status:"filled",broker_order_id:observed.id??brokerId,
          last_reconciled_at:new Date().toISOString(),metadata:{...objectValue(local.metadata),
            brokerObservedStatus:"filled",filledQuantityObserved:numeric(observed.filled_qty)??0}});
        continue;
      }
      await patchOrder(local.client_order_id,{status:"canceled",last_reconciled_at:new Date().toISOString(),
        metadata:{...objectValue(local.metadata),cancelReason:"atlas-day-manager-replacement",
          cancelRequestedAt:new Date().toISOString(),brokerObservedStatus:observed?.status??"canceled"}});
    }
  };

  const createProtection=async(input:{symbol:string;qty:number;stop:number;entry:OrderRow;reason:string})=>{
    if(!(input.qty>0&&input.stop>0))return false;
    const clientId=createPaperClientOrderId(BOT_ID,STRATEGY_VERSION,crypto.randomUUID());
    const stop=roundPrice(input.stop);
    const metadata={
      purpose:"protective-stop",paperOnly:true,executionMode:EXECUTION_MODE,brokerOrderType:"stop",
      parentClientOrderId:input.entry.client_order_id,atlasReservationId:objectValue(input.entry.metadata).atlasReservationId??null,
      stopPrice:stop,sessionDate,
    };
    const {error:insertError}=await db.from("paper_bot_orders").insert({
      client_order_id:clientId,bot_id:BOT_ID,strategy_id:STRATEGY_ID,strategy_version:STRATEGY_VERSION,
      symbol:input.symbol,asset_class:"stock",side:"sell",status:"prepared",requested_quantity:input.qty,pool_id:"day",
      entry_trigger:stop,protective_stop:stop,planned_risk_dollars:0,expires_at:clock.next_close??null,
      stage_reason:input.reason,metadata,
    });
    if(insertError)return false;
    const submitted=await submitSimple({
      symbol:input.symbol,qty:qtyString(input.qty),side:"sell",type:"stop",time_in_force:"day",
      stop_price:String(stop),client_order_id:clientId,extended_hours:false,
    },clientId);
    if(!submitted.order){
      await patchOrder(clientId,{status:submitted.rejected?"rejected":"submitted",
        last_reconciled_at:submitted.rejected?new Date().toISOString():null,
        metadata:{...metadata,brokerSubmissionRejected:submitted.rejected,brokerLookupPending:!submitted.rejected,
          executionError:submitted.detail}});
      return false;
    }
    const observed=await pollOrder(submitted.order,2);
    await patchOrder(clientId,{broker_order_id:observed.id??null,status:mappedStatus(observed.status),
      submitted_at:new Date().toISOString(),last_reconciled_at:new Date().toISOString(),
      metadata:{...metadata,brokerObservedStatus:observed.status??"submitted",
        filledQuantityObserved:numeric(observed.filled_qty)??0,brokerLookupPending:false}});
    return Boolean(observed.id);
  };

  const submitExit=async(input:{symbol:string;qty:number;purpose:string;reason:string;entry:OrderRow})=>{
    if(!(input.qty>0))return {order:null as BrokerOrder|null,ambiguous:false};
    const clientId=createPaperClientOrderId(BOT_ID,STRATEGY_VERSION,crypto.randomUUID());
    const metadata={purpose:input.purpose,paperOnly:true,executionMode:EXECUTION_MODE,brokerOrderType:"market",
      parentClientOrderId:input.entry.client_order_id,sessionDate};
    const {error:insertError}=await db.from("paper_bot_orders").insert({
      client_order_id:clientId,bot_id:BOT_ID,strategy_id:STRATEGY_ID,strategy_version:STRATEGY_VERSION,
      symbol:input.symbol,asset_class:"stock",side:"sell",status:"prepared",requested_quantity:input.qty,pool_id:"day",
      planned_risk_dollars:0,expires_at:clock.next_close??null,stage_reason:input.reason,metadata,
    });
    if(insertError)return {order:null,ambiguous:true};
    const submitted=await submitSimple({
      symbol:input.symbol,qty:qtyString(input.qty),side:"sell",type:"market",time_in_force:"day",
      client_order_id:clientId,extended_hours:false,
    },clientId);
    if(!submitted.order){
      await patchOrder(clientId,{status:submitted.rejected?"rejected":"submitted",
        last_reconciled_at:submitted.rejected?new Date().toISOString():null,
        metadata:{...metadata,brokerSubmissionRejected:submitted.rejected,brokerLookupPending:!submitted.rejected,
          executionError:submitted.detail}});
      return {order:null,ambiguous:!submitted.rejected};
    }
    const observed=await pollOrder(submitted.order,10);
    await patchOrder(clientId,{broker_order_id:observed.id??null,status:mappedStatus(observed.status),
      submitted_at:new Date().toISOString(),last_reconciled_at:new Date().toISOString(),
      metadata:{...metadata,brokerObservedStatus:observed.status??"submitted",
        filledQuantityObserved:numeric(observed.filled_qty)??0,
        filledAveragePriceObserved:numeric(observed.filled_avg_price),brokerLookupPending:false}});
    return {order:observed,ambiguous:false};
  };

  const brokerPositions=await currentPositions();
  const {data:localPositionRows,error:localPositionError}=await db.from("paper_bot_positions")
    .select("symbol,quantity,pool_id,average_entry,protective_stop,initial_protective_stop,exit_manager_state,metadata")
    .eq("bot_id",BOT_ID).eq("pool_id","day").gt("quantity",0);
  if(localPositionError)return reply({error:"Atlas virtual positions unavailable."},503);
  const ownedSymbols=new Set<string>([
    ...(localPositionRows??[]).map(row=>normalize(row.symbol)),
    ...entryOrders.filter(o=>["filled","partially_filled"].includes(o.status)).map(o=>normalize(o.symbol)),
  ]);
  const ownedBrokerPositions=brokerPositions.filter(p=>ownedSymbols.has(normalize(p.symbol))
    &&Math.abs(numeric(p.qty)??0)>0);
  if(ownedBrokerPositions.length>1){
    return reply({error:"Atlas has more than one broker position; new entries are blocked pending reconciliation.",
      paperOnly:true,critical:true,symbols:ownedBrokerPositions.map(p=>p.symbol)},503);
  }

  if(ownedBrokerPositions.length===1){
    const position=ownedBrokerPositions[0];
    const symbol=position.symbol??"";
    const entry=entryOrders.find(o=>normalize(o.symbol)===normalize(symbol));
    if(!entry)return reply({error:"Atlas broker position lacks an attributable day entry.",paperOnly:true,critical:true},503);
    const entryMetadata=objectValue(entry.metadata);
    const qty=floorQty(numeric(position.qty_available)??numeric(position.qty)??0);
    const averageEntry=numeric(position.avg_entry_price);
    const initialStop=numeric(entry.protective_stop)??numeric(entryMetadata.initialStop);
    if(!(qty>0&&averageEntry&&initialStop&&initialStop<averageEntry))
      return reply({error:"Atlas position risk references are incomplete.",paperOnly:true,critical:true},503);

    const quote=await marketQuote(symbol);
    if(!quote?.mark)return reply({error:"Atlas manager does not have a valid current stock quote.",paperOnly:true},503);
    const carried=entryMetadata.sessionDate!==sessionDate;

    if(!session.marketOpen){
      return reply({ok:true,paperOnly:true,action:"hold",reason:"market-closed-position-retained",
        symbol,carriedOver:carried,audit:auditBody});
    }

    const forceFlatten=carried||session.flattenDue;
    if(forceFlatten){
      await cancelProtection(symbol);
      const refreshed=await findBrokerPosition(symbol);
      const sellable=floorQty(numeric(refreshed?.qty_available)??numeric(refreshed?.qty)??0);
      if(!(sellable>0))return reply({ok:true,paperOnly:true,action:"none",reason:"position-already-closed",symbol,audit:auditBody});
      const exit=await submitExit({symbol,qty:sellable,purpose:carried?"overnight-recovery":"forced-day-flatten",
        reason:carried?"Atlas overnight carry recovery flatten.":"Atlas forced same-day flatten before market close.",entry});
      return reply({ok:Boolean(exit.order),paperOnly:true,action:carried?"overnight-recovery":"forced-day-flatten",
        symbol,quantity:sellable,ambiguous:exit.ambiguous,audit:auditBody},exit.ambiguous?502:200);
    }

    const currentProtection=protectiveOrdersFor(symbol).at(0)??null;
    const currentStop=numeric(currentProtection?.protective_stop)??numeric(entryMetadata.currentProtectiveStop)??initialStop;
    if(!currentProtection){
      const protectedNow=await createProtection({symbol,qty,stop:currentStop,entry,
        reason:"Atlas fractional DAY protective stop."});
      if(!protectedNow){
        const emergency=await submitExit({symbol,qty,purpose:"emergency-flatten",
          reason:"Atlas emergency flatten after protective-stop failure.",entry});
        return reply({error:"Atlas protection could not be established; emergency flatten attempted.",
          paperOnly:true,critical:true,symbol,emergencySubmitted:Boolean(emergency.order),ambiguous:emergency.ambiguous},502);
      }
      await patchOrder(entry.client_order_id,{metadata:{...entryMetadata,currentProtectiveStop:roundPrice(currentStop),
        protectionEstablishedAt:new Date().toISOString()}});
      return reply({ok:true,paperOnly:true,action:"protect",symbol,stop:roundPrice(currentStop),audit:auditBody});
    }

    const partialCompleted=entryMetadata.partialProfitCompleted===true;
    const action=atlasDayPositionAction({mark:quote.mark,averageEntry,initialStop,currentStop,
      partialCompleted,partialFraction:numeric(entry.take_profit_fraction)??.25});
    if(action.action==="invalid")
      return reply({error:"Atlas exit-manager state is invalid.",paperOnly:true,critical:true,symbol},503);
    if(action.action==="hold")
      return reply({ok:true,paperOnly:true,action:"hold",symbol,rMultiple:action.rMultiple,mark:quote.mark,
        currentStop,audit:auditBody});

    if(action.action==="partial-profit"){
      await cancelProtection(symbol);
      const refreshed=await findBrokerPosition(symbol);
      const available=floorQty(numeric(refreshed?.qty_available)??numeric(refreshed?.qty)??0);
      const partialQty=floorQty(available*(action.partialFraction??.25));
      if(!(partialQty>0)){
        const restored=await createProtection({symbol,qty:available,stop:currentStop,entry,
          reason:"Restore Atlas protection after unavailable partial quantity."});
        return reply({ok:restored,paperOnly:true,action:"partial-skipped",symbol,protectionRestored:restored},restored?200:502);
      }
      const partial=await submitExit({symbol,qty:partialQty,purpose:"take-profit-partial",
        reason:"Atlas +1.75R partial profit.",entry});
      if(partial.ambiguous){
        return reply({error:"Atlas partial-profit outcome is ambiguous; new entries remain blocked.",
          paperOnly:true,critical:true,symbol},502);
      }
      const filled=numeric(partial.order?.filled_qty)??0;
      if(!(filled>0)){
        const still=await findBrokerPosition(symbol);
        const restoreQty=floorQty(numeric(still?.qty_available)??numeric(still?.qty)??0);
        const restored=restoreQty>0&&await createProtection({symbol,qty:restoreQty,stop:currentStop,entry,
          reason:"Restore Atlas protection after unfilled partial profit."});
        return reply({ok:true,paperOnly:true,action:"partial-no-fill",symbol,protectionRestored:Boolean(restored)});
      }
      const after=await findBrokerPosition(symbol);
      const remaining=floorQty(numeric(after?.qty_available)??numeric(after?.qty)??0);
      const nextStop=Math.max(action.desiredStop??averageEntry,averageEntry);
      if(remaining>0){
        const restored=await createProtection({symbol,qty:remaining,stop:nextStop,entry,
          reason:"Atlas protects remainder at break-even after +1.75R trim."});
        if(!restored){
          const emergency=await submitExit({symbol,qty:remaining,purpose:"emergency-flatten",
            reason:"Atlas emergency flatten after partial-profit protection failure.",entry});
          return reply({error:"Atlas partial filled but remainder protection failed; emergency flatten attempted.",
            paperOnly:true,critical:true,symbol,emergencySubmitted:Boolean(emergency.order),ambiguous:emergency.ambiguous},502);
        }
      }
      await patchOrder(entry.client_order_id,{metadata:{...entryMetadata,partialProfitCompleted:true,
        partialProfitCompletedAt:new Date().toISOString(),currentProtectiveStop:roundPrice(nextStop)}});
      return reply({ok:true,paperOnly:true,action:"partial-profit",symbol,filledQuantity:filled,
        remainingProtected:remaining>0,rMultiple:action.rMultiple,audit:auditBody});
    }

    const desired=action.desiredStop??currentStop;
    if(desired<=currentStop*(1.001))
      return reply({ok:true,paperOnly:true,action:"hold",symbol,rMultiple:action.rMultiple,mark:quote.mark,currentStop,audit:auditBody});
    if(desired>=quote.mark){
      await cancelProtection(symbol);
      const refreshed=await findBrokerPosition(symbol);
      const available=floorQty(numeric(refreshed?.qty_available)??numeric(refreshed?.qty)??0);
      const emergency=await submitExit({symbol,qty:available,purpose:"risk-flatten",
        reason:"Atlas desired protective stop reached current market; flatten instead of invalid stop.",entry});
      return reply({ok:Boolean(emergency.order),paperOnly:true,action:"risk-flatten",symbol,
        ambiguous:emergency.ambiguous,rMultiple:action.rMultiple},emergency.ambiguous?502:200);
    }
    await cancelProtection(symbol);
    const refreshed=await findBrokerPosition(symbol);
    const available=floorQty(numeric(refreshed?.qty_available)??numeric(refreshed?.qty)??0);
    if(!(available>0))return reply({ok:true,paperOnly:true,action:"none",reason:"position-closed-during-stop-update",symbol});
    const replaced=await createProtection({symbol,qty:available,stop:desired,entry,
      reason:action.action==="trail"?"Atlas trails remainder one initial R behind mark.":"Atlas protects winner at break-even."});
    if(!replaced){
      const emergency=await submitExit({symbol,qty:available,purpose:"emergency-flatten",
        reason:"Atlas emergency flatten after stop replacement failure.",entry});
      return reply({error:"Atlas protective-stop replacement failed; emergency flatten attempted.",
        paperOnly:true,critical:true,symbol,emergencySubmitted:Boolean(emergency.order),ambiguous:emergency.ambiguous},502);
    }
    await patchOrder(entry.client_order_id,{metadata:{...entryMetadata,currentProtectiveStop:roundPrice(desired),
      lastProtectionUpdateAt:new Date().toISOString()}});
    return reply({ok:true,paperOnly:true,action:action.action==="trail"?"trail":"break-even",
      symbol,newStop:roundPrice(desired),rMultiple:action.rMultiple,mark:quote.mark,audit:auditBody});
  }

  const activeEntry=entryOrders.find(o=>["prepared","submitted"].includes(o.status)
    ||(o.status==="partially_filled"&&!["canceled","expired"].includes(String(objectValue(o.metadata).brokerObservedStatus??""))));
  const settleEntry=async(order:OrderRow)=>{
    const metadata=objectValue(order.metadata);
    const reservationId=typeof metadata.atlasReservationId==="string"?metadata.atlasReservationId:null;
    if(!reservationId)return {ok:false,state:"missing-reservation-lineage"};

    let observed=await lookupByClientId(order.client_order_id).catch(()=>null);
    if(!observed){
      const sameSession=metadata.sessionDate===sessionDate;
      if(!session.marketOpen||!sameSession||!session.entriesOpen){
        const now=new Date().toISOString();
        await patchOrder(order.client_order_id,{status:"canceled",last_reconciled_at:now,
          metadata:{...metadata,brokerNeverSubmitted:true,brokerLookupConfirmedMissing:true,
            brokerObservedStatus:"not-submitted-session-expired"}});
        const {data}=await db.rpc("paper_atlas_release_never_submitted",{
          p_reservation_id:reservationId,p_client_order_id:order.client_order_id,
        });
        return {ok:data===true,state:"never-submitted-released"};
      }
      const qty=numeric(order.requested_quantity),limit=numeric(order.max_entry_price);
      if(!qty||!limit)return {ok:false,state:"invalid-stored-entry"};
      const submitted=await submitSimple({
        symbol:order.symbol,qty:qtyString(qty),side:"buy",type:"limit",time_in_force:"day",
        limit_price:String(roundPrice(limit)),client_order_id:order.client_order_id,extended_hours:false,
      },order.client_order_id);
      if(!submitted.order){
        const now=new Date().toISOString();
        if(submitted.rejected){
          await patchOrder(order.client_order_id,{status:"rejected",last_reconciled_at:now,
            metadata:{...metadata,brokerSubmissionRejected:true,brokerLookupConfirmedMissing:true,
              brokerObservedStatus:"rejected-before-create",executionError:submitted.detail}});
          const {data}=await db.rpc("paper_atlas_release_bound_rejection",{
            p_reservation_id:reservationId,p_client_order_id:order.client_order_id,
          });
          return {ok:data===true,state:"broker-rejected-released"};
        }
        await patchOrder(order.client_order_id,{status:"submitted",metadata:{...metadata,brokerLookupPending:true,
          executionError:submitted.detail}});
        return {ok:false,state:"broker-outcome-unconfirmed"};
      }
      observed=submitted.order;
    }

    observed=await pollOrder(observed,12);
    let status=mappedStatus(observed.status);
    let filledQty=numeric(observed.filled_qty)??0;
    if(!isTerminal(observed.status)){
      if(observed.id)await broker(`orders/${encodeURIComponent(observed.id)}`,{method:"DELETE"});
      await sleep(200);
      const after=await lookupByClientId(order.client_order_id).catch(()=>observed);
      if(after)observed=await pollOrder(after,5);
      status=mappedStatus(observed.status);
      filledQty=numeric(observed.filled_qty)??filledQty;
    }

    const localStatus=filledQty>0
      ?(observed.status==="filled"?"filled":"partially_filled")
      :mappedStatus(observed.status);
    const now=new Date().toISOString();
    const nextMetadata={...metadata,brokerObservedStatus:observed.status??status,
      filledQuantityObserved:filledQty,filledAveragePriceObserved:numeric(observed.filled_avg_price),
      brokerLookupPending:false};
    await patchOrder(order.client_order_id,{broker_order_id:observed.id??order.broker_order_id,
      status:localStatus,last_reconciled_at:now,submitted_at:order.submitted_at??now,metadata:nextMetadata});

    if(filledQty<=0&&["canceled","rejected","expired"].includes(status)){
      const {data}=await db.rpc("paper_atlas_release",{p_reservation_id:reservationId});
      return {ok:data===true,state:data===true?"no-fill-released":"no-fill-release-pending"};
    }

    if(filledQty>0){
      if(localStatus==="filled"){
        await db.rpc("paper_atlas_consume",{p_reservation_id:reservationId,p_client_order_id:order.client_order_id});
      }else if(["canceled","expired"].includes(String(observed.status??""))){
        await db.rpc("paper_atlas_consume_partial_terminal",{
          p_reservation_id:reservationId,p_client_order_id:order.client_order_id,
        });
      }
      let brokerPosition:BrokerPosition|null=null;
      for(let i=0;i<10;i++){
        brokerPosition=await findBrokerPosition(order.symbol);
        const available=numeric(brokerPosition?.qty_available)??numeric(brokerPosition?.qty)??0;
        if(available>0)break;
        await sleep(200);
      }
      const available=floorQty(numeric(brokerPosition?.qty_available)??numeric(brokerPosition?.qty)??0);
      const stop=numeric(order.protective_stop);
      if(!(available>0&&stop&&stop>0))return {ok:false,state:"filled-position-not-confirmed-for-protection"};
      const protectedNow=await createProtection({symbol:order.symbol,qty:available,stop,entry:{...order,status:localStatus,metadata:nextMetadata},
        reason:"Atlas fractional DAY protective stop after entry fill."});
      if(!protectedNow){
        const emergency=await submitExit({symbol:order.symbol,qty:available,purpose:"emergency-flatten",
          reason:"Atlas emergency flatten after entry protection failure.",entry:{...order,status:localStatus,metadata:nextMetadata}});
        return {ok:false,state:"protection-failed-emergency-flatten",emergencySubmitted:Boolean(emergency.order),ambiguous:emergency.ambiguous};
      }
      await patchOrder(order.client_order_id,{metadata:{...nextMetadata,protectionEstablishedAt:new Date().toISOString(),
        currentProtectiveStop:roundPrice(stop)}});
      return {ok:true,state:localStatus==="filled"?"filled-protected":"partial-fill-protected",filledQty};
    }
    return {ok:false,state:status};
  };

  if(activeEntry){
    const state=await settleEntry(activeEntry);
    return reply({...state,paperOnly:true,action:"reconcile-entry",symbol:activeEntry.symbol,audit:auditBody},
      state.ok?200:state.state.includes("pending")||state.state.includes("unconfirmed")?502:200);
  }

  if(!session.entriesOpen){
    return reply({ok:true,paperOnly:true,action:"none",
      reason:session.marketOpen?"entry-window-closed":"stock-market-closed",
      minutesToClose:session.minutesToClose,audit:auditBody});
  }

  const {data:ledgerRows,error:ledgerError}=await db.from("paper_bot_ledgers")
    .select("starting_cash,cash").eq("bot_id",BOT_ID).limit(1);
  if(ledgerError||!ledgerRows?.[0])return reply({error:"Atlas ledger unavailable."},503);
  const startingCash=numeric(ledgerRows[0].starting_cash),cash=numeric(ledgerRows[0].cash);
  if(!startingCash||cash===null)return reply({error:"Atlas ledger values are invalid."},503);

  const {data:positionRows,error:positionError}=await db.from("paper_bot_positions")
    .select("symbol,quantity,pool_id,market_value").eq("bot_id",BOT_ID);
  if(positionError)return reply({error:"Atlas positions unavailable."},503);
  const committed=(positionRows??[]).filter(row=>row.pool_id==="day")
    .reduce((sum,row)=>sum+Math.max(0,numeric(row.market_value)??0),0);
  const poolRemaining=Math.max(0,startingCash*.20-committed);

  const openOrdersResult=await broker("orders?status=open&limit=500&nested=false&direction=desc");
  if(!openOrdersResult.response.ok)return reply({error:"Atlas could not inspect shared broker orders."},503);
  const sharedOpenOrders=Array.isArray(openOrdersResult.body)?openOrdersResult.body as BrokerOrder[]:[];

  const candidateSince=new Date(Date.now()-6*60_000).toISOString();
  const {data:candidateRows,error:candidateError}=await db.from("paper_bot_journal")
    .select("symbol,asset_class,occurred_at,score,qualification,blockers,metadata")
    .eq("bot_id",BOT_ID).eq("strategy_id",STRATEGY_ID).eq("strategy_version",STRATEGY_VERSION)
    .eq("event_type","candidate").eq("qualification","trade-ready")
    .gte("occurred_at",candidateSince).order("score",{ascending:false}).order("occurred_at",{ascending:false}).limit(30);
  if(candidateError)return reply({error:"Atlas executable-candidate lookup failed."},503);

  for(const candidate of (candidateRows??[]) as CandidateRow[]){
    if(candidate.asset_class!=="stock")continue;
    if(JSON.stringify(candidate.blockers)!==JSON.stringify([POOL_BLOCKER]))continue;
    const provenance=inputObject(candidate),plan=referencePlan(candidate);
    if(!plan||provenance.candidateSource!=="persisted-paper-watchlist")continue;
    const approvedPools=Array.isArray(provenance.approvedPools)?provenance.approvedPools.filter(v=>typeof v==="string") as string[]:[];
    const pool=atlasExecutionPool(approvedPools);
    const opportunityId=typeof provenance.opportunityId==="string"?provenance.opportunityId:"";
    const decisionId=typeof candidate.metadata?.decisionId==="string"?candidate.metadata.decisionId:"";
    if(pool!=="day"||!opportunityId||!decisionId)continue;

    const compact=normalize(candidate.symbol);
    if(brokerPositions.some(p=>normalize(p.symbol)===compact&&Math.abs(numeric(p.qty)??0)>0))continue;
    if(sharedOpenOrders.some(o=>normalize(o.symbol)===compact))continue;

    const assetResult=await broker(`assets/${encodeURIComponent(candidate.symbol)}`);
    if(!assetResult.response.ok)continue;
    const asset=assetResult.body as BrokerAsset;
    const brokerAssetVerified=asset.class==="us_equity"&&asset.status==="active"
      &&asset.tradable===true&&asset.fractionable===true&&normalize(asset.symbol)===compact;
    if(!brokerAssetVerified)continue;

    const quote=await marketQuote(candidate.symbol);
    if(!quote?.ask)continue;
    const quoteAt=quote.timestamp?Date.parse(quote.timestamp):NaN;
    const quoteAgeMs=Number.isFinite(quoteAt)?Date.now()-quoteAt:null;
    const execution=buildAtlasStockExecutionPlan({
      ask:quote.ask,quoteAgeMs,referencePlan:plan,cash,poolRemaining,fractionable:true,
    });
    if(!execution.executable||!execution.quantity||!execution.requestedNotional
       ||!execution.maxEntryPrice||!execution.plannedRiskDollars)continue;

    const preflight={
      symbol:candidate.symbol,assetClass:"stock",brokerAssetVerified:true,marketSessionOpen:true,
      quoteFresh:true,sharedSymbolClear:true,triggerReached:true,noChase:true,
      fractionalSimpleOnly:true,executionMode:EXECUTION_MODE,minutesToClose:session.minutesToClose,
      quoteAt:quote.timestamp,brokerAssetId:asset.id??null,brokerClass:asset.class??null,
    };
    const {data:authorized,error:authorizeError}=await db.rpc("paper_atlas_authorize_day_candidate",{
      p_decision_id:decisionId,p_opportunity_id:opportunityId,p_amount:execution.requestedNotional,p_preflight:preflight,
    });
    if(authorizeError||authorized!==true)continue;

    const {data:reservation,error:reservationError}=await db.rpc("paper_atlas_reserve",{
      p_decision_id:decisionId,p_opportunity_id:opportunityId,p_pool:"day",
      p_amount:execution.requestedNotional,p_expected_bot:BOT_ID,
    });
    const reservationData=objectValue(reservation);
    const reservationId=typeof reservationData.reservationId==="string"?reservationData.reservationId:null;
    if(reservationError||reservationData.reserved!==true||!reservationId)continue;

    const clientOrderId=createPaperClientOrderId(BOT_ID,STRATEGY_VERSION,crypto.randomUUID());
    const expiresAt=new Date(Date.now()+5*60_000).toISOString();
    const orderMetadata={
      paperOnly:true,purpose:"entry",atlasReservationId:reservationId,decisionId,opportunityId,
      authorizationPreflight:preflight,quoteAt:quote.timestamp,executionMode:EXECUTION_MODE,
      brokerOrderType:"limit",timeInForce:"day",sessionDate,initialStop:plan.stopPrice,
      partialProfitCompleted:false,
    };
    const {error:insertError}=await db.from("paper_bot_orders").insert({
      client_order_id:clientOrderId,bot_id:BOT_ID,strategy_id:STRATEGY_ID,strategy_version:STRATEGY_VERSION,
      symbol:candidate.symbol,asset_class:"stock",side:"buy",status:"prepared",
      requested_notional:execution.requestedNotional,requested_quantity:execution.quantity,pool_id:"day",
      entry_trigger:plan.entryTrigger,max_entry_price:execution.maxEntryPrice,protective_stop:plan.stopPrice,
      planned_risk_dollars:execution.plannedRiskDollars,expires_at:expiresAt,
      stage_reason:"Atlas v1 fractional DAY entry authorized from current decision evidence.",
      take_profit_price:plan.exitPrice,take_profit_fraction:.25,take_profit_r:1.75,
      protect_winner_at_r:1,trail_remainder:true,metadata:orderMetadata,
    });
    if(insertError){
      await db.rpc("paper_atlas_abandon_unbound",{p_reservation_id:reservationId});
      return reply({error:"Atlas prepared-order persistence failed; unbound reservation cleanup attempted."},503);
    }

    const {data:bound,error:bindError}=await db.rpc("paper_atlas_bind_order",{
      p_reservation_id:reservationId,p_client_order_id:clientOrderId,
    });
    if(bindError||bound!==true){
      return reply({error:"Atlas order was prepared but reservation binding failed; broker submission was not attempted.",
        paperOnly:true,clientOrderId,reservationId},503);
    }

    const prepared:OrderRow={
      client_order_id:clientOrderId,broker_order_id:null,status:"prepared",symbol:candidate.symbol,asset_class:"stock",
      side:"buy",requested_notional:execution.requestedNotional,requested_quantity:execution.quantity,pool_id:"day",
      entry_trigger:plan.entryTrigger,max_entry_price:execution.maxEntryPrice,protective_stop:plan.stopPrice,
      planned_risk_dollars:execution.plannedRiskDollars,take_profit_price:plan.exitPrice,take_profit_fraction:.25,
      take_profit_r:1.75,expires_at:expiresAt,submitted_at:null,created_at:new Date().toISOString(),metadata:orderMetadata,
    };
    const state=await settleEntry(prepared);
    return reply({...state,paperOnly:true,action:"entry",symbol:candidate.symbol,
      clientOrderId,reservationId,audit:auditBody},state.ok?200:502);
  }

  return reply({ok:true,paperOnly:true,action:"none",reason:"no-executable-day-stock",
    minutesToClose:session.minutesToClose,audit:auditBody});
}
