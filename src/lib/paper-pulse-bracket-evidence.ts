/** Read-only broker-evidence check for a whole-share Pulse PAPER bracket.
 * Existence of leg IDs alone is NOT proof that sells are live or cover shares.
 * A successful snapshot does not replace continuous broker reconciliation.
 */
export type PulseBracketLeg={
  id?:string;client_order_id?:string;symbol?:string;side?:string;
  type?:string;status?:string;qty?:string;filled_qty?:string;
  limit_price?:string|null;stop_price?:string|null;
};
export type PulseBracketParent=PulseBracketLeg & {
  order_class?:string;legs?:PulseBracketLeg[]|null;
};

const protectiveStatuses=new Set([
  "new","accepted","held","pending_new","accepted_for_bidding","partially_filled",
]);
function nonnegativeQuantity(raw:unknown):number|null{
  if(typeof raw!=="string"||!/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(raw))return null;
  const value=Number(raw);
  return Number.isFinite(value)&&value>=0?value:null;
}
function remaining(leg:PulseBracketLeg):number|null {
  const qty=nonnegativeQuantity(leg.qty);
  const filled=nonnegativeQuantity(leg.filled_qty);
  if(qty===null||filled===null||filled>qty)return null;
  return qty-filled;
}
function atLeastPrice(raw:unknown,minimum:number):boolean{
  if(typeof raw!=="string"||!/^\d+(?:\.\d+)?$/.test(raw))return false;
  const price=Number(raw);
  return Number.isFinite(price)&&price>0&&price+0.000001>=minimum;
}
export function auditPulseBrokerBracket(input:{
  parent:PulseBracketParent;
  brokerOrderId:string;
  clientOrderId:string;
  symbol:string;
  quantity:number;
  authorizedStop:number;
  authorizedTarget:number;
}):{verified:boolean;stopLegObserved:boolean;targetLegObserved:boolean}{
  const {parent,brokerOrderId,clientOrderId,symbol,quantity,authorizedStop,authorizedTarget}=input;
  const legs=parent.legs;
  const sells=Array.isArray(legs)?legs.filter(l=>l.side==="sell"&&l.symbol===symbol):[];
  const stops=sells.filter(l=>l.type==="stop"||l.type==="stop_limit");
  const targets=sells.filter(l=>l.type==="limit");
  const stopLegObserved=stops.some(l=>typeof l.id==="string"&&l.id.length>0);
  const targetLegObserved=targets.some(l=>typeof l.id==="string"&&l.id.length>0);
  const parentValid=parent.id===brokerOrderId&&parent.client_order_id===clientOrderId&&
    parent.symbol===symbol&&parent.side==="buy"&&parent.type==="market"&&
    parent.order_class==="bracket"&&Number.isSafeInteger(quantity)&&quantity>=1;
  if(!parentValid||stops.length!==1||targets.length!==1||!Number.isFinite(authorizedStop)||
     !Number.isFinite(authorizedTarget)||authorizedStop<=0||authorizedTarget<=authorizedStop)
    return {verified:false,stopLegObserved,targetLegObserved};
  const stop=stops[0],target=targets[0];
  const validLeg=(l:PulseBracketLeg)=>Boolean(l.id&&l.client_order_id)&&
    protectiveStatuses.has(l.status??"")&&remaining(l)!==null&&
    remaining(l)!+0.00000001>=quantity;
  const verified=validLeg(stop)&&validLeg(target)&&stop.id!==target.id&&
    atLeastPrice(stop.stop_price,authorizedStop)&&
    atLeastPrice(target.limit_price,authorizedTarget);
  return {verified,stopLegObserved,targetLegObserved};
}
