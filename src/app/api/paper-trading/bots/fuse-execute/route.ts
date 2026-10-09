import { NextResponse } from "next/server";
import { z } from "zod";
import { createPaperClientOrderId } from "@/lib/paper-order-attribution";
import { FUSE_PENNY_STRATEGY_V1 as cfg } from "@/lib/paper-fuse-strategy-config";
import type { FuseBracketOrder } from "@/lib/paper-fuse-bracket";

export const dynamic="force-dynamic";
const DB=process.env.NEXT_PUBLIC_SUPABASE_URL||"https://yufptpfiwdbzzrvhkvux.supabase.co";
const PAPER="https://paper-api.alpaca.markets/v2";
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{"Cache-Control":"no-store"}});
const requestSchema=z.object({symbol:z.string().regex(/^[A-Z][A-Z0-9.]{0,15}$/)}).strict();
const ledgerSchema=z.object({
  bot_id:z.literal(cfg.botProfileId),status:z.literal("active"),
  equity:z.coerce.number().positive(),buying_power:z.coerce.number().positive(),
  metadata:z.record(z.string(),z.unknown()),
});
const orderSchema=z.object({
  symbol:z.string(),qty:z.number().int().positive(),
  limitPrice:z.number().positive(),stopPrice:z.number().positive(),
  takeProfitPrice:z.number().positive(),plannedNotional:z.number().positive(),
  plannedLoss:z.number().positive(),
});
const previewSchema=z.object({
  paperOnly:z.literal(true),researchOnly:z.literal(true),
  brokerOrdersSubmitted:z.literal(false),executionEnabled:z.boolean(),
  pilotEnabled:z.boolean(),pilotClaimed:z.boolean(),pilotArmed:z.boolean(),
  submissionReady:z.literal(false),
  plans:z.array(z.object({
    symbol:z.string(),readiness:z.string(),fuseScore:z.number(),
    eligible:z.boolean(),order:orderSchema.nullable(),
  })),
});
const brokerOrderSchema=z.object({
  id:z.string(),client_order_id:z.string(),symbol:z.string(),side:z.string(),
  type:z.string(),order_class:z.string(),status:z.string(),qty:z.string().optional(),
  legs:z.array(z.object({id:z.string().optional(),side:z.string().optional(),
    type:z.string().optional()})).nullable().optional(),
}).passthrough();
function brokerStatus(s:string){
  return ["filled","partially_filled","rejected","canceled","expired","replaced"].includes(s)?s:"submitted";
}

/**
 * Explicitly gated ONE-ENTRY Alpaca PAPER pilot. The strategy's research-only
 * readiness remains unchanged; this privileged endpoint revalidates it and
 * requires TWO independent ledger flags plus an atomic SQL one-shot claim.
 * No route to live trading, and no client-supplied price/quantity/risk fields.
 */
export async function POST(request:Request){
  const cron=process.env.CRON_SECRET?.trim()??"";
  if(!cron||request.headers.get("authorization")!=="Bearer "+cron)
    return reply({error:"Unauthorized."},401);
  const service=process.env.SUPABASE_SECRET_KEY?.trim()??"";
  const key=process.env.ALPACA_API_KEY_ID?.trim()??"";
  const apiSecret=process.env.ALPACA_API_SECRET_KEY?.trim()??"";
  if(!service||!key||!apiSecret)return reply({error:"PAPER-only Fuse execution credentials missing."},503);
  const input=requestSchema.safeParse(await request.json().catch(()=>null));
  if(!input.success)return reply({error:"A valid Fuse symbol is required."},400);
  const dh:Record<string,string>={apikey:service,Accept:"application/json","Content-Type":"application/json"};
  if(service.startsWith("eyJ"))dh.Authorization="Bearer "+service;
  const bh={"APCA-API-KEY-ID":key,"APCA-API-SECRET-KEY":apiSecret,
    Accept:"application/json","Content-Type":"application/json"};
  const getDb=async(path:string)=>{
    const r=await fetch(DB+"/rest/v1/"+path,{headers:dh,cache:"no-store",
      signal:AbortSignal.timeout(12000)});
    if(!r.ok)throw Error("Fuse ledger lookup HTTP "+r.status);
    return r.json() as Promise<unknown>;
  };
  const broker=async(path:string,method:"GET"|"POST"="GET",body?:unknown)=>{
    const r=await fetch(PAPER+"/"+path,{method,headers:bh,cache:"no-store",
      ...(body===undefined?{}:{body:JSON.stringify(body)}),
      signal:AbortSignal.timeout(10000)});
    const t=await r.text();let payload:unknown=null;
    try{payload=t?JSON.parse(t):null;}catch{}
    return {ok:r.ok,status:r.status,payload};
  };
  try{
    const ledger=z.array(ledgerSchema).parse(await getDb(
      "paper_bot_ledgers?bot_id=eq."+cfg.botProfileId+
      "&select=bot_id,status,equity,buying_power,metadata&limit=1"))[0];
    if(!ledger||ledger.metadata.executionEnabled!==true||
      ledger.metadata.fusePilotEnabled!==true||
      typeof ledger.metadata.fusePilotClientOrderId==="string")
      return reply({ok:false,action:"disabled",reason:"Fuse PAPER pilot has not been armed or is already reserved."},423);

    // Research signals are never converted from a historical observation.
    // Re-fetch a current independently computed live readiness preview.
    const previewResponse=await fetch(new URL("/api/paper-trading/bots/fuse-execution-preview",request.url),{
      cache:"no-store",signal:AbortSignal.timeout(35000),
    });
    if(!previewResponse.ok)return reply({error:"Current Fuse signal preview unavailable."},503);
    const preview=previewSchema.parse(await previewResponse.json());
    if(preview.executionEnabled!==true||preview.pilotArmed!==true)
      return reply({ok:false,action:"pilot-no-longer-armed"},423);
    const chosen=preview.plans.find(row=>row.symbol===input.data.symbol);
    if(!chosen||!chosen.eligible||chosen.readiness!=="research-ready"||!chosen.order||
      chosen.fuseScore<cfg.scoring.readyScore)
      return reply({ok:false,action:"no-longer-ready",symbol:input.data.symbol},423);
    const order:FuseBracketOrder={...chosen.order,orderClass:"bracket",timeInForce:"day",entryType:"limit",
      maxRisk:ledger.equity*cfg.risk.riskPerTradePct/100,
      maxCash:Math.min(ledger.buying_power,ledger.equity*cfg.risk.maximumAllocationPct/100)};
    if(!Number.isInteger(order.qty)||order.qty<1||
      order.plannedLoss>order.maxRisk+0.000001||
      order.plannedNotional>order.maxCash+0.000001||
      order.stopPrice>=order.limitPrice||order.takeProfitPrice<=order.limitPrice)
      return reply({error:"Fuse final whole-share PAPER risk plan is invalid."},409);

    const [assetResponse,clockResponse,positionsResponse,ordersResponse,virtualRaw]=await Promise.all([
      broker("assets/"+encodeURIComponent(input.data.symbol)),
      broker("clock"),broker("positions"),broker("orders?status=open&limit=500&nested=false"),
      getDb("paper_bot_positions?quantity=gt.0&select=bot_id,symbol,quantity&limit=500"),
    ]);
    if(!assetResponse.ok||!clockResponse.ok||!positionsResponse.ok||!ordersResponse.ok)
      return reply({error:"Alpaca PAPER broker collision/asset preflight is unavailable."},503);
    const asset=z.object({status:z.string(),tradable:z.boolean()}).parse(assetResponse.payload);
    const clock=z.object({is_open:z.boolean()}).parse(clockResponse.payload);
    const positions=z.array(z.object({symbol:z.string()})).parse(positionsResponse.payload);
    const open=z.array(z.object({symbol:z.string()})).parse(ordersResponse.payload);
    const virtual=z.array(z.object({symbol:z.string(),bot_id:z.string()})).parse(virtualRaw);
    if(asset.status!=="active"||!asset.tradable||!clock.is_open)
      return reply({ok:false,action:"broker-market-closed-or-ineligible"},423);
    if(positions.some(x=>x.symbol===input.data.symbol)||open.some(x=>x.symbol===input.data.symbol)||
      virtual.some(x=>x.symbol===input.data.symbol))
      return reply({error:"Shared PAPER broker or virtual bot already owns this symbol."},409);

    // The minute manager MUST independently be available before new risk.
    const healthResponse=await fetch(new URL("/api/paper-trading/bots/fuse-manage",request.url),{
      headers:{Authorization:"Bearer "+cron},cache:"no-store",signal:AbortSignal.timeout(25000),
    });
    const health=await healthResponse.json().catch(()=>null) as
      {ok?:boolean;paperOnly?:boolean;marketOpen?:boolean;flattenDue?:boolean;managedEntries?:number}|null;
    if(!healthResponse.ok||health?.ok!==true||health.paperOnly!==true||
      health.marketOpen!==true||health.flattenDue!==false||health.managedEntries!==0)
      return reply({error:"Independent Fuse PAPER exit manager not healthy; refusing entry."},503);

    const clientId=createPaperClientOrderId(cfg.botProfileId,cfg.version);
    const reserve=await fetch(DB+"/rest/v1/rpc/paper_fuse_claim_pilot_entry",{
      method:"POST",headers:dh,cache:"no-store",signal:AbortSignal.timeout(12000),
      body:JSON.stringify({p_client_order_id:clientId,p_symbol:input.data.symbol,
        p_qty:order.qty,p_limit_price:order.limitPrice,
        p_stop_price:order.stopPrice,p_target_price:order.takeProfitPrice,
        p_scanner_score:chosen.fuseScore}),
    });
    if(!reserve.ok||await reserve.json().catch(()=>false)!==true)
      return reply({error:"Atomic Fuse one-entry PAPER pilot reservation rejected; no broker submission."},423);

    // DB order is already claimed and attributable BEFORE first broker POST.
    // This broker call must never be retried, even after a timeout.
    let submitted:z.infer<typeof brokerOrderSchema>|null=null;
    let brokerError="";
    try{
      const result=await broker("orders","POST",{
        symbol:input.data.symbol,side:"buy",type:"limit",
        qty:String(order.qty),limit_price:String(order.limitPrice),
        time_in_force:"day",extended_hours:false,order_class:"bracket",
        take_profit:{limit_price:String(order.takeProfitPrice)},
        stop_loss:{stop_price:String(order.stopPrice)},
        client_order_id:clientId,
      });
      if(result.ok)submitted=brokerOrderSchema.parse(result.payload);
      else brokerError="Alpaca PAPER broker rejected HTTP "+result.status;
    }catch(e){brokerError=e instanceof Error?e.message.slice(0,120):"Alpaca PAPER response ambiguous";}
    if(!submitted){
      try{
        const found=await broker("orders:by_client_order_id?client_order_id="+encodeURIComponent(clientId));
        if(found.ok)submitted=brokerOrderSchema.parse(found.payload);
      }catch{}
    }
    const match=submitted&&submitted.client_order_id===clientId&&
      submitted.symbol===input.data.symbol&&submitted.side==="buy"&&
      submitted.type==="limit"&&submitted.order_class==="bracket";
    const observed=match?submitted:null;
    if(!match&&submitted)brokerError="Alpaca broker order identity/format failed verification.";
    let nested=observed;
    if(observed){
      try{
        const detail=await broker("orders/"+encodeURIComponent(observed.id)+"?nested=true");
        if(detail.ok){
          const parsed=brokerOrderSchema.safeParse(detail.payload);
          if(parsed.success&&parsed.data.id===observed.id&&
            parsed.data.client_order_id===clientId)nested=parsed.data;
        }
      }catch{}
    }
    const children=(nested?.legs??[]).filter(x=>x.side==="sell");
    const stopSeen=children.some(x=>["stop","stop_limit"].includes(x.type??"")&&x.id);
    const targetSeen=children.some(x=>x.type==="limit"&&x.id);
    const patch=await fetch(DB+"/rest/v1/paper_bot_orders?bot_id=eq."+
      cfg.botProfileId+"&client_order_id=eq."+encodeURIComponent(clientId),{
      method:"PATCH",headers:{...dh,Prefer:"return=minimal"},cache:"no-store",
      signal:AbortSignal.timeout(12000),
      body:JSON.stringify({
        ...(observed?{broker_order_id:observed.id,status:brokerStatus(observed.status)}:{}),
        metadata:{paperOnly:true,liveMoneyEnabled:false,
          executionMode:"fuse-whole-share-bracket-pilot-v1",
          pilotClaimed:true,bracketAccepted:Boolean(observed),
          brokerLookupPending:!observed,bracketProtectionVerified:false,
          stopLegObserved:Boolean(stopSeen),takeProfitLegObserved:Boolean(targetSeen),
          limitPrice:order.limitPrice,stopPrice:order.stopPrice,
          targetPrice:order.takeProfitPrice,fuseScore:chosen.fuseScore,
          ...(brokerError?{brokerError}:{}),
        },updated_at:new Date().toISOString(),
      }),
    });
    if(!patch.ok)return reply({ok:false,paperOnly:true,action:"broker-accounting-unconfirmed",
      clientOrderId:clientId,brokerOrderId:observed?.id??null,
      warning:"Claim reserved and possible broker entry exists. Do not resubmit; manual reconciliation required."},503);
    if(!observed)return reply({ok:false,paperOnly:true,action:"broker-outcome-ambiguous",
      clientOrderId:clientId,warning:"Claim is consumed. Do not retry; manually verify Alpaca PAPER entry."},503);
    return reply({ok:true,paperOnly:true,action:"broker-entry-accepted",
      clientOrderId:clientId,brokerOrderId:observed.id,symbol:input.data.symbol,
      status:brokerStatus(observed.status),quantity:order.qty,
      limitPrice:order.limitPrice,stopPrice:order.stopPrice,
      takeProfitPrice:order.takeProfitPrice,
      stopLegObserved:Boolean(stopSeen),takeProfitLegObserved:Boolean(targetSeen),
      protectionPending:true,
      warning:"Broker acceptance is not fill or verified active protection; reconcile with independent manager and fills."},202);
  }catch(error){
    return reply({ok:false,paperOnly:true,error:error instanceof Error?
      error.message:"Fuse PAPER execution could not be verified."},503);
  }
}
