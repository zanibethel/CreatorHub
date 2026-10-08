/**
 * Historical Pattern Intelligence v2: intraday research-only evidence.
 * Each anchor is an actually completed 1-hour bar. Outcomes start at the NEXT
 * observed bar open. This prevents knowledge of the breakout leaking backward.
 */
import {historicalFeatures, normalizeHistoryBars, type HistoryAssetClass, type HistoryBar, type HistoryFeatures} from "./historical-pattern-intelligence";

export const INTRADAY_VERSION=2;
export const INTRADAY_TARGETS=[4,6,10,15,20] as const;
export type IntradayHorizon="24h"|"72h"|"14d";
export type IntradayFeatures={
  move1hPct:number; move6hPct:number; move24hPct:number;
  volumeRatio24h:number; range24hPct:number; highDistance24hPct:number;
  observedHours24h:number; overnightGapPct:number; realizedVolatility24hPct:number;
  dailyContext:HistoryFeatures;
};
export type MicroFeatures={
  asOf:string;bars5m:number;move15mPct:number|null;move60mPct:number|null;
  volumeVsPreviousHour:number|null;complete:boolean;
};
export type IntradayEvent={
  assetClass:HistoryAssetClass;symbol:string;decisionAt:string;entryAt:string;outcomeEndAt:string;
  horizon:IntradayHorizon;targetPct:number;entryPrice:number;
  status:"target"|"stop"|"timeout"|"ambiguous";maxGainPct:number;maxDrawdownPct:number;
  terminalReturnPct:number;features:IntradayFeatures;
};
export type IntradayCandle=HistoryBar;
const HOUR=3600000,DAY=86400000,STOP=3;
const round=(n:number)=>Number(n.toFixed(5));
const pct=(n:number,d:number)=>(n/d-1)*100;
const mean=(x:number[])=>x.reduce((a,b)=>a+b,0)/x.length;
const HORIZONS:Record<IntradayHorizon,number>={"24h":24*HOUR,"72h":72*HOUR,"14d":14*DAY};
export function normalizeIntradayBars(input:IntradayCandle[],nowMs=Infinity) {
  return normalizeHistoryBars(input).filter(b=>Date.parse(b.t)+HOUR<=nowMs);
}
function dailyContextAt(daily:HistoryBar[],anchorAt:number,assetClass:HistoryAssetClass):HistoryFeatures|null {
  // A 1Day Alpaca bar is stamped at its calendar date, but is not public
  // until day-end. Exclude the anchor calendar day entirely (incl. premarket).
  const anchorDay=new Date(anchorAt).toISOString().slice(0,10);
  let index=daily.length-1;
  while(index>=0 && daily[index].t.slice(0,10)>=anchorDay) index--;
  return historicalFeatures(daily,index,assetClass);
}
function hourData(bars:IntradayCandle[],i:number,assetClass:HistoryAssetClass,daily:HistoryBar[]):IntradayFeatures|null {
  const now=Date.parse(bars[i].t)+HOUR;
  const previous=bars.slice(0,i+1);
  const past24=previous.filter(b=>Date.parse(b.t)>=now-DAY);
  const previous24=previous.filter(b=>Date.parse(b.t)>=now-2*DAY&&Date.parse(b.t)<now-DAY);
  const past6=previous.filter(b=>Date.parse(b.t)>=now-6*HOUR);
  // Stocks have overnight/holiday gaps: count actual hour-bars; never fill
  // missing periods with invented prices or volumes.
  if(past24.length<(assetClass==="stock"?4:18)||past6.length<1||previous24.length<1) return null;
  const ctx=dailyContextAt(daily,now,assetClass);
  if(!ctx)return null;
  const last=bars[i],max=Math.max(...past24.map(b=>b.h)),min=Math.min(...past24.map(b=>b.l));
  const volume=mean(past24.map(b=>b.v)),prevVolume=mean(previous24.map(b=>b.v));
  const returns=past24.map(b=>pct(b.c,b.o));
  const m=mean(returns);
  const prevBar=bars[i-1];
  const gap=prevBar&&Date.parse(last.t)-Date.parse(prevBar.t)>=3*HOUR
    ?pct(last.o,prevBar.c):0;
  return {
    move1hPct:round(pct(last.c,last.o)),
    move6hPct:round(pct(last.c,past6[0].o)),
    move24hPct:round(pct(last.c,past24[0].o)),
    volumeRatio24h:round(prevVolume>0?volume/prevVolume:0),
    range24hPct:round((max-min)/last.c*100),
    highDistance24hPct:round((max-last.c)/max*100),
    observedHours24h:past24.length,
    overnightGapPct:round(gap),
    realizedVolatility24hPct:round(Math.sqrt(mean(returns.map(x=>(x-m)**2)))),
    dailyContext:ctx,
  };
}
function outcome(bars:IntradayCandle[],entryIndex:number,end:number,targetPct:number){
  const entry=bars[entryIndex].o,stop=entry*(1-STOP/100),target=entry*(1+targetPct/100);
  let state:IntradayEvent["status"]="timeout",endIndex=entryIndex,maxGain=0,maxDrawdown=0,terminal=0;
  for(let j=entryIndex;j<bars.length;j++){
    const candle=bars[j],at=Date.parse(candle.t);
    if(at>=end)break;
    endIndex=j;
    maxGain=Math.max(maxGain,pct(candle.h,entry));maxDrawdown=Math.min(maxDrawdown,pct(candle.l,entry));
    const hitTarget=candle.h>=target,hitStop=candle.l<=stop;
    if(hitTarget&&hitStop){state="ambiguous";terminal=-STOP;break;}
    if(hitStop){state="stop";terminal=-STOP;break;}
    if(hitTarget){state="target";terminal=targetPct;break;}
    terminal=pct(candle.c,entry);
  }
  return {status:state,endIndex,entryPrice:round(entry),maxGainPct:round(maxGain),
    maxDrawdownPct:round(maxDrawdown),terminalReturnPct:round(terminal)};
}
/**
 * One time-based anchor per 4 observed hourly bars. 24/72/336h outcome windows
 * use wall clock and reflect actual observed trading hours within that window.
 * Require the full future horizon (even if stop/target occurred early) so
 * missing future prices never become silent successes.
 */
export function extractIntradayEvents(symbol:string,assetClass:HistoryAssetClass,rawHourly:HistoryBar[],rawDaily:HistoryBar[],
  nowMs=Date.now()):IntradayEvent[]{
  const hourly=normalizeIntradayBars(rawHourly,nowMs),daily=normalizeHistoryBars(rawDaily);
  const events:IntradayEvent[]=[];
  for(let i=4;i<hourly.length-1;i+=4){
    const at=Date.parse(hourly[i].t)+HOUR;
    const feat=hourData(hourly,i,assetClass,daily);
    if(!feat)continue;
    const next=hourly[i+1],entryAt=Date.parse(next.t);
    if(entryAt<at)continue;
    for(const horizon of ["24h","72h","14d"] as IntradayHorizon[]){
      const until=entryAt+HORIZONS[horizon];
      if(until>nowMs)continue;
      // Require at least one completed price observation at/after the evaluation horizon,
      // or we cannot confirm that the requested interval is fully covered.
      if(Date.parse(hourly.at(-1)!.t)+HOUR<until)continue;
      for(const targetPct of INTRADAY_TARGETS){
        const label=outcome(hourly,i+1,until,targetPct);
        events.push({assetClass,symbol,decisionAt:new Date(at).toISOString(),entryAt:next.t,
          outcomeEndAt:new Date(Date.parse(hourly[label.endIndex].t)+HOUR).toISOString(),
          horizon,targetPct,...label,features:feat});
      }
    }
  }
  return events;
}
const scale:Record<Exclude<keyof IntradayFeatures,"dailyContext">,number>={
  move1hPct:1.5,move6hPct:4,move24hPct:10,volumeRatio24h:1,range24hPct:12,
  highDistance24hPct:8,observedHours24h:10,overnightGapPct:5,realizedVolatility24hPct:3,
};
function distance(a:IntradayFeatures,b:IntradayFeatures){
  const keys=Object.keys(scale) as (keyof typeof scale)[];
  const intraday=mean(keys.map(k=>Math.min(4,Math.abs(a[k]-b[k])/scale[k])**2));
  const prior=mean(["prior3mPct","prior6mPct","prior1yPct"].map(k=>
    Math.min(4,Math.abs(a.dailyContext[k as keyof HistoryFeatures]-b.dailyContext[k as keyof HistoryFeatures])/40)**2));
  return Math.sqrt((intraday*3+prior)/4);
}
export function intradayMatch(events:IntradayEvent[],features:IntradayFeatures,horizon:IntradayHorizon,
  targetPct:number,asOf:string,assetClass:HistoryAssetClass){
  const now=Date.parse(asOf);
  const known=events.filter(e=>e.assetClass===assetClass&&e.horizon===horizon&&e.targetPct===targetPct
    &&e.status!=="ambiguous"&&Date.parse(e.outcomeEndAt)<now);
  const near=known.map(e=>({e,d:distance(e.features,features)}))
    .sort((a,b)=>a.d-b.d).slice(0,35).map(x=>x.e);
  const base=known.length?known.filter(e=>e.status==="target").length/known.length:null;
  const rate=near.length?near.filter(e=>e.status==="target").length/near.length:null;
  const enough=known.length>=60 && near.length>=25;
  return {
    status:enough?"research-only" as const:"insufficient-evidence" as const,
    score:enough&&base!==null&&rate!==null
      ?Math.round(Math.max(0,Math.min(100,50+(rate-base)*100*Math.min(1,Math.sqrt(near.length/50))))):null,
    comparisons:near.length,knownCount:known.length,baselineRate:base===null?null:round(base),
    matchedRate:rate===null?null:round(rate),
    ambiguous:events.filter(e=>e.assetClass===assetClass&&e.horizon===horizon&&e.targetPct===targetPct
      &&e.status==="ambiguous"&&Date.parse(e.outcomeEndAt)<now).length,
    advisoryOnly:true as const,
  };
}
/** Point-in-time five-minute confirmation. Null when coverage is inadequate. */
export function microstructureFeatures(raw5m:HistoryBar[],asOf:string):MicroFeatures{
  const asOfMs=Date.parse(asOf);
  const bars=normalizeHistoryBars(raw5m).filter(b=>Date.parse(b.t)+5*60000<=asOfMs);
  const hour=bars.filter(b=>Date.parse(b.t)>=asOfMs-HOUR);
  const quarter=hour.filter(b=>Date.parse(b.t)>=asOfMs-15*60000);
  const previous=bars.filter(b=>Date.parse(b.t)>=asOfMs-2*HOUR&&Date.parse(b.t)<asOfMs-HOUR);
  const coverage=hour.length>=9&&quarter.length>=2;
  const volPrev=previous.length?mean(previous.map(b=>b.v)):0;
  return {asOf,bars5m:hour.length,complete:coverage,
    move15mPct:quarter.length>=2?round(pct(quarter.at(-1)!.c,quarter[0].o)):null,
    move60mPct:hour.length>=9?round(pct(hour.at(-1)!.c,hour[0].o)):null,
    volumeVsPreviousHour:coverage&&previous.length>=9&&volPrev>0
      ?round(mean(hour.map(b=>b.v))/volPrev):null};
}
/** Latest completed anchor; if insufficient context, return null with explicit coverage. */
export function currentIntradaySnapshot(assetClass:HistoryAssetClass,rawHourly:HistoryBar[],
  rawDaily:HistoryBar[],raw5m:HistoryBar[],nowMs=Date.now()){
  const hours=normalizeIntradayBars(rawHourly,nowMs);
  if(!hours.length)return null;
  const index=hours.length-1,decisionAt=new Date(Date.parse(hours[index].t)+HOUR).toISOString();
  const features=hourData(hours,index,assetClass,normalizeHistoryBars(rawDaily));
  return {decisionAt,features,micro:microstructureFeatures(raw5m,decisionAt),
    dataThrough:hours[index].t,coverageValid:features!==null};
}
