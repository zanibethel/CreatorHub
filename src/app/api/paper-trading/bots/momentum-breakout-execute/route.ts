import { NextResponse } from "next/server";
import { z } from "zod";
import { MOMENTUM_BREAKOUT_STRATEGY_V1 as strategy } from "@/lib/paper-momentum-breakout-strategy-config";
import { pulseEntryOrderMode, pulseFractionalQuantity } from "@/lib/paper-pulse-fractional";
import { auditPulseBrokerBracket, type PulseBracketParent } from "@/lib/paper-pulse-bracket-evidence";

export const dynamic="force-dynamic";

const SUPABASE_URL=process.env.NEXT_PUBLIC_SUPABASE_URL||"https://yufptpfiwdbzzrvhkvux.supabase.co";
const ALPACA_PAPER="https://paper-api.alpaca.markets/v2";
const PUBLIC_ORIGIN=process.env.CREATORHUB_PUBLIC_ORIGIN||"https://creatorhub-gray.vercel.app";

const requestSchema=z.object({symbol:z.preprocess(v=>typeof v==="string"?v.trim().toUpperCase():v,z.string().regex(/^[A-Z][A-Z0-9.]{0,15}$/))}).strict();
const planSchema=z.object({
  symbol:z.string(),state:z.enum(["ready","waiting","blocked"]),selectedForSubmission:z.boolean(),
  quoteAgeSeconds:z.number().finite().nonnegative().nullable(),
  ask:z.number().finite().positive().nullable(),maxEntry:z.number().finite().positive().nullable(),protectiveStop:z.number().finite().positive().nullable(),
  takeProfit:z.number().finite().positive().nullable(),plannedQuantity:z.number().finite().positive().nullable(),
  plannedNotional:z.number().finite().positive().nullable(),plannedRiskDollars:z.number().finite().nonnegative().nullable(),
  plannedRiskPct:z.number().finite().nonnegative().nullable(),
});
const readinessSchema=z.object({
  paperOnly:z.literal(true),executionEnabled:z.boolean(),fractionalExecutionEnabled:z.boolean(),submissionReady:z.boolean(),plans:z.array(planSchema),
});
const preparedSchema=z.object({
  client_order_id:z.string(),bot_id:z.literal(strategy.botProfileId),strategy_id:z.string(),strategy_version:z.coerce.number().int().positive(),
  symbol:z.string(),asset_class:z.string(),side:z.literal("buy"),status:z.string(),broker_order_id:z.string().nullable(),metadata:z.record(z.string(),z.unknown()),
});
type BrokerOrder=PulseBracketParent;

function reply(body:unknown,status=200){return NextResponse.json(body,{status,headers:{"Cache-Control":"no-store"}});}
async function digest(value:string){
  const bytes=new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value)));
  return Array.from(bytes,b=>b.toString(16).padStart(2,"0")).join("");
}
async function authorized(request:Request){
  const expected=process.env.PAPER_MOMENTUM_EXECUTION_TOKEN?.trim()??"";
  const supplied=request.headers.get("x-paper-momentum-execution-token")?.trim()??"";
  return expected.length>=32&&supplied.length>=32&&(await digest(expected))===(await digest(supplied));
}
function qtyString(value:number){return value.toFixed(9).replace(/0+$/,"").replace(/\.$/,"");}
function brokerStatus(value:unknown){
  const status=typeof value==="string"?value:"submitted";
  return ["filled","partially_filled","rejected","canceled","expired","replaced"].includes(status)?status:"submitted";
}
function roundPrice(value:number){return Number(value.toFixed(value>=1?2:6));}

export async function POST(request:Request){
  if(!(await authorized(request)))return reply({error:"Unauthorized."},401);
  const supabaseSecret=process.env.SUPABASE_SECRET_KEY?.trim()??"";
  const alpacaKey=process.env.ALPACA_API_KEY_ID?.trim()??"";
  const alpacaSecret=process.env.ALPACA_API_SECRET_KEY?.trim()??"";
  if(!supabaseSecret||!alpacaKey||!alpacaSecret)return reply({error:"Pulse execution dependencies are not configured."},503);

  let parsed:z.infer<typeof requestSchema>;
  try{parsed=requestSchema.parse(await request.json());}catch{return reply({error:"A valid Pulse symbol is required."},400);}

  const readinessResponse=await fetch(new URL("/api/paper-trading/bots/momentum-breakout-readiness",PUBLIC_ORIGIN),{
    cache:"no-store",signal:AbortSignal.timeout(20_000),
  });
  if(!readinessResponse.ok)return reply({error:"Pulse final readiness recheck failed."},503);
  const readiness=readinessSchema.parse(await readinessResponse.json());
  const plan=readiness.plans.find(item=>item.symbol===parsed.symbol);
  if(!readiness.paperOnly||!readiness.executionEnabled||!readiness.submissionReady||!plan?.selectedForSubmission||plan.state!=="ready"){
    return reply({error:"Pulse setup changed during final revalidation.",state:plan?.state??"blocked"},423);
  }
  if(plan.quoteAgeSeconds===null||plan.quoteAgeSeconds>strategy.marketData.maximumQuoteAgeSeconds||!plan.ask||!plan.protectiveStop||!plan.takeProfit||!plan.plannedQuantity){
    return reply({error:"Pulse execution preview is incomplete or stale."},409);
  }
  if(!(plan.protectiveStop<plan.ask&&plan.takeProfit>plan.ask))return reply({error:"Pulse bracket prices do not surround entry."},409);
  const orderMode=pulseEntryOrderMode(plan.plannedQuantity);
  if(!orderMode)return reply({error:"Pulse quantity is invalid for supported PAPER order modes."},409);
  const fractional=orderMode==="fractional-simple-protected";
  // Both integer brackets and fractional simple orders must participate
  // in the SAME one-shot pilot and shared stock-symbol reservation.
  // The existing atomic pilot RPC deliberately fails closed if disabled.
  if(!readiness.fractionalExecutionEnabled)
    return reply({error:"Pulse shared one-entry PAPER stock pilot is not armed."},409);

  const paperHeaders={"APCA-API-KEY-ID":alpacaKey,"APCA-API-SECRET-KEY":alpacaSecret,Accept:"application/json"};
  const verifyBrokerVenue=async():Promise<{ok:true}|{ok:false;status:number;error:string}>=>{
    try{
      const urls=[`${ALPACA_PAPER}/assets/${encodeURIComponent(parsed.symbol)}`,
        `${ALPACA_PAPER}/clock`,
        `${ALPACA_PAPER}/positions`,
        `${ALPACA_PAPER}/orders?status=open&limit=500&nested=false`];
      const values=await Promise.all(urls.map(url=>fetch(url,{
        headers:paperHeaders,cache:"no-store",signal:AbortSignal.timeout(10_000),
      })));
      if(values.some(response=>!response.ok))
        return {ok:false,status:503,error:"Pulse broker-wide PAPER preflight is unavailable."};
      const [asset,clock,positions,orders]=await Promise.all(values.map(response=>response.json())) as [
        {symbol?:string;class?:string;fractionable?:boolean;tradable?:boolean;status?:string},
        {is_open?:boolean},Array<{symbol?:string;qty?:string}>,
        Array<{symbol?:string;status?:string;client_order_id?:string}>
      ];
      if(asset.symbol!==parsed.symbol||asset.class!=="us_equity"||asset.status!=="active"||
         asset.tradable!==true||(fractional&&asset.fractionable!==true))
        return {ok:false,status:409,error:"Alpaca PAPER asset is not independently verified for this stock order mode."};
      if(clock.is_open!==true)
        return {ok:false,status:409,error:"Pulse stock entry requires the active regular PAPER session."};
      // Refuse pagination ambiguity and malformed venue rows; missing an
      // order or position here could buy another bot's physical shares twice.
      if(!Array.isArray(positions)||!Array.isArray(orders)||positions.length>=500||orders.length>=500||
         positions.some(p=>typeof p?.symbol!=="string"||!p.symbol)||
         orders.some(o=>typeof o?.symbol!=="string"||!o.symbol))
        return {ok:false,status:503,error:"Pulse stock venue ownership scan is incomplete."};
      if(positions.some(p=>p.symbol===parsed.symbol)||orders.some(o=>o.symbol===parsed.symbol))
        return {ok:false,status:409,error:"Shared PAPER broker symbol is occupied; Pulse will not buy it."};
      return {ok:true};
    }catch{
      return {ok:false,status:503,error:"Pulse PAPER broker preflight could not be verified."};
    }
  };
  const initialVenue=await verifyBrokerVenue();
  if(!initialVenue.ok)return reply({error:initialVenue.error},initialVenue.status);

  // A fractional market order could exceed both the cash and risk caps on
  // slippage. Limit the entry and shrink quantity using the worst fill price.
  const maxLimit=plan.maxEntry===null?null:Math.floor(plan.maxEntry*100)/100;
  const limitPrice=fractional?Math.ceil(plan.ask*100-1e-8)/100:null;
  if(fractional&&(!(limitPrice&&maxLimit&&limitPrice<=maxLimit)||!plan.plannedNotional||
     plan.plannedRiskDollars===null||!plan.protectiveStop||limitPrice<=plan.protectiveStop)){
    return reply({error:"Pulse fractional DAY limit entry exceeds the authorized risk envelope."},409);
  }
  const effectiveQty=fractional
    ? pulseFractionalQuantity(
      plan.plannedRiskDollars!/(limitPrice!-plan.protectiveStop!),
      plan.plannedNotional!/limitPrice!,limitPrice!,
    )
    : plan.plannedQuantity;
  if(effectiveQty===null||effectiveQty<=0||effectiveQty>plan.plannedQuantity+0.000000001)
    return reply({error:"Pulse fractional limit adjustment cannot preserve the existing risk caps."},409);

  const headers:Record<string,string>={apikey:supabaseSecret,"Content-Type":"application/json",Accept:"application/json"};
  if(supabaseSecret.startsWith("eyJ"))headers.Authorization=`Bearer ${supabaseSecret}`;
  const preparedResponse=await fetch(
    `${SUPABASE_URL}/rest/v1/paper_bot_orders?bot_id=eq.${strategy.botProfileId}&symbol=eq.${encodeURIComponent(parsed.symbol)}&side=eq.buy&status=eq.prepared&broker_order_id=is.null&select=client_order_id,bot_id,strategy_id,strategy_version,symbol,asset_class,side,status,broker_order_id,metadata&order=created_at.asc&limit=1`,
    {headers,cache:"no-store",signal:AbortSignal.timeout(10_000)},
  );
  if(!preparedResponse.ok)return reply({error:"Pulse prepared-order lookup failed."},503);
  const prepared=z.array(preparedSchema).parse(await preparedResponse.json())[0];
  if(!prepared)return reply({error:"No unclaimed Pulse prepared order exists."},409);

  if(fractional){
    // An independent protected fractional stop manager must be healthy
    // before the irreversible, single-entry venue/ledger pilot claim.
    const cron=process.env.CRON_SECRET?.trim()??"";
    if(!cron)return reply({error:"Pulse independent stop manager is not configured."},503);
    let managerHealthy=false;
    try{
      const manager=await fetch(new URL("/api/paper-trading/bots/momentum-breakout-manage",PUBLIC_ORIGIN),{
        headers:{Authorization:`Bearer ${cron}`},cache:"no-store",signal:AbortSignal.timeout(25_000),
      });
      const health=await manager.json() as {ok?:boolean;paperOnly?:boolean;marketOpen?:boolean};
      managerHealthy=manager.ok&&health.ok===true&&health.paperOnly===true&&health.marketOpen===true;
    }catch{}
    if(!managerHealthy)
      return reply({error:"Pulse fractional protection manager is not healthy; refusing new risk."},503);
  }

  // The existing service-role RPC claims the one-shot Pulse stock pilot and
  // inserts an atomic venue-wide symbol reservation. It is required for
  // WHOLE-SHARE brackets too. Do not add a separate unreserved buy path.
  // Uncertain RPC results fail closed: neither the pilot nor the physical
  // symbol can be reclaimed without the existing evidence-gated workflow.
  let reserved=false;
  try{
    const response=await fetch(`${SUPABASE_URL}/rest/v1/rpc/paper_pulse_claim_fractional_pilot`,{
      method:"POST",headers,body:JSON.stringify({p_client_order_id:prepared.client_order_id}),
      cache:"no-store",signal:AbortSignal.timeout(10_000),
    });
    if(response.ok)reserved=(await response.json())===true;
  }catch{}
  if(!reserved)return reply({error:"Pulse shared, one-entry PAPER stock pilot slot is unavailable."},423);

  const claimedAt=new Date().toISOString();
  const claim=await fetch(
    `${SUPABASE_URL}/rest/v1/paper_bot_orders?client_order_id=eq.${encodeURIComponent(prepared.client_order_id)}&status=eq.prepared&broker_order_id=is.null`,
    {
      method:"PATCH",headers:{...headers,Prefer:"return=representation"},
      body:JSON.stringify({
        status:"submitted",requested_quantity:effectiveQty,submitted_at:claimedAt,
        metadata:{...prepared.metadata,executionMode:fractional?"paper-fractional-simple-v1":"paper-bracket",executionClaimedAt:claimedAt,entryReference:plan.ask,limitPrice,brokerProtection:fractional?"independent-day-stop":"bracket"},
        updated_at:claimedAt,
      }),cache:"no-store",signal:AbortSignal.timeout(10_000),
    },
  );
  if(!claim.ok)return reply({error:"Pulse order claim failed."},503);
  const claimed=z.array(preparedSchema).parse(await claim.json());
  if(claimed.length!==1)return reply({error:"Pulse prepared order was already claimed."},409);

  // A venue collision can appear between the first broker scan and the
  // atomic database claim. Re-read physical Alpaca state immediately before
  // the actual buy POST, including for WHOLE-SHARE bracket orders.
  // Keep the pilot/reservation claimed if this fails: never retry blindly.
  const finalVenue=await verifyBrokerVenue();
  if(!finalVenue.ok)
    return reply({error:"Pulse post-claim PAPER venue preflight failed; no broker buy attempted.",
      detail:finalVenue.error},finalVenue.status);

  const brokerHeaders={"APCA-API-KEY-ID":alpacaKey,"APCA-API-SECRET-KEY":alpacaSecret,Accept:"application/json","Content-Type":"application/json"};
  let order:BrokerOrder|null=null; let submitError="";
  try{
    const response=await fetch(`${ALPACA_PAPER}/orders`,{
      method:"POST",headers:brokerHeaders,
      body:JSON.stringify({
        symbol:parsed.symbol,side:"buy",qty:qtyString(effectiveQty),type:fractional?"limit":"market",time_in_force:"day",extended_hours:false,
        ...(fractional?{limit_price:String(limitPrice)}:{}),
        client_order_id:prepared.client_order_id,order_class:fractional?"simple":"bracket",
        ...(fractional?{}:{take_profit:{limit_price:String(roundPrice(plan.takeProfit))},
          stop_loss:{stop_price:String(roundPrice(plan.protectiveStop))}}),
      }),
      cache:"no-store",signal:AbortSignal.timeout(10_000),
    });
    const text=await response.text(); const body=text?JSON.parse(text):{};
    if(!response.ok)throw new Error(typeof body?.message==="string"?body.message:`Broker returned HTTP ${response.status}.`);
    order=body as BrokerOrder;
  }catch(error){submitError=error instanceof Error?error.message.slice(0,180):"Pulse bracket submission failed.";}

  if(!order?.id){
    try{
      const lookup=await fetch(`${ALPACA_PAPER}/orders:by_client_order_id?client_order_id=${encodeURIComponent(prepared.client_order_id)}`,{
        headers:brokerHeaders,cache:"no-store",signal:AbortSignal.timeout(8_000),
      });
      if(lookup.ok)order=await lookup.json() as BrokerOrder;
    }catch{}
  }

  if(!order?.id){
    await fetch(`${SUPABASE_URL}/rest/v1/paper_bot_orders?client_order_id=eq.${encodeURIComponent(prepared.client_order_id)}`,{
      method:"PATCH",headers:{...headers,Prefer:"return=minimal"},
      body:JSON.stringify({metadata:{...prepared.metadata,executionError:submitError||"Broker outcome unconfirmed.",brokerLookupPending:true},updated_at:new Date().toISOString()}),
      cache:"no-store",signal:AbortSignal.timeout(10_000),
    });
    return reply({error:"Pulse broker outcome is unconfirmed; order remains claimed to prevent duplication."},502);
  }

  let nested=order;
  try{
    const response=await fetch(`${ALPACA_PAPER}/orders/${encodeURIComponent(order.id)}?nested=true`,{headers:brokerHeaders,cache:"no-store",signal:AbortSignal.timeout(8_000)});
    if(response.ok)nested=await response.json() as BrokerOrder;
  }catch{}
  // A broker leg ID alone does not establish that the stop/target is
  // live, priced correctly or has enough unfilled shares remaining.
  const brokerProof=auditPulseBrokerBracket({
    parent:nested,brokerOrderId:order.id,clientOrderId:prepared.client_order_id,
    symbol:parsed.symbol,quantity:effectiveQty,
    authorizedStop:roundPrice(plan.protectiveStop),
    authorizedTarget:roundPrice(plan.takeProfit),
  });
  const takeObserved=brokerProof.targetLegObserved;
  const stopObserved=brokerProof.stopLegObserved;

  await fetch(`${SUPABASE_URL}/rest/v1/paper_bot_orders?client_order_id=eq.${encodeURIComponent(prepared.client_order_id)}`,{
    method:"PATCH",headers:{...headers,Prefer:"return=minimal"},
    body:JSON.stringify({
      broker_order_id:order.id,status:brokerStatus(order.status),
      metadata:{...prepared.metadata,executionMode:fractional?"paper-fractional-simple-v1":"paper-bracket",brokerObservedStatus:order.status??"submitted",bracketAccepted:order.order_class==="bracket",takeProfitLegObserved:takeObserved,stopLossLegObserved:stopObserved,brokerLookupPending:false,protectionValidatedAt:!fractional&&brokerProof.verified?new Date().toISOString():null},
      updated_at:new Date().toISOString(),
    }),cache:"no-store",signal:AbortSignal.timeout(10_000),
  });

  if(fractional){
    // The entry may fill later. Immediate management reduces the unprotected
    // interval; a separate one-minute cron independently retries reconciliation.
    const cron=process.env.CRON_SECRET?.trim()??"";
    let protection:{ok?:boolean;outcome?:unknown;error?:string}|null=null;
    if(cron){
      try{
        const response=await fetch(new URL("/api/paper-trading/bots/momentum-breakout-manage",PUBLIC_ORIGIN),{
          headers:{Authorization:`Bearer ${cron}`},cache:"no-store",signal:AbortSignal.timeout(20_000),
        });
        protection=await response.json() as typeof protection;
      }catch{protection={ok:false,error:"Immediate protection manager unavailable."};}
    }
    return reply({ok:true,paperOnly:true,symbol:parsed.symbol,executionMode:"paper-fractional-simple-v1",
      brokerOrderId:order.id,status:brokerStatus(order.status),protectionManager:protection,
      protectionPending:true,warning:"Simple fractional entry does not include broker OCO; a separate stop/flatten manager must confirm protection."},202);
  }
  // An accepted entry is not proof that its protective exits exist. Fail closed and
  // surface an explicit reconciliation requirement rather than reporting success.
  const protectionVerified=brokerProof.verified;
  if(!protectionVerified){
    return reply({ok:false,symbol:parsed.symbol,paperOnly:true,action:"protection-unverified",
      brokerOrderId:order.id,bracketAccepted:nested.order_class==="bracket",
      takeProfitLegObserved:takeObserved,stopLossLegObserved:stopObserved,
      warning:"Broker entry may exist. Reconcile and cancel or flatten safely before any new entry; do not resubmit."},503);
  }
  return reply({ok:true,symbol:parsed.symbol,status:brokerStatus(order.status),paperOnly:true,bracketAccepted:true,takeProfitLegObserved:true,stopLossLegObserved:true});
}
