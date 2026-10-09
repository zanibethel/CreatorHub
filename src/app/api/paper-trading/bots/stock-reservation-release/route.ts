import {NextResponse} from "next/server";
import {z} from "zod";

export const dynamic="force-dynamic";
const DB=process.env.NEXT_PUBLIC_SUPABASE_URL||"https://yufptpfiwdbzzrvhkvux.supabase.co";
const PAPER="https://paper-api.alpaca.markets/v2";
const reqSchema=z.object({
  reservationId:z.string().uuid(),
  clientOrderId:z.string().min(10).max(128),
  confirm:z.literal("RELEASE VERIFIED PAPER STOCK RESERVATION"),
}).strict();
const idSchema=z.string().uuid();
const reservationSchema=z.object({
  reservation_id:z.string().uuid(),client_order_id:z.string(),
  bot_id:z.string(),symbol:z.string(),status:z.literal("active"),
});
const localOrderSchema=z.object({
  bot_id:z.string(),client_order_id:z.string(),symbol:z.string(),
  asset_class:z.string(),status:z.string(),side:z.string(),
});
const brokerSymbol=z.object({symbol:z.string()}).passthrough();
const brokerParent=z.object({
  client_order_id:z.string(),symbol:z.string(),side:z.string(),
  status:z.string(),
}).passthrough();
const activeLocal=new Set(["prepared","submitted","accepted","pending_new",
  "partially_filled","pending_cancel","pending_replace","held","new"]);
const terminalLocal=new Set(["filled","canceled","rejected","expired","closed"]);
const terminalBroker=new Set(["filled","canceled","expired","rejected"]);
function reply(body:unknown,status=200){
  return NextResponse.json(body,{status,headers:{"Cache-Control":"no-store"}});
}
type DbRecord=Record<string,unknown>;

/** Private manual review; NEVER called by a cron; no automatic release. */
async function handle(request:Request,release:boolean){
  const cron=process.env.CRON_SECRET?.trim()??"";
  if(!cron||request.headers.get("authorization")!=="Bearer "+cron)
    return reply({error:"Unauthorized."},401);
  const operatorToken=process.env.PAPER_STOCK_RELEASE_TOKEN?.trim()??"";
  if(release&&(!operatorToken||operatorToken.length<32||
    request.headers.get("x-paper-stock-release-token")!==operatorToken))
    return reply({error:"Independent manual release authorization unavailable."},403);

  const input=release
    ?reqSchema.safeParse(await request.json().catch(()=>null))
    :idSchema.safeParse(new URL(request.url).searchParams.get("reservation_id"));
  if(!input.success)return reply({error:"Invalid reservation request."},400);
  const id=release?input.data.reservationId:input.data;
  const secret=process.env.SUPABASE_SECRET_KEY?.trim()??"";
  const key=process.env.ALPACA_API_KEY_ID?.trim()??"";
  const apiSecret=process.env.ALPACA_API_SECRET_KEY?.trim()??"";
  if(!secret||!key||!apiSecret)
    return reply({error:"Independent PAPER release audit dependencies unavailable."},503);

  const dh:Record<string,string>={apikey:secret,"Content-Type":"application/json",Accept:"application/json"};
  if(secret.startsWith("eyJ"))dh.Authorization="Bearer "+secret;
  const bh={"APCA-API-KEY-ID":key,"APCA-API-SECRET-KEY":apiSecret,
    Accept:"application/json"};
  const readDb=async(path:string):Promise<unknown>=>{
    const r=await fetch(DB+"/rest/v1/"+path,{headers:dh,cache:"no-store",
      signal:AbortSignal.timeout(12000)});
    if(!r.ok)throw Error("PAPER reconciliation database HTTP "+r.status);
    return r.json();
  };
  const readBroker=async(path:string,allowMissing=false):Promise<{status:number,payload:unknown}>=>{
    const r=await fetch(PAPER+"/"+path,{headers:bh,cache:"no-store",
      signal:AbortSignal.timeout(12000)});
    if(r.status===404&&allowMissing)return {status:404,payload:null};
    if(!r.ok)throw Error("Alpaca PAPER ownership read HTTP "+r.status);
    return {status:r.status,payload:await r.json()};
  };
  try{
    const owners=z.array(reservationSchema).parse(await readDb(
      "paper_stock_symbol_reservations?reservation_id=eq."+encodeURIComponent(id)+
      "&status=eq.active&select=reservation_id,client_order_id,bot_id,symbol,status&limit=1"));
    const owner=owners[0];
    if(!owner)return reply({ok:false,reason:"No active reservation exists."},404);
    if(release&&owner.client_order_id!==input.data.clientOrderId)
      return reply({ok:false,reason:"Order ID does not match reservation."},409);

    const symbol=owner.symbol;
    // Read local accounting, broker clock, all physical positions, all open
    // orders, and the precise parent client order independently.
    const [localRaw,virtualRaw,clockRaw,positionsRaw,ordersRaw,parentRaw]=await Promise.all([
      readDb("paper_bot_orders?symbol=eq."+encodeURIComponent(symbol)+
        "&asset_class=in.(stock,etf)&select=bot_id,client_order_id,symbol,asset_class,status,side&limit=500"),
      readDb("paper_bot_positions?symbol=eq."+encodeURIComponent(symbol)+
        "&asset_class=in.(stock,etf)&select=symbol,quantity,bot_id&limit=500"),
      readBroker("clock"),readBroker("positions"),
      readBroker("orders?status=open&limit=500&nested=false"),
      readBroker("orders:by_client_order_id?client_order_id="+encodeURIComponent(owner.client_order_id),true),
    ]);
    const local=z.array(localOrderSchema).parse(localRaw);
    const virtual=z.array(z.object({bot_id:z.string(),symbol:z.string(),
      quantity:z.coerce.number()})).parse(virtualRaw);
    const clock=z.object({is_open:z.boolean()}).parse(clockRaw.payload);
    const positions=z.array(brokerSymbol).parse(positionsRaw.payload);
    const open=z.array(brokerSymbol).parse(ordersRaw.payload);
    const origin=local.find(o=>o.client_order_id===owner.client_order_id&&
      o.bot_id===owner.bot_id&&o.symbol===symbol&&o.side==="buy");
    const parent=parentRaw.status===404?null:brokerParent.parse(parentRaw.payload);
    const originTerminal=Boolean(origin&&terminalLocal.has(origin.status));
    const brokerParentTerminal=parent===null?originTerminal:Boolean(
      parent.client_order_id===owner.client_order_id&&parent.symbol===symbol&&
      parent.side==="buy"&&terminalBroker.has(parent.status));
    const localClear=local.length<500&&local.every(o=>!activeLocal.has(o.status)&&
      terminalLocal.has(o.status));
    const virtualClear=virtual.length<500&&virtual.every(p=>p.quantity===0);
    const brokerPositionsClear=positions.length<500&&!positions.some(p=>p.symbol===symbol);
    const brokerOpenOrdersClear=open.length<500&&!open.some(o=>o.symbol===symbol);
    const reasons:string[]=[];
    if(clock.is_open)reasons.push("PAPER stock market must be closed.");
    if(!originTerminal)reasons.push("Originating virtual buy must be terminal/reconciled.");
    if(!brokerParentTerminal)reasons.push("Alpaca parent buy is not terminal.");
    if(!localClear)reasons.push("Unresolved virtual stock orders remain.");
    if(!virtualClear)reasons.push("Virtual stock shares remain or scan incomplete.");
    if(!brokerPositionsClear)reasons.push("Alpaca holds physical shares or position scan incomplete.");
    if(!brokerOpenOrdersClear)reasons.push("Alpaca has open orders or order scan incomplete.");
    const checkedAt=new Date().toISOString();
    const ready=reasons.length===0;
    if(!release)return reply({ok:ready,paperOnly:true,readOnly:true,
      reservationId:id,symbol,botId:owner.bot_id,clientOrderId:owner.client_order_id,
      brokerMarketOpen:clock.is_open,releaseEligibleForOperatorReview:ready,reasons});

    if(!ready)return reply({ok:false,action:"release-blocked",paperOnly:true,
      symbol,reasons},409);
    // A secret plus explicit confirmation is necessary but not sufficient.
    // The database *rechecks* the local order, unapplied fills, stock
    // position, journal sync freshness, owner identity and global symbol lock
    // in the same transaction that releases & audits the reservation.
    const proof:DbRecord={source:"alpaca-paper-independent-audit-v1",
      brokerHost:"paper-api.alpaca.markets",checkedAt,
      symbol,botId:owner.bot_id,clientOrderId:owner.client_order_id,
      operatorConfirmed:true,brokerMarketOpen:false,
      brokerPositionsClear:true,brokerOpenOrdersClear:true,
      brokerParentTerminal:true};
    const r=await fetch(DB+"/rest/v1/rpc/paper_stock_symbol_release_verified",{
      method:"POST",headers:dh,body:JSON.stringify({
        p_reservation_id:id,p_client_order_id:owner.client_order_id,p_proof:proof,
      }),cache:"no-store",signal:AbortSignal.timeout(12000),
    });
    if(!r.ok)throw Error("PAPER release transaction HTTP "+r.status);
    const released=await r.json();
    return released===true?reply({ok:true,paperOnly:true,action:"released",
      reservationId:id,symbol,clientOrderId:owner.client_order_id}):
      reply({ok:false,paperOnly:true,action:"release-denied-by-db",
        reason:"Local broker-fill/ledger/report proof failed or reservation no longer active."},409);
  }catch(error){
    return reply({ok:false,paperOnly:true,
      error:error instanceof Error?error.message:"PAPER release audit unavailable."},503);
  }
}
export async function GET(request:Request){return handle(request,false);}
export async function POST(request:Request){return handle(request,true);}
