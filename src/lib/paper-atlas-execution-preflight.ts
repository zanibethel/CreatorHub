import type { PaperDecision } from "./paper-decision-engine";
import { ACTIVE_PAPER_STRATEGY } from "./paper-strategy-config";

// Read-only, fail-closed preflight. Atomic reservation and final broker recheck are still required.
export type AtlasBrokerAsset = {symbol:string;asset_class:"us_equity"|"crypto";tradable:boolean;fractionable?:boolean;status:string};
export type AtlasPool = "day"|"multi-day"|"multi-week";
export type AtlasPreflightInput = {
  decision:PaperDecision;brokerAsset:AtlasBrokerAsset|null;approvedPools:readonly AtlasPool[];
  pool:AtlasPool|null;poolLimitDollars:number|null;poolCommittedDollars:number|null;
  ledgerCashDollars:number|null;positionNotionalDollars:number|null;
  fractionalRequested:boolean;marketOpen:boolean|null;
};
export function atlasExecutionPreflight(input:AtlasPreflightInput) {
  const d=input.decision;
  const blockers=[...d.blockers];
  if(d.botProfileId!=="default-diverse"||d.strategyId!==ACTIVE_PAPER_STRATEGY.id||
     d.strategyVersion!==ACTIVE_PAPER_STRATEGY.version||d.mode!=="paper-only")
    blockers.push("Atlas strategy identity or version mismatch.");
  if(d.qualification!=="trade-ready"||d.score<ACTIVE_PAPER_STRATEGY.score.thresholds.tradeReady)
    blockers.push("Atlas decision is not trade-ready.");
  if(d.orderSubmission!==false) blockers.push("Unexpected decision submission state.");
  const asset=input.brokerAsset;
  if(!asset||asset.symbol!==d.symbol||asset.asset_class!==(d.assetClass==="stock"?"us_equity":"crypto")||
     !asset.tradable||asset.status!=="active")
    blockers.push("Verified active, tradable broker asset required.");
  if(input.fractionalRequested&&!asset?.fractionable)
    blockers.push("Fractional execution requires verified broker support.");
  if(!input.pool||!input.approvedPools.includes(input.pool))
    blockers.push("Funded Atlas pool approval is required.");
  const valid=(n:number|null)=>n!==null&&Number.isFinite(n)&&n>=0;
  const notional=input.positionNotionalDollars;
  if(!valid(notional)||notional===0||!valid(input.ledgerCashDollars)||
     notional!>input.ledgerCashDollars!)
    blockers.push("Atlas ledger cash must cover positive proposed notional.");
  if(!valid(input.poolLimitDollars)||!valid(input.poolCommittedDollars)||!valid(notional)||
     input.poolCommittedDollars!+notional!>input.poolLimitDollars!)
    blockers.push("Verified pool capacity must cover proposed notional.");
  if(input.marketOpen!==true) blockers.push("Verified open market session required.");
  return {preflightPassed:blockers.length===0,executionAuthorized:false as const,
    requiresAtomicReservation:true as const,blockers:[...new Set(blockers)]};
}
