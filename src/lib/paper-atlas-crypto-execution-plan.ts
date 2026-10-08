import type {AtlasExecutionReferencePlan} from "@/lib/paper-atlas-execution-plan";

export const ATLAS_CRYPTO_ESTIMATED_FEE_BPS_PER_SIDE=25;

export type AtlasCryptoExecutionInput={
  ask:number|null;
  quoteAgeMs:number|null;
  referencePlan:AtlasExecutionReferencePlan;
  cash:number;
  poolRemaining:number;
  feeBpsPerSide?:number;
};

const finitePositive=(value:unknown):value is number =>
  typeof value==="number"&&Number.isFinite(value)&&value>0;

const floorQty=(value:number)=>Math.floor((value+Number.EPSILON)*1_000_000_000)/1_000_000_000;

export function buildAtlasCryptoExecutionPlan(input:AtlasCryptoExecutionInput){
  const blockers:string[]=[];
  const {entryTrigger,stopPrice,exitPrice,riskDollars,uncappedPositionValue}=input.referencePlan;
  const feeBps=Math.max(0,input.feeBpsPerSide??ATLAS_CRYPTO_ESTIMATED_FEE_BPS_PER_SIDE);
  const feeRate=feeBps/10_000;

  if(!finitePositive(input.ask))blockers.push("A positive executable crypto ask is required.");
  if(input.quoteAgeMs===null||!Number.isFinite(input.quoteAgeMs)||input.quoteAgeMs<0||input.quoteAgeMs>60_000)
    blockers.push("Crypto execution quote must be no more than 60 seconds old.");
  if(!finitePositive(entryTrigger)||!finitePositive(stopPrice)||!finitePositive(exitPrice)
     ||!finitePositive(riskDollars)||!finitePositive(uncappedPositionValue)
     ||stopPrice>=entryTrigger||exitPrice<=entryTrigger)
    blockers.push("Atlas crypto reference entry/stop/exit/risk plan is incomplete.");

  const stopDistancePct=finitePositive(entryTrigger)&&finitePositive(stopPrice)&&stopPrice<entryTrigger
    ?(entryTrigger-stopPrice)/entryTrigger*100:null;
  if(stopDistancePct===null||stopDistancePct>8)
    blockers.push("Atlas crypto reference stop distance exceeds the 8.00% execution ceiling.");

  const maxEntry=finitePositive(entryTrigger)?entryTrigger*1.006:null;
  if(finitePositive(input.ask)&&finitePositive(entryTrigger)&&input.ask<entryTrigger)
    blockers.push("Atlas crypto breakout trigger has not been reached.");
  if(finitePositive(input.ask)&&finitePositive(maxEntry)&&input.ask>maxEntry)
    blockers.push("Atlas crypto entry is beyond the 0.60% chase ceiling.");

  let quantity=0;
  let requestedNotional=0;
  let estimatedEntryFee=0;
  let reservedAmount=0;
  let plannedRiskDollars=0;

  if(!blockers.length&&finitePositive(maxEntry)&&finitePositive(stopPrice)
     &&finitePositive(riskDollars)&&finitePositive(uncappedPositionValue)){
    const roundTripRiskPerUnit=(maxEntry-stopPrice)+(maxEntry*feeRate)+(stopPrice*feeRate);
    const grossCapacity=Math.min(Math.max(0,input.cash),Math.max(0,input.poolRemaining),uncappedPositionValue);
    const quantityByNotional=grossCapacity/(maxEntry*(1+feeRate));
    const quantityByRisk=riskDollars/roundTripRiskPerUnit;
    quantity=floorQty(Math.min(quantityByNotional,quantityByRisk));
    requestedNotional=quantity*maxEntry;
    estimatedEntryFee=requestedNotional*feeRate;
    reservedAmount=requestedNotional+estimatedEntryFee;
    plannedRiskDollars=quantity*roundTripRiskPerUnit;
    if(!(quantity>0)||requestedNotional<1)
      blockers.push("Atlas crypto risk/cash/pool limits do not support the $1 minimum paper entry.");
    if(reservedAmount>Math.min(Math.max(0,input.cash),Math.max(0,input.poolRemaining))+0.000001)
      blockers.push("Atlas crypto entry plus estimated fee exceeds available funded capacity.");
  }

  return {
    executable:blockers.length===0,
    blockers:[...new Set(blockers)],
    maxEntryPrice:finitePositive(maxEntry)?Number(maxEntry.toFixed(8)):null,
    quantity:quantity>0?quantity:null,
    requestedNotional:requestedNotional>0?Number(requestedNotional.toFixed(6)):null,
    estimatedEntryFee:estimatedEntryFee>0?Number(estimatedEntryFee.toFixed(6)):null,
    reservedAmount:reservedAmount>0?Number(reservedAmount.toFixed(6)):null,
    plannedRiskDollars:plannedRiskDollars>0?Number(plannedRiskDollars.toFixed(6)):null,
    feeBpsPerSide:feeBps,
  };
}

export function atlasCryptoExecutionPool(approvedPools:readonly string[]){
  if(approvedPools.includes("multi-day"))return "multi-day" as const;
  if(approvedPools.includes("multi-week"))return "multi-week" as const;
  return null;
}
