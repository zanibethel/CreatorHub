import {withPaperCronHeartbeat} from "@/lib/paper-cron-health";
import { NextResponse } from "next/server";
import { z } from "zod";
import { pulseCompanionClientOrderId } from "@/lib/paper-pulse-fractional";
import { MOMENTUM_BREAKOUT_STRATEGY_V1 as strategy } from "@/lib/paper-momentum-breakout-strategy-config";

export const dynamic="force-dynamic";
const API="https://paper-api.alpaca.markets/v2";
const URL=process.env.NEXT_PUBLIC_SUPABASE_URL||"https://yufptpfiwdbzzrvhkvux.supabase.co";
const activeStatuses=new Set(["accepted","new","partially_filled","pending_new","accepted_for_bidding","held","pending_cancel","pending_replace"]);
// A stop being canceled or replaced is NOT verified broker protection.
const confirmedStopStatuses=new Set(["accepted","new","partially_filled","pending_new","accepted_for_bidding","held"]);
const orderSchema=z.object({
  client_order_id:z.string(),broker_order_id:z.string().nullable(),symbol:z.string(),
  side:z.enum(["buy","sell"]),status:z.string(),requested_quantity:z.coerce.number().nullable(),
  protective_stop:z.coerce.number().nullable(),metadata:z.record(z.string(),z.unknown()),
});
type LocalOrder=z.infer<typeof orderSchema>;
type BrokerOrder={id?:string;client_order_id?:string;symbol?:string;side?:string;
  type?:string;status?:string;qty?:string;filled_qty?:string;stop_price?:string|null};
type BrokerPosition={symbol?:string;qty?:string;qty_available?:string};
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{"Cache-Control":"no-store"}});
const numeric=(v:unknown)=>{const n=Number(v);return Number.isFinite(n)?n:null;};
const qty9=(v:number)=>Math.floor(v*1e9+0.0000001)/1e9;
const qtyString=(v:number)=>v.toFixed(9).replace(/0+$/,"").replace(/\.$/,"");
const stopPrice=(v:number)=>Number(v.toFixed(v>=1?2:6));
function etMinute(now:number){
  const parts=new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",
    hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date(now));
  const p=Object.fromEntries(parts.map(row=>[row.type,row.value]));
  return Number(p.hour)*60+Number(p.minute);
}
function mapped(status:string|undefined){
  return ["filled","partially_filled","rejected","canceled","expired","replaced"].includes(status??"")
    ? status : "submitted";
}
/**
 * Manages only Pulse's own broker-attributed orders. Never cancels or replaces
 * other bots' protective sells, and never retries an ambiguous submission.
 */
async function runPaperCron(request:Request){
  const cron=process.env.CRON_SECRET?.trim()??"";
  if(!cron||request.headers.get("authorization")!==`Bearer ${cron}`)return reply({error:"Unauthorized"},401);
  const key=process.env.ALPACA_API_KEY_ID?.trim()??"",secret=process.env.ALPACA_API_SECRET_KEY?.trim()??"";
  const sb=process.env.SUPABASE_SECRET_KEY?.trim()??"";
  if(!key||!secret||!sb)return reply({error:"Pulse manager dependencies missing."},503);
  const brokerHeaders={"APCA-API-KEY-ID":key,"APCA-API-SECRET-KEY":secret,
    "Content-Type":"application/json",Accept:"application/json"};
  const dbHeaders:Record<string,string>={apikey:sb,"Content-Type":"application/json",Accept:"application/json"};
  if(sb.startsWith("eyJ"))dbHeaders.Authorization=`Bearer ${sb}`;
  const db=async(path:string,method:"GET"|"POST"|"PATCH"="GET",body?:unknown,prefer?:string)=>{
    const response=await fetch(`${URL}/rest/v1/${path}`,{
      method,headers:{...dbHeaders,...(prefer?{Prefer:prefer}:{})},
      ...(body===undefined?{}:{body:JSON.stringify(body)}),cache:"no-store",signal:AbortSignal.timeout(12_000),
    });
    if(!response.ok)throw new Error(`Pulse store ${method} ${response.status}`);
    const t=await response.text();return t?JSON.parse(t) as unknown:null;
  };
  const broker=async(path:string,method:"GET"|"POST"|"DELETE"="GET",body?:unknown)=>{
    const response=await fetch(`${API}/${path}`,{
      method,headers:brokerHeaders,...(body===undefined?{}:{body:JSON.stringify(body)}),
      cache:"no-store",signal:AbortSignal.timeout(10_000),
    });
    const t=await response.text();
    const payload=t?JSON.parse(t) as unknown:null;
    return {response,payload};
  };
  const allOpen=async()=>{
    const {response,payload}=await broker("orders?status=open&limit=500&nested=false");
    if(!response.ok||!Array.isArray(payload)||payload.length>=500)
      throw Error("Pulse shared PAPER broker open-order ownership scan incomplete.");
    return z.array(z.object({
      id:z.string(),client_order_id:z.string(),symbol:z.string(),
      side:z.enum(["buy","sell"]),status:z.string(),
    }).passthrough()).parse(payload);
  };
  const byClient=async(id:string)=>{
    const {response,payload}=await broker(`orders:by_client_order_id?client_order_id=${encodeURIComponent(id)}`);
    if(response.status===404)return null;
    if(!response.ok)throw Error(`Pulse broker lookup ${response.status}`);
    return payload as BrokerOrder;
  };
  const patch=async(id:string,body:Record<string,unknown>)=>{
    await db(`paper_bot_orders?bot_id=eq.${strategy.botProfileId}&client_order_id=eq.${encodeURIComponent(id)}`,
      "PATCH",{...body,updated_at:new Date().toISOString()},"return=minimal");
  };
  const companion=async(entry:LocalOrder,purpose:"stop"|"flatten",quantity:number,price:number|null)=>{
    const id=pulseCompanionClientOrderId(entry.client_order_id,purpose);
    if(!id)throw Error("Pulse entry attribution is not valid.");
    const existing=z.array(orderSchema).parse(await db(
      `paper_bot_orders?bot_id=eq.${strategy.botProfileId}&client_order_id=eq.${encodeURIComponent(id)}&select=client_order_id,broker_order_id,symbol,side,status,requested_quantity,protective_stop,metadata&limit=1`));
    let local=existing[0];
    if(!local){
      await db("paper_bot_orders?on_conflict=client_order_id","POST",{
        client_order_id:id,bot_id:strategy.botProfileId,strategy_id:strategy.id,
        strategy_version:strategy.version,symbol:entry.symbol,asset_class:"stock",
        side:"sell",status:"prepared",requested_quantity:quantity,pool_id:"day",
        protective_stop:price,
        metadata:{paperOnly:true,executionMode:"paper-fractional-simple-v1",
          purpose:purpose==="stop"?"protective-stop":"session-flatten",
          parentClientOrderId:entry.client_order_id},
      },"resolution=ignore-duplicates,return=minimal");
      local=z.array(orderSchema).parse(await db(
        `paper_bot_orders?bot_id=eq.${strategy.botProfileId}&client_order_id=eq.${encodeURIComponent(id)}&select=client_order_id,broker_order_id,symbol,side,status,requested_quantity,protective_stop,metadata&limit=1`))[0];
    }
    if(!local||local.side!=="sell"||local.symbol!==entry.symbol||
      local.metadata.parentClientOrderId!==entry.client_order_id)
      throw Error("Pulse companion ownership or attribution mismatch.");
    let observed:BrokerOrder|null=await byClient(id);
    if(observed?.id) {
      if(observed.client_order_id!==id||observed.symbol!==entry.symbol||
         observed.side!=="sell"||
         (purpose==="stop"&&observed.type!=="stop")||
         (purpose==="flatten"&&observed.type!=="market"))
        throw Error("Pulse broker companion attribution or order type mismatch.");
      await patch(id,{broker_order_id:observed.id,status:mapped(observed.status),
        submitted_at:new Date().toISOString(),
        metadata:{...local.metadata,brokerLookupPending:false,brokerObservedStatus:observed.status}});
      return {status:observed.status??"submitted",id,order:observed};
    }
    // Never retry if a previous process claimed this order. A timeout is
    // indistinguishable from a broker-side acceptance until reconciled.
    if(local.status!=="prepared"||local.broker_order_id)return {status:"unconfirmed",id,order:null};
    const claim=z.array(orderSchema).parse(await db(
      `paper_bot_orders?bot_id=eq.${strategy.botProfileId}&client_order_id=eq.${encodeURIComponent(id)}&status=eq.prepared&broker_order_id=is.null`,
      "PATCH",{status:"submitted",submitted_at:new Date().toISOString(),
        metadata:{...local.metadata,brokerLookupPending:true,claimedBy:"pulse-protection-manager"}},
      "return=representation"));
    if(claim.length!==1)return {status:"claimed-by-another-run",id,order:null};
    const payload={symbol:entry.symbol,side:"sell",qty:qtyString(quantity),type:purpose==="stop"?"stop":"market",
      time_in_force:"day",extended_hours:false,order_class:"simple",client_order_id:id,
      ...(purpose==="stop"&&price!==null?{stop_price:String(stopPrice(price))}:{})};
    let explicitReject=false;let error="";
    try{
      const submitted=await broker("orders","POST",payload);
      if(submitted.response.ok)observed=submitted.payload as BrokerOrder;
      else if(submitted.response.status>=400&&submitted.response.status<500){
        explicitReject=true;error=`Broker rejected ${purpose} HTTP ${submitted.response.status}`;
      }
    }catch{error="Broker submission returned no confirmed response.";}
    if(!observed?.id)observed=await byClient(id).catch(()=>null);
    if(!observed?.id){
      await patch(id,{status:explicitReject?"rejected":"submitted",metadata:{...local.metadata,
        brokerLookupPending:!explicitReject,executionError:error||"Order outcome uncertain"}});
      return {status:explicitReject?"rejected":"unconfirmed",id,order:null};
    }
    if(observed.client_order_id!==id||observed.symbol!==entry.symbol||observed.side!=="sell"||
       (purpose==="stop"&&observed.type!=="stop")||
       (purpose==="flatten"&&observed.type!=="market"))
      throw Error("Pulse submitted companion identity or type mismatch.");
    await patch(id,{broker_order_id:observed.id,status:mapped(observed.status),submitted_at:new Date().toISOString(),
      metadata:{...local.metadata,brokerLookupPending:false,brokerObservedStatus:observed.status}});
    return {status:observed.status??"submitted",id,order:observed};
  };

  const outcome:Array<{symbol:string;action:string;detail?:string}>=[];
  try{
    const clock=await broker("clock");
    if(!clock.response.ok)throw Error("Paper exchange clock unavailable.");
    const marketOpen=(clock.payload as {is_open?:boolean})?.is_open===true;
    const minute=etMinute(Date.now());
    const flattenDue=marketOpen&&minute>=15*60+40;
    const positionsRaw=await broker("positions");
    if(!positionsRaw.response.ok)throw Error("Broker positions unavailable.");
    const positions=positionsRaw.payload as BrokerPosition[];
    if(!Array.isArray(positions)||positions.length>=500)
      throw Error("Broker positions malformed or pagination cap reached.");
    const others=z.array(z.object({bot_id:z.string(),symbol:z.string(),quantity:z.coerce.number()}))
      .parse(await db(`paper_bot_positions?bot_id=neq.${strategy.botProfileId}&quantity=gt.0&select=bot_id,symbol,quantity`));
    const entries=z.array(orderSchema).parse(await db(
      `paper_bot_orders?bot_id=eq.${strategy.botProfileId}&side=eq.buy&status=in.(submitted,partially_filled,filled)&select=client_order_id,broker_order_id,symbol,side,status,requested_quantity,protective_stop,metadata&order=created_at.desc&limit=60`))
      .filter(row=>row.metadata.executionMode==="paper-fractional-simple-v1");
    if(entries.length>=60||others.length>=500)
      throw Error("Pulse paper ownership scan exceeded its safe pagination limit.");
    for(const entry of entries){
      const symbol=entry.symbol;
      try {
        if(others.some(row=>row.symbol===symbol)){
          outcome.push({symbol,action:"manual-reconciliation",detail:"another bot shares the broker symbol"});continue;
        }
        const stopId=pulseCompanionClientOrderId(entry.client_order_id,"stop");
        const flattenId=pulseCompanionClientOrderId(entry.client_order_id,"flatten");
        if(!stopId||!flattenId)throw Error("Pulse order attribution invalid.");
        const knownIds=new Set([entry.client_order_id,stopId,flattenId]);
        const openOrders=await allOpen();
        if(openOrders.some(o=>o.symbol===symbol&&!knownIds.has(o.client_order_id))){
          outcome.push({symbol,action:"manual-reconciliation",
            detail:"Unattributed open PAPER broker order occupies Pulse's physical symbol."});continue;
        }
        const buy=await byClient(entry.client_order_id);
        if(!buy?.id){outcome.push({symbol,action:"broker-buy-unconfirmed"});continue;}
        if(buy.client_order_id!==entry.client_order_id||buy.symbol!==symbol||buy.side!=="buy")
          throw Error("Entry broker attribution mismatch.");
        if(buy.status==="pending_cancel"){
          outcome.push({symbol,action:"awaiting-partial-entry-cancel"});continue;
        }
        if(buy.status==="pending_replace"){
          outcome.push({symbol,action:"manual-reconciliation",
            detail:"Entry replacement pending; cannot prove final fill quantity."});continue;
        }
        let qtyFilled=numeric(buy.filled_qty)??0;
        if(qtyFilled<=0) {
          if(flattenDue&&activeStatuses.has(buy.status??"")){
            await broker(`orders/${encodeURIComponent(buy.id)}`,"DELETE");
            outcome.push({symbol,action:"cancel-pending-entry-near-close"});
          }else outcome.push({symbol,action:"awaiting-entry-fill"});
          continue;
        }
        let position=positions.find(p=>p.symbol===symbol);
        if(activeStatuses.has(buy.status??"")){
          if(buy.status==="pending_cancel"){
            outcome.push({symbol,action:"awaiting-partial-entry-cancel"});continue;
          }
          if(buy.status==="pending_replace"){
            outcome.push({symbol,action:"manual-reconciliation",
              detail:"Entry replacement pending; cannot prove final fill quantity."});continue;
          }
          const cancel=await broker(`orders/${encodeURIComponent(buy.id)}`,"DELETE");
          if(!cancel.response.ok&&cancel.response.status!==404){
            outcome.push({symbol,action:"unconfirmed-partial-cancel"});continue;
          }
          const after=await byClient(entry.client_order_id);
          if(!after||after.id!==buy.id||after.client_order_id!==entry.client_order_id||
             activeStatuses.has(after.status??"")){
            outcome.push({symbol,action:"awaiting-partial-entry-cancel"});continue;
          }
          // An in-flight fill can increase filled_qty while the remaining
          // shares are being canceled. Never size protection from the stale
          // pre-cancel fill/position snapshot.
          const finalFilled=numeric(after.filled_qty);
          if(finalFilled===null||finalFilled+1e-8<qtyFilled){
            outcome.push({symbol,action:"manual-reconciliation",detail:"Final broker filled quantity cannot be confirmed."});continue;
          }
          qtyFilled=finalFilled;
          const refreshed=await broker("positions");
          if(!refreshed.response.ok||!Array.isArray(refreshed.payload)){
            outcome.push({symbol,action:"post-cancel-position-unconfirmed"});continue;
          }
          position=(refreshed.payload as BrokerPosition[]).find(p=>p.symbol===symbol);
        }
        const owned=numeric(position?.qty)??0;
        let sellable=numeric(position?.qty_available)??0;
        if(owned<=0){outcome.push({symbol,action:"no-broker-position"});continue;}
        if(owned>qtyFilled+0.00000001){
          outcome.push({symbol,action:"manual-reconciliation",detail:"broker holds more than Pulse's filled quantity"});continue;
        }
        const currentStop=await byClient(stopId);
        const localStops=z.array(orderSchema).parse(await db(
          `paper_bot_orders?bot_id=eq.${strategy.botProfileId}&client_order_id=eq.${encodeURIComponent(stopId)}&select=client_order_id,broker_order_id,symbol,side,status,requested_quantity,protective_stop,metadata&limit=1`));
        const localStop=localStops[0];
        if(currentStop&&["pending_cancel","pending_replace"].includes(currentStop.status??"")){
          outcome.push({symbol,action:"stop-outcome-unconfirmed",
            detail:"Alpaca protective stop is canceling/replacing; no verified active protection."});continue;
        }
        const stopActive=currentStop&&confirmedStopStatuses.has(currentStop.status??"");
        // A confirmed 4xx rejection may leave no broker order to look up.
        // Remember that terminal local result across minute-level cron runs.
        const stopRejectedWithoutBroker=!currentStop&&localStop?.status==="rejected";
        if(!currentStop&&localStop&&!stopRejectedWithoutBroker&&localStop.status!=="prepared"){
          outcome.push({symbol,action:"stop-outcome-unconfirmed"});continue;
        }
        if(stopActive){
          const stopQty=numeric(currentStop.qty)??0;
          const stopAt=numeric(currentStop.stop_price);
          const requiredStop=numeric(entry.protective_stop);
          const identity=currentStop.client_order_id===stopId&&currentStop.symbol===symbol&&
            currentStop.side==="sell"&&currentStop.type==="stop";
          const protective=identity&&stopAt!==null&&requiredStop!==null&&requiredStop>0&&
            stopAt+0.000001>=requiredStop&&stopQty+0.00000001>=owned;
          if(!protective){
            outcome.push({symbol,action:"manual-reconciliation",
              detail:"broker stop identity, type, quantity or loss limit cannot be verified"});continue;
          }
          if(!flattenDue){
            outcome.push({symbol,action:"broker-stop-verified"});continue;
          }
        }
        if(!marketOpen) {
          outcome.push({symbol,action:"market-closed-position-needs-review"});continue;
        }
        // An expired, rejected, or canceled DAY stop cannot be silently
        // recreated using the same idempotency key. Flatten the remaining
        // position rather than pretending it is still protected.
        const priorStopTerminal=stopRejectedWithoutBroker||
          (currentStop&&["expired","rejected","canceled","filled","replaced"].includes(currentStop.status??""));
        if(stopActive&&flattenDue){
          const cancel=await broker(`orders/${encodeURIComponent(currentStop.id!)}`,"DELETE");
          if(!cancel.response.ok&&cancel.response.status!==404){
            outcome.push({symbol,action:"stop-cancel-unconfirmed"});continue;
          }
          const after=await byClient(stopId);
          if(!after||activeStatuses.has(after.status??"")){
            outcome.push({symbol,action:"stop-cancel-pending"});continue;
          }
          // The now-canceled stop may previously have reserved all shares.
          // Query Alpaca again; pre-cancel qty_available is not reliable.
          const refreshed=await broker("positions");
          if(!refreshed.response.ok||!Array.isArray(refreshed.payload)){
            outcome.push({symbol,action:"post-cancel-position-unconfirmed"});continue;
          }
          const fresh=(refreshed.payload as BrokerPosition[]).find(p=>p.symbol===symbol);
          const afterQty=numeric(fresh?.qty)??0;
          if(afterQty<=0){
            outcome.push({symbol,action:"no-position-after-stop-cancel"});continue;
          }
          if(afterQty>qtyFilled+0.00000001||Math.abs(afterQty-owned)>0.00000001){
            outcome.push({symbol,action:"manual-reconciliation",detail:"position changed during stop cancellation"});continue;
          }
          sellable=numeric(fresh?.qty_available)??0;
        }
        if(sellable<=0){
          outcome.push({symbol,action:"position-quantity-not-yet-sellable"});continue;
        }
        if(sellable+1e-8<owned){
          outcome.push({symbol,action:"manual-reconciliation",
            detail:"Not all Pulse shares are available for the required protective sell."});continue;
        }
        const lastOpen=await allOpen();
        if(lastOpen.some(o=>o.symbol===symbol&&!knownIds.has(o.client_order_id))){
          outcome.push({symbol,action:"manual-reconciliation",
            detail:"Conflicting PAPER order appeared before protection submission."});continue;
        }
        const quantity=qty9(Math.min(sellable,owned));
        if(quantity<=0)throw Error("No fractional sellable quantity.");
        if(flattenDue||priorStopTerminal) {
          const result=await companion(entry,"flatten",quantity,null);
          outcome.push({symbol,action:"session-flatten-"+result.status});
        } else if(!Number.isFinite(entry.protective_stop)||entry.protective_stop!<=0) {
          outcome.push({symbol,action:"manual-reconciliation",detail:"entry has no valid protective stop"});
        } else {
          const result=await companion(entry,"stop",quantity,entry.protective_stop);
          outcome.push({symbol,action:"protective-stop-"+result.status});
          if(result.status==="rejected"){
            const emergency=await companion(entry,"flatten",quantity,null);
            outcome.push({symbol,action:"emergency-flatten-"+emergency.status});
          }
        }
      }catch(error){
        outcome.push({symbol,action:"management-error",detail:error instanceof Error?error.message:"unknown"});
      }
    }
    const issue=outcome.some(x=>/error|unconfirmed|manual-reconciliation|closed-position|not-yet-sellable|pending|awaiting-partial-entry-cancel|rejected|claimed-by-another-run|stop-cancel|flatten-unconfirmed/.test(x.action));
    return reply({ok:!issue,paperOnly:true,entries:entries.length,marketOpen,flattenDue,outcome},issue?503:200);
  }catch(error){
    return reply({ok:false,paperOnly:true,error:error instanceof Error?error.message:"Pulse manager failed."},503);
  }
}

export const GET=withPaperCronHeartbeat({job:"pulse-manage",botId:"momentum-breakout-100",expectedMinutes:1},runPaperCron);
