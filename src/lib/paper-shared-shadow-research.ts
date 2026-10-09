/**
 * Research-only forward bar evaluator for capital-denied PAPER proposals.
 * Uses only verified, completed 5-minute bars opened AFTER the decision.
 * Never submits orders, assumes a broker fill, or updates challenge P/L.
 */
export type SharedShadowBar = {t:string;o:number;h:number;l:number;c:number};
export type SharedShadowStudy = {
  decisionAt:string;
  status:"watching"|"triggered"|"completed"|"expired"|"ambiguous";
  referenceEntry:number;
  protectiveStop:number;
  plannedTarget:number;
  hypotheticalQuantity:number;
  estimatedRoundTripCostPct:number;
  assumedEntry:number|null;
  assumedExit:number|null;
  entryAt:string|null;
  exitAt:string|null;
  lastBarAt:string|null;
  markCount:number;
  grossPl:number|null;
  estimatedCosts:number|null;
  hypotheticalNetPl:number|null;
  mfeR:number|null;
  maeR:number|null;
  firstOutcome:string|null;
};
export type ShadowAdvanceOptions = {
  completedThrough:string;
  /** Caller supplies the strategy's actual eligible holding/entry cutoff. */
  expiresAt?:string;
};

function timestamp(value:string):number {
  const n=Date.parse(value);
  if(!Number.isFinite(n))throw new Error("Invalid shadow timestamp.");
  return n;
}
function finitePositive(x:number):boolean{
  return Number.isFinite(x)&&x>0;
}
const round=(x:number)=>Math.round(x*1e6)/1e6;
function markExcursions(s:SharedShadowStudy,bar:SharedShadowBar){
  const e=s.assumedEntry;
  if(e===null)return;
  const risk=e-s.protectiveStop;
  if(!(risk>0))throw new Error("Invalid shadow stop distance.");
  s.mfeR=round(Math.max(s.mfeR??0,(bar.h-e)/risk));
  s.maeR=round(Math.min(s.maeR??0,(bar.l-e)/risk));
}
function finish(s:SharedShadowStudy,exit:number,when:string,reason:string){
  const entry=s.assumedEntry;
  if(entry===null)throw new Error("Shadow missing assumed entry.");
  s.status="completed";
  s.assumedExit=exit;
  s.exitAt=when;
  s.firstOutcome=reason;
  s.grossPl=round((exit-entry)*s.hypotheticalQuantity);
  s.estimatedCosts=round(entry*s.hypotheticalQuantity*s.estimatedRoundTripCostPct/100);
  s.hypotheticalNetPl=round(s.grossPl-s.estimatedCosts);
}
function evaluateExit(s:SharedShadowStudy,bar:SharedShadowBar){
  const stopTouched=bar.l<=s.protectiveStop;
  const targetTouched=bar.h>=s.plannedTarget;
  if(stopTouched&&targetTouched){
    s.status="ambiguous";
    s.firstOutcome="stop-and-target-in-same-bar";
  } else if(stopTouched){
    const gapBelowStop=bar.o<s.protectiveStop;
    finish(s,gapBelowStop?bar.o:s.protectiveStop,bar.t,gapBelowStop?
      "stop-gap-worse-fill":"stop-reached");
  } else if(targetTouched){
    // Price improvement on target gaps is never fabricated.
    finish(s,s.plannedTarget,bar.t,"planned-target-reached");
  }
}

export function advanceSharedShadowStudy(
  original:SharedShadowStudy,
  completedBars:SharedShadowBar[],
  options:ShadowAdvanceOptions,
):{changed:boolean;study:SharedShadowStudy}{
  const s={...original};
  const decisionTime=timestamp(s.decisionAt);
  const observedThrough=timestamp(options.completedThrough);
  const expiration=options.expiresAt===undefined?null:timestamp(options.expiresAt);
  if(!finitePositive(s.referenceEntry)||!finitePositive(s.protectiveStop)||
    s.protectiveStop>=s.referenceEntry||!finitePositive(s.plannedTarget)||
    s.plannedTarget<=s.referenceEntry||!finitePositive(s.hypotheticalQuantity)||
    !finitePositive(s.estimatedRoundTripCostPct)||s.estimatedRoundTripCostPct>10||
    !Number.isInteger(s.markCount)||s.markCount<0)
    throw new Error("Invalid research-only shadow plan.");
  if(!Array.isArray(completedBars)||completedBars.length>2000)
    throw new Error("Invalid shadow bar collection.");
  if(!["watching","triggered"].includes(s.status))return {changed:false,study:s};
  const last=s.lastBarAt===null?Number.NEGATIVE_INFINITY:timestamp(s.lastBarAt);
  const bars=completedBars
    .map(b=>({bar:b,time:timestamp(b.t)}))
    .filter(({time})=>time>=decisionTime && time>last &&
      time+5*60_000<=observedThrough &&
      (expiration===null || time<expiration))
    .sort((a,b)=>a.time-b.time);
  let changed=false;
  let previous=last;
  for(const {bar,time} of bars){
    if(time<=previous)continue;
    if(![bar.o,bar.h,bar.l,bar.c].every(finitePositive)||
      bar.h<Math.max(bar.o,bar.c)||bar.l>Math.min(bar.o,bar.c)||bar.l>bar.h)
      throw new Error("Invalid completed shadow candle.");
    previous=time;
    changed=true;
    s.lastBarAt=bar.t;
    s.markCount+=1;
    if(s.status==="watching"){
      const atOpen=Math.abs(bar.o-s.referenceEntry)<1e-8;
      const touched=bar.l<=s.referenceEntry&&bar.h>=s.referenceEntry;
      if(!atOpen&&!touched)continue;
      s.assumedEntry=s.referenceEntry;
      s.entryAt=bar.t;
      s.status="triggered";
      s.mfeR=0;s.maeR=0;
      // If entry happens intrabar, we cannot order earlier highs/lows relative
      // to the fill; any same-bar stop/target is ambiguous.
      if(!atOpen){
        if(bar.l<=s.protectiveStop||bar.h>=s.plannedTarget){
          s.status="ambiguous";
          s.firstOutcome="entry-and-exit-order-unknown";
          break;
        }
      }else{
        markExcursions(s,bar);
        evaluateExit(s,bar);
        if(s.status!=="triggered")break;
      }
    }else{
      markExcursions(s,bar);
      evaluateExit(s,bar);
      if(s.status!=="triggered")break;
    }
  }
  if(expiration!==null&&observedThrough>=expiration&&["watching","triggered"].includes(s.status)){
    s.status="expired";
    s.firstOutcome=s.assumedEntry===null?"never-triggered":"unresolved-at-horizon";
    changed=true;
  }
  return {changed,study:s};
}
