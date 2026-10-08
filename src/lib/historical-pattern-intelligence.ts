/**
 * Historical Pattern Intelligence v1: read-only research, never an order signal.
 * Decisions use only completed bars strictly earlier than the proposed entry.
 * Each failed/timeout setup is included alongside successes (no winners-only sampling).
 */
export type HistoryAssetClass = "stock" | "crypto";
export type HistoryHorizon = "same-day" | "3-day" | "2-week";
export type HistoryBar = { t:string; o:number; h:number; l:number; c:number; v:number };
export type HistoryFeatures = {
  prior24hPct:number; prior5dPct:number; prior20dPct:number;
  prior3mPct:number; prior6mPct:number; prior1yPct:number;
  volumeRatio20:number; range20Pct:number; highDistance20Pct:number;
  volatility20Pct:number;
};
export type HistoryExample = {
  symbol:string; assetClass:HistoryAssetClass; horizon:HistoryHorizon;
  targetPct:number; decisionAt:string; outcomeEndAt:string;
  entryAt:string; entryPrice:number; features:HistoryFeatures;
  status:"target"|"stop"|"timeout"|"ambiguous";
  maxGainPct:number; maxDrawdownPct:number; terminalReturnPct:number;
};
export const HISTORY_TARGETS = [4,6,10,15,20] as const;
export const HISTORY_VERSION = 1;
export const HISTORY_STOP_PCT = 3;
const DAY_MS = 86_400_000;
const stockContext = 252;
const cryptoContext = 365;

function validBar(b:HistoryBar) {
  return Number.isFinite(Date.parse(b.t)) && [b.o,b.h,b.l,b.c].every(n => Number.isFinite(n) && n > 0)
    && Number.isFinite(b.v) && b.v >= 0 && b.l <= Math.min(b.o,b.c)
    && b.h >= Math.max(b.o,b.c) && b.h >= b.l;
}
const avg=(ns:number[]) => ns.reduce((s,n)=>s+n,0)/ns.length;
const pct=(n:number,d:number)=> (n/d-1)*100;
const round=(n:number)=>Number(n.toFixed(5));

export function normalizeHistoryBars(rows:HistoryBar[]):HistoryBar[] {
  const byDate=new Map<string,HistoryBar>();
  for(const b of rows) if(validBar(b)) byDate.set(new Date(b.t).toISOString(),b);
  return [...byDate.values()].sort((a,b)=>Date.parse(a.t)-Date.parse(b.t));
}
function closeAt(bars:HistoryBar[],i:number,days:number) { return bars[i-days].c; }

/** Feature window ends at i; the first hypothetical entry is NEXT bar open. */
export function historicalFeatures(bars:HistoryBar[],i:number,assetClass:HistoryAssetClass="stock"):HistoryFeatures|null {
  const minimum=assetClass==="crypto"?cryptoContext:stockContext;
  if(i<minimum || i>=bars.length) return null;
  const last=bars[i], recent=bars.slice(i-19,i+1), old=bars.slice(i-39,i-19);
  const meanVolume=avg(recent.map(b=>b.v));
  const previousVolume=avg(old.map(b=>b.v));
  const high=Math.max(...recent.map(b=>b.h));
  const low=Math.min(...recent.map(b=>b.l));
  const returns=recent.map((b,k)=>pct(b.c,bars[i-20+k].c));
  const volatility=Math.sqrt(avg(returns.map(r=>(r-avg(returns))**2)));
  return {
    prior24hPct:round(pct(last.c,closeAt(bars,i,1))),
    prior5dPct:round(pct(last.c,closeAt(bars,i,5))),
    prior20dPct:round(pct(last.c,closeAt(bars,i,20))),
    prior3mPct:round(pct(last.c,closeAt(bars,i,assetClass==="crypto"?90:63))),
    prior6mPct:round(pct(last.c,closeAt(bars,i,assetClass==="crypto"?180:126))),
    prior1yPct:round(pct(last.c,closeAt(bars,i,minimum))),
    volumeRatio20:round(previousVolume>0?meanVolume/previousVolume:0),
    range20Pct:round((high-low)/last.c*100),
    highDistance20Pct:round((high-last.c)/high*100),
    volatility20Pct:round(volatility),
  };
}

function daysFor(assetClass:HistoryAssetClass,horizon:HistoryHorizon) {
  if(horizon==="same-day") return 1;
  if(horizon==="3-day") return 3;
  return assetClass==="stock" ? 10 : 14; // Trading sessions, vs crypto calendar days.
}
function labelOutcome(bars:HistoryBar[],entryIndex:number,duration:number,targetPct:number) {
  const entry=bars[entryIndex].o;
  const stopPrice=entry*(1-HISTORY_STOP_PCT/100);
  const targetPrice=entry*(1+targetPct/100);
  let peak=0,drawdown=0;
  let status:HistoryExample["status"]="timeout";
  let endIndex=entryIndex+duration-1;
  let terminal=0;
  for(let k=entryIndex;k<=endIndex;k++) {
    const b=bars[k];
    peak=Math.max(peak,pct(b.h,entry));
    drawdown=Math.min(drawdown,pct(b.l,entry));
    const hitTarget=b.h>=targetPrice, hitStop=b.l<=stopPrice;
    if(hitTarget&&hitStop) {
      status="ambiguous";endIndex=k;terminal=-HISTORY_STOP_PCT;break; // Conservative.
    }
    if(hitStop) {status="stop";endIndex=k;terminal=-HISTORY_STOP_PCT;break;}
    if(hitTarget) {status="target";endIndex=k;terminal=targetPct;break;}
    terminal=pct(b.c,entry);
  }
  return {status,entry,peak:round(peak),drawdown:round(drawdown),terminal:round(terminal),endIndex};
}

/**
 * Includes EVERY eligible daily decision, all targets and both successful and unsuccessful
 * outcomes. No future bar is used in a feature. End must be known before labeling.
 */
export function extractHistoryExamples(symbol:string,assetClass:HistoryAssetClass,raw:HistoryBar[]):HistoryExample[] {
  const bars=normalizeHistoryBars(raw);
  const examples:HistoryExample[]=[];
  const windows:HistoryHorizon[]=["same-day","3-day","2-week"];
  for(let i=assetClass==="crypto"?cryptoContext:stockContext;i<bars.length-1;i++) {
    const features=historicalFeatures(bars,i,assetClass);
    if(!features) continue;
    for(const horizon of windows) {
      const duration=daysFor(assetClass,horizon), entryIndex=i+1;
      if(entryIndex+duration>bars.length) continue; // Unresolved futures excluded.
      for(const targetPct of HISTORY_TARGETS) {
        const outcome=labelOutcome(bars,entryIndex,duration,targetPct);
        examples.push({
          symbol,assetClass,horizon,targetPct,
          // One second before next UTC day boundary: completed candle, never the bar open.
          decisionAt:new Date(Date.parse(bars[i].t)+DAY_MS-1000).toISOString(),
          entryAt:bars[entryIndex].t,
          outcomeEndAt:new Date(Date.parse(bars[outcome.endIndex].t)+DAY_MS).toISOString(),
          entryPrice:round(outcome.entry),features,status:outcome.status,
          maxGainPct:outcome.peak,maxDrawdownPct:outcome.drawdown,
          terminalReturnPct:outcome.terminal,
        });
      }
    }
  }
  return examples;
}

const SCALES:Record<keyof HistoryFeatures,number>={
  prior24hPct:4,prior5dPct:8,prior20dPct:15,
  prior3mPct:25,prior6mPct:40,prior1yPct:60,
  volumeRatio20:1,range20Pct:15,highDistance20Pct:10,volatility20Pct:3,
};
export function featureDistance(a:HistoryFeatures,b:HistoryFeatures):number {
  const keys=Object.keys(SCALES) as (keyof HistoryFeatures)[];
  const weighted=keys.map(k=>Math.min(4,Math.abs(a[k]-b[k])/SCALES[k]));
  return round(Math.sqrt(avg(weighted.map(v=>v*v))));
}
export type HistoryMatch = {
  status:"insufficient-evidence"|"research-only";
  score:number|null; matchedCount:number; targetCount:number;
  baselineTargetRate:number|null; similarTargetRate:number|null;
  ambiguousCount:number; avgMaxGainPct:number|null;
  avgMaxDrawdownPct:number|null; asOf:string;
};

/** Strict point-in-time neighbors: sample outcome must have ended BEFORE asOf. */
export function matchHistoricalPattern(
  examples:HistoryExample[],features:HistoryFeatures,
  horizon:HistoryHorizon,targetPct:number,asOf:string,assetClass:HistoryAssetClass,
  maxNeighbors=35,
):HistoryMatch {
  const eligible=examples.filter(e=>e.assetClass===assetClass&&e.horizon===horizon
    &&e.targetPct===targetPct&&Date.parse(e.outcomeEndAt)<Date.parse(asOf)
    &&e.status!=="ambiguous");
  // Group by DECISION DAY prevents synthetic frequency inflation if intraday examples are added later.
  const ranked=eligible.map(e=>({e,d:featureDistance(features,e.features)})).sort((a,b)=>a.d-b.d);
  const nearest=ranked.slice(0,maxNeighbors).map(r=>r.e);
  const hit=(e:HistoryExample)=>e.status==="target";
  const base=eligible.length?eligible.filter(hit).length/eligible.length:null;
  const matched=nearest.length?nearest.filter(hit).length/nearest.length:null;
  const enough=eligible.length>=70&&nearest.length>=25;
  const reliability=Math.min(1,Math.sqrt(nearest.length/50));
  return {
    status:enough?"research-only":"insufficient-evidence",
    // This is a relative RESEARCH similarity index, NOT a return/probability prediction.
    score:enough&&base!==null&&matched!==null
      ?Math.round(Math.max(0,Math.min(100,50+(matched-base)*100*reliability))):null,
    matchedCount:nearest.length,targetCount:nearest.filter(hit).length,
    baselineTargetRate:base===null?null:round(base),
    similarTargetRate:matched===null?null:round(matched),
    ambiguousCount:examples.filter(e=>e.assetClass===assetClass&&e.horizon===horizon
      &&e.targetPct===targetPct&&e.status==="ambiguous"&&Date.parse(e.outcomeEndAt)<Date.parse(asOf)).length,
    avgMaxGainPct:nearest.length?round(avg(nearest.map(e=>e.maxGainPct))):null,
    avgMaxDrawdownPct:nearest.length?round(avg(nearest.map(e=>e.maxDrawdownPct))):null,
    asOf,
  };
}

/** Walk-forward holdout: test only the final 25%; outcomes never train their own predictions. */
export function evaluateHistoryHoldout(examples:HistoryExample[],assetClass:HistoryAssetClass,
  horizon:HistoryHorizon,targetPct:number) {
  const cohort=examples.filter(e=>e.assetClass===assetClass&&e.horizon===horizon&&e.targetPct===targetPct)
    .sort((a,b)=>Date.parse(a.decisionAt)-Date.parse(b.decisionAt));
  const split=Math.floor(cohort.length*.75);
  const validation=cohort.slice(split).filter(e=>e.status!=="ambiguous");
  let scored=0,matchedHits=0;
  for(const candidate of validation) {
    const history=cohort.filter(e=>Date.parse(e.outcomeEndAt)<Date.parse(candidate.decisionAt));
    const m=matchHistoricalPattern(history,candidate.features,horizon,targetPct,candidate.decisionAt,assetClass);
    if(m.status!=="research-only"||m.similarTargetRate===null||m.baselineTargetRate===null) continue;
    scored++;if(candidate.status==="target") matchedHits++;

  }
  return {
    assetClass,horizon,targetPct,total:cohort.length,
    successes:cohort.filter(e=>e.status==="target").length,
    stops:cohort.filter(e=>e.status==="stop").length,
    timeouts:cohort.filter(e=>e.status==="timeout").length,
    ambiguous:cohort.filter(e=>e.status==="ambiguous").length,
    holdoutCount:validation.length,scoredHoldout:scored,
    scoredHoldoutWins:matchedHits, // NOT an estimated trading win rate without entry/risk/cost review.
    modelVersion:HISTORY_VERSION,advisoryOnly:true,
    status:scored>=30?"research-observed":"insufficient-validation",
  };
}

/** Current feature read uses last FULLY COMPLETED daily bar only. */
export function researchSummary(symbol:string,assetClass:HistoryAssetClass,raw:HistoryBar[]) {
  const bars=normalizeHistoryBars(raw);
  const examples=extractHistoryExamples(symbol,assetClass,bars);
  const latest=bars.length?historicalFeatures(bars,bars.length-1,assetClass):null;
  if(!latest||!examples.length) throw new Error("Insufficient completed history for 12-month context and resolved outcomes.");
  const asOf=new Date(Date.parse(bars[bars.length-1].t)+DAY_MS).toISOString();
  const rows=(["same-day","3-day","2-week"] as HistoryHorizon[]).flatMap(horizon=>
    HISTORY_TARGETS.map(targetPct=>({
      ...evaluateHistoryHoldout(examples,assetClass,horizon,targetPct),
      match:matchHistoricalPattern(examples,latest,horizon,targetPct,asOf,assetClass),
    })));
  return {symbol,assetClass,asOf,barCount:bars.length,exampleCount:examples.length,
    targets:[...HISTORY_TARGETS],stopPct:HISTORY_STOP_PCT,
    version:HISTORY_VERSION,features:latest,rows,
    note:"Research only. Same-day = next stock trading session or crypto UTC day. No intraday 24h lead-in validation yet; daily prior-session proxy. No fees, spread, borrow costs or corporate action look-ahead modeled.",
  };
}
