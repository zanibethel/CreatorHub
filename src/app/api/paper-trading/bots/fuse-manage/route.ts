import { NextResponse } from "next/server";
import { z } from "zod";
import { FUSE_PENNY_STRATEGY_V1 as cfg } from "@/lib/paper-fuse-strategy-config";
import { parsePaperClientOrderId } from "@/lib/paper-order-attribution";
import { auditFuseBrokerBracket, type FuseBrokerParent, type FuseBrokerLeg } from "@/lib/paper-fuse-protection-audit";
import { chooseFuseExitAction, FUSE_ACTIVE_PAPER_ORDER_STATUSES as active,
  fuseExitWindow, fuseFlattenOrderId } from "@/lib/paper-fuse-exit-manager";

export const dynamic="force-dynamic";
const URL=process.env.NEXT_PUBLIC_SUPABASE_URL||"https://yufptpfiwdbzzrvhkvux.supabase.co";
const API="https://paper-api.alpaca.markets/v2";
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{"Cache-Control":"no-store"}});
const entrySchema=z.object({
  client_order_id:z.string(),symbol:z.string(),side:z.literal("buy"),status:z.string(),
  broker_order_id:z.string().nullable(),requested_quantity:z.coerce.number().nullable(),
  entry_trigger:z.coerce.number().nullable(),max_entry_price:z.coerce.number().nullable(),
  protective_stop:z.coerce.number().nullable(),take_profit_price:z.coerce.number().nullable(),
});
const positionSchema=z.object({symbol:z.string(),qty:z.string(),qty_available:z.string().optional()});
const virtualSchema=z.object({bot_id:z.string(),symbol:z.string(),quantity:z.coerce.number()});
const orderSchema=z.object({
  id:z.string(),client_order_id:z.string(),symbol:z.string(),side:z.string(),
  status:z.string(),type:z.string(),order_class:z.string().optional(),
  time_in_force:z.string().optional(),qty:z.string().optional(),
  filled_qty:z.string().optional(),limit_price:z.string().nullable().optional(),
  stop_price:z.string().nullable().optional(),legs:z.array(z.unknown()).nullable().optional(),
}).passthrough();
const sellSchema=z.object({
  client_order_id:z.string(),bot_id:z.string(),symbol:z.string(),side:z.string(),
  status:z.string(),broker_order_id:z.string().nullable(),
  metadata:z.record(z.string(),z.unknown()),
});
type BrokerOrder=z.infer<typeof orderSchema>;
type Entry=z.infer<typeof entrySchema>;

function shares(value:unknown):number|null {
  if(typeof value!=="string"&&typeof value!=="number")return null;
  if(!/^\d+(?:\.\d+)?$/.test(String(value)))return null;
  const n=Number(value);
  return Number.isSafeInteger(n)&&n>=0?n:null;
}
function status(value:string){
  return ["filled","partially_filled","rejected","canceled","expired","replaced"].includes(value)?
    value:"submitted";
}
/**
 * PAPER-only Fuse emergency close manager.
 * Does not authorize BUY orders. All destructive broker operations require
 * exclusive Fuse attribution, exact virtual share matching, open market
 * and a second broker confirmation. Unconfirmed cancellation stops further
 * processing until a later cron run.
 */
export async function GET(request:Request){
  const cron=process.env.CRON_SECRET?.trim()??"";
  if(!cron||request.headers.get("authorization")!=="Bearer "+cron)
    return reply({error:"Unauthorized."},401);
  const secret=process.env.SUPABASE_SECRET_KEY?.trim()??"";
  const key=process.env.ALPACA_API_KEY_ID?.trim()??"";
  const apiSecret=process.env.ALPACA_API_SECRET_KEY?.trim()??"";
  if(!secret||!key||!apiSecret)return reply({error:"Fuse manager PAPER dependencies missing."},503);
  const dh:Record<string,string>={apikey:secret,"Content-Type":"application/json",Accept:"application/json"};
  if(secret.startsWith("eyJ"))dh.Authorization="Bearer "+secret;
  const bh={"APCA-API-KEY-ID":key,"APCA-API-SECRET-KEY":apiSecret,
    "Content-Type":"application/json",Accept:"application/json"};
  const db=async(path:string,method:"GET"|"POST"|"PATCH"="GET",body?:unknown,prefer?:string)=>{
    const r=await fetch(URL+"/rest/v1/"+path,{
      method,headers:{...dh,...(prefer?{Prefer:prefer}:{})},
      ...(body===undefined?{}:{body:JSON.stringify(body)}),cache:"no-store",signal:AbortSignal.timeout(12_000),
    });
    if(!r.ok)throw Error("Fuse storage "+method+" HTTP "+r.status);
    const t=await r.text();return t?JSON.parse(t) as unknown:null;
  };
  const broker=async(path:string,method:"GET"|"DELETE"|"POST"="GET",body?:unknown)=>{
    const r=await fetch(API+"/"+path,{
      method,headers:bh,...(body===undefined?{}:{body:JSON.stringify(body)}),
      cache:"no-store",signal:AbortSignal.timeout(12_000),
    });
    const t=await r.text();let value:unknown=null;
    try{value=t?JSON.parse(t):null;}catch{}
    return {ok:r.ok,status:r.status,value};
  };
  const readBroker=async(path:string)=>{
    const r=await broker(path);if(!r.ok)throw Error("Fuse broker GET HTTP "+r.status);
    return r.value;
  };
  const allPositions=async()=>z.array(positionSchema).parse(await readBroker("positions"));
  const allOpen=async()=>z.array(orderSchema).parse(await readBroker("orders?status=open&limit=500&nested=false"));
  const byClient=async(id:string)=>{
    const r=await broker("orders:by_client_order_id?client_order_id="+encodeURIComponent(id));
    if(r.status===404)return null;
    if(!r.ok)throw Error("Fuse flatten broker attribution lookup HTTP "+r.status);
    return orderSchema.parse(r.value);
  };
  const patch=async(id:string,update:Record<string,unknown>)=>{
    await db("paper_bot_orders?bot_id=eq."+cfg.botProfileId+
      "&client_order_id=eq."+encodeURIComponent(id),"PATCH",
      {...update,updated_at:new Date().toISOString()},"return=minimal");
  };
  const ensureFlatten=async(entry:Entry,quantity:number)=>{
    const id=fuseFlattenOrderId(entry.client_order_id);
    if(!id)throw Error("Invalid Fuse emergency order attribution.");
    const path="paper_bot_orders?bot_id=eq."+cfg.botProfileId+
      "&client_order_id=eq."+encodeURIComponent(id);
    const existing=z.array(sellSchema).parse(await db(path+
      "&select=client_order_id,bot_id,symbol,side,status,broker_order_id,metadata&limit=1"));
    if(!existing.length){
      await db("paper_bot_orders?on_conflict=client_order_id","POST",{
        client_order_id:id,bot_id:cfg.botProfileId,strategy_id:cfg.id,
        strategy_version:cfg.version,symbol:entry.symbol,asset_class:"stock",
        side:"sell",status:"prepared",broker_order_id:null,requested_quantity:quantity,pool_id:"day",
        metadata:{paperOnly:true,reason:"fuse-emergency-or-session-close",
          parentClientOrderId:entry.client_order_id,
          manualRetryRequiredOnAmbiguity:true},
      },"resolution=ignore-duplicates,return=minimal");
    }
    const local=z.array(sellSchema).parse(await db(path+
      "&select=client_order_id,bot_id,symbol,side,status,broker_order_id,metadata&limit=1"))[0];
    if(!local||local.symbol!==entry.symbol||local.side!=="sell"||
      local.metadata.parentClientOrderId!==entry.client_order_id)
      throw Error("Fuse flatten ownership does not match entry.");
    const already=await byClient(id);
    if(already){
      if(already.symbol!==entry.symbol||already.side!=="sell"||already.type!=="market")
        throw Error("Fuse broker flatten order is not the expected market sell.");
      await patch(id,{broker_order_id:already.id,status:status(already.status)});
      return "broker-flatten-"+already.status;
    }
    // At-most-once broker POST. After a claimed or ambiguous first submit,
    // lack of broker acknowledgement requires manual review, never retry.
    if(local.status!=="prepared"||local.broker_order_id)return "flatten-unconfirmed-no-retry";
    const claimed=z.array(sellSchema).parse(await db(path+
      "&status=eq.prepared&broker_order_id=is.null","PATCH",{
        status:"submitted",submitted_at:new Date().toISOString(),
        metadata:{...local.metadata,submissionClaimedAt:new Date().toISOString()},
      },"return=representation"));
    if(claimed.length!==1)return "flatten-claimed-by-other-run";
    const out=await broker("orders","POST",{
      symbol:entry.symbol,side:"sell",qty:String(quantity),
      type:"market",time_in_force:"day",extended_hours:false,
      order_class:"simple",client_order_id:id,
    }).catch(()=>null);
    let observed=out?.ok?orderSchema.safeParse(out.value):null;
    if(!observed?.success){
      const lookup=await byClient(id).catch(()=>null);
      observed=lookup?orderSchema.safeParse(lookup):null;
    }
    if(observed?.success){
      const o=observed.data;
      if(o.symbol!==entry.symbol||o.side!=="sell"||o.type!=="market"||
        o.client_order_id!==id)throw Error("Fuse submitted flatten identity differs from authorized sell.");
      await patch(id,{broker_order_id:o.id,status:status(o.status)});
      return "flatten-"+o.status;
    }
    if(out&&out.status>=400&&out.status<500){
      await patch(id,{status:"rejected",metadata:{...local.metadata,
        brokerRejectStatus:out.status,manualRetryRequiredOnAmbiguity:true}});
      return "flatten-rejected";
    }
    return "flatten-outcome-ambiguous-no-retry";
  };

  try{
    const clock=z.object({is_open:z.boolean()}).parse(await readBroker("clock"));
    const session=fuseExitWindow(Date.now());
    const flattenDue=clock.is_open&&session.regularClockMinute&&session.entryCutoff;
    const [entriesRaw,virtualRaw,positions,open]=await Promise.all([
      db("paper_bot_orders?bot_id=eq."+cfg.botProfileId+
        "&side=eq.buy&status=in.(submitted,partially_filled,filled)"+
        "&select=client_order_id,symbol,side,status,broker_order_id,requested_quantity,entry_trigger,max_entry_price,protective_stop,take_profit_price&order=created_at.desc&limit=75"),
      db("paper_bot_positions?quantity=gt.0&select=bot_id,symbol,quantity&limit=500"),
      allPositions(),allOpen(),
    ]);
    const entries=z.array(entrySchema).parse(entriesRaw);
    const virtual=z.array(virtualSchema).parse(virtualRaw);
    const decisions:Array<{symbol:string;action:string;detail?:string}>=[];
    const parentIds=new Set(entries.map(e=>e.broker_order_id).filter(Boolean));
    const orphan=open.filter(o=>o.client_order_id.startsWith("chb-pny-v")&&
      !parentIds.has(o.id)&&!entries.some(e=>fuseFlattenOrderId(e.client_order_id)===o.client_order_id));
    if(orphan.length)return reply({ok:false,paperOnly:true,executionEnabled:false,
      error:"Unrecognized active Fuse-tagged broker order; manual venue reconciliation required.",
      orphanClientOrderIds:orphan.map(o=>o.client_order_id)},503);
    for(const entry of entries){
      const symbol=entry.symbol;
      try{
        const attribution=parsePaperClientOrderId(entry.client_order_id);
        if(!attribution||attribution.botId!==cfg.botProfileId||attribution.strategyVersion!==cfg.version||
          !entry.broker_order_id)throw Error("Fuse entry cannot be attributed to its broker parent.");
        if(entries.filter(e=>e.symbol===symbol).length!==1)
          throw Error("Multiple Fuse entries share the physical broker symbol.");
        if(virtual.some(v=>v.symbol===symbol&&v.bot_id!==cfg.botProfileId))
          throw Error("Other virtual bot holds this physical broker symbol.");
        const current=positions.find(p=>p.symbol===symbol)??null;
        const owned=shares(current?.qty??"0");
        const mine=virtual.filter(v=>v.bot_id===cfg.botProfileId&&v.symbol===symbol);
        if(owned===null||mine.length>1)throw Error("Fuse shares cannot be reconciled.");
        const virtualQty=mine[0]?.quantity??0;
        const raw=orderSchema.parse(await readBroker("orders/"+encodeURIComponent(entry.broker_order_id)+"?nested=true"));
        if(raw.client_order_id!==entry.client_order_id||raw.id!==entry.broker_order_id||
          raw.symbol!==symbol||raw.side!=="buy"||raw.order_class!=="bracket"||
          raw.type!=="limit"||raw.time_in_force!=="day")
          throw Error("Broker parent order attribution/type does not match Fuse plan.");
        const children=Array.isArray(raw.legs)?await Promise.all(raw.legs.map(async child=>{
          const id=z.object({id:z.string()}).parse(child).id;
          return orderSchema.parse(await readBroker("orders/"+encodeURIComponent(id)));
        })):[];
        if(children.some(ch=>ch.symbol!==symbol||ch.side!=="sell"))
          throw Error("Bracket child identity mismatch.");
        const parent:FuseBrokerParent={...raw,legs:children as FuseBrokerLeg[]};
        const filled=shares(raw.filled_qty??"0");
        if(filled===null)throw Error("Invalid parent filled quantity.");
        const expectedIds=new Set([raw.id,...children.map(c=>c.id)]);
        const foreign=open.some(o=>o.symbol===symbol&&!expectedIds.has(o.id)&&
          fuseFlattenOrderId(entry.client_order_id)!==o.client_order_id);
        const sellOpen=open.filter(o=>o.symbol===symbol&&o.side==="sell");
        const protection=auditFuseBrokerBracket({
          entry,parent,brokerPosition:current,otherBotOwnsSymbol:foreign,
          liveSellOrders:[...sellOpen,...children] as FuseBrokerLeg[],
        });
        const entryPending=active.has(raw.status)&&filled<(shares(raw.qty??"0")??0);
        const stopOrTargetActive=children.some(c=>c.side==="sell"&&active.has(c.status));
        const decision=chooseFuseExitAction({
          marketOpen:clock.is_open,regularClockMinute:session.regularClockMinute,
          flattenDue,brokerQty:owned,virtualQty,entryFilledQty:filled,
          entryPending,stopOrTargetActive,foreignSymbolOrder:foreign,
          parentVerified:true,protection,
        });
        if(decision.action==="cancel-pending-entry"){
          if(["pending_cancel","pending_replace"].includes(raw.status)){
            decisions.push({symbol,action:"awaiting-broker-parent-cancel"});continue;
          }
          const cancel=await broker("orders/"+encodeURIComponent(raw.id),"DELETE");
          if(!cancel.ok&&cancel.status!==404)throw Error("Fuse parent cancel returned HTTP "+cancel.status);
          decisions.push({symbol,action:"entry-cancel-requested",detail:"Revalidate parent and position on next cron pass."});
        }else if(decision.action==="cancel-bracket-exits"){
          if(children.some(c=>["pending_cancel","pending_replace"].includes(c.status))){
            decisions.push({symbol,action:"awaiting-broker-oco-cancel",
              detail:"Do not re-request a pending cancel or send a new sell."});continue;
          }
          // One child cancel should cancel OCO siblings; never submit a sell
          // in the same pass. Only cancel independently fetched child ids.
          const activeChildren=children.filter(c=>c.side==="sell"&&active.has(c.status));
          if(activeChildren.length===0)throw Error("No attributable active child to cancel.");
          const cancellation=await broker("orders/"+encodeURIComponent(activeChildren[0].id),"DELETE");
          if(!cancellation.ok&&cancellation.status!==404)
            throw Error("Fuse OCO cancel returned HTTP "+cancellation.status);
          decisions.push({symbol,action:"oco-cancel-requested",detail:"No separate flatten until broker confirms all sibling orders closed."});
        }else if(decision.action==="flatten-ready"){
          if(open.some(o=>o.symbol===symbol&&active.has(o.status))){
            decisions.push({symbol,action:"manual-reconciliation",detail:"An open broker order remains before flatten."});continue;
          }
          // Second broker read closes the window for stale position/venue data.
          const [nowPositions,nowOpen]=await Promise.all([allPositions(),allOpen()]);
          const nowQty=shares(nowPositions.find(p=>p.symbol===symbol)?.qty??"0");
          if(nowQty!==owned||nowQty!==virtualQty||!current||
            nowOpen.some(o=>o.symbol===symbol&&active.has(o.status))){
            decisions.push({symbol,action:"manual-reconciliation",detail:"Broker holdings/orders changed before flatten."});continue;
          }
          // A previously submitted exit must never be duplicated.
          decisions.push({symbol,action:await ensureFlatten(entry,owned)});
        }else{
          decisions.push({symbol,action:decision.action,detail:decision.reason});
        }
      }catch(error){
        decisions.push({symbol,action:"manual-reconciliation",
          detail:error instanceof Error?error.message:"Fuse protection management failed."});
      }
    }
    const critical=decisions.some(x=>/manual|unconfirmed|rejected|ambiguous|claimed-by-other/.test(x.action));
    return reply({ok:!critical,paperOnly:true,executionEnabled:false,
      buySubmissionsImplemented:false,marketOpen:clock.is_open,flattenDue,
      managedEntries:entries.length,decisions},critical?503:200);
  }catch(error){
    return reply({ok:false,paperOnly:true,executionEnabled:false,
      error:error instanceof Error?error.message:"Fuse manager unavailable."},503);
  }
}
