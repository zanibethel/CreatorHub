import { NextResponse } from "next/server";
import { z } from "zod";
import { MOMENTUM_BREAKOUT_STRATEGY_V1 as strategy } from "@/lib/paper-momentum-breakout-strategy-config";

export const dynamic="force-dynamic";

const SUPABASE_URL=process.env.NEXT_PUBLIC_SUPABASE_URL||"https://yufptpfiwdbzzrvhkvux.supabase.co";
const ALPACA_PAPER="https://paper-api.alpaca.markets/v2";

const requestSchema=z.object({symbol:z.preprocess(v=>typeof v==="string"?v.trim().toUpperCase():v,z.string().regex(/^[A-Z][A-Z0-9.]{0,15}$/))}).strict();
const planSchema=z.object({
  symbol:z.string(),state:z.enum(["ready","waiting","blocked"]),selectedForSubmission:z.boolean(),
  quoteAgeSeconds:z.number().finite().nonnegative().nullable(),
  ask:z.number().finite().positive().nullable(),protectiveStop:z.number().finite().positive().nullable(),
  takeProfit:z.number().finite().positive().nullable(),plannedQuantity:z.number().finite().positive().nullable(),
  plannedNotional:z.number().finite().positive().nullable(),plannedRiskDollars:z.number().finite().nonnegative().nullable(),
  plannedRiskPct:z.number().finite().nonnegative().nullable(),
});
const readinessSchema=z.object({
  paperOnly:z.literal(true),executionEnabled:z.boolean(),submissionReady:z.boolean(),plans:z.array(planSchema),
});
const preparedSchema=z.object({
  client_order_id:z.string(),bot_id:z.literal(strategy.botProfileId),strategy_id:z.string(),strategy_version:z.coerce.number().int().positive(),
  symbol:z.string(),asset_class:z.string(),side:z.literal("buy"),status:z.string(),broker_order_id:z.string().nullable(),metadata:z.record(z.string(),z.unknown()),
});
type BrokerOrder={id?:string;status?:string;order_class?:string;side?:string;type?:string;legs?:BrokerOrder[]|null};

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

  const readinessResponse=await fetch(new URL("/api/paper-trading/bots/momentum-breakout-readiness",request.url),{
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

  const headers:Record<string,string>={apikey:supabaseSecret,"Content-Type":"application/json",Accept:"application/json"};
  if(supabaseSecret.startsWith("eyJ"))headers.Authorization=`Bearer ${supabaseSecret}`;
  const preparedResponse=await fetch(
    `${SUPABASE_URL}/rest/v1/paper_bot_orders?bot_id=eq.${strategy.botProfileId}&symbol=eq.${encodeURIComponent(parsed.symbol)}&side=eq.buy&status=eq.prepared&broker_order_id=is.null&select=client_order_id,bot_id,strategy_id,strategy_version,symbol,asset_class,side,status,broker_order_id,metadata&order=created_at.asc&limit=1`,
    {headers,cache:"no-store",signal:AbortSignal.timeout(10_000)},
  );
  if(!preparedResponse.ok)return reply({error:"Pulse prepared-order lookup failed."},503);
  const prepared=z.array(preparedSchema).parse(await preparedResponse.json())[0];
  if(!prepared)return reply({error:"No unclaimed Pulse prepared order exists."},409);

  const claimedAt=new Date().toISOString();
  const claim=await fetch(
    `${SUPABASE_URL}/rest/v1/paper_bot_orders?client_order_id=eq.${encodeURIComponent(prepared.client_order_id)}&status=eq.prepared&broker_order_id=is.null`,
    {
      method:"PATCH",headers:{...headers,Prefer:"return=representation"},
      body:JSON.stringify({
        status:"submitted",requested_quantity:plan.plannedQuantity,submitted_at:claimedAt,
        metadata:{...prepared.metadata,executionMode:"paper-bracket",executionClaimedAt:claimedAt,entryReference:plan.ask,brokerProtection:"bracket"},
        updated_at:claimedAt,
      }),cache:"no-store",signal:AbortSignal.timeout(10_000),
    },
  );
  if(!claim.ok)return reply({error:"Pulse order claim failed."},503);
  const claimed=z.array(preparedSchema).parse(await claim.json());
  if(claimed.length!==1)return reply({error:"Pulse prepared order was already claimed."},409);

  const brokerHeaders={"APCA-API-KEY-ID":alpacaKey,"APCA-API-SECRET-KEY":alpacaSecret,Accept:"application/json","Content-Type":"application/json"};
  let order:BrokerOrder|null=null; let submitError="";
  try{
    const response=await fetch(`${ALPACA_PAPER}/orders`,{
      method:"POST",headers:brokerHeaders,
      body:JSON.stringify({
        symbol:parsed.symbol,side:"buy",qty:qtyString(plan.plannedQuantity),type:"market",time_in_force:"day",extended_hours:false,
        client_order_id:prepared.client_order_id,order_class:"bracket",
        take_profit:{limit_price:String(roundPrice(plan.takeProfit))},
        stop_loss:{stop_price:String(roundPrice(plan.protectiveStop))},
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
  const sellLegs=(nested.legs??[]).filter(leg=>leg.side==="sell");
  const takeObserved=sellLegs.some(leg=>leg.type==="limit"&&Boolean(leg.id));
  const stopObserved=sellLegs.some(leg=>(leg.type==="stop"||leg.type==="stop_limit")&&Boolean(leg.id));

  await fetch(`${SUPABASE_URL}/rest/v1/paper_bot_orders?client_order_id=eq.${encodeURIComponent(prepared.client_order_id)}`,{
    method:"PATCH",headers:{...headers,Prefer:"return=minimal"},
    body:JSON.stringify({
      broker_order_id:order.id,status:brokerStatus(order.status),
      metadata:{...prepared.metadata,executionMode:"paper-bracket",brokerObservedStatus:order.status??"submitted",bracketAccepted:order.order_class==="bracket",takeProfitLegObserved:takeObserved,stopLossLegObserved:stopObserved,brokerLookupPending:false,protectionValidatedAt:new Date().toISOString()},
      updated_at:new Date().toISOString(),
    }),cache:"no-store",signal:AbortSignal.timeout(10_000),
  });

  // An accepted entry is not proof that its protective exits exist. Fail closed and
  // surface an explicit reconciliation requirement rather than reporting success.
  const protectionVerified=nested.order_class==="bracket"&&takeObserved&&stopObserved;
  if(!protectionVerified){
    return reply({ok:false,symbol:parsed.symbol,paperOnly:true,action:"protection-unverified",
      brokerOrderId:order.id,bracketAccepted:nested.order_class==="bracket",
      takeProfitLegObserved:takeObserved,stopLossLegObserved:stopObserved,
      warning:"Broker entry may exist. Reconcile and cancel or flatten safely before any new entry; do not resubmit."},503);
  }
  return reply({ok:true,symbol:parsed.symbol,status:brokerStatus(order.status),paperOnly:true,bracketAccepted:true,takeProfitLegObserved:true,stopLossLegObserved:true});
}
