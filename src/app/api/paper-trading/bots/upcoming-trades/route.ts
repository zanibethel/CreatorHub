import {NextResponse} from "next/server";
import {z} from "zod";
import {createAdminSupabaseClient} from "@/lib/supabase-admin";
import {buildUpcomingStockWatch,UPCOMING_SHARED_MODEL_NOTE} from "@/lib/paper-upcoming-trades";
import type {SharedPortfolioSnapshot,PortfolioExposure} from "@/lib/paper-shared-capital-manager";

export const dynamic="force-dynamic";
const numeric=z.coerce.number().finite();
const prospect=z.object({
  symbol:z.string(),status:z.string(),score:numeric,watchlist_eligible:z.boolean(),
  assigned_bot_ids:z.array(z.string()),spread_pct:numeric.nullable(),
  last_seen_at:z.string(),metadata:z.record(z.string(),z.unknown()),
});
const journal=z.object({
  bot_id:z.string(),symbol:z.string(),event_type:z.string(),
  qualification:z.string().nullable(),occurred_at:z.string(),
  blockers:z.array(z.string()),warnings:z.array(z.string()),
  metadata:z.record(z.string(),z.unknown()),
});
const order=z.object({
  bot_id:z.string(),symbol:z.string(),status:z.string(),side:z.string(),
  entry_trigger:numeric.nullable(),protective_stop:numeric.nullable(),
  take_profit_price:numeric.nullable(),requested_notional:numeric.nullable(),
  take_profit_fraction:numeric.nullable(),trail_remainder:z.boolean(),
  expires_at:z.string().nullable(),created_at:z.string(),
});
const position=z.object({bot_id:z.string(),symbol:z.string(),quantity:numeric});
const scenario=z.object({
  scenario_id:z.string(),state:z.string(),equity:numeric,cash:numeric,
  settled_cash:numeric,buying_power:numeric,reserved_cash:numeric,
  broker_execution_enabled:z.boolean(),paper_only:z.boolean(),
});
const reservation=z.object({
  symbol:z.string(),sleeve:z.enum(["stocks","swing","crypto"]),
  concentration_group:z.string(),planned_notional:numeric,planned_loss:numeric,
  status:z.string(),
});

function response(value:unknown,status=200){
  return NextResponse.json(value,{status,headers:{"Cache-Control":"no-store"}});
}

/** Sanitized public dashboard projection; no credentials, broker writes or claims. */
export async function GET(){
  try{
    const db=createAdminSupabaseClient();
    const [prospects,staged,positions,shared,holds]=await Promise.all([
      db.from("paper_prospects")
        .select("symbol,status,score,watchlist_eligible,assigned_bot_ids,spread_pct,last_seen_at,metadata")
        .eq("asset_class","stock").in("status",["watchlist","review-ready"])
        .eq("watchlist_eligible",true).order("score",{ascending:false}).limit(60),
      db.from("paper_bot_orders")
        .select("bot_id,symbol,status,side,entry_trigger,protective_stop,take_profit_price,requested_notional,take_profit_fraction,trail_remainder,expires_at,created_at")
        .eq("side","buy").in("status",["prepared","submitted","partially_filled"])
        .order("created_at",{ascending:false}).limit(100),
      db.from("paper_bot_positions").select("bot_id,symbol,quantity")
        .gt("quantity",0).limit(100),
      db.from("paper_shared_portfolio_scenarios")
        .select("scenario_id,state,equity,cash,settled_cash,buying_power,reserved_cash,broker_execution_enabled,paper_only")
        .eq("scenario_id","shared-paper-v1").maybeSingle(),
      db.from("paper_shared_capital_reservations")
        .select("symbol,sleeve,concentration_group,planned_notional,planned_loss,status")
        .eq("scenario_id","shared-paper-v1").eq("status","held").limit(100),
    ]);
    for(const result of [prospects,staged,positions,shared,holds]){
      if(result.error)throw new Error("Upcoming source read failed.");
    }
    const stocks=z.array(prospect).parse(prospects.data??[]);
    const symbols=stocks.map(p=>p.symbol).filter(Boolean);
    const journalResult=symbols.length?await db.from("paper_bot_journal")
      .select("bot_id,symbol,event_type,qualification,occurred_at,blockers,warnings,metadata")
      .in("symbol",symbols).eq("asset_class","stock")
      .in("event_type",["candidate","authorized"])
      .gte("occurred_at",new Date(Date.now()-36*3600_000).toISOString())
      .order("occurred_at",{ascending:false}).limit(3500):{data:[],error:null};
    if(journalResult.error)throw new Error("Upcoming journal read failed.");
    const portfolioRow=shared.data?scenario.parse(shared.data):null;
    const pending=z.array(reservation).parse(holds.data??[]);
    let portfolio:SharedPortfolioSnapshot|null=null;
    // These are diagnostic previews ONLY. Period-start losses have not been
    // reconciled to a shared execution ledger, so no authorization is possible.
    if(portfolioRow&&portfolioRow.state==="preview"&&portfolioRow.paper_only&&
       !portfolioRow.broker_execution_enabled&&portfolioRow.equity>0){
      const mapped:PortfolioExposure[]=pending.map(p=>({
        symbol:p.symbol,sleeve:p.sleeve,concentrationGroup:p.concentration_group,
        marketValueUsd:p.planned_notional,plannedLossUsd:p.planned_loss,
      }));
      portfolio={
        equityUsd:portfolioRow.equity,settledCashUsd:portfolioRow.settled_cash,
        buyingPowerUsd:portfolioRow.buying_power,reservedCashUsd:portfolioRow.reserved_cash,
        dayStartEquityUsd:portfolioRow.equity,weekStartEquityUsd:portfolioRow.equity,
        dayProfitLossUsd:0,weekProfitLossUsd:0,
        holdings:[],pendingEntries:mapped,
      };
    }
    const candidates=buildUpcomingStockWatch({
      prospects:stocks,
      journals:z.array(journal).parse(journalResult.data??[]),
      stagedOrders:z.array(order).parse(staged.data??[]),
      positions:z.array(position).parse(positions.data??[]),
      portfolio,now:new Date().toISOString(),
    });
    return response({
      collectedAt:new Date().toISOString(),source:"stored-watchlist-and-bot-decisions",
      executionMode:"observation-only",brokerOrderAuthorized:false,
      sharedPortfolio:portfolioRow?{
        startingModel:"$5,000 shared PAPER research",
        equityUsd:portfolioRow.equity,reservedCashUsd:portfolioRow.reserved_cash,
        executionIntegrated:false,lossWindowsVerified:false,
      }:null,
      candidates,modelNote:UPCOMING_SHARED_MODEL_NOTE,
    });
  }catch{
    return response({error:"Upcoming trade plans are temporarily unavailable; no execution state has been inferred."},503);
  }
}
