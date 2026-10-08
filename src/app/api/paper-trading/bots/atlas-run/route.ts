import {NextResponse} from "next/server";
import {createAdminSupabaseClient} from "@/lib/supabase-admin";
import {createPaperClientOrderId} from "@/lib/paper-order-attribution";
import {buildAtlasStockExecutionPlan,atlasExecutionPool,type AtlasExecutionReferencePlan} from "@/lib/paper-atlas-execution-plan";
import {GET as runAtlasAudit} from "@/app/api/paper-trading/bots/atlas-decision-audit/route";
import {GET as readOnlyMarketSnapshot} from "@/app/api/paper-trading/market-data/route";

export const dynamic="force-dynamic";

const ALPACA_PAPER="https://paper-api.alpaca.markets/v2";
const BOT_ID="default-diverse";
const STRATEGY_ID="paper-medium-high-v1";
const STRATEGY_VERSION=1;
const POOL_BLOCKER="Current pool allocation capacity must be checked before order authorization.";

type CandidateRow={
  symbol:string;asset_class:string;occurred_at:string;score:number|string|null;
  qualification:string|null;blockers:unknown;metadata:Record<string,unknown>;
};
type OrderRow={
  client_order_id:string;broker_order_id:string|null;status:string;symbol:string;
  requested_notional:number|string|null;requested_quantity:number|string|null;
  pool_id:string|null;max_entry_price:number|string|null;protective_stop:number|string|null;
  take_profit_price:number|string|null;expires_at:string|null;metadata:Record<string,unknown>|null;
};
type BrokerOrder={
  id?:string;client_order_id?:string;status?:string;order_class?:string;side?:string;type?:string;
  filled_qty?:string;filled_avg_price?:string|null;legs?:BrokerOrder[]|null;
};
type BrokerAsset={
  id?:string;class?:string;symbol?:string;status?:string;tradable?:boolean;fractionable?:boolean;
};
type BrokerPosition={symbol?:string;qty?:string};
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
function qtyString(value:number){
  return value.toFixed(9).replace(/0+$/,"").replace(/\.$/,"");
}
function roundPrice(value:number){
  return Number(value.toFixed(value>=1?2:6));
}
function mappedStatus(value:unknown){
  const status=typeof value==="string"?value:"submitted";
  if(["filled","partially_filled","canceled","rejected","expired","replaced"].includes(status))return status;
  return "submitted";
}
function inputObject(row:CandidateRow){
  const value=row.metadata?.inputProvenance;
  return value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:null;
}
function referencePlan(row:CandidateRow):AtlasExecutionReferencePlan|null{
  const value=row.metadata?.referencePlan;
  if(!value||typeof value!=="object"||Array.isArray(value))return null;
  const v=value as Record<string,unknown>;
  return {
    entryTrigger:numeric(v.entryTrigger),stopPrice:numeric(v.stopPrice),exitPrice:numeric(v.exitPrice),
    riskDollars:numeric(v.riskDollars),uncappedPositionValue:numeric(v.uncappedPositionValue),
  };
}

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
  const protectionSummary=(order:BrokerOrder)=>{
    const legs=(order.legs??[]).filter(leg=>leg.side==="sell");
    return {
      bracketAccepted:order.order_class==="bracket",
      takeProfitObserved:legs.some(leg=>leg.type==="limit"&&Boolean(leg.id)),
      stopLossObserved:legs.some(leg=>(leg.type==="stop"||leg.type==="stop_limit")&&Boolean(leg.id)),
    };
  };
  const submitBracket=async(order:OrderRow)=>{
    const qty=numeric(order.requested_quantity);
    const maxEntry=numeric(order.max_entry_price);
    const stop=numeric(order.protective_stop);
    const take=numeric(order.take_profit_price);
    if(!qty||!maxEntry||!stop||!take)throw new Error("Stored Atlas prepared order is incomplete.");
    let created:BrokerOrder|null=null;
    const result=await broker("orders",{
      method:"POST",
      body:JSON.stringify({
        symbol:order.symbol,side:"buy",qty:qtyString(qty),type:"limit",time_in_force:"gtc",
        limit_price:String(roundPrice(maxEntry)),client_order_id:order.client_order_id,
        order_class:"bracket",take_profit:{limit_price:String(roundPrice(take))},
        stop_loss:{stop_price:String(roundPrice(stop))},
      }),
    });
    if(result.response.ok)created=result.body as BrokerOrder;
    if(!created?.id)created=await lookupByClientId(order.client_order_id);
    if(!created?.id)throw new Error("Atlas broker outcome is unconfirmed; the bound order remains fail-closed.");
    const nested=await broker(`orders/${encodeURIComponent(created.id)}?nested=true`);
    return nested.response.ok?nested.body as BrokerOrder:created;
  };
  const reconcile=async(order:OrderRow)=>{
    let observed=await lookupByClientId(order.client_order_id);
    if(!observed&&["prepared","submitted"].includes(order.status)){
      observed=await submitBracket(order);
    }
    if(!observed?.id)return {done:false,state:"broker-unconfirmed"};

    const current=await broker(`orders/${encodeURIComponent(observed.id)}?nested=true`);
    if(current.response.ok)observed=current.body as BrokerOrder;
    let status=mappedStatus(observed.status);
    let filledQty=numeric(observed.filled_qty)??0;

    if(order.expires_at&&Date.now()>Date.parse(order.expires_at)
       &&["submitted","partially_filled"].includes(status)){
      await broker(`orders/${encodeURIComponent(observed.id)}`,{method:"DELETE"});
      const after=await broker(`orders/${encodeURIComponent(observed.id)}?nested=true`);
      if(after.response.ok){
        observed=after.body as BrokerOrder;
        status=mappedStatus(observed.status);
        filledQty=numeric(observed.filled_qty)??filledQty;
      }
    }

    const protection=protectionSummary(observed);
    const now=new Date().toISOString();
    const metadata={
      ...(order.metadata??{}),brokerObservedStatus:observed.status??status,
      filledQuantityObserved:filledQty,filledAveragePriceObserved:numeric(observed.filled_avg_price),
      bracketAccepted:protection.bracketAccepted,takeProfitLegObserved:protection.takeProfitObserved,
      stopLossLegObserved:protection.stopLossObserved,brokerLookupPending:false,
      protectionValidatedAt:now,
    };
    const {error:updateError}=await db.from("paper_bot_orders").update({
      broker_order_id:observed.id,status,last_reconciled_at:now,metadata,updated_at:now,
    }).eq("client_order_id",order.client_order_id).eq("bot_id",BOT_ID);
    if(updateError)throw new Error("Atlas broker reconciliation could not be persisted.");

    const reservationId=typeof metadata.atlasReservationId==="string"?metadata.atlasReservationId:null;
    if(!reservationId)return {done:false,state:"missing-reservation-lineage"};

    if(status==="filled"){
      const {data,error}=await db.rpc("paper_atlas_consume",{
        p_reservation_id:reservationId,p_client_order_id:order.client_order_id,
      });
      return {done:data===true&&!error,state:data===true&&!error?"filled-consumed":"filled-settlement-pending",
        protection};
    }
    if(["canceled","rejected","expired"].includes(status)&&filledQty===0){
      const {data,error}=await db.rpc("paper_atlas_release",{p_reservation_id:reservationId});
      return {done:data===true&&!error,state:data===true&&!error?"terminal-released":"terminal-release-pending",
        protection};
    }
    return {done:false,state:status,protection,filledQty};
  };

  const {data:activeRows,error:activeError}=await db.from("paper_bot_orders")
    .select("client_order_id,broker_order_id,status,symbol,requested_notional,requested_quantity,pool_id,max_entry_price,protective_stop,take_profit_price,expires_at,metadata")
    .eq("bot_id",BOT_ID).eq("strategy_id",STRATEGY_ID).eq("strategy_version",STRATEGY_VERSION)
    .eq("side","buy").in("status",["prepared","submitted","partially_filled"])
    .order("created_at",{ascending:true}).limit(1);
  if(activeError)return reply({error:"Atlas active-order lookup failed."},503);
  const active=(activeRows?.[0]??null) as OrderRow|null;
  if(active){
    try{
      const result=await reconcile(active);
      return reply({ok:true,paperOnly:true,action:"reconcile",symbol:active.symbol,...result,audit:auditBody});
    }catch(error){
      return reply({error:error instanceof Error?error.message:"Atlas reconciliation failed.",paperOnly:true,
        action:"reconcile",symbol:active.symbol,audit:auditBody},502);
    }
  }

  const candidateSince=new Date(Date.now()-6*60_000).toISOString();
  const {data:candidateRows,error:candidateError}=await db.from("paper_bot_journal")
    .select("symbol,asset_class,occurred_at,score,qualification,blockers,metadata")
    .eq("bot_id",BOT_ID).eq("strategy_id",STRATEGY_ID).eq("strategy_version",STRATEGY_VERSION)
    .eq("event_type","candidate").eq("qualification","trade-ready")
    .gte("occurred_at",candidateSince).order("score",{ascending:false}).order("occurred_at",{ascending:false}).limit(30);
  if(candidateError)return reply({error:"Atlas executable-candidate lookup failed."},503);

  const {data:ledgerRows,error:ledgerError}=await db.from("paper_bot_ledgers")
    .select("starting_cash,cash").eq("bot_id",BOT_ID).limit(1);
  if(ledgerError||!ledgerRows?.[0])return reply({error:"Atlas ledger unavailable."},503);
  const startingCash=numeric(ledgerRows[0].starting_cash);
  const cash=numeric(ledgerRows[0].cash);
  if(!startingCash||cash===null)return reply({error:"Atlas ledger values are invalid."},503);

  const {data:positionRows,error:positionError}=await db.from("paper_bot_positions")
    .select("symbol,quantity,pool_id,market_value").eq("bot_id",BOT_ID);
  if(positionError)return reply({error:"Atlas positions unavailable."},503);
  const committed=(positionRows??[]).filter(row=>row.pool_id==="multi-day")
    .reduce((sum,row)=>sum+Math.max(0,numeric(row.market_value)??0),0);
  const poolRemaining=Math.max(0,startingCash*.40-committed);

  const [clockResult,positionsResult,ordersResult]=await Promise.all([
    broker("clock"),broker("positions"),broker("orders?status=open&limit=500&nested=true&direction=desc"),
  ]);
  if(!clockResult.response.ok||!positionsResult.response.ok||!ordersResult.response.ok)
    return reply({error:"Atlas broker preflight could not be completed."},503);
  const clock=clockResult.body as {is_open?:boolean};
  if(clock.is_open!==true)return reply({ok:true,paperOnly:true,action:"none",reason:"stock-market-closed",audit:auditBody});

  const brokerPositions=Array.isArray(positionsResult.body)?positionsResult.body as BrokerPosition[]:[];
  const brokerOrders=Array.isArray(ordersResult.body)?ordersResult.body as BrokerOrder[]:[];

  const candidates=(candidateRows??[]) as CandidateRow[];
  for(const candidate of candidates){
    if(candidate.asset_class!=="stock")continue;
    if(JSON.stringify(candidate.blockers)!==JSON.stringify([POOL_BLOCKER]))continue;
    const provenance=inputObject(candidate);
    const plan=referencePlan(candidate);
    if(!provenance||!plan||provenance.candidateSource!=="persisted-paper-watchlist")continue;
    const approvedPools=Array.isArray(provenance.approvedPools)?provenance.approvedPools.filter(v=>typeof v==="string") as string[]:[];
    const pool=atlasExecutionPool(approvedPools);
    const opportunityId=typeof provenance.opportunityId==="string"?provenance.opportunityId:"";
    const decisionId=typeof candidate.metadata?.decisionId==="string"?candidate.metadata.decisionId:"";
    if(!pool||!opportunityId||!decisionId)continue;

    const compact=normalize(candidate.symbol);
    const sharedPosition=brokerPositions.some(p=>normalize(p.symbol)===compact&&Math.abs(numeric(p.qty)??0)>0);
    const sharedOrder=brokerOrders.some(o=>normalize((o as {symbol?:string}).symbol)===compact);
    if(sharedPosition||sharedOrder)continue;

    const assetResult=await broker(`assets/${encodeURIComponent(candidate.symbol)}`);
    if(!assetResult.response.ok)continue;
    const asset=assetResult.body as BrokerAsset;
    const brokerAssetVerified=asset.class==="us_equity"&&asset.status==="active"
      &&asset.tradable===true&&asset.fractionable===true&&normalize(asset.symbol)===compact;
    if(!brokerAssetVerified)continue;

    const marketUrl=new URL("/api/paper-trading/market-data",request.url);
    marketUrl.searchParams.set("stocks",candidate.symbol);
    marketUrl.searchParams.set("crypto","");
    const marketResponse=await readOnlyMarketSnapshot(new Request(marketUrl));
    if(!marketResponse.ok)continue;
    const market=await marketResponse.json() as MarketSnapshot;
    const quote=market.stocks?.[candidate.symbol];
    const quoteAt=quote?.timestamp?Date.parse(quote.timestamp):NaN;
    const quoteAgeMs=Number.isFinite(quoteAt)?Date.now()-quoteAt:null;
    const execution=buildAtlasStockExecutionPlan({
      ask:quote?.ask??null,quoteAgeMs,referencePlan:plan,cash,poolRemaining,fractionable:asset.fractionable===true,
    });
    if(!execution.executable||!execution.quantity||!execution.requestedNotional||!execution.maxEntryPrice
       ||!execution.plannedRiskDollars)continue;

    const preflight={
      symbol:candidate.symbol,assetClass:"stock",brokerAssetVerified:true,marketSessionOpen:true,
      quoteFresh:true,sharedSymbolClear:true,triggerReached:true,noChase:true,quoteAt:quote?.timestamp??null,
      brokerAssetId:asset.id??null,brokerClass:asset.class??null,
    };
    const {data:authorized,error:authorizeError}=await db.rpc("paper_atlas_authorize_candidate",{
      p_decision_id:decisionId,p_opportunity_id:opportunityId,p_pool:pool,
      p_amount:execution.requestedNotional,p_preflight:preflight,
    });
    if(authorizeError||authorized!==true)continue;

    const {data:reservation,error:reservationError}=await db.rpc("paper_atlas_reserve",{
      p_decision_id:decisionId,p_opportunity_id:opportunityId,p_pool:pool,
      p_amount:execution.requestedNotional,p_expected_bot:BOT_ID,
    });
    const reservationData=reservation&&typeof reservation==="object"?reservation as Record<string,unknown>:null;
    const reservationId=typeof reservationData?.reservationId==="string"?reservationData.reservationId:null;
    if(reservationError||reservationData?.reserved!==true||!reservationId)continue;

    const clientOrderId=createPaperClientOrderId(BOT_ID,STRATEGY_VERSION,crypto.randomUUID());
    const expiresAt=new Date(Date.now()+5*60_000).toISOString();
    const orderMetadata={
      paperOnly:true,purpose:"entry",atlasReservationId:reservationId,decisionId,opportunityId,
      authorizationPreflight:preflight,quoteAt:quote?.timestamp??null,executionMode:"atlas-stock-bracket-v1",
    };
    const {error:insertError}=await db.from("paper_bot_orders").insert({
      client_order_id:clientOrderId,bot_id:BOT_ID,strategy_id:STRATEGY_ID,strategy_version:STRATEGY_VERSION,
      symbol:candidate.symbol,asset_class:"stock",side:"buy",status:"prepared",
      requested_notional:execution.requestedNotional,requested_quantity:execution.quantity,pool_id:pool,
      entry_trigger:plan.entryTrigger,max_entry_price:execution.maxEntryPrice,protective_stop:plan.stopPrice,
      planned_risk_dollars:execution.plannedRiskDollars,expires_at:expiresAt,
      stage_reason:"Atlas v1 multi-day PAPER entry authorized from current decision evidence.",
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
      client_order_id:clientOrderId,broker_order_id:null,status:"prepared",symbol:candidate.symbol,
      requested_notional:execution.requestedNotional,requested_quantity:execution.quantity,pool_id:pool,
      max_entry_price:execution.maxEntryPrice,protective_stop:plan.stopPrice,take_profit_price:plan.exitPrice,
      expires_at:expiresAt,metadata:orderMetadata,
    };

    try{
      const observed=await submitBracket(prepared);
      const protection=protectionSummary(observed);
      const status=mappedStatus(observed.status);
      const filledQty=numeric(observed.filled_qty)??0;
      const now=new Date().toISOString();
      const metadata={...orderMetadata,brokerObservedStatus:observed.status??status,
        filledQuantityObserved:filledQty,filledAveragePriceObserved:numeric(observed.filled_avg_price),
        bracketAccepted:protection.bracketAccepted,takeProfitLegObserved:protection.takeProfitObserved,
        stopLossLegObserved:protection.stopLossObserved,brokerLookupPending:false,protectionValidatedAt:now};
      await db.from("paper_bot_orders").update({
        broker_order_id:observed.id??null,status,last_reconciled_at:now,submitted_at:now,metadata,updated_at:now,
      }).eq("client_order_id",clientOrderId).eq("bot_id",BOT_ID);

      if(status==="filled"){
        await db.rpc("paper_atlas_consume",{p_reservation_id:reservationId,p_client_order_id:clientOrderId});
      }
      const protectionVerified=protection.bracketAccepted&&protection.takeProfitObserved&&protection.stopLossObserved;
      return reply({ok:protectionVerified,paperOnly:true,action:"submitted",symbol:candidate.symbol,
        pool,clientOrderId,reservationId,status,filledQty,protection,audit:auditBody},
        protectionVerified?200:503);
    }catch(error){
      await db.from("paper_bot_orders").update({
        status:"submitted",metadata:{...orderMetadata,brokerLookupPending:true,
          executionError:error instanceof Error?error.message.slice(0,180):"Broker outcome unconfirmed."},
        updated_at:new Date().toISOString(),
      }).eq("client_order_id",clientOrderId).eq("bot_id",BOT_ID);
      return reply({error:"Atlas broker outcome is unconfirmed; the same client-order ID will be reconciled before any retry.",
        paperOnly:true,clientOrderId,reservationId,symbol:candidate.symbol},502);
    }
  }

  return reply({ok:true,paperOnly:true,action:"none",reason:"no-executable-multi-day-stock",audit:auditBody});
}
