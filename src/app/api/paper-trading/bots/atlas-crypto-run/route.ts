import {NextResponse} from "next/server";
import {createAdminSupabaseClient} from "@/lib/supabase-admin";
import {createPaperClientOrderId} from "@/lib/paper-order-attribution";
import {
  ATLAS_CRYPTO_ESTIMATED_FEE_BPS_PER_SIDE,
  atlasCryptoExecutionPool,
  buildAtlasCryptoExecutionPlan,
} from "@/lib/paper-atlas-crypto-execution-plan";
import type {AtlasExecutionReferencePlan} from "@/lib/paper-atlas-execution-plan";
import {GET as readOnlyMarketSnapshot} from "@/app/api/paper-trading/market-data/route";

export const dynamic="force-dynamic";

const ALPACA_PAPER="https://paper-api.alpaca.markets/v2";
const BOT_ID="default-diverse";
const STRATEGY_ID="paper-medium-high-v1";
const STRATEGY_VERSION=1;
const POOL_BLOCKER="Current pool allocation capacity must be checked before order authorization.";
const ACTIVE_STATUSES=["prepared","submitted","partially_filled"] as const;

type JsonMap=Record<string,unknown>;
type AtlasPool="day"|"multi-day"|"multi-week";
type CandidateRow={
  symbol:string;asset_class:string;occurred_at:string;score:number|string|null;
  qualification:string|null;blockers:unknown;metadata:JsonMap;
};
type OrderRow={
  client_order_id:string;broker_order_id:string|null;status:string;symbol:string;asset_class:string;side:string;
  requested_notional:number|string|null;requested_quantity:number|string|null;
  pool_id:string|null;entry_trigger:number|string|null;max_entry_price:number|string|null;
  protective_stop:number|string|null;planned_risk_dollars:number|string|null;
  take_profit_price:number|string|null;take_profit_fraction:number|string|null;
  protect_winner_at_r:number|string|null;trail_remainder:boolean|null;
  expires_at:string|null;metadata:JsonMap|null;created_at?:string;
};
type ReservationRow={
  reservation_id:string;client_order_id:string|null;created_at:string;amount:number|string;pool:string;
};
type PositionRow={
  symbol:string;asset_class:string;quantity:number|string;average_entry:number|string;pool_id:string|null;
  protective_stop:number|string|null;initial_protective_stop:number|string|null;
  take_profit_price:number|string|null;take_profit_fraction:number|string|null;
  protect_winner_at_r:number|string|null;trail_remainder:boolean|null;
  exit_manager_state:JsonMap|null;metadata:JsonMap|null;
};
type BrokerOrder={
  id?:string;client_order_id?:string;status?:string;symbol?:string;side?:string;type?:string;
  qty?:string;filled_qty?:string;filled_avg_price?:string|null;stop_price?:string|null;limit_price?:string|null;
};
type BrokerPosition={symbol?:string;qty?:string;qty_available?:string};
type BrokerAsset={
  id?:string;class?:string;symbol?:string;status?:string;tradable?:boolean;fractionable?:boolean;
  min_order_size?:string;min_trade_increment?:string;
};
type CryptoBook={
  product:string;timestamp:string|null;
  bestBid?:{price:number;size:number;timestamp:string}|null;
  bestAsk?:{price:number;size:number;timestamp:string}|null;
};
type MarketSnapshot={crypto?:CryptoBook[]};

function reply(body:unknown,status=200){
  return NextResponse.json(body,{status,headers:{"Cache-Control":"no-store"}});
}
function object(value:unknown):JsonMap{
  return value&&typeof value==="object"&&!Array.isArray(value)?value as JsonMap:{};
}
function num(value:unknown){
  const n=typeof value==="number"?value:typeof value==="string"&&value.trim()?Number(value):NaN;
  return Number.isFinite(n)?n:null;
}
function normalize(value:string|undefined){
  return (value??"").replace(/[\/-]/g,"").toUpperCase();
}
function brokerSymbol(product:string){return product.replace("-","/");}
function floorQty(value:number){return Math.floor((value+Number.EPSILON)*1_000_000_000)/1_000_000_000;}
function qtyString(value:number){return value.toFixed(9).replace(/0+$/,"").replace(/\.$/,"");}
function roundPrice(value:number){return Number(value.toFixed(value>=1000?2:value>=1?4:6));}
function stopFloor(stop:number){return roundPrice(stop*.997);}
function mappedStatus(value:unknown){
  const s=typeof value==="string"?value:"submitted";
  return ["filled","partially_filled","canceled","rejected","expired","replaced","error"].includes(s)?s:"submitted";
}
function inputObject(row:CandidateRow){return object(row.metadata?.inputProvenance);}
function referencePlan(row:CandidateRow):AtlasExecutionReferencePlan|null{
  const value=object(row.metadata?.referencePlan);
  if(!Object.keys(value).length)return null;
  return {
    entryTrigger:num(value.entryTrigger),stopPrice:num(value.stopPrice),exitPrice:num(value.exitPrice),
    riskDollars:num(value.riskDollars),uncappedPositionValue:num(value.uncappedPositionValue),
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
    return reply({error:"Atlas crypto PAPER dependencies are not configured."},503);

  const db=createAdminSupabaseClient();
  const {data:ledgerRows,error:ledgerError}=await db.from("paper_bot_ledgers")
    .select("starting_cash,cash,metadata").eq("bot_id",BOT_ID).limit(1);
  if(ledgerError||!ledgerRows?.[0])return reply({error:"Atlas ledger unavailable."},503);
  const ledger=ledgerRows[0];
  const ledgerMeta=object(ledger.metadata);
  if(ledgerMeta.liveMoneyEnabled===true)return reply({error:"Live-money mode is not permitted."},423);
  if(ledgerMeta.executionEnabled!==true||ledgerMeta.cryptoExecutionEnabled!==true)
    return reply({ok:true,paperOnly:true,action:"none",reason:"crypto-executor-disabled"});

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
    if(!result.response.ok)throw new Error(`Atlas crypto broker lookup returned HTTP ${result.response.status}.`);
    return result.body as BrokerOrder;
  };
  const brokerPositions=async()=>{
    const result=await broker("positions");
    if(!result.response.ok)throw new Error("Atlas crypto broker positions are unavailable.");
    return Array.isArray(result.body)?result.body as BrokerPosition[]:[];
  };
  const brokerPosition=async(product:string)=>{
    const rows=await brokerPositions();
    return rows.find(row=>normalize(row.symbol)===normalize(product))??null;
  };
  const quote=async(product:string)=>{
    const url=new URL("/api/paper-trading/market-data",request.url);
    url.searchParams.set("stocks","");
    url.searchParams.set("crypto",product);
    url.searchParams.set("history","0");
    const response=await readOnlyMarketSnapshot(new Request(url));
    if(!response.ok)return null;
    const body=await response.json() as MarketSnapshot;
    return body.crypto?.find(row=>row.product===product)??null;
  };
  const patchOrder=async(id:string,values:JsonMap)=>{
    const {error}=await db.from("paper_bot_orders").update({...values,updated_at:new Date().toISOString()})
      .eq("client_order_id",id).eq("bot_id",BOT_ID);
    if(error)throw new Error("Atlas crypto paper order update failed.");
  };
  const submitWithLookup=async(clientOrderId:string,payload:JsonMap)=>{
    let created:BrokerOrder|null=null;
    let explicitReject:string|null=null;
    try{
      const result=await broker("orders",{method:"POST",body:JSON.stringify(payload)});
      if(result.response.ok)created=result.body as BrokerOrder;
      else if(result.response.status>=400&&result.response.status<500)
        explicitReject=typeof object(result.body).message==="string"?String(object(result.body).message):`HTTP ${result.response.status}`;
    }catch{}
    if(!created?.id){
      try{created=await lookupByClientId(clientOrderId);}catch{}
    }
    return {order:created,explicitReject};
  };
  const reconcileStoredOrder=async(order:OrderRow):Promise<{observed:BrokerOrder;metadata:JsonMap}|null>=>{
    let observed:BrokerOrder|null=null;
    if(order.broker_order_id){
      const result=await broker(`orders/${encodeURIComponent(order.broker_order_id)}`);
      if(result.response.ok)observed=result.body as BrokerOrder;
    }
    if(!observed){
      try{observed=await lookupByClientId(order.client_order_id);}catch{}
    }
    if(!observed?.id)return null;
    const metadata:JsonMap={
      ...object(order.metadata),brokerObservedStatus:observed.status??"submitted",
      filledQuantityObserved:num(observed.filled_qty)??0,
      filledAveragePriceObserved:num(observed.filled_avg_price),brokerLookupPending:false,
    };
    await patchOrder(order.client_order_id,{
      broker_order_id:observed.id,status:mappedStatus(observed.status),
      last_reconciled_at:new Date().toISOString(),metadata,
    });
    return {observed,metadata};
  };

  const activeSellOrders=async(product:string)=>{
    const {data,error}=await db.from("paper_bot_orders")
      .select("client_order_id,broker_order_id,status,symbol,asset_class,side,requested_notional,requested_quantity,pool_id,entry_trigger,max_entry_price,protective_stop,planned_risk_dollars,take_profit_price,take_profit_fraction,protect_winner_at_r,trail_remainder,expires_at,metadata,created_at")
      .eq("bot_id",BOT_ID).eq("symbol",product).eq("asset_class","crypto").eq("side","sell")
      .in("status",[...ACTIVE_STATUSES]).order("created_at",{ascending:false}).limit(20);
    if(error)throw new Error("Atlas crypto protective-order lookup failed.");
    return (data??[]) as OrderRow[];
  };
  const cancelProtection=async(product:string)=>{
    const active=await activeSellOrders(product);
    const stops=active.filter(row=>object(row.metadata).purpose==="protective-stop");
    for(const stop of stops){
      let brokerId=stop.broker_order_id;
      if(!brokerId){
        try{brokerId=(await lookupByClientId(stop.client_order_id))?.id??null;}catch{}
      }
      if(brokerId){
        const canceled=await broker(`orders/${encodeURIComponent(brokerId)}`,{method:"DELETE"});
        if(!canceled.response.ok&&canceled.response.status!==404)return false;
      }
      await patchOrder(stop.client_order_id,{
        status:"canceled",last_reconciled_at:new Date().toISOString(),
        metadata:{...object(stop.metadata),cancelRequestedAt:new Date().toISOString(),cancelReason:"atlas-crypto-manager-v4"},
      });
    }
    if(stops.some(stop=>stop.broker_order_id))await sleep(250);
    return true;
  };
  const sellableQty=async(product:string)=>{
    for(let i=0;i<10;i++){
      const position=await brokerPosition(product);
      const available=floorQty(num(position?.qty_available)??num(position?.qty)??0);
      if(available>0)return available;
      await sleep(200);
    }
    return 0;
  };

  const submitSell=async(input:{
    product:string;quantity:number;purpose:string;parentClientOrderId:string;pool:AtlasPool;
    type:"market"|"stop_limit";stopPrice?:number;stageReason:string;
  })=>{
    const clientOrderId=createPaperClientOrderId(BOT_ID,STRATEGY_VERSION,crypto.randomUUID());
    const stopPrice=input.stopPrice?roundPrice(input.stopPrice):null;
    const stopLimit=stopPrice?stopFloor(stopPrice):null;
    const metadata:JsonMap={
      paperOnly:true,purpose:input.purpose,parentClientOrderId:input.parentClientOrderId,
      executionMode:"atlas-crypto-v4",holdingPool:input.pool,
      estimatedFeeBps:ATLAS_CRYPTO_ESTIMATED_FEE_BPS_PER_SIDE,
    };
    const {error:insertError}=await db.from("paper_bot_orders").insert({
      client_order_id:clientOrderId,bot_id:BOT_ID,strategy_id:STRATEGY_ID,strategy_version:STRATEGY_VERSION,
      symbol:input.product,asset_class:"crypto",side:"sell",status:"prepared",
      requested_quantity:input.quantity,pool_id:input.pool,
      entry_trigger:stopPrice,max_entry_price:stopLimit,protective_stop:stopPrice,
      planned_risk_dollars:0,stage_reason:input.stageReason,metadata,
    });
    if(insertError)throw new Error("Atlas crypto protective/exit persistence failed.");

    const payload:JsonMap={
      symbol:brokerSymbol(input.product),side:"sell",qty:qtyString(input.quantity),type:input.type,
      time_in_force:"gtc",client_order_id:clientOrderId,
    };
    if(input.type==="stop_limit"&&stopPrice&&stopLimit){
      payload.stop_price=String(stopPrice);payload.limit_price=String(stopLimit);
    }
    const submitted=await submitWithLookup(clientOrderId,payload);
    if(!submitted.order?.id){
      await patchOrder(clientOrderId,{
        status:submitted.explicitReject?"rejected":"prepared",
        metadata:{...metadata,brokerLookupPending:!submitted.explicitReject,executionError:submitted.explicitReject},
      });
      return {ok:false,ambiguous:!submitted.explicitReject,clientOrderId,order:null as BrokerOrder|null};
    }
    await patchOrder(clientOrderId,{
      status:mappedStatus(submitted.order.status),broker_order_id:submitted.order.id,
      submitted_at:new Date().toISOString(),last_reconciled_at:new Date().toISOString(),
      metadata:{...metadata,brokerObservedStatus:submitted.order.status??"submitted",
        brokerLookupPending:false,filledQuantityObserved:num(submitted.order.filled_qty)??0},
    });
    return {ok:true,ambiguous:false,clientOrderId,order:submitted.order};
  };

  const emergencyFlatten=async(product:string,parentClientOrderId:string,pool:AtlasPool,reason:string)=>{
    const canceled=await cancelProtection(product);
    if(!canceled)return {ok:false,reason:"protective-cancel-failed"};
    const quantity=await sellableQty(product);
    if(!(quantity>0))return {ok:false,reason:"no-sellable-quantity"};
    const result=await submitSell({
      product,quantity,purpose:"emergency-flatten",parentClientOrderId,pool,type:"market",stageReason:reason,
    });
    return {ok:result.ok,reason:result.ok?"submitted":result.ambiguous?"broker-ambiguous":"broker-rejected"};
  };

  const ensureProtection=async(product:string,stopPrice:number,parentClientOrderId:string,pool:AtlasPool)=>{
    const active=await activeSellOrders(product);
    const protective=active.find(row=>object(row.metadata).purpose==="protective-stop");
    if(protective){
      const reconciled=await reconcileStoredOrder(protective);
      if(reconciled&&["submitted","partially_filled"].includes(mappedStatus(reconciled.observed.status)))
        return {ok:true,state:"protected",clientOrderId:protective.client_order_id};
      if(!reconciled&&protective.status==="prepared"){
        const quantity=await sellableQty(product);
        if(!(quantity>0))return {ok:false,state:"no-sellable-quantity"};
        const stop=num(protective.protective_stop)??stopPrice;
        const limit=num(protective.max_entry_price)??stopFloor(stop);
        const submitted=await submitWithLookup(protective.client_order_id,{
          symbol:brokerSymbol(product),side:"sell",qty:qtyString(quantity),type:"stop_limit",
          time_in_force:"gtc",stop_price:String(roundPrice(stop)),limit_price:String(roundPrice(limit)),
          client_order_id:protective.client_order_id,
        });
        if(submitted.order?.id){
          await patchOrder(protective.client_order_id,{
            broker_order_id:submitted.order.id,status:mappedStatus(submitted.order.status),
            submitted_at:new Date().toISOString(),last_reconciled_at:new Date().toISOString(),
            metadata:{...object(protective.metadata),brokerLookupPending:false,
              brokerObservedStatus:submitted.order.status??"submitted"},
          });
          return {ok:true,state:"protected",clientOrderId:protective.client_order_id};
        }
        if(!submitted.explicitReject)return {ok:false,state:"ambiguous"};
      }
    }

    const quantity=await sellableQty(product);
    if(!(quantity>0))return {ok:false,state:"no-sellable-quantity"};
    const submitted=await submitSell({
      product,quantity,purpose:"protective-stop",parentClientOrderId,pool,type:"stop_limit",stopPrice,
      stageReason:"Atlas v4 broker-hosted crypto GTC stop-limit.",
    });
    if(!submitted.ok&&!submitted.ambiguous){
      const flattened=await emergencyFlatten(
        product,parentClientOrderId,pool,
        "Atlas crypto protective stop was rejected; emergency PAPER flatten."
      );
      return {ok:flattened.ok,state:flattened.ok?"emergency-flatten":"protection-failed"};
    }
    return {ok:submitted.ok,state:submitted.ok?"protected":"protection-ambiguous",clientOrderId:submitted.clientOrderId};
  };

  const clockNow=Date.now();

  const {data:reservationRows,error:reservationError}=await db.from("paper_atlas_reservations")
    .select("reservation_id,client_order_id,created_at,amount,pool")
    .eq("bot_id",BOT_ID).eq("status","reserved").order("created_at",{ascending:true}).limit(1);
  if(reservationError)return reply({error:"Atlas reservation lookup failed."},503);
  const reservation=(reservationRows?.[0]??null) as ReservationRow|null;

  if(reservation){
    if(!reservation.client_order_id){
      if(clockNow-Date.parse(reservation.created_at)>90_000){
        const {data}=await db.rpc("paper_atlas_abandon_unbound",{p_reservation_id:reservation.reservation_id});
        return reply({ok:data===true,paperOnly:true,action:"reservation-recovery",released:data===true});
      }
      return reply({ok:true,paperOnly:true,action:"reservation-wait",reason:"order-link-pending"});
    }
    const {data:orders,error:orderError}=await db.from("paper_bot_orders")
      .select("client_order_id,broker_order_id,status,symbol,asset_class,side,requested_notional,requested_quantity,pool_id,entry_trigger,max_entry_price,protective_stop,planned_risk_dollars,take_profit_price,take_profit_fraction,protect_winner_at_r,trail_remainder,expires_at,metadata,created_at")
      .eq("bot_id",BOT_ID).eq("client_order_id",reservation.client_order_id).limit(1);
    if(orderError||!orders?.[0])return reply({error:"Atlas reserved order is missing."},503);
    const order=orders[0] as OrderRow;
    if(order.asset_class!=="crypto")
      return reply({ok:true,paperOnly:true,action:"none",reason:"stock-reservation-owned-by-stock-runner"});

    let reconciled=await reconcileStoredOrder(order);
    if(!reconciled&&order.status==="prepared"){
      const quantity=num(order.requested_quantity);
      const limit=num(order.max_entry_price);
      if(!quantity||!limit)return reply({error:"Atlas crypto prepared entry is incomplete."},503);
      const submitted=await submitWithLookup(order.client_order_id,{
        symbol:brokerSymbol(order.symbol),side:"buy",qty:qtyString(quantity),type:"limit",time_in_force:"gtc",
        limit_price:String(roundPrice(limit)),client_order_id:order.client_order_id,
      });
      if(!submitted.order?.id){
        await patchOrder(order.client_order_id,{
          status:submitted.explicitReject?"rejected":"prepared",
          metadata:{...object(order.metadata),brokerLookupPending:!submitted.explicitReject,executionError:submitted.explicitReject},
        });
        if(submitted.explicitReject){
          const {data}=await db.rpc("paper_atlas_release_unsubmitted",{
            p_reservation_id:reservation.reservation_id,p_client_order_id:order.client_order_id,
          });
          return reply({ok:data===true,paperOnly:true,action:"entry-rejected",
            reservationReleased:data===true,reason:submitted.explicitReject});
        }
        return reply({error:"Atlas crypto broker entry outcome is unconfirmed; reservation remains locked.",
          paperOnly:true,action:"entry-ambiguous"},502);
      }
      await patchOrder(order.client_order_id,{
        broker_order_id:submitted.order.id,status:mappedStatus(submitted.order.status),
        submitted_at:new Date().toISOString(),last_reconciled_at:new Date().toISOString(),
        metadata:{...object(order.metadata),brokerLookupPending:false,
          brokerObservedStatus:submitted.order.status??"submitted",
          filledQuantityObserved:num(submitted.order.filled_qty)??0,
          filledAveragePriceObserved:num(submitted.order.filled_avg_price)},
      });
      reconciled={observed:submitted.order,metadata:{
        ...object(order.metadata),brokerLookupPending:false,
        filledQuantityObserved:num(submitted.order.filled_qty)??0,
      }};
    }
    if(!reconciled)return reply({ok:true,paperOnly:true,action:"entry-wait",reason:"broker-order-not-visible"});

    let observed=reconciled.observed;
    let status=mappedStatus(observed.status);
    let filledQty=num(observed.filled_qty)??0;
    if(status==="partially_filled"||(order.expires_at&&clockNow>Date.parse(order.expires_at)&&status==="submitted")){
      if(observed.id)await broker(`orders/${encodeURIComponent(observed.id)}`,{method:"DELETE"});
      await sleep(250);
      if(observed.id){
        const after=await broker(`orders/${encodeURIComponent(observed.id)}`);
        if(after.response.ok){
          observed=after.body as BrokerOrder;
          status=mappedStatus(observed.status);
          filledQty=num(observed.filled_qty)??filledQty;
          await patchOrder(order.client_order_id,{
            status,broker_order_id:observed.id,last_reconciled_at:new Date().toISOString(),
            metadata:{...reconciled.metadata,filledQuantityObserved:filledQty,
              filledAveragePriceObserved:num(observed.filled_avg_price),brokerObservedStatus:observed.status??status},
          });
        }
      }
    }

    if(filledQty>0){
      const stop=num(order.protective_stop);
      const pool=order.pool_id==="multi-day"||order.pool_id==="multi-week"?order.pool_id:null;
      if(!stop||!pool)return reply({error:"Atlas crypto filled entry is missing stop or swing pool.",critical:true},503);
      const protection=await ensureProtection(order.symbol,stop,order.client_order_id,pool);
      if(!protection.ok)return reply({error:"Atlas crypto position is not confirmed protected.",
        paperOnly:true,critical:true,protection},503);
      const {data:consumed,error:consumeError}=await db.rpc("paper_atlas_consume",{
        p_reservation_id:reservation.reservation_id,p_client_order_id:order.client_order_id,
      });
      return reply({ok:true,paperOnly:true,action:"entry-filled",symbol:order.symbol,protection,
        ledgerSettlement:!consumeError&&consumed===true?"consumed":"pending"});
    }

    if(["canceled","rejected","expired"].includes(status)){
      const {data:released,error:releaseError}=await db.rpc("paper_atlas_release",{
        p_reservation_id:reservation.reservation_id,
      });
      return reply({ok:!releaseError&&released===true,paperOnly:true,action:"entry-terminal",
        status,reservationReleased:!releaseError&&released===true});
    }
    return reply({ok:true,paperOnly:true,action:"entry-pending",symbol:order.symbol,status});
  }

  const {data:positionRows,error:positionError}=await db.from("paper_bot_positions")
    .select("symbol,asset_class,quantity,average_entry,pool_id,protective_stop,initial_protective_stop,take_profit_price,take_profit_fraction,protect_winner_at_r,trail_remainder,exit_manager_state,metadata")
    .eq("bot_id",BOT_ID).gt("quantity",0).limit(1);
  if(positionError)return reply({error:"Atlas crypto position lookup failed."},503);
  const position=(positionRows?.[0]??null) as PositionRow|null;

  if(position){
    if(position.asset_class!=="crypto")
      return reply({ok:true,paperOnly:true,action:"none",reason:"stock-position-owned-by-stock-runner"});
    const pool=position.pool_id==="multi-day"||position.pool_id==="multi-week"?position.pool_id:null;
    if(!pool)return reply({error:"Atlas crypto position has no supported swing pool.",critical:true},503);

    const brokerPos=await brokerPosition(position.symbol);
    if(!brokerPos)return reply({ok:true,paperOnly:true,action:"position-sync-wait",symbol:position.symbol});
    const {data:entryRows,error:entryError}=await db.from("paper_bot_orders")
      .select("client_order_id,broker_order_id,status,symbol,asset_class,side,requested_notional,requested_quantity,pool_id,entry_trigger,max_entry_price,protective_stop,planned_risk_dollars,take_profit_price,take_profit_fraction,protect_winner_at_r,trail_remainder,expires_at,metadata,created_at")
      .eq("bot_id",BOT_ID).eq("symbol",position.symbol).eq("asset_class","crypto").eq("side","buy")
      .order("created_at",{ascending:false}).limit(1);
    if(entryError||!entryRows?.[0])return reply({error:"Atlas crypto position has no attributed entry plan.",critical:true},503);
    const parent=entryRows[0] as OrderRow;

    const book=await quote(position.symbol);
    const mark=num(book?.bestBid?.price)??num(book?.bestAsk?.price);
    if(!mark)return reply({error:"Atlas crypto position quote unavailable."},503);

    const quantity=floorQty(Math.min(num(position.quantity)??0,num(brokerPos.qty)??0));
    const average=num(position.average_entry);
    const initialStop=num(position.initial_protective_stop)??num(position.protective_stop);
    const currentStop=num(position.protective_stop);
    const target=num(position.take_profit_price);
    const takeFraction=num(position.take_profit_fraction)??0.25;
    const protectWinnerAtR=num(position.protect_winner_at_r)??1;
    const partialDone=object(position.exit_manager_state).partialProfitState==="completed";
    if(!(quantity>0&&average&&initialStop&&initialStop<average&&currentStop&&target))
      return reply({error:"Atlas crypto position risk plan is incomplete.",critical:true},503);

    const active=await activeSellOrders(position.symbol);
    const nonProtection=active.find(row=>object(row.metadata).purpose!=="protective-stop");
    if(nonProtection){
      const reconciled=await reconcileStoredOrder(nonProtection);
      return reply({ok:true,paperOnly:true,action:"exit-reconcile",symbol:position.symbol,
        purpose:object(nonProtection.metadata).purpose??"sell",
        status:reconciled?.observed.status??nonProtection.status});
    }

    const riskDistance=average-initialStop;
    const rMultiple=riskDistance>0?(mark-average)/riskDistance:0;
    const minimumStep=Math.max(riskDistance*.10,mark*.0015);

    if(!partialDone&&mark>=target&&takeFraction>0&&takeFraction<1){
      const canceled=await cancelProtection(position.symbol);
      if(!canceled)return reply({error:"Atlas crypto stop could not be canceled before partial profit.",critical:true},503);
      const available=await sellableQty(position.symbol);
      const partialQty=floorQty(Math.min(quantity*takeFraction,available*takeFraction));
      if(!(partialQty>0))return reply({error:"Atlas crypto has no sellable quantity for partial profit.",critical:true},503);
      const partial=await submitSell({
        product:position.symbol,quantity:partialQty,purpose:"take-profit-partial",
        parentClientOrderId:parent.client_order_id,pool,type:"market",
        stageReason:"Atlas v4 crypto first reference-target partial profit.",
      });
      if(!partial.ok){
        const restored=await ensureProtection(position.symbol,currentStop,parent.client_order_id,pool);
        return reply({error:"Atlas crypto partial profit was not confirmed; stop restoration attempted.",
          critical:!restored.ok,restored},502);
      }
      let observed=partial.order;
      const brokerId=observed?.id;
      if(brokerId){
        for(let i=0;i<10&&!["filled","canceled","rejected","expired"].includes(mappedStatus(observed?.status));i++){
          await sleep(200);
          const latest=await broker(`orders/${encodeURIComponent(brokerId)}`);
          if(latest.response.ok)observed=latest.body as BrokerOrder;
        }
      }
      const filled=num(observed?.filled_qty)??0;
      if(!(filled>0)){
        if(brokerId)await broker(`orders/${encodeURIComponent(brokerId)}`,{method:"DELETE"});
        const restored=await ensureProtection(position.symbol,currentStop,parent.client_order_id,pool);
        return reply({ok:true,paperOnly:true,action:"partial-no-fill",protectionRestored:restored.ok});
      }

      await patchOrder(partial.clientOrderId,{
        status:mappedStatus(observed?.status),last_reconciled_at:new Date().toISOString(),
        metadata:{purpose:"take-profit-partial",paperOnly:true,parentClientOrderId:parent.client_order_id,
          estimatedFeeBps:ATLAS_CRYPTO_ESTIMATED_FEE_BPS_PER_SIDE,
          filledQuantityObserved:filled,brokerObservedStatus:observed?.status??"filled"},
      });
      await db.from("paper_bot_positions").update({
        exit_manager_state:{...object(position.exit_manager_state),partialProfitState:"completed",
          partialProfitCompletedAt:new Date().toISOString(),lastBrokerAction:"partial_profit"},
        updated_at:new Date().toISOString(),
      }).eq("bot_id",BOT_ID).eq("symbol",position.symbol);

      const remaining=await sellableQty(position.symbol);
      if(remaining>0){
        const feeRate=ATLAS_CRYPTO_ESTIMATED_FEE_BPS_PER_SIDE/10_000;
        const breakEven=average/(1-feeRate);
        const nextStop=Math.max(currentStop,breakEven);
        const restored=await ensureProtection(position.symbol,nextStop,parent.client_order_id,pool);
        return reply({ok:restored.ok,paperOnly:true,action:"partial-profit",symbol:position.symbol,
          filledQuantity:filled,remainingProtected:restored.ok,newStop:roundPrice(nextStop)},restored.ok?200:503);
      }
      return reply({ok:true,paperOnly:true,action:"partial-profit",symbol:position.symbol,positionClosed:true});
    }

    let desiredStop=currentStop;
    const feeRate=ATLAS_CRYPTO_ESTIMATED_FEE_BPS_PER_SIDE/10_000;
    const breakEven=average/(1-feeRate);
    if(partialDone&&position.trail_remainder){
      desiredStop=Math.max(currentStop,breakEven,mark-riskDistance);
    }else if(!partialDone&&rMultiple>=protectWinnerAtR){
      desiredStop=Math.max(currentStop,breakEven);
    }
    if(desiredStop>=currentStop+minimumStep){
      const canceled=await cancelProtection(position.symbol);
      if(!canceled)return reply({error:"Atlas crypto current stop could not be canceled for tightening.",critical:true},503);
      const protectedResult=await ensureProtection(position.symbol,desiredStop,parent.client_order_id,pool);
      if(!protectedResult.ok){
        const flattened=await emergencyFlatten(position.symbol,parent.client_order_id,pool,
          "Atlas crypto tightened stop could not be installed; emergency PAPER flatten.");
        return reply({error:"Atlas crypto stop tightening failed.",critical:true,emergencyFlatten:flattened},502);
      }
      await db.from("paper_bot_positions").update({
        protective_stop:roundPrice(desiredStop),
        exit_manager_state:{...object(position.exit_manager_state),lastBrokerAction:"tighten_stop",
          lastBrokerActionAt:new Date().toISOString(),rMultiple},
        updated_at:new Date().toISOString(),
      }).eq("bot_id",BOT_ID).eq("symbol",position.symbol);
      return reply({ok:true,paperOnly:true,action:"tighten-stop",symbol:position.symbol,newStop:roundPrice(desiredStop)});
    }

    const protection=await ensureProtection(position.symbol,currentStop,parent.client_order_id,pool);
    return reply({ok:protection.ok,paperOnly:true,action:"hold",symbol:position.symbol,
      rMultiple:Number(rMultiple.toFixed(4)),protection},protection.ok?200:503);
  }

  const startingCash=num(ledger.starting_cash);
  const cash=num(ledger.cash);
  if(!startingCash||cash===null)return reply({error:"Atlas ledger values are invalid."},503);

  const candidateSince=new Date(clockNow-6*60_000).toISOString();
  const {data:candidateRows,error:candidateError}=await db.from("paper_bot_journal")
    .select("symbol,asset_class,occurred_at,score,qualification,blockers,metadata")
    .eq("bot_id",BOT_ID).eq("strategy_id",STRATEGY_ID).eq("strategy_version",STRATEGY_VERSION)
    .eq("event_type","candidate").eq("asset_class","crypto").eq("qualification","trade-ready")
    .gte("occurred_at",candidateSince).order("score",{ascending:false}).order("occurred_at",{ascending:false}).limit(30);
  if(candidateError)return reply({error:"Atlas crypto candidate lookup failed."},503);

  const sharedPositions=await brokerPositions();
  const openOrdersResult=await broker("orders?status=open&limit=500&nested=true&direction=desc");
  if(!openOrdersResult.response.ok)return reply({error:"Atlas crypto broker open-order preflight failed."},503);
  const sharedOrders=Array.isArray(openOrdersResult.body)?openOrdersResult.body as BrokerOrder[]:[];

  for(const candidate of (candidateRows??[]) as CandidateRow[]){
    if(JSON.stringify(candidate.blockers)!==JSON.stringify([POOL_BLOCKER]))continue;
    const provenance=inputObject(candidate);
    const plan=referencePlan(candidate);
    if(!plan||provenance.candidateSource!=="persisted-paper-watchlist")continue;
    const approvedPools=Array.isArray(provenance.approvedPools)
      ? provenance.approvedPools.filter(v=>typeof v==="string") as string[]:[];
    const pool=atlasCryptoExecutionPool(approvedPools);
    const opportunityId=typeof provenance.opportunityId==="string"?provenance.opportunityId:"";
    const decisionId=typeof candidate.metadata?.decisionId==="string"?candidate.metadata.decisionId:"";
    if(!pool||!opportunityId||!decisionId)continue;

    const compact=normalize(candidate.symbol);
    if(sharedPositions.some(row=>normalize(row.symbol)===compact&&Math.abs(num(row.qty)??0)>0))continue;
    if(sharedOrders.some(row=>normalize(row.symbol)===compact))continue;

    const venueSymbol=brokerSymbol(candidate.symbol);
    const assetResult=await broker(`assets/${encodeURIComponent(venueSymbol)}`);
    if(!assetResult.response.ok)continue;
    const asset=assetResult.body as BrokerAsset;
    const brokerAssetVerified=asset.class==="crypto"&&asset.status==="active"&&asset.tradable===true
      &&asset.fractionable===true&&normalize(asset.symbol)===compact;
    if(!brokerAssetVerified)continue;

    const book=await quote(candidate.symbol);
    const ask=num(book?.bestAsk?.price);
    const quoteAt=book?.timestamp?Date.parse(book.timestamp):NaN;
    const quoteAgeMs=Number.isFinite(quoteAt)?clockNow-quoteAt:null;
    const poolRemaining=startingCash*.40;
    const execution=buildAtlasCryptoExecutionPlan({
      ask,quoteAgeMs,referencePlan:plan,cash,poolRemaining,
      feeBpsPerSide:ATLAS_CRYPTO_ESTIMATED_FEE_BPS_PER_SIDE,
    });
    if(!execution.executable||!execution.quantity||!execution.requestedNotional
       ||!execution.reservedAmount||!execution.maxEntryPrice||!execution.plannedRiskDollars)continue;

    const preflight={
      symbol:candidate.symbol,assetClass:"crypto",brokerAssetVerified:true,marketSessionOpen:true,
      quoteFresh:true,sharedSymbolClear:true,triggerReached:true,noChase:true,
      quoteAt:book?.timestamp??null,brokerAssetId:asset.id??null,brokerSymbol:venueSymbol,
      protectionMode:"crypto-gtc-stop-limit",holdingPool:pool,
    };
    const {data:authorized,error:authorizeError}=await db.rpc("paper_atlas_authorize_candidate",{
      p_decision_id:decisionId,p_opportunity_id:opportunityId,p_pool:pool,
      p_amount:execution.reservedAmount,p_preflight:preflight,
    });
    if(authorizeError||authorized!==true)continue;

    const {data:reservationData,error:reserveError}=await db.rpc("paper_atlas_reserve",{
      p_decision_id:decisionId,p_opportunity_id:opportunityId,p_pool:pool,
      p_amount:execution.reservedAmount,p_expected_bot:BOT_ID,
    });
    const reserveObject=object(reservationData);
    const reservationId=typeof reserveObject.reservationId==="string"?reserveObject.reservationId:null;
    if(reserveError||reserveObject.reserved!==true||!reservationId)continue;

    const clientOrderId=createPaperClientOrderId(BOT_ID,STRATEGY_VERSION,crypto.randomUUID());
    const expiresAt=new Date(clockNow+5*60_000).toISOString();
    const metadata:JsonMap={
      paperOnly:true,purpose:"entry",atlasReservationId:reservationId,decisionId,opportunityId,
      authorizationPreflight:preflight,quoteAt:book?.timestamp??null,executionMode:"atlas-crypto-v4",
      holdingPool:pool,estimatedFeeBps:ATLAS_CRYPTO_ESTIMATED_FEE_BPS_PER_SIDE,
      estimatedEntryFee:execution.estimatedEntryFee,reservedAmount:execution.reservedAmount,
    };
    const {error:insertError}=await db.from("paper_bot_orders").insert({
      client_order_id:clientOrderId,bot_id:BOT_ID,strategy_id:STRATEGY_ID,strategy_version:STRATEGY_VERSION,
      symbol:candidate.symbol,asset_class:"crypto",side:"buy",status:"prepared",
      requested_notional:execution.requestedNotional,requested_quantity:execution.quantity,pool_id:pool,
      entry_trigger:plan.entryTrigger,max_entry_price:execution.maxEntryPrice,protective_stop:plan.stopPrice,
      planned_risk_dollars:execution.plannedRiskDollars,expires_at:expiresAt,
      stage_reason:`Atlas v4 crypto ${pool} PAPER entry from current trade-ready evidence.`,
      take_profit_price:plan.exitPrice,take_profit_fraction:.25,take_profit_r:1.75,
      protect_winner_at_r:1,trail_remainder:true,metadata,
    });
    if(insertError){
      await db.rpc("paper_atlas_abandon_unbound",{p_reservation_id:reservationId});
      return reply({error:"Atlas crypto prepared entry persistence failed; reservation cleanup attempted."},503);
    }

    const {data:bound,error:bindError}=await db.rpc("paper_atlas_bind_order",{
      p_reservation_id:reservationId,p_client_order_id:clientOrderId,
    });
    if(bindError||bound!==true)
      return reply({error:"Atlas crypto reservation/order binding failed; broker submission was not attempted.",
        clientOrderId,reservationId},503);

    const submitted=await submitWithLookup(clientOrderId,{
      symbol:venueSymbol,side:"buy",qty:qtyString(execution.quantity),type:"limit",time_in_force:"gtc",
      limit_price:String(roundPrice(execution.maxEntryPrice)),client_order_id:clientOrderId,
    });
    if(!submitted.order?.id){
      await patchOrder(clientOrderId,{
        status:submitted.explicitReject?"rejected":"prepared",
        metadata:{...metadata,brokerLookupPending:!submitted.explicitReject,executionError:submitted.explicitReject},
      });
      if(submitted.explicitReject){
        const {data:released}=await db.rpc("paper_atlas_release_unsubmitted",{
          p_reservation_id:reservationId,p_client_order_id:clientOrderId,
        });
        return reply({ok:false,paperOnly:true,action:"entry-rejected",symbol:candidate.symbol,
          reservationReleased:released===true,reason:submitted.explicitReject},409);
      }
      return reply({error:"Atlas crypto broker entry outcome is unconfirmed; reservation remains locked.",
        paperOnly:true,action:"entry-ambiguous",symbol:candidate.symbol},502);
    }

    const observed=submitted.order;
    const filledQty=num(observed.filled_qty)??0;
    await patchOrder(clientOrderId,{
      broker_order_id:observed.id,status:mappedStatus(observed.status),submitted_at:new Date().toISOString(),
      last_reconciled_at:new Date().toISOString(),
      metadata:{...metadata,brokerObservedStatus:observed.status??"submitted",
        filledQuantityObserved:filledQty,filledAveragePriceObserved:num(observed.filled_avg_price),
        brokerLookupPending:false},
    });
    if(filledQty>0&&plan.stopPrice){
      const protection=await ensureProtection(candidate.symbol,plan.stopPrice,clientOrderId,pool);
      return reply({ok:protection.ok,paperOnly:true,action:"entry-filled",symbol:candidate.symbol,
        clientOrderId,reservationId,protection},protection.ok?200:503);
    }
    return reply({ok:true,paperOnly:true,action:"entry-submitted",symbol:candidate.symbol,
      clientOrderId,reservationId,status:mappedStatus(observed.status)});
  }

  return reply({ok:true,paperOnly:true,action:"none",reason:"no-executable-crypto-swing"});
}
