// Strictly private Alpaca PAPER trade_updates normalization. No account IDs,
// credentials, raw provider payload, or customer data are persisted.
type Dict=Record<string,unknown>;
const obj=(x:unknown):Dict|null=>x!==null&&typeof x==="object"&&!Array.isArray(x)?x as Dict:null;
const str=(x:unknown,max:number):string|null=>typeof x==="string"&&x.length>0&&x.length<=max?x:null;
const num=(x:unknown):string|null=>{
  if(typeof x!=="string"&&typeof x!=="number")return null;
  const s=String(x);
  return /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]{1,12})?$/.test(s)&&Number.isFinite(Number(s))?s:null;
};
const ts=(x:unknown):string|null=>{
  const s=str(x,45);
  return s&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?(?:Z|[+-]\d\d:\d\d)$/.test(s)&&
    Number.isFinite(Date.parse(s))?s:null;
};
const hex=async(value:string)=>{
  const bytes=new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value)));
  return [...bytes].map(x=>x.toString(16).padStart(2,"0")).join("");
};
export type StreamEvent={
  eventHash:string;event:string;brokerOrderId:string;clientOrderId:string|null;
  symbol:string;eventTimestampRaw:string|null;orderUpdatedAtRaw:string|null;
  side:string|null;status:string|null;orderClass:string|null;orderType:string|null;
  orderQuantity:string|null;cumulativeFillQuantity:string|null;
  eventFillQuantity:string|null;eventFillPrice:string|null;positionQuantity:string|null;
  executionId:string|null;brokerEventId:string|null;details:Dict;
};
export async function normalizeTradeUpdate(raw:unknown):Promise<StreamEvent>{
  const frame=obj(raw);
  if(frame?.stream!=="trade_updates")throw Error("Only Alpaca PAPER trade_updates frames are accepted.");
  const eventData=obj(frame.data),order=obj(eventData?.order);
  if(!eventData||!order)throw Error("Missing broker trade update order.");
  const event=str(eventData.event,40),id=str(order.id,80),
    symbol=str(order.symbol,32);
  if(!event||!/^[a-z][a-z_]{1,39}$/.test(event)||
     !id||!/^[0-9a-f]{8}-[0-9a-f-]{27,40}$/i.test(id)||
     !symbol||!/^[A-Za-z0-9./_-]{1,32}$/.test(symbol))
    throw Error("Malformed broker trade update identity.");
  const details:Dict={
    stopPrice:num(order.stop_price),limitPrice:num(order.limit_price),
    canceledAt:ts(order.canceled_at),replacedAt:ts(order.replaced_at),
    filledAt:ts(order.filled_at),
    cancelRequestedAt:ts(order.cancel_requested_at),
    replaces:str(order.replaces,80),replacedBy:str(order.replaced_by,80),
  };
  const clean:Omit<StreamEvent,"eventHash">={
    event,brokerOrderId:id,clientOrderId:str(order.client_order_id,128),
    symbol,eventTimestampRaw:ts(eventData.timestamp)??ts(eventData.at)??ts(order.updated_at),
    orderUpdatedAtRaw:ts(order.updated_at),
    side:str(order.side,12),status:str(order.status,40),
    orderClass:str(order.order_class,40),orderType:str(order.type,40),
    orderQuantity:num(order.qty),cumulativeFillQuantity:num(order.filled_qty),
    eventFillQuantity:num(eventData.qty),eventFillPrice:num(eventData.price),
    positionQuantity:num(eventData.position_qty),
    executionId:str(eventData.execution_id,128),
    brokerEventId:str(eventData.event_id,128),
    details,
  };
  // The hash includes the exact order event and its precise time/quantity,
  // but excludes local receipt time so reconnect replays are idempotent.
  return {...clean,eventHash:await hex(JSON.stringify(clean))};
}
