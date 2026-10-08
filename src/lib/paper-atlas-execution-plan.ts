export type AtlasExecutionReferencePlan = {
  entryTrigger:number|null;
  stopPrice:number|null;
  exitPrice:number|null;
  riskDollars:number|null;
  uncappedPositionValue:number|null;
};

export type AtlasStockExecutionInput = {
  ask:number|null;
  quoteAgeMs:number|null;
  referencePlan:AtlasExecutionReferencePlan;
  cash:number;
  poolRemaining:number;
  fractionable:boolean;
};

const finitePositive=(value:unknown):value is number =>
  typeof value==="number"&&Number.isFinite(value)&&value>0;

const floorQty=(value:number)=>Math.floor((value+Number.EPSILON)*1_000_000_000)/1_000_000_000;

export function buildAtlasStockExecutionPlan(input:AtlasStockExecutionInput){
  const blockers:string[]=[];
  const {entryTrigger,stopPrice,exitPrice,riskDollars,uncappedPositionValue}=input.referencePlan;

  if(!input.fractionable) blockers.push("Broker asset must support fractional shares.");
  if(!finitePositive(input.ask)) blockers.push("A positive executable ask is required.");
  if(input.quoteAgeMs===null||!Number.isFinite(input.quoteAgeMs)||input.quoteAgeMs<0||input.quoteAgeMs>60_000)
    blockers.push("Execution quote must be no more than 60 seconds old.");
  if(!finitePositive(entryTrigger)||!finitePositive(stopPrice)||!finitePositive(exitPrice)
     ||!finitePositive(riskDollars)||!finitePositive(uncappedPositionValue)
     ||stopPrice>=entryTrigger||exitPrice<=entryTrigger)
    blockers.push("Atlas reference entry/stop/exit/risk plan is incomplete.");

  const referenceStopDistancePct=finitePositive(entryTrigger)&&finitePositive(stopPrice)&&stopPrice<entryTrigger
    ?(entryTrigger-stopPrice)/entryTrigger*100:null;
  if(referenceStopDistancePct===null||referenceStopDistancePct>8)
    blockers.push("Atlas reference stop distance exceeds the 8.00% execution ceiling.");

  const maxEntry=finitePositive(entryTrigger)?entryTrigger*1.006:null;
  if(finitePositive(input.ask)&&finitePositive(entryTrigger)&&input.ask<entryTrigger)
    blockers.push("Atlas breakout trigger has not been reached.");
  if(finitePositive(input.ask)&&finitePositive(maxEntry)&&input.ask>maxEntry)
    blockers.push("Atlas entry is beyond the 0.60% chase ceiling.");

  const cash=Math.max(0,input.cash);
  const pool=Math.max(0,input.poolRemaining);
  let quantity=0;
  let requestedNotional=0;
  let plannedRiskDollars=0;

  if(!blockers.length&&finitePositive(maxEntry)&&finitePositive(stopPrice)
     &&finitePositive(riskDollars)&&finitePositive(uncappedPositionValue)){
    const riskPerShare=maxEntry-stopPrice;
    if(!(riskPerShare>0)) blockers.push("Worst-case entry must remain above the protective stop.");
    else{
      const notionalCap=Math.min(uncappedPositionValue,cash,pool);
      const quantityByNotional=notionalCap/maxEntry;
      const quantityByRisk=riskDollars/riskPerShare;
      quantity=floorQty(Math.min(quantityByNotional,quantityByRisk));
      requestedNotional=quantity*maxEntry;
      plannedRiskDollars=quantity*riskPerShare;
      if(!(quantity>0)||requestedNotional<1)
        blockers.push("Atlas risk/cash/pool limits do not support the $1 minimum paper entry.");
    }
  }

  return {
    executable:blockers.length===0,
    blockers:[...new Set(blockers)],
    maxEntryPrice:finitePositive(maxEntry)?Number(maxEntry.toFixed(4)):null,
    quantity:quantity>0?quantity:null,
    requestedNotional:requestedNotional>0?Number(requestedNotional.toFixed(6)):null,
    plannedRiskDollars:plannedRiskDollars>0?Number(plannedRiskDollars.toFixed(6)):null,
  };
}

export function atlasExecutionPool(approvedPools:readonly string[]){
  if(approvedPools.includes("day")) return "day" as const;
  if(approvedPools.includes("multi-day")) return "multi-day" as const;
  if(approvedPools.includes("multi-week")) return "multi-week" as const;
  return null;
}

export function atlasPoolCapFraction(pool:"day"|"multi-day"|"multi-week"){
  return pool==="day" ? 0.20 : 0.40;
}
