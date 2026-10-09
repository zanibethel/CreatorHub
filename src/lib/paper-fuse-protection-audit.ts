import { FUSE_PENNY_STRATEGY_V1 as cfg } from "./paper-fuse-strategy-config";
import { parsePaperClientOrderId } from "./paper-order-attribution";

export type FuseBrokerLeg = {
  id?:string;client_order_id?:string;symbol?:string;side?:string;
  status?:string;type?:string;order_type?:string;order_class?:string;
  qty?:string;filled_qty?:string;stop_price?:string|null;limit_price?:string|null;
};
export type FuseBrokerParent = FuseBrokerLeg & {
  legs?:FuseBrokerLeg[]|null;time_in_force?:string;filled_avg_price?:string|null;
};
export type FuseAuditEntry = {
  client_order_id:string;symbol:string;side:string;status:string;
  broker_order_id:string|null;requested_quantity:number|null;
  entry_trigger:number|null;max_entry_price:number|null;
  protective_stop:number|null;take_profit_price:number|null;
};
export type FuseAuditPosition = {symbol:string;qty:string;qty_available?:string};
export type FuseProtectionStatus =
  "awaiting-entry"|"broker-flat"|"protected"|"unprotected"|"unconfirmed"|"ownership-collision";
export type FuseProtectionResult = {
  symbol:string;clientOrderId:string;state:FuseProtectionStatus;
  brokerPositionQuantity:number;brokerFilledQuantity:number;stopAt:number|null;
  targetAt:number|null;issues:string[];
};
const active=new Set(["new","accepted","held","partially_filled","pending_new","accepted_for_bidding"]);
function validNumber(s:unknown):number|null {
  if(typeof s!=="number"&&typeof s!=="string")return null;
  if(s===null||s===""||typeof s==="string"&&!/^\d+(?:\.\d+)?$/.test(s))return null;
  const v=Number(s);
  return Number.isFinite(v)&&v>=0?v:null;
}
function isActive(leg:FuseBrokerLeg){return active.has(leg.status??"");}
function legQty(leg:FuseBrokerLeg) {
  const requested=validNumber(leg.qty),filled=validNumber(leg.filled_qty);
  return requested===null||filled===null||filled>requested?null:requested-filled;
}

/** A read-only reconciliation snapshot, never a substitute for a protective manager. */
export function auditFuseBrokerBracket(input:{
  entry:FuseAuditEntry;parent:FuseBrokerParent|null;brokerPosition:FuseAuditPosition|null;
  otherBotOwnsSymbol:boolean;liveSellOrders:FuseBrokerLeg[];
}):FuseProtectionResult {
  const {entry,parent,brokerPosition,otherBotOwnsSymbol,liveSellOrders}=input;
  const issues:string[]=[];
  const quantity=validNumber(brokerPosition?.qty)??0;
  const filled=validNumber(parent?.filled_qty)??0;
  const result=(state:FuseProtectionStatus,stopAt:number|null=null,targetAt:number|null=null):FuseProtectionResult=>({
    symbol:entry.symbol,clientOrderId:entry.client_order_id,state,brokerPositionQuantity:quantity,
    brokerFilledQuantity:filled,stopAt,targetAt,issues,
  });
  const attribution=parsePaperClientOrderId(entry.client_order_id);
  if(!attribution||attribution.botId!==cfg.botProfileId||
     attribution.strategyVersion!==cfg.version||entry.side!=="buy"||
     !/^[A-Z][A-Z0-9.]{0,15}$/.test(entry.symbol)) {
    issues.push("Fuse local order identity is not independently attributable.");
    return result("unconfirmed");
  }
  if(otherBotOwnsSymbol){
    issues.push("Another virtual bot owns this broker symbol.");
    return result("ownership-collision");
  }
  if(!parent){
    issues.push("Alpaca broker parent order could not be independently confirmed.");
    return result("unconfirmed");
  }
  if(!parent.id||parent.id!==entry.broker_order_id||
     parent.client_order_id!==entry.client_order_id||parent.symbol!==entry.symbol||
     parent.side!=="buy"||parent.order_class!=="bracket"||
     parent.type!=="limit"||parent.time_in_force!=="day"){
    issues.push("Alpaca parent order attribution, type, or session is wrong.");
    return result("unconfirmed");
  }
  if(filled>0&&quantity<=0){
    issues.push("Broker is flat after a fill; virtual-ledger fill and exit reconciliation must be checked.");
    return result("broker-flat");
  }
  if(quantity>0&&filled<=0){
    issues.push("Broker holds shares but the attributed entry has no verified fill.");
    return result("unconfirmed");
  }
  if(filled<=0)return result("awaiting-entry");
  const plannedQty=entry.requested_quantity;
  if(!Number.isInteger(plannedQty)||plannedQty===null||plannedQty<1||
     filled>plannedQty+1e-8||quantity>filled+1e-8){
    issues.push("Broker share quantity is incompatible with Fuse's attributed whole-share entry.");
    return result("unconfirmed");
  }
  if(!Number.isInteger(quantity)){
    issues.push("Fuse's whole-share broker position is fractional or ambiguous.");
    return result("unconfirmed");
  }
  const expectedStop=entry.protective_stop,expectedTarget=entry.take_profit_price;
  if(expectedStop===null||expectedTarget===null||!Number.isFinite(expectedStop)||
     !Number.isFinite(expectedTarget)||expectedStop<=0||expectedTarget<=expectedStop){
    issues.push("Fuse protective loss or target from stored plan is invalid.");
    return result("unconfirmed");
  }
  const children=parent.legs;
  if(!Array.isArray(children)) {
    issues.push("Alpaca did not return nested bracket exit legs.");
    return result("unprotected");
  }
  const sellChildren=children.filter(leg=>leg.side==="sell"&&leg.symbol===entry.symbol);
  const stops=sellChildren.filter(leg=>["stop","stop_limit"].includes(leg.type??"")&&isActive(leg));
  const targets=sellChildren.filter(leg=>leg.type==="limit"&&isActive(leg));
  if(stops.length!==1||targets.length!==1){
    issues.push("Expected exactly one live bracket stop and one live profit target.");
    return result("unprotected");
  }
  const stop=stops[0],target=targets[0];
  const stopAt=validNumber(stop.stop_price),targetAt=validNumber(target.limit_price);
  if(stopAt===null||targetAt===null||
     stopAt+0.000001<expectedStop||targetAt+0.000001<expectedTarget){
    issues.push("Broker stop or profit target is worse than Fuse's authorized plan.");
  }
  const stopRemaining=legQty(stop),targetRemaining=legQty(target);
  if(stopRemaining===null||targetRemaining===null||
    Math.abs(stopRemaining-quantity)>1e-8||
    Math.abs(targetRemaining-quantity)>1e-8){
    issues.push("Remaining protective and target leg quantities do not cover the broker position.");
  }
  const expectedChildIds=new Set([stop.id,target.id].filter(Boolean));
  if(expectedChildIds.size!==2||
     !liveSellOrders.some(o=>o.id===stop.id&&o.client_order_id===stop.client_order_id)||
     !liveSellOrders.some(o=>o.id===target.id&&o.client_order_id===target.client_order_id)||
     liveSellOrders.some(o=>o.symbol===entry.symbol&&o.side==="sell"&&isActive(o)&&!expectedChildIds.has(o.id))){
    issues.push("Open Alpaca sell orders cannot be reconciled exactly to the bracket children.");
  }
  return result(issues.length?"unprotected":"protected",stopAt,targetAt);
}
