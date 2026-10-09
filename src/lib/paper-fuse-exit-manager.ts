import type { FuseProtectionResult } from "./paper-fuse-protection-audit";

export const FUSE_ACTIVE_PAPER_ORDER_STATUSES=new Set([
  "new","accepted","held","partially_filled","pending_new","accepted_for_bidding",
  "pending_replace","pending_cancel",
]);
export type FuseExitDecision =
  | "market-closed"|"awaiting-entry"|"cancel-pending-entry"|"protected"
  | "cancel-bracket-exits"|"flatten-ready"|"broker-flat"|"manual-reconciliation";

export function fuseExitWindow(when:number) {
  const parts=new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",
    weekday:"short",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date(when));
  const p=Object.fromEntries(parts.map(item=>[item.type,item.value]));
  const minute=Number(p.hour)*60+Number(p.minute);
  return {regularWeekday:!["Sat","Sun"].includes(p.weekday),
    entryCutoff:minute>=15*60+40,
    regularClockMinute:minute>=9*60+30&&minute<16*60};
}

/** One flat order per Fuse parent, stable under concurrent minute crons. */
export function fuseFlattenOrderId(parentClientId:string):string|null {
  if(!/^chb-pny-v[1-9][0-9]*-[a-z0-9]+-[a-z0-9]{6,24}$/.test(parentClientId)||
      parentClientId.length>110)return null;
  return parentClientId+"-fx";
}

/** Decide only; actual broker calls MUST additionally revalidate current positions and orders. */
export function chooseFuseExitAction(input:{
  marketOpen:boolean;regularClockMinute:boolean;flattenDue:boolean;
  brokerQty:number;virtualQty:number;entryFilledQty:number;
  entryPending:boolean;stopOrTargetActive:boolean;
  foreignSymbolOrder:boolean;parentVerified:boolean;
  protection:FuseProtectionResult;
}):{action:FuseExitDecision;reason:string} {
  const i=input,deny=(reason:string)=>({action:"manual-reconciliation" as const,reason});
  if(!i.parentVerified)return deny("Fuse parent broker identity/type cannot be verified.");
  if(!Number.isSafeInteger(i.brokerQty)||!Number.isSafeInteger(i.virtualQty)||
     !Number.isSafeInteger(i.entryFilledQty)||i.brokerQty<0||i.virtualQty<0||
     i.entryFilledQty<0||i.brokerQty>i.entryFilledQty)
    return deny("Broker fill/position share attribution is not safe.");
  if(i.foreignSymbolOrder||i.protection.state==="ownership-collision")
    return deny("The shared PAPER symbol belongs to another owner or an unknown broker order.");
  if(i.brokerQty!==i.virtualQty)
    return deny("Fuse virtual and physical share counts do not match.");
  if(!i.marketOpen||!i.regularClockMinute)return {action:"market-closed",reason:"Cannot cancel or flatten outside verified stock-session clock."};
  if(i.entryPending&&(i.flattenDue||i.brokerQty>0))
    return {action:"cancel-pending-entry",reason:"Cancel remaining buy before managing a partial fill or session cutoff."};
  if(i.brokerQty===0) {
    if(i.flattenDue&&i.entryPending)
      return {action:"cancel-pending-entry",reason:"Reject unfilled carryover into the session close."};
    return {action:i.entryFilledQty>0?"broker-flat":"awaiting-entry",
      reason:"No broker shares are currently held."};
  }
  if(i.protection.state==="protected"&&!i.flattenDue)
    return {action:"protected",reason:"Both Alpaca bracket exits remain broker verified."};
  if(i.stopOrTargetActive)
    return {action:"cancel-bracket-exits",
      reason:i.flattenDue?"Cancel existing OCO children and verify cancellation before session flatten.":
        "Existing broken OCO children must be canceled before an emergency sell."};
  if(i.protection.state==="unconfirmed"||i.protection.state==="awaiting-entry")
    return deny("Cannot establish that the held shares are protected or attributable.");
  return {action:"flatten-ready",reason:i.flattenDue?
    "Session cutoff requires a broker-verified flat exit.":"Broker-hosted stop/target is missing or invalid; emergency exit required."};
}
