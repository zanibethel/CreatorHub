import type { FuseReadiness } from "./paper-fuse-readiness";
import { FUSE_PENNY_STRATEGY_V1 as strategy } from "./paper-fuse-strategy-config";

export function buildFuseShadowSeeds(plans: FuseReadiness[], collectedAt: string, sessionDate: string) {
  if (!Number.isFinite(Date.parse(collectedAt)) || !/^\d{4}-\d{2}-\d{2}$/.test(sessionDate)) return [];
  return plans.flatMap(plan => {
    if (plan.readiness !== "research-ready" || plan.blockers.length > 0) return [];
    const trigger=plan.entryTrigger, maxEntry=plan.maximumEntry;
    const stop=plan.plan.stopPrice, target=plan.plan.exitPrice;
    if (trigger === null || maxEntry === null || stop === null || target === null ||
        ![trigger,maxEntry,stop,target].every(v => Number.isFinite(v) && v > 0) ||
        !(stop < trigger && trigger <= maxEntry && target > trigger)) return [];
    return [{
      setup_key:`fuse:${strategy.id}:v${strategy.version}:${sessionDate}:${plan.symbol}`,
      bot_id:strategy.botProfileId,strategy_id:strategy.id,strategy_version:strategy.version,
      symbol:plan.symbol,asset_class:"stock",source_event_type:"candidate",
      decision_state:"ready",decision_at:collectedAt,session_key:sessionDate,status:"watching",
      score:plan.fuseScore,trigger_price:trigger,max_entry_price:maxEntry,
      protective_stop:stop,planned_take_profit:target,
      last_bar_at:plan.lastCompletedBarAt,blockers:[],warnings:plan.warnings,
      metadata:{source:"fuse-penny-research-shadow-v1",paperOnly:true,researchOnly:true,
        brokerOrderPlaced:false,executedTrade:false,
        trackingPolicy:"first-research-ready-setup-per-symbol-per-eastern-session",
        quoteAgeSeconds:plan.quoteAgeSeconds,spreadPct:plan.spreadPct,
        relativeVolume:plan.relativeVolume,recentDollarVolume:plan.recentDollarVolume},
    }];
  });
}

/** Stored strategy decisions are the sole historical replay source, never price hindsight. */
export type FuseArchivedObservation = {
  symbol:string; evaluatedAt:string; strategyVersion:number; readiness:string; fuseScore:number;
  blockers:string[]; warnings:string[]; lastCompletedBarAt:string|null;
  plan:{entryPrice:number|null;stopPrice:number|null;exitPrice:number|null};
  quoteAgeSeconds:number|null;spreadPct:number|null;
};

function observationNyDate(value:string):string|null {
  const epoch=Date.parse(value);
  if(!Number.isFinite(epoch))return null;
  const fields=new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",
    year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date(epoch));
  const p=Object.fromEntries(fields.map(part=>[part.type,part.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

/**
 * Recover genuine research-ready opportunities evaluated before the outcome
 * tracker was deployed (or after a transient tracker outage).
 * The recorded five-minute bar is excluded from future outcome marks; no
 * later prices or refreshed quotes may change the original trading thesis.
 */
export function buildFuseArchivedShadowSeeds(
  observations:FuseArchivedObservation[], collectedAt:string, sessionDate:string,
) {
  const now=Date.parse(collectedAt);
  if(!Number.isFinite(now)||!/^\\d{4}-\\d{2}-\\d{2}$/.test(sessionDate))return [];
  const selected=new Set<string>();
  return [...observations].sort((a,b)=>Date.parse(a.evaluatedAt)-Date.parse(b.evaluatedAt))
    .flatMap(row=>{
      const evaluated=Date.parse(row.evaluatedAt), last=Date.parse(row.lastCompletedBarAt??"");
      if(!Number.isFinite(evaluated)||evaluated>now||observationNyDate(row.evaluatedAt)!==sessionDate||
        row.strategyVersion!==strategy.version||row.readiness!=="research-ready"||
        row.fuseScore<strategy.scoring.readyScore||row.blockers.length>0||
        !Number.isFinite(last)||last+300_000>evaluated||
        observationNyDate(row.lastCompletedBarAt!)!==sessionDate||
        !/^[A-Z][A-Z0-9.]{0,15}$/.test(row.symbol)||selected.has(row.symbol))return [];
      const trigger=row.plan.entryPrice, stop=row.plan.stopPrice, target=row.plan.exitPrice;
      const max=trigger===null?null:Number((trigger*(1+strategy.setup.maximumChasePct/100)).toFixed(6));
      if(trigger===null||stop===null||target===null||max===null||
        ![trigger,stop,target,max].every(n=>Number.isFinite(n)&&n>0)||
        !(stop<trigger&&trigger<=max&&target>trigger))return [];
      selected.add(row.symbol);
      return [{
        setup_key:`fuse:${strategy.id}:v${strategy.version}:${sessionDate}:${row.symbol}`,
        bot_id:strategy.botProfileId,strategy_id:strategy.id,strategy_version:strategy.version,
        symbol:row.symbol,asset_class:"stock",source_event_type:"candidate",
        decision_state:"ready",decision_at:row.evaluatedAt,session_key:sessionDate,status:"watching",
        score:row.fuseScore,trigger_price:trigger,max_entry_price:max,
        protective_stop:stop,planned_take_profit:target,
        last_bar_at:row.lastCompletedBarAt,blockers:[],warnings:row.warnings,
        metadata:{source:"fuse-archived-research-shadow-v1",paperOnly:true,researchOnly:true,
          replayedObservation:true,brokerOrderPlaced:false,executedTrade:false,
          trackingPolicy:"first-research-ready-setup-per-symbol-per-eastern-session",
          quoteAgeSeconds:row.quoteAgeSeconds,spreadPct:row.spreadPct},
      }];
    });
}
