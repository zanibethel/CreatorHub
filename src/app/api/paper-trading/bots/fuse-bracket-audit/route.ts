import { NextResponse } from "next/server";
import { z } from "zod";
import { auditFuseBrokerBracket, type FuseBrokerParent, type FuseBrokerLeg } from "@/lib/paper-fuse-protection-audit";
import { FUSE_PENNY_STRATEGY_V1 as cfg } from "@/lib/paper-fuse-strategy-config";

export const dynamic="force-dynamic";
const SUPABASE=process.env.NEXT_PUBLIC_SUPABASE_URL||"https://yufptpfiwdbzzrvhkvux.supabase.co";
const ALPACA="https://paper-api.alpaca.markets/v2";
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{"Cache-Control":"no-store"}});
const localSchema=z.object({
  client_order_id:z.string(),symbol:z.string(),side:z.string(),status:z.string(),
  broker_order_id:z.string().nullable(),requested_quantity:z.coerce.number().nullable(),
  entry_trigger:z.coerce.number().nullable(),max_entry_price:z.coerce.number().nullable(),
  protective_stop:z.coerce.number().nullable(),take_profit_price:z.coerce.number().nullable(),
});
const positionSchema=z.object({symbol:z.string(),qty:z.string(),qty_available:z.string().optional()});
const virtualSchema=z.object({bot_id:z.string(),symbol:z.string(),quantity:z.coerce.number()});
const openSchema=z.object({id:z.string(),client_order_id:z.string(),symbol:z.string(),side:z.string(),status:z.string(),type:z.string().optional()}).passthrough();
const brokerOrderSchema=z.object({
  id:z.string(),client_order_id:z.string(),symbol:z.string(),side:z.string(),status:z.string(),
  type:z.string(),order_class:z.string().optional(),time_in_force:z.string().optional(),
  qty:z.string().optional(),filled_qty:z.string().optional(),
  stop_price:z.string().nullable().optional(),limit_price:z.string().nullable().optional(),
  filled_avg_price:z.string().nullable().optional(),legs:z.array(z.any()).nullable().optional(),
}).passthrough();

/** Read-only PAPER venue audit; this is NOT a stop/flatten manager. */
export async function GET(request:Request){
  const cron=process.env.CRON_SECRET?.trim()??"";
  if(!cron||request.headers.get("authorization")!=="Bearer "+cron)
    return reply({error:"Unauthorized."},401);
  const service=process.env.SUPABASE_SECRET_KEY?.trim()??"";
  const key=process.env.ALPACA_API_KEY_ID?.trim()??"";
  const secret=process.env.ALPACA_API_SECRET_KEY?.trim()??"";
  if(!service||!key||!secret)return reply({error:"Fuse PAPER audit dependencies missing."},503);
  const dbHeaders:Record<string,string>={apikey:service,Accept:"application/json"};
  if(service.startsWith("eyJ"))dbHeaders.Authorization="Bearer "+service;
  const brokerHeaders={"APCA-API-KEY-ID":key,"APCA-API-SECRET-KEY":secret,Accept:"application/json"};
  const db=async(path:string)=>{
    const r=await fetch(SUPABASE+"/rest/v1/"+path,{headers:dbHeaders,cache:"no-store",signal:AbortSignal.timeout(12_000)});
    if(!r.ok)throw Error("Fuse PAPER audit database read returned HTTP "+r.status);
    return r.json() as Promise<unknown>;
  };
  const broker=async(path:string)=>{
    const r=await fetch(ALPACA+"/"+path,{headers:brokerHeaders,cache:"no-store",signal:AbortSignal.timeout(12_000)});
    if(!r.ok)throw Error("Fuse PAPER broker read returned HTTP "+r.status);
    return r.json() as Promise<unknown>;
  };
  try{
    const [entryRaw,virtualRaw,positionRaw,openRaw]=await Promise.all([
      db("paper_bot_orders?bot_id=eq."+cfg.botProfileId+
        "&side=eq.buy&status=in.(submitted,partially_filled,filled)"+
        "&select=client_order_id,symbol,side,status,broker_order_id,requested_quantity,entry_trigger,max_entry_price,protective_stop,take_profit_price&order=created_at.desc&limit=30"),
      db("paper_bot_positions?quantity=gt.0&select=bot_id,symbol,quantity&limit=500"),
      broker("positions"),broker("orders?status=open&limit=500&nested=false"),
    ]);
    const entries=z.array(localSchema).parse(entryRaw);
    const virtual=z.array(virtualSchema).parse(virtualRaw);
    const positions=z.array(positionSchema).parse(positionRaw);
    const open=z.array(openSchema).parse(openRaw);
    const outcomes=[];
    for(const entry of entries){
      const position=positions.find(p=>p.symbol===entry.symbol)??null;
      const otherOwner=virtual.some(p=>p.symbol===entry.symbol&&p.bot_id!==cfg.botProfileId);
      let parent:FuseBrokerParent|null=null;
      let verifiedChildren:FuseBrokerLeg[]=[];
      if(entry.broker_order_id){
        const raw=brokerOrderSchema.parse(await broker("orders/"+encodeURIComponent(entry.broker_order_id)+"?nested=true"));
        parent=raw as FuseBrokerParent;
        if(Array.isArray(raw.legs)){
          for(const leg of raw.legs){
            const id=z.object({id:z.string()}).parse(leg).id;
            const observed=brokerOrderSchema.parse(await broker("orders/"+encodeURIComponent(id)));
            verifiedChildren.push(observed as FuseBrokerLeg);
          }
          parent={...raw,legs:verifiedChildren};
        }
      }
      const expectedIds=new Set([entry.broker_order_id,
        ...verifiedChildren.map(child=>child.id)].filter(Boolean));
      const collidingOpen=open.some(order=>order.symbol===entry.symbol&&
        !expectedIds.has(order.id));
      outcomes.push(auditFuseBrokerBracket({
        entry,parent,brokerPosition:position,
        otherBotOwnsSymbol:otherOwner||collidingOpen,
        liveSellOrders:[...open,...verifiedChildren],
      }));
    }
    const fuseVirtual=virtual.filter(p=>p.bot_id===cfg.botProfileId);
    const untrackedVirtual=fuseVirtual.filter(p=>
      !entries.some(entry=>entry.symbol===p.symbol));
    const orphanBroker=positions.filter(p=>
      fuseVirtual.some(v=>v.symbol===p.symbol)&&
      !entries.some(entry=>entry.symbol===p.symbol));
    const critical=outcomes.some(o=>o.state==="unprotected"||
      o.state==="unconfirmed"&&o.brokerPositionQuantity>0||
      o.state==="ownership-collision")||untrackedVirtual.length>0||orphanBroker.length>0;
    return reply({
      ok:!critical,paperOnly:true,readOnly:true,protectiveManagementImplemented:false,
      executionEnabled:false,trackedEntries:entries.length,
      outcomes,untrackedVirtualPositions:untrackedVirtual.map(p=>p.symbol),
      orphanBrokerSymbols:orphanBroker.map(p=>p.symbol),
    },critical?503:200);
  }catch(error){
    return reply({ok:false,paperOnly:true,readOnly:true,
      error:error instanceof Error?error.message:"Fuse PAPER protection audit unavailable."},503);
  }
}
