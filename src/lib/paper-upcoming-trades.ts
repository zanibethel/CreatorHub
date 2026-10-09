import {
  PAPER_SHARED_CAPITAL_POLICY_V1 as policy,
  previewSharedPaperAllocation,
  type SharedPortfolioSnapshot,
} from "./paper-shared-capital-manager";

/** Public-safe read-only projection. A watchlist assignment is NOT a trade order. */
export type UpcomingProspect = {
  symbol:string;status:string;score:number;watchlist_eligible:boolean;
  assigned_bot_ids:string[];spread_pct:number|null;last_seen_at:string;
  metadata:Record<string,unknown>;
};
export type UpcomingJournal = {
  bot_id:string;symbol:string;event_type:string;qualification:string|null;
  occurred_at:string;blockers:string[];warnings:string[];
  metadata:Record<string,unknown>;
};
export type UpcomingStagedOrder = {
  bot_id:string;symbol:string;status:string;side:string;
  entry_trigger:number|null;protective_stop:number|null;take_profit_price:number|null;
  requested_notional:number|null;expires_at:string|null;created_at:string;
};
export type UpcomingHeldPosition={bot_id:string;symbol:string;quantity:number};
export type UpcomingStock = {
  symbol:string;watchlistScore:number;watchlistStatus:string;
  assignedBotId:string;assignedBotName:string;reviewingBots:string[];
  planSource:"prepared-order"|"strategy-reference"|"awaiting-plan";
  planState:"prepared"|"watching"|"blocked"|"awaiting-plan";
  entryPrice:number|null;stopPrice:number|null;targetPrice:number|null;
  referenceNotional:number|null;netRewardRisk:number|null;
  allocatorState:"rejected"|"shadow-only"|"allocatable"|null;
  allocatorBudgetUsd:number|null;
  allocatorReasons:string[];
  paperOrderAuthorized:false;
  quoteFresh:false|boolean;quoteAt:string|null;planCheckedAt:string|null;
  reason:string;
};
const names:Record<string,string>={
  "default-diverse":"Atlas","penny-volatility-day-100":"Fuse",
  "three-trade-weekly-swing-100":"Harbor","momentum-breakout-100":"Pulse",
  "squeeze-breakout-100":"Coil","crypto-ignition-100":"Spark",
  "weekend-crypto-day-100":"Flash","crypto-swing-100":"Orbit",
};
const num=(v:unknown)=>typeof v==="number"&&Number.isFinite(v)?v:
  typeof v==="string"&&v.trim()&&Number.isFinite(Number(v))?Number(v):null;
const map=(v:unknown):Record<string,unknown>=>v&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,unknown>:{};
const date=(v:string|null)=>v&&Number.isFinite(Date.parse(v))?Date.parse(v):0;
const normalize=(s:string)=>s.replace(/[\\/\s-]/g,"").toUpperCase();
const valid=(entry:number|null,stop:number|null,target:number|null)=>
  entry!==null&&stop!==null&&target!==null&&entry>0&&stop>0&&stop<entry&&target>entry;
const BOT_STOCK_SLEEVE=(id:string)=>id==="three-trade-weekly-swing-100"?"swing" as const:"stocks" as const;

export function buildUpcomingStockWatch(
  input:{
    prospects:UpcomingProspect[];journals:UpcomingJournal[];
    stagedOrders:UpcomingStagedOrder[];positions:UpcomingHeldPosition[];
    portfolio:SharedPortfolioSnapshot|null;now:string;
  },
):UpcomingStock[]{
  const now=date(input.now);
  if(!now)throw new Error("A valid evaluation timestamp is required.");
  const matching=new Map<string,UpcomingJournal>();
  for(const j of [...input.journals].sort((a,b)=>date(b.occurred_at)-date(a.occurred_at))){
    const k=`${j.bot_id}:${normalize(j.symbol)}`;
    if(!matching.has(k) && date(j.occurred_at)<=now && date(j.occurred_at)>=now-36*3600_000){
      matching.set(k,j);
    }
  }
  return input.prospects
    .filter(p=>p.watchlist_eligible && ["watchlist","review-ready"].includes(p.status) &&
      p.assigned_bot_ids.length>0 && /^[A-Z0-9.]{1,15}$/.test(p.symbol.toUpperCase()) &&
      date(p.last_seen_at)>now-72*3600_000)
    .map(p=>{
      const symbol=p.symbol.toUpperCase();
      const quotes = p.metadata;
      const proposals=p.assigned_bot_ids.map(id=>{
        const journal=matching.get(`${id}:${normalize(symbol)}`);
        const order=input.stagedOrders.find(o=>o.bot_id===id&&normalize(o.symbol)===normalize(symbol)&&
          o.side==="buy" && o.status==="prepared" && date(o.expires_at)>now);
        const ref=map(journal?.metadata?.referencePlan);
        const prepared=order&&valid(order.entry_trigger,order.protective_stop,order.take_profit_price);
        const entry=prepared?order.entry_trigger:num(ref.entryTrigger);
        const stop=prepared?order.protective_stop:num(ref.stopPrice);
        const target=prepared?order.take_profit_price:num(ref.exitPrice);
        const planned=valid(entry,stop,target);
        // Historical reference signals are never upgraded to ready by a scanner score.
        const quoteRaw=map(journal?.metadata?.inputProvenance).quoteAt ?? quotes.quoteAt;
        const quoteAt=typeof quoteRaw==="string" && date(quoteRaw)?quoteRaw:null;
        const quoteFresh=!!quoteAt && date(quoteAt)<=now && now-date(quoteAt)<=90_000;
        const allClear=journal?.qualification==="trade-ready" &&
          journal.blockers.length===0&&journal.warnings.length===0;
        const reason=order&&prepared?"Prepared entry awaiting same-session revalidation.":
          journal?.blockers[0]??journal?.warnings[0]??"Assigned for bot review; no authorized order.";
        const planSource=prepared?"prepared-order" as const:planned?"strategy-reference" as const:"awaiting-plan" as const;
        const planState=prepared?"prepared" as const:planned?
          (journal?.blockers.length?"blocked" as const:"watching" as const):"awaiting-plan" as const;
        const notional=prepared?order.requested_notional:num(ref.uncappedPositionValue);
        const spread=p.spread_pct;
        // 0.50% minimum round-trip friction is an OBSERVATION assumption, not broker evidence.
        const costPct=Math.max(0.5,(spread??0)*2+0.2);
        let allocatorState:UpcomingStock["allocatorState"]=null;
        let allocatorBudgetUsd:number|null=null;
        let allocatorReasons:string[]=[];
        let netRewardRisk:number|null=null;
        if(planned && entry!==null && stop!==null && target!==null){
          const roundTripCost=entry*costPct/100;
          netRewardRisk=Math.round(((target-entry-roundTripCost)/(entry-stop+roundTripCost))*100)/100;
          if(input.portfolio){
            const preview=previewSharedPaperAllocation({
              botId:id,symbol,sleeve:BOT_STOCK_SLEEVE(id),assetClass:"stock",
              // No verified industry taxonomy yet: group UNKNOWN together conservatively.
              concentrationGroup:"UNVERIFIED-STOCK-EXPOSURE",
              entryPrice:entry,stopPrice:stop,targetPrice:target,
              roundTripCostPct:costPct,
              strategyQualified:allClear,
              freshQuote:quoteFresh,
              marketSessionEligible:quotes.marketSession==="regular",
              // Broker protection / serial order ownership must be separately proven.
              brokerProtectionSupported:false,speculative:entry<=5,
            },input.portfolio);
            allocatorState=preview.state;
            allocatorBudgetUsd=preview.capitalLimitUsd;
            allocatorReasons=preview.reasons;
          }
        }
        return {
          assignedBotId:id,
          assignedBotName:names[id]??id,
          planSource,planState,entryPrice:planned?entry:null,
          stopPrice:planned?stop:null,targetPrice:planned?target:null,
          referenceNotional:planned?notional:null,
          netRewardRisk:planned?netRewardRisk:null,allocatorState,allocatorBudgetUsd,allocatorReasons,
          quoteFresh,quoteAt,planCheckedAt:journal?.occurred_at??order?.created_at??null,reason,
          rank:planned?(prepared?3:2):1,
        };
      });
      proposals.sort((a,b)=>b.rank-a.rank || (date(b.planCheckedAt)-date(a.planCheckedAt)) ||
        a.assignedBotId.localeCompare(b.assignedBotId));
      const lead=proposals[0];
      return {
        symbol,watchlistScore:p.score,watchlistStatus:p.status,
        assignedBotId:lead.assignedBotId,assignedBotName:lead.assignedBotName,
        reviewingBots:p.assigned_bot_ids.map(id=>names[id]??id),
        planSource:lead.planSource,planState:lead.planState,
        entryPrice:lead.entryPrice,stopPrice:lead.stopPrice,targetPrice:lead.targetPrice,
        referenceNotional:lead.referenceNotional,netRewardRisk:lead.netRewardRisk,
        allocatorState:lead.allocatorState,allocatorBudgetUsd:lead.allocatorBudgetUsd,
        allocatorReasons:lead.allocatorReasons,paperOrderAuthorized:false as const,
        quoteFresh:lead.quoteFresh,quoteAt:lead.quoteAt,planCheckedAt:lead.planCheckedAt,
        reason:input.positions.some(pos=>pos.quantity>0&&normalize(pos.symbol)===normalize(symbol))
          ?"Symbol already held by a PAPER bot; no new entry implied.":lead.reason,
      };
    })
    .filter(row=>!input.positions.some(pos=>pos.quantity>0&&normalize(pos.symbol)===normalize(row.symbol)))
    .sort((a,b)=>(b.planSource==="prepared-order"?1:0)-(a.planSource==="prepared-order"?1:0) ||
      (b.entryPrice!==null?1:0)-(a.entryPrice!==null?1:0) ||
      b.watchlistScore-a.watchlistScore)
    .slice(0,6);
}

export const UPCOMING_SHARED_MODEL_NOTE =
  "Research-only capital fit; pending orders, risk and broker protection remain subject to independent verification. No shared-paper broker execution.";
