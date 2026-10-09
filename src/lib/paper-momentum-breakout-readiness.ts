import { MOMENTUM_BREAKOUT_STRATEGY_V1 as strategy } from "./paper-momentum-breakout-strategy-config";
import { pulseFractionalQuantity, pulseEntryOrderMode } from "./paper-pulse-fractional";

export type MomentumBar = { t:string; o:number; h:number; l:number; c:number; v:number };
export type MomentumQuote = { bid:number|null; ask:number|null; timestamp:string|null };
export type MomentumProspect = {
  symbol:string;
  scannerScore:number;
  scannerVersion:number;
  lastSeenAt:string;
  percentChange:number|null;
  acceleration:number;
  catalyst:number;
  chasePenalty:number;
  reasons:string[];
};
export type MomentumLedger = {
  active:boolean;
  equity:number;
  buyingPower:number;
  openRiskPct:number;
  dailyRealizedLossPct:number;
  openPositions:number;
  dailyNewEntries:number;
  executionEnabled:boolean;
  fractionalExecutionEnabled:boolean;
};

const positive=(value:unknown):value is number=>typeof value==="number"&&Number.isFinite(value)&&value>0;
const average=(values:number[])=>values.length?values.reduce((sum,value)=>sum+value,0)/values.length:null;
const returnPct=(bars:MomentumBar[],lookback:number)=>{
  if(bars.length<=lookback)return null;
  const start=bars[bars.length-1-lookback]?.c,end=bars.at(-1)?.c;
  return positive(start)&&positive(end)?(end/start-1)*100:null;
};
const atr=(bars:MomentumBar[],period:number)=>{
  if(bars.length<period+1)return null;
  const slice=bars.slice(-(period+1)); const values:number[]=[];
  for(let i=1;i<slice.length;i++){
    const current=slice[i],previous=slice[i-1];
    values.push(Math.max(current.h-current.l,Math.abs(current.h-previous.c),Math.abs(current.l-previous.c)));
  }
  return average(values);
};
const quoteAge=(quote:MomentumQuote,now:number)=>{
  const parsed=quote.timestamp?Date.parse(quote.timestamp):NaN;
  return Number.isFinite(parsed)?Math.max(0,(now-parsed)/1000):null;
};
const spreadPct=(quote:MomentumQuote)=>{
  if(!positive(quote.bid)||!positive(quote.ask)||quote.ask<quote.bid)return null;
  const mid=(quote.bid+quote.ask)/2;
  return mid>0?(quote.ask-quote.bid)/mid*100:null;
};
export function pulseBracketWholeShareQuantity(riskCap:number,allocationCap:number){
  if(!Number.isFinite(riskCap)||!Number.isFinite(allocationCap)||riskCap<=0||allocationCap<=0)return null;
  const whole=Math.floor(Math.min(riskCap,allocationCap));
  return Number.isSafeInteger(whole)&&whole>=1?whole:null;
}
const roundPrice=(value:number)=>Number(value.toFixed(value>=1?2:6));

function regularSessionMinutes(now:number){
  const parts=new Intl.DateTimeFormat("en-US",{
    timeZone:strategy.session.timezone,weekday:"short",hour:"2-digit",minute:"2-digit",hourCycle:"h23",
  }).formatToParts(new Date(now));
  const map=Object.fromEntries(parts.map(part=>[part.type,part.value]));
  const weekday=map.weekday??"";
  const minutes=Number(map.hour??0)*60+Number(map.minute??0);
  const weekdayOpen=!["Sat","Sun"].includes(weekday);
  return {weekday,minutes,marketOpen:weekdayOpen&&minutes>=570&&minutes<960};
}

export function evaluateMomentumBreakoutCandidate(input:{
  now:number;
  prospect:MomentumProspect;
  quote:MomentumQuote;
  bars5m:MomentumBar[];
  ledger:MomentumLedger;
  symbolOccupiedByOtherBot:boolean;
}){
  const {prospect,quote,bars5m,ledger}=input;
  const ageMinutes=Math.max(0,(input.now-Date.parse(prospect.lastSeenAt))/60_000);
  const spread=spreadPct(quote);
  const age=quoteAge(quote,input.now);
  const currentAtr=atr(bars5m,strategy.marketData.atrPeriod);
  const ask=positive(quote.ask)?quote.ask:null;
  const bid=positive(quote.bid)?quote.bid:null;
  const atrPct=positive(currentAtr)&&positive(ask)?currentAtr/ask*100:null;
  const fastMomentum=returnPct(bars5m,strategy.setup.momentumLookbackBars);
  const priorBreakout=bars5m.slice(-(strategy.setup.breakoutLookbackBars+1),-1);
  const priorHigh=priorBreakout.length?Math.max(...priorBreakout.map(bar=>bar.h)):null;
  const trigger=positive(priorHigh)?priorHigh*(1+strategy.setup.breakoutBufferPct/100):null;
  const maxEntry=positive(trigger)&&positive(currentAtr)?trigger+currentAtr*strategy.setup.maximumChaseAtr:null;
  const volumeWindow=bars5m.slice(-(strategy.setup.volumeLookbackBars+1));
  const latestVolume=volumeWindow.at(-1)?.v??null;
  const priorVolumes=volumeWindow.slice(0,-1).map(bar=>bar.v).filter(value=>Number.isFinite(value)&&value>=0);
  const priorAverageVolume=average(priorVolumes);
  const relativeVolume=positive(latestVolume)&&positive(priorAverageVolume)?latestVolume/priorAverageVolume:null;
  const session=regularSessionMinutes(input.now);

  const waitingOn:string[]=[];
  const blockers:string[]=[];

  if(!ledger.active)blockers.push("Pulse virtual ledger is not active.");
  if(input.symbolOccupiedByOtherBot)blockers.push("Another bot already holds this symbol.");
  if(ledger.openPositions>=strategy.cadence.maximumOpenPositions)blockers.push("Pulse open-position limit is already occupied.");
  if(ledger.dailyNewEntries>=strategy.cadence.maximumNewEntriesPerDay)blockers.push("Pulse daily entry limit has been reached.");
  if(ledger.dailyRealizedLossPct>=strategy.risk.dailyRealizedLossLimitPct)blockers.push("Pulse daily realized-loss kill switch is active.");
  if(ledger.openRiskPct>=strategy.risk.maximumOpenRiskPct)blockers.push("Pulse open-risk ceiling is already occupied.");
  if(!(ledger.equity>0)||!(ledger.buyingPower>0))blockers.push("Virtual equity or buying power is unavailable.");

  if(prospect.scannerVersion<strategy.intake.minimumScannerVersion)waitingOn.push("Prospect came from an older scanner version.");
  if(prospect.scannerScore<strategy.intake.minimumScannerScore)waitingOn.push("Scanner score is below Pulse intake.");
  if(ageMinutes>strategy.intake.maximumProspectAgeMinutes)waitingOn.push("Prospect is stale for an intraday momentum entry.");
  if(prospect.acceleration<strategy.intake.minimumAccelerationScore)waitingOn.push("Scanner acceleration is below Pulse threshold.");
  if(prospect.chasePenalty>strategy.intake.maximumChasePenalty)waitingOn.push("Scanner chase risk is too high.");
  if(ask!==null&&ask<strategy.intake.minimumPriceUsd)waitingOn.push("Price belongs in the penny-stock lane instead of Pulse.");
  if(!session.marketOpen)waitingOn.push("US regular market is closed.");
  if(session.marketOpen&&session.minutes<570+strategy.session.minimumMinutesAfterOpen)waitingOn.push("Waiting for the opening volatility buffer.");
  if(session.marketOpen&&session.minutes>=960-strategy.session.stopNewEntriesMinutesBeforeClose)waitingOn.push("Pulse new-entry window is closed for the session.");
  if(age===null||age>strategy.marketData.maximumQuoteAgeSeconds)waitingOn.push("Waiting for a fresh quote.");
  if(spread===null)waitingOn.push("Waiting for a valid non-crossed quote.");
  else if(spread>strategy.marketData.maximumSpreadPct)waitingOn.push("Spread is wider than Pulse allows.");
  if(bars5m.length<strategy.marketData.minimumCompleted5mBars)waitingOn.push("Waiting for enough completed 5-minute bars.");
  if(fastMomentum===null||fastMomentum<strategy.setup.minimumMomentumPct)waitingOn.push("5-minute momentum is below Pulse threshold.");
  if(relativeVolume===null||relativeVolume<strategy.setup.minimumRelativeVolume)waitingOn.push("5-minute relative volume has not ignited enough.");
  if(atrPct===null||atrPct<strategy.setup.minimumAtrPct||atrPct>strategy.setup.maximumAtrPct)waitingOn.push("5-minute volatility is outside Pulse range.");
  if(!(positive(ask)&&positive(trigger)&&ask>=trigger))waitingOn.push("Short-horizon breakout trigger has not been reached.");
  if(positive(ask)&&positive(maxEntry)&&ask>maxEntry)waitingOn.push("Price is beyond Pulse maximum chase distance.");

  let protectiveStop:number|null=null,takeProfit:number|null=null,plannedQuantity:number|null=null,plannedNotional:number|null=null,plannedRiskDollars:number|null=null,plannedRiskPct:number|null=null;
  let fractionalReferenceQuantity:number|null=null;
  if(positive(ask)&&positive(currentAtr)&&ledger.equity>0&&ledger.buyingPower>0){
    const minDistance=ask*strategy.risk.minimumStopPct/100;
    const atrDistance=currentAtr*strategy.risk.atrStopMultiplier;
    const stopDistance=Math.max(minDistance,atrDistance);
    const stopPct=stopDistance/ask*100;
    if(stopPct>strategy.risk.maximumStopPct){
      waitingOn.push(`Required stop distance ${stopPct.toFixed(2)}% is wider than Pulse allows.`);
    }else{
      protectiveStop=roundPrice(ask-stopDistance);
      takeProfit=roundPrice(ask+stopDistance*strategy.risk.firstTakeProfitR);
      const riskBudget=ledger.equity*strategy.risk.riskPerTradePct/100;
      const qtyByRisk=riskBudget/stopDistance;
      const allocationBudget=Math.min(ledger.equity*strategy.risk.maximumPositionAllocationPct/100,ledger.buyingPower);
      const qtyByAllocation=allocationBudget/ask;
      const wholeQuantity=pulseBracketWholeShareQuantity(qtyByRisk,qtyByAllocation);
      fractionalReferenceQuantity=pulseFractionalQuantity(qtyByRisk,qtyByAllocation,ask);
      plannedQuantity=wholeQuantity??(ledger.fractionalExecutionEnabled?fractionalReferenceQuantity:null);
      plannedNotional=plannedQuantity===null?null:plannedQuantity*ask;
      plannedRiskDollars=plannedQuantity===null?null:plannedQuantity*stopDistance;
      plannedRiskPct=plannedRiskDollars===null?null:plannedRiskDollars/ledger.equity*100;
      if(plannedQuantity===null)blockers.push("Pulse needs one affordable whole share or its independently protected fractional execution feature to be enabled.");
      if(plannedQuantity!==null && pulseEntryOrderMode(plannedQuantity)===null)blockers.push("Pulse quantity is not supported by its protected broker order modes.");
      if(ledger.openRiskPct+(plannedRiskPct??0)>strategy.risk.maximumOpenRiskPct)blockers.push("Planned trade would exceed Pulse open-risk ceiling.");
    }
  }

  const state=blockers.length?"blocked":waitingOn.length?"waiting":"ready";
  return {
    symbol:prospect.symbol,
    state,
    selectedForSubmission:false,
    scannerScore:prospect.scannerScore,
    scannerVersion:prospect.scannerVersion,
    prospectAgeMinutes:ageMinutes,
    acceleration:prospect.acceleration,
    catalyst:prospect.catalyst,
    chasePenalty:prospect.chasePenalty,
    bid,ask,spreadPct:spread,quoteAgeSeconds:age,
    fastMomentumPct:fastMomentum,
    relativeVolume,
    atrPct,
    trigger,maxEntry,protectiveStop,takeProfit,
    plannedQuantity,plannedNotional,plannedRiskDollars,plannedRiskPct,fractionalReferenceQuantity,
    orderMode:plannedQuantity===null?null:pulseEntryOrderMode(plannedQuantity),
    blockers,waitingOn,
    reasons:prospect.reasons,
    marketOpen:session.marketOpen,
    trackingBars:bars5m,
    paperOnly:true as const,
  };
}
