import { NextResponse } from "next/server";
import { z } from "zod";
import { buildPaperExecutionFailureJournalRow } from "@/lib/paper-order-lifecycle-evidence";
import { createPaperClientOrderId } from "@/lib/paper-order-attribution";
import { DAILY_CRYPTO_DAY_STRATEGY_V3 as strategy } from "@/lib/paper-weekend-crypto-strategy-config";

export const dynamic = "force-dynamic";

const BOT_ID = strategy.botProfileId;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://yufptpfiwdbzzrvhkvux.supabase.co";
const ALPACA_PAPER = "https://paper-api.alpaca.markets/v2";

const positionSchema = z.object({
  symbol: z.enum(strategy.executionUniverse),
  quantity: z.coerce.number().finite().positive(),
});

const sellOrderSchema = z.object({
  client_order_id: z.string(),
  broker_order_id: z.string().nullable(),
  status: z.string(),
  metadata: z.record(z.string(),z.unknown()),
});

type BrokerPosition = { symbol?: string; qty?: string; qty_available?: string };
type BrokerOrder = { id?: string; status?: string; filled_qty?: string };

function reply(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control":"no-store" } });
}

async function digest(value: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return Array.from(bytes, byte => byte.toString(16).padStart(2,"0")).join("");
}

async function authorized(request: Request) {
  const expected = process.env.PAPER_WEEKEND_CRYPTO_EXECUTION_TOKEN?.trim() ?? "";
  const supplied = request.headers.get("x-paper-weekend-execution-token")?.trim() ?? "";
  if (expected.length < 32 || supplied.length < 32) return false;
  return (await digest(expected)) === (await digest(supplied));
}

function normalize(value: string | undefined) {
  return (value ?? "").replace("/","").toUpperCase();
}
function num(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}
function floorQty(value: number) {
  return Math.floor((value + Number.EPSILON) * 1_000_000_000) / 1_000_000_000;
}
function qtyString(value: number) {
  return value.toFixed(9).replace(/0+$/,"").replace(/\.$/,"");
}
function mappedStatus(value: unknown) {
  const status = typeof value === "string" ? value : "submitted";
  if (status === "filled") return "filled";
  if (status === "partially_filled") return "partially_filled";
  if (status === "canceled" || status === "cancelled") return "canceled";
  if (status === "rejected") return "rejected";
  if (status === "expired") return "expired";
  return "submitted";
}

export async function POST(request: Request) {
  if (!(await authorized(request))) return reply({ error:"Unauthorized." },401);

  const supabaseSecret=process.env.SUPABASE_SECRET_KEY?.trim() ?? "";
  const alpacaKey=process.env.ALPACA_API_KEY_ID?.trim() ?? "";
  const alpacaSecret=process.env.ALPACA_API_SECRET_KEY?.trim() ?? "";
  if (!supabaseSecret || !alpacaKey || !alpacaSecret) {
    return reply({ error:"Daily crypto flatten dependencies are not configured." },503);
  }

  const dbHeaders:Record<string,string>={apikey:supabaseSecret,"Content-Type":"application/json"};
  if (supabaseSecret.startsWith("eyJ")) dbHeaders.Authorization=`Bearer ${supabaseSecret}`;

  const db=async(path:string,body?:unknown,method:"GET"|"POST"|"PATCH"="GET",prefer?:string)=>{
    const response=await fetch(`${SUPABASE_URL}/rest/v1/${path}`,{
      method,
      headers:{...dbHeaders,...(prefer?{Prefer:prefer}:{})},
      ...(body===undefined||method==="GET"?{}:{body:JSON.stringify(body)}),
      cache:"no-store",
      signal:AbortSignal.timeout(10_000),
    });
    const text=await response.text();
    if(!response.ok) throw new Error(`Daily crypto flatten storage returned HTTP ${response.status}.`);
    return text?JSON.parse(text):null;
  };
  const journalFailure=async(input:Parameters<typeof buildPaperExecutionFailureJournalRow>[0])=>{
    try{await db("paper_bot_journal",buildPaperExecutionFailureJournalRow(input),"POST","return=minimal");}catch{}
  };

  const brokerHeaders={
    "APCA-API-KEY-ID":alpacaKey,
    "APCA-API-SECRET-KEY":alpacaSecret,
    Accept:"application/json",
    "Content-Type":"application/json",
  };
  const alpaca=async(path:string,init:RequestInit={})=>{
    const response=await fetch(`${ALPACA_PAPER}/${path}`,{
      ...init,headers:{...brokerHeaders,...(init.headers??{})},cache:"no-store",signal:AbortSignal.timeout(10_000),
    });
    const text=await response.text();
    const body=text?JSON.parse(text):null;
    if(!response.ok) throw new Error(typeof body?.message==="string"?body.message:`Alpaca HTTP ${response.status}`);
    return body;
  };

  const positionRows=z.array(positionSchema).parse(await db(
    `paper_bot_positions?select=symbol,quantity&bot_id=eq.${BOT_ID}&quantity=gt.0&limit=1`
  ));
  const position=positionRows[0];
  if(!position) return reply({ok:true,paperOnly:true,outcome:"no-position"});

  // Cancel this bot's active protective/exit orders first so their reserved
  // quantities cannot conflict with the forced session-close sell.
  const sellOrders=z.array(sellOrderSchema).parse(await db(
    `paper_bot_orders?select=client_order_id,broker_order_id,status,metadata&bot_id=eq.${BOT_ID}&side=eq.sell&status=in.(prepared,submitted,partially_filled)&order=created_at.desc&limit=50`
  ));
  for(const order of sellOrders){
    if(order.broker_order_id){
      try{
        await alpaca(`orders/${encodeURIComponent(order.broker_order_id)}`,{method:"DELETE"});
      }catch(error){
        const reason=error instanceof Error?error.message.slice(0,180):"Protective/exit order cancellation failed before session flatten.";
        await journalFailure({
          botId:BOT_ID,strategyId:strategy.id,strategyVersion:strategy.version,
          symbol:position.symbol,assetClass:"crypto",clientOrderId:order.client_order_id,
          phase:"pre-flatten-cancel",reason,side:"sell",
          purpose:typeof order.metadata.purpose==="string"?order.metadata.purpose:null,critical:true,
        });
        return reply({error:"Existing protective/exit order could not be canceled; session flatten was not submitted.",critical:true},502);
      }
    }
    await db(
      `paper_bot_orders?client_order_id=eq.${encodeURIComponent(order.client_order_id)}`,
      {
        status:"canceled",
        updated_at:new Date().toISOString(),
        metadata:{...order.metadata,cancelRequestedAt:new Date().toISOString(),cancelReason:"session-flatten"},
      },
      "PATCH","return=minimal"
    );
  }

  let brokerPosition:BrokerPosition|null=null;
  for(let index=0;index<8;index++){
    const positions=await alpaca("positions") as BrokerPosition[];
    brokerPosition=positions.find(item=>normalize(item.symbol)===normalize(position.symbol))??null;
    if((num(brokerPosition?.qty_available)??num(brokerPosition?.qty)??0)>0) break;
    await new Promise(resolve=>setTimeout(resolve,200));
  }

  const available=floorQty(Math.min(
    position.quantity,
    num(brokerPosition?.qty_available)??num(brokerPosition?.qty)??0
  ));
  if(!(available>0)){
    const reason="Virtual position exists, but no sellable broker quantity is available for the session flatten.";
    await journalFailure({
      botId:BOT_ID,strategyId:strategy.id,strategyVersion:strategy.version,
      symbol:position.symbol,assetClass:"crypto",
      phase:"session-flatten-quantity",reason,side:"sell",purpose:"session-flat",critical:true,
    });
    return reply({
      ok:true,paperOnly:true,outcome:"no-sellable-broker-quantity",symbol:position.symbol,
    });
  }

  const clientOrderId=createPaperClientOrderId(BOT_ID,strategy.version,crypto.randomUUID());
  await db("paper_bot_orders",{
    client_order_id:clientOrderId,
    bot_id:BOT_ID,
    strategy_id:strategy.id,
    strategy_version:strategy.version,
    symbol:position.symbol,
    asset_class:"crypto",
    side:"sell",
    status:"prepared",
    requested_quantity:available,
    pool_id:"day",
    planned_risk_dollars:0,
    stage_reason:"Daily crypto crypto deterministic session-close flatten.",
    metadata:{
      purpose:"session-flat",
      paperOnly:true,
      estimatedFeeBps:strategy.fees.estimatedTakerFeeBpsPerSide,
      timezone:strategy.timezone,
    },
  },"POST","return=minimal");

  try{
    const order=await alpaca("orders",{
      method:"POST",
      body:JSON.stringify({
        symbol:position.symbol,
        qty:qtyString(available),
        side:"sell",
        type:"market",
        time_in_force:"gtc",
        client_order_id:clientOrderId,
      }),
    }) as BrokerOrder;

    await db(
      `paper_bot_orders?client_order_id=eq.${encodeURIComponent(clientOrderId)}`,
      {
        status:mappedStatus(order.status),
        broker_order_id:order.id??null,
        submitted_at:new Date().toISOString(),
        updated_at:new Date().toISOString(),
      },
      "PATCH","return=minimal"
    );
    return reply({
      ok:true,paperOnly:true,outcome:"flatten-submitted",symbol:position.symbol,quantity:available,
    });
  }catch(error){
    const reason=error instanceof Error?error.message.slice(0,180):"Session flatten failed.";
    await db(
      `paper_bot_orders?client_order_id=eq.${encodeURIComponent(clientOrderId)}`,
      {
        status:"error",
        updated_at:new Date().toISOString(),
        metadata:{
          purpose:"session-flat",paperOnly:true,
          estimatedFeeBps:strategy.fees.estimatedTakerFeeBpsPerSide,
          executionError:reason,
        },
      },
      "PATCH","return=minimal"
    );
    await journalFailure({
      botId:BOT_ID,strategyId:strategy.id,strategyVersion:strategy.version,
      symbol:position.symbol,assetClass:"crypto",clientOrderId,
      phase:"session-flatten-submission",reason,side:"sell",purpose:"session-flat",critical:true,
    });
    return reply({error:"Daily crypto PAPER session flatten failed.",critical:true},502);
  }
}
