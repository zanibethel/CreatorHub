import { CRYPTO_IGNITION_STRATEGY_V1 as strategy } from "./paper-crypto-ignition-strategy-config";
import type { CryptoBar } from "./paper-weekend-crypto-readiness";

const positive=(value:unknown):value is number=>typeof value==="number"&&Number.isFinite(value)&&value>0;
const average=(values:number[])=>values.length?values.reduce((sum,value)=>sum+value,0)/values.length:null;

export type CryptoIgnitionSourceCandidate={
  symbol:string;
  score:number;
  bid:number|null;
  ask:number|null;
  spreadPct:number|null;
  quoteAgeSeconds:number|null;
  fastMomentumPct:number|null;
  slowMomentumPct:number|null;
  atrPct:number|null;
  trigger:number|null;
  maxEntry:number|null;
  trackingBars:CryptoBar[];
};
export type CryptoIgnitionLedger={
  active:boolean; equity:number; buyingPower:number; openRiskPct:number;
  dailyRealizedLossPct:number; openPositions:number; dailyNewEntries:number; executionEnabled:boolean;
};

export function evaluateCryptoIgnitionCandidate(input:{
  source:CryptoIgnitionSourceCandidate;
  ledger:CryptoIgnitionLedger;
  symbolOccupiedByOtherBot:boolean;
}){
  const {source,ledger}=input;
  const waitingOn:string[]=[]; const blockers:string[]=[];
  const bars=source.trackingBars;
  const latestVolume=bars.at(-1)?.v??null;
  const priorVolumes=bars.slice(-7,-1).map(bar=>bar.v??0).filter(v=>v>0);
  const priorVolume=average(priorVolumes);
  const relativeVolume=positive(latestVolume)&&positive(priorVolume)?latestVolume/priorVolume:null;

  if(!ledger.active)blockers.push("Spark virtual ledger is not active.");
  if(input.symbolOccupiedByOtherBot)blockers.push("Another bot already holds this symbol.");
  if(ledger.openPositions>=strategy.cadence.maximumOpenPositions)blockers.push("Spark one-position limit is already occupied.");
  if(ledger.dailyNewEntries>=strategy.cadence.maximumNewEntriesPerDay)blockers.push("Spark daily entry limit has been reached.");
  if(ledger.dailyRealizedLossPct>=strategy.risk.dailyRealizedLossLimitPct)blockers.push("Spark daily realized-loss kill switch is active.");
  if(ledger.openRiskPct>=strategy.risk.maximumOpenRiskPct)blockers.push("Spark open-risk ceiling is already occupied.");
  if(!(ledger.equity>0)||!(ledger.buyingPower>0))blockers.push("Virtual equity or buying power is unavailable.");

  if(source.score<strategy.setup.minimumSourceScore)waitingOn.push("Setup is still below the early-ignition tier.");
  if(source.score>strategy.setup.maximumSourceScore)waitingOn.push("Setup graduated to Flash; Spark steps aside.");
  if(source.quoteAgeSeconds===null||source.quoteAgeSeconds>strategy.marketData.maximumQuoteAgeSeconds)waitingOn.push("Waiting for a fresh crypto quote.");
  if(source.spreadPct===null||source.spreadPct>strategy.marketData.maximumSpreadPct)waitingOn.push("Spread is wider than Spark allows.");
  if(bars.length<strategy.marketData.minimumCompleted5mBars)waitingOn.push("Waiting for enough 5-minute evidence.");
  if(source.fastMomentumPct===null||source.fastMomentumPct<strategy.setup.minimumFastMomentumPct)waitingOn.push("Fast momentum has not ignited enough.");
  if(relativeVolume===null||relativeVolume<strategy.setup.minimumRelativeVolume)waitingOn.push("Fast relative volume is still weak.");
  if(source.atrPct===null||source.atrPct<strategy.setup.minimumAtrPct||source.atrPct>strategy.setup.maximumAtrPct)waitingOn.push("Fast volatility is outside Spark range.");
  if(!(positive(source.ask)&&positive(source.trigger)&&source.ask>=source.trigger))waitingOn.push("Short-horizon breakout trigger has not been reached.");
  if(positive(source.ask)&&positive(source.maxEntry)&&source.ask>source.maxEntry)waitingOn.push("Price is beyond Spark maximum chase distance.");

  let protectiveStop:number|null=null,takeProfit:number|null=null,plannedQuantity:number|null=null,plannedNotional:number|null=null,plannedRiskDollars:number|null=null,plannedRiskPct:number|null=null;
  if(positive(source.ask)&&source.atrPct!==null&&ledger.equity>0&&ledger.buyingPower>0){
    const ask=source.ask;
    const minimumDistance=ask*strategy.risk.minimumStopPct/100;
    const atrDistance=ask*(source.atrPct/100)*strategy.risk.atrStopMultiplier;
    const stopDistance=Math.max(minimumDistance,atrDistance);
    const stopPct=stopDistance/ask*100;
    if(stopPct>strategy.risk.maximumStopPct){
      waitingOn.push(`Required stop distance ${stopPct.toFixed(2)}% is wider than Spark allows.`);
    }else{
      protectiveStop=ask-stopDistance;
      takeProfit=ask+stopDistance*strategy.risk.firstTakeProfitR;
      const riskBudget=ledger.equity*strategy.risk.riskPerTradePct/100;
      const notionalByRisk=riskBudget/(stopPct/100);
      plannedNotional=Math.min(notionalByRisk,ledger.equity*strategy.risk.maximumPositionAllocationPct/100,ledger.buyingPower);
      plannedQuantity=plannedNotional/ask;
      plannedRiskDollars=plannedNotional*stopPct/100;
      plannedRiskPct=plannedRiskDollars/ledger.equity*100;
      if(ledger.openRiskPct+(plannedRiskPct??0)>strategy.risk.maximumOpenRiskPct)blockers.push("Planned trade would exceed Spark open-risk ceiling.");
    }
  }

  return {
    symbol:source.symbol,
    sourceScore:source.score,
    state:blockers.length?"blocked":waitingOn.length?"waiting":"ready",
    selectedForSubmission:false,
    bid:source.bid,ask:source.ask,spreadPct:source.spreadPct,quoteAgeSeconds:source.quoteAgeSeconds,
    fastMomentumPct:source.fastMomentumPct,slowMomentumPct:source.slowMomentumPct,
    relativeVolume,atrPct:source.atrPct,trigger:source.trigger,maxEntry:source.maxEntry,
    protectiveStop,takeProfit,plannedQuantity,plannedNotional,plannedRiskDollars,plannedRiskPct,
    blockers,waitingOn,trackingBars:source.trackingBars,paperOnly:true as const,
  };
}
