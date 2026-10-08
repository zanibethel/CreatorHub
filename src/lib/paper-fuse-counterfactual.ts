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
