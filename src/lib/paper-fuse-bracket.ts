import { FUSE_PENNY_STRATEGY_V1 as cfg } from "./paper-fuse-strategy-config";

/**
 * Converts a qualifying Fuse research signal into a conservative, broker-legal
 * WHOLE-SHARE bracket preview. This module never places orders.
 *
 * Alpaca restricts both stop/limit price precision and requires a $0.01
 * minimum gap between stop-loss sell and entry/current market reference.
 */
export type FuseBracketCandidate = {
  symbol:string;readiness:string;blockers:string[];quoteAgeSeconds:number|null;
  bid:number|null;ask:number|null;entryTrigger:number|null;maximumEntry:number|null;
  plannedShares:number;
  plan:{stopPrice:number|null;exitPrice:number|null};
};
export type FuseBracketLedger = {equity:number;buyingPower:number};
export type FuseBracketOrder = {
  symbol:string;qty:number;limitPrice:number;stopPrice:number;takeProfitPrice:number;
  plannedNotional:number;plannedLoss:number;maxRisk:number;maxCash:number;
  orderClass:"bracket";timeInForce:"day";entryType:"limit";
};
export type FuseBracketPreview =
  | {eligible:true;order:FuseBracketOrder;blockers:[]}
  | {eligible:false;order:null;blockers:string[]};

function positive(value:unknown):value is number {
  return typeof value==="number" && Number.isFinite(value) && value>0;
}
function tick(value:number){return value>=1?0.01:0.0001;}
function ceilBrokerPrice(value:number):number {
  const t=tick(value);
  return Number((Math.ceil(value/t-1e-9)*t).toFixed(4));
}
function floorBrokerPrice(value:number):number {
  const t=tick(value);
  return Number((Math.floor(value/t+1e-9)*t).toFixed(4));
}
export function fuseBracketPreview(candidate:FuseBracketCandidate,ledger:FuseBracketLedger):FuseBracketPreview {
  const blockers:string[]=[];
  if(candidate.readiness!=="research-ready"||candidate.blockers.length>0)
    blockers.push("Fuse original signal is not research-ready.");
  if(!/^[A-Z][A-Z0-9.]{0,15}$/.test(candidate.symbol))
    blockers.push("Invalid equity symbol.");
  if(candidate.quoteAgeSeconds===null||candidate.quoteAgeSeconds<0||
    candidate.quoteAgeSeconds>cfg.market.maximumQuoteAgeSeconds)
    blockers.push("Live quote is stale or unavailable.");
  const {bid,ask,entryTrigger,maximumEntry}=candidate;
  const stop=candidate.plan.stopPrice,target=candidate.plan.exitPrice;
  if(!positive(bid)||!positive(ask)||ask<bid||!positive(entryTrigger)||!positive(maximumEntry)||
    !positive(stop)||!positive(target))
    blockers.push("Missing or invalid broker reference prices.");
  if(!Number.isSafeInteger(candidate.plannedShares)||candidate.plannedShares<=0)
    blockers.push("Fuse entry must be at least one whole share.");
  if(!positive(ledger.equity)||!positive(ledger.buyingPower))
    blockers.push("Fuse virtual ledger is not funded.");
  if(blockers.length)return {eligible:false,order:null,blockers};

  const limitPrice=ceilBrokerPrice(ask!);
  const stopPrice=ceilBrokerPrice(stop!); // never worsen the declared loss limit
  const takeProfitPrice=ceilBrokerPrice(target!);
  const capEntry=floorBrokerPrice(maximumEntry!);
  if(limitPrice>capEntry+1e-9)
    blockers.push("Broker-valid entry exceeds the strategy's maximum chase price.");
  if(!(entryTrigger!<=limitPrice&&stopPrice<limitPrice&&takeProfitPrice>limitPrice))
    blockers.push("Bracket trigger, stop and target do not surround the entry.");
  // Alpaca may reject a stop closer than one cent to either the entry
  // limit or the contemporaneous market base price.
  if(Math.min(limitPrice,bid!)-stopPrice<0.01-1e-9)
    blockers.push("Alpaca advanced-order stop must be at least $0.01 below entry and market base.");
  const maxRisk=ledger.equity*cfg.risk.riskPerTradePct/100;
  const maxCash=Math.min(ledger.buyingPower,ledger.equity*cfg.risk.maximumAllocationPct/100);
  const perShareRisk=limitPrice-stopPrice;
  const riskShares=perShareRisk>0?Math.floor((maxRisk+1e-9)/perShareRisk):0;
  const cashShares=Math.floor((maxCash+1e-9)/limitPrice);
  const qty=Math.max(0,Math.min(candidate.plannedShares,riskShares,cashShares));
  if(qty<1)blockers.push("No whole share fits Fuse risk and allocation at the broker limit price.");
  if(blockers.length)return {eligible:false,order:null,blockers};

  return {eligible:true,blockers:[],order:{
    symbol:candidate.symbol,qty,limitPrice,stopPrice,takeProfitPrice,
    plannedNotional:Number((qty*limitPrice).toFixed(6)),
    plannedLoss:Number((qty*perShareRisk).toFixed(6)),
    maxRisk:Number(maxRisk.toFixed(6)),maxCash:Number(maxCash.toFixed(6)),
    orderClass:"bracket",timeInForce:"day",entryType:"limit",
  }};
}
