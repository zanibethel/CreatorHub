import { PAPER_BOT_TRADE_PLAN_CONTRACT_VERSION, type PaperBotTradePlan } from "./paper-bot-trade-plan";
import { FUSE_PENNY_STRATEGY_V1 as cfg } from "./paper-fuse-strategy-config";

export type FuseBar = { t: string; o: number; h: number; l: number; c: number; v: number };
export type FuseProspect = { symbol: string; scannerScore: number; scannerVersion: number; lastSeenAt: string; price: number | null; sessionChangePct: number | null; volume: number | null; assigned: boolean };
export type FuseQuote = { bid: number | null; ask: number | null; timestamp: string | null; source?: string };
export type FuseLedger = { active: boolean; equity: number; buyingPower: number; openRiskPct: number; dailyLossPct: number; openPositions: number; dailyEntries: number; hasExistingOrderOrPosition: boolean };

const pos = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;
const clamp = (v: number, hi: number) => Math.max(0, Math.min(hi, v));
const mean = (xs: number[]) => xs.reduce((sum, n) => sum + n, 0) / xs.length;
const rnd = (n: number) => Number(n.toFixed(6));

export function fuseSession(now: number) {
  const date = new Date(now);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const p = Object.fromEntries(parts.map(item => [item.type, item.value]));
  const minute = Number(p.hour) * 60 + Number(p.minute);
  const weekday = p.weekday !== "Sat" && p.weekday !== "Sun";
  // Exchange holiday/unscheduled close status cannot be inferred here. A fresh live quote and bars are independently required.
  const inRegularHours = weekday && minute >= 570 && minute < 960;
  return { inRegularHours, canEnter: inRegularHours && minute >= 570 + cfg.session.openingWaitMinutes && minute < 960 - cfg.session.stopEntriesMinutesBeforeClose,
    mustFlattenByClose: inRegularHours && minute >= 960 - cfg.session.flattenMinutesBeforeClose, minute };
}

export type FuseReadiness = PaperBotTradePlan & {
  fuseScore: number; readiness: "rejected" | "waiting" | "prepared" | "research-ready";
  spreadPct: number | null; quoteAgeSeconds: number | null; relativeVolume: number | null;
  recentDollarVolume: number | null; fastMomentumPct: number | null; chasePct: number | null;
  entryTrigger: number | null; maximumEntry: number | null; plannedShares: number;
  lastCompletedBarAt: string | null; researchOnly: true;
};

export function evaluateFuseCandidate(input: {
  now: number; prospect: FuseProspect; quote: FuseQuote; bars5m: FuseBar[]; ledger: FuseLedger;
  historicalPatternScore?: number | null; historicalSampleCount?: number;
}): FuseReadiness {
  const { now, prospect, quote, ledger } = input;
  const blockers: string[] = [], warnings: string[] = [];
  const session = fuseSession(now);
  const quoteTime = quote.timestamp ? Date.parse(quote.timestamp) : NaN;
  const quoteAgeSeconds = Number.isFinite(quoteTime) ? (now - quoteTime) / 1000 : null;
  const validQuote = pos(quote.bid) && pos(quote.ask) && quote.ask >= quote.bid;
  const currentPrice = validQuote ? rnd((quote.bid! + quote.ask!) / 2) : null;
  const spreadPct = validQuote ? (quote.ask! - quote.bid!) / currentPrice! * 100 : null;
  const sourceAge = now - Date.parse(prospect.lastSeenAt);
  const validBars = input.bars5m.filter((b) => {
    const start = Date.parse(b.t);
    return Number.isFinite(start) && start + 300_000 <= now && start <= now
      && [b.o,b.h,b.l,b.c].every(pos) && Number.isFinite(b.v) && b.v >= 0
      && b.l <= Math.min(b.o,b.c) && b.h >= Math.max(b.o,b.c);
  }).sort((a,b) => Date.parse(a.t) - Date.parse(b.t));
  const bars = [...new Map(validBars.map(b => [b.t,b])).values()];
  const last = bars.at(-1), prev = bars.slice(0,-1);
  const recent = bars.slice(-6);
  const lookback = prev.slice(-cfg.setup.breakoutLookbackBars);
  const baseline = prev.slice(-cfg.setup.volumeBaselineBars);
  const relativeVolume = last && baseline.length >= cfg.setup.volumeBaselineBars ? last.v / Math.max(1,mean(baseline.map(b=>b.v))) : null;
  const recentDollarVolume = recent.length ? recent.reduce((sum,b)=>sum + b.c*b.v,0) : null;
  const fastMomentumPct = last && bars.length >= 4 ? (last.c / bars.at(-4)!.c - 1)*100 : null;
  const breakout = lookback.length === cfg.setup.breakoutLookbackBars ? Math.max(...lookback.map(b => b.h)) : null;
  const entryTrigger = breakout !== null ? rnd(breakout * (1+cfg.setup.breakoutBufferPct/100)) : null;
  const maximumEntry = entryTrigger !== null ? rnd(entryTrigger*(1+cfg.setup.maximumChasePct/100)) : null;
  const chasePct = entryTrigger !== null && currentPrice !== null ? (currentPrice/entryTrigger - 1)*100 : null;
  const barStalenessMs = last ? now - (Date.parse(last.t)+300_000) : Infinity;
  const ranges = bars.slice(-7).map((b,i,all) => i===0 ? b.h-b.l : Math.max(b.h-b.l,Math.abs(b.h-all[i-1].c),Math.abs(b.l-all[i-1].c)));
  const atr = ranges.length >= 7 ? mean(ranges.slice(1)) : null;
  const atrPct = atr !== null && currentPrice !== null ? atr/currentPrice*100 : null;
  const maximumSpread = currentPrice !== null && currentPrice < 1 ? cfg.market.maximumSpreadUnderOnePct : cfg.market.maximumSpreadPct;

  if (!prospect.assigned || prospect.scannerVersion < cfg.intake.minimumScannerVersion) blockers.push("No valid Fuse scanner assignment/version.");
  if (!(sourceAge >= 0 && sourceAge <= cfg.intake.maximumProspectAgeMinutes*60_000)) warnings.push("Scanner observation is stale or invalid.");
  const priceForUniverse = currentPrice ?? prospect.price;
  if (!pos(priceForUniverse) || priceForUniverse < cfg.intake.minimumPriceUsd || priceForUniverse > cfg.intake.maximumPriceUsd) blockers.push("Outside $0.08–$5.00 eligible universe.");
  if (!session.canEnter) warnings.push(session.mustFlattenByClose ? "Flatten-only window; new entries forbidden." : "Not in the entry window of a regular US stock session.");
  if (!validQuote) blockers.push("No valid two-sided live quote; spread cannot be verified.");
  if (quoteAgeSeconds === null || quoteAgeSeconds < 0 || quoteAgeSeconds > cfg.market.maximumQuoteAgeSeconds) warnings.push("Quote is missing, future-dated, or stale.");
  if (spreadPct !== null && spreadPct > maximumSpread) blockers.push("Live spread exceeds penny-stock price-tier limit.");
  if (bars.length < cfg.market.minimumCompleted5mBars || barStalenessMs > cfg.market.maximumBarLagMinutes*60_000) warnings.push("Missing sufficient recent completed 5-minute bars; possible halt, incomplete feed or closed market.");
  if (recentDollarVolume === null || recentDollarVolume < cfg.market.minimumRecentDollarVolume) blockers.push("Insufficient recent observed dollar liquidity.");
  if (relativeVolume === null || relativeVolume < cfg.setup.minimumRelativeVolume) warnings.push("No verified 5-minute relative-volume ignition.");
  if (fastMomentumPct === null || fastMomentumPct < cfg.setup.minimumMomentumPct || fastMomentumPct > cfg.setup.maximumMomentumPct) warnings.push("Fast momentum is missing or excessively extended.");
  if (atrPct === null || atrPct < cfg.setup.minimumAtrPct || atrPct > cfg.setup.maximumAtrPct) blockers.push("5-minute volatility is outside the defined stop regime.");
  if (prospect.sessionChangePct !== null && prospect.sessionChangePct > cfg.setup.maximumSessionGainPct) blockers.push("Session gain is already too extended; refuse chase.");
  if (chasePct !== null && chasePct > cfg.setup.maximumChasePct) blockers.push("Price exceeds maximum allowed breakout chase.");
  if (currentPrice !== null && entryTrigger !== null && currentPrice < entryTrigger) warnings.push("Entry breakout has not confirmed.");
  if (!ledger.active || ledger.equity <= 0 || ledger.buyingPower <= 0) blockers.push("Fuse virtual ledger is not active or has no buying power.");
  if (ledger.dailyLossPct >= cfg.risk.maximumDailyLossPct) blockers.push("Fuse daily loss kill switch.");
  if (ledger.openRiskPct >= cfg.risk.maximumOpenRiskPct) blockers.push("Fuse open risk is exhausted.");
  if (ledger.openPositions >= cfg.risk.maximumOpenPositions || ledger.dailyEntries >= cfg.risk.maximumEntriesPerDay) blockers.push("Fuse trade-frequency or open-position cap.");
  if (ledger.hasExistingOrderOrPosition) blockers.push("Duplicate order or existing position for this symbol.");

  const scores = {
    scanner: clamp(prospect.scannerScore/100*10,10),
    ignition: clamp(relativeVolume===null?0:(relativeVolume-1)*13,25),
    acceleration: clamp(fastMomentumPct===null?0:fastMomentumPct*9,20),
    structure: clamp(chasePct===null?0:chasePct < -1?3:chasePct<=cfg.setup.maximumChasePct?20:0,20),
    liquidity: clamp(spreadPct===null||recentDollarVolume===null?0:(1-spreadPct/maximumSpread)*10+recentDollarVolume/cfg.market.minimumRecentDollarVolume*2.5,15),
    volatility: clamp(atrPct===null?0:atrPct>=cfg.setup.minimumAtrPct&&atrPct<=cfg.setup.maximumAtrPct?10:0,10),
  };
  const fuseScore = Math.round(Object.values(scores).reduce((sum,v)=>sum+v,0));
  const trigger = entryTrigger;
  const stopPct = atrPct === null ? cfg.risk.defaultStopPct : Math.min(cfg.risk.maximumStopPct,Math.max(cfg.risk.minimumStopPct,atrPct*cfg.risk.atrStopMultiplier));
  const stopPrice = trigger !== null ? rnd(trigger*(1-stopPct/100)) : null;
  const targetPrice = trigger !== null && stopPrice !== null ? rnd(trigger+2*(trigger-stopPrice)) : null;
  const maxRisk = Math.max(0, Math.min(ledger.equity*cfg.risk.riskPerTradePct/100,ledger.equity*Math.max(0,cfg.risk.maximumOpenRiskPct-ledger.openRiskPct)/100));
  const maxCash = Math.max(0,Math.min(ledger.buyingPower,ledger.equity*cfg.risk.maximumAllocationPct/100));
  const riskShares = trigger && stopPrice ? Math.floor(maxRisk/(trigger-stopPrice)) : 0;
  const cashShares = trigger ? Math.floor(maxCash/trigger) : 0;
  const plannedShares = Math.max(0,Math.min(riskShares,cashShares));
  const purchaseAmount = trigger !== null ? rnd(plannedShares*trigger) : null;
  if (plannedShares < 1) blockers.push("A full share cannot fit within Fuse's isolated risk/cash limits.");

  if (input.historicalPatternScore !== undefined && input.historicalPatternScore !== null) {
    warnings.push("Historical pattern evidence is shadow-only; it cannot override hard risk gates.");
  }
  const conditionsPass = session.canEnter && sourceAge>=0 && sourceAge<=cfg.intake.maximumProspectAgeMinutes*60_000
    && quoteAgeSeconds!==null && quoteAgeSeconds>=0 && quoteAgeSeconds<=cfg.market.maximumQuoteAgeSeconds
    && bars.length>=cfg.market.minimumCompleted5mBars && barStalenessMs<=cfg.market.maximumBarLagMinutes*60_000
    && relativeVolume!==null && relativeVolume>=cfg.setup.minimumRelativeVolume
    && fastMomentumPct!==null && fastMomentumPct>=cfg.setup.minimumMomentumPct && fastMomentumPct<=cfg.setup.maximumMomentumPct
    && currentPrice!==null && trigger!==null && currentPrice>=trigger && chasePct!==null && chasePct<=cfg.setup.maximumChasePct;
  const ready = conditionsPass && blockers.length===0 && fuseScore>=cfg.scoring.readyScore;
  const readiness: FuseReadiness["readiness"] = blockers.length ? "rejected" : ready ? "research-ready" : fuseScore>=cfg.scoring.prepareScore?"prepared":"waiting";
  const phase = trigger===null || plannedShares<1 ? "awaiting-data" : ready || readiness==="prepared" ? "prepared" : "reference";
  return {
    contractVersion:PAPER_BOT_TRADE_PLAN_CONTRACT_VERSION,botId:cfg.botProfileId,strategyId:cfg.id,strategyVersion:cfg.version,
    symbol:prospect.symbol,label:"Fuse penny ignition / early momentum",assetClass:"stock",currentPrice,
    score:fuseScore,fuseScore,readiness,state:readiness,detail:ready?"All research gates passed; simulated order submission remains DISABLED.":blockers[0]??warnings[0]??"Awaiting ignition.",
    horizons:["day"],executionEligible:false,selectedForSubmission:false,blockers,warnings,
    plan:{phase,entryPrice:trigger,purchaseAmount,stopPrice,maxLossDollars:trigger!==null&&stopPrice!==null?rnd(plannedShares*(trigger-stopPrice)):null,
      exitPrice:targetPrice,projectedProfitDollars:trigger!==null&&targetPrice!==null?rnd(plannedShares*(targetPrice-trigger)):null,
      projectedProfitPct:trigger!==null&&targetPrice!==null?(targetPrice/trigger-1)*100:null},
    spreadPct,quoteAgeSeconds,relativeVolume,recentDollarVolume,fastMomentumPct,chasePct,entryTrigger,maximumEntry,plannedShares,
    lastCompletedBarAt:last?.t??null,researchOnly:true,
  };
}
