import { NextResponse } from "next/server";
import { z } from "zod";
import { evaluateSqueezeBreakoutCandidate } from "@/lib/paper-squeeze-breakout-readiness";
import { SQUEEZE_BREAKOUT_STRATEGY_V1 as strategy } from "@/lib/paper-squeeze-breakout-strategy-config";

export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://yufptpfiwdbzzrvhkvux.supabase.co";
const ALPACA_DATA = "https://data.alpaca.markets";

const prospectSchema = z.object({
  symbol:z.string(),
  score:z.coerce.number().finite(),
  base_high:z.coerce.number().finite().positive().nullable(),
  base_low:z.coerce.number().finite().positive().nullable(),
  base_range_pct:z.coerce.number().finite().nullable(),
  relative_volume_pace:z.coerce.number().finite().nullable(),
  session_change_pct:z.coerce.number().finite().nullable(),
  spread_pct:z.coerce.number().finite().nullable(),
  average_dollar_volume:z.coerce.number().finite().nullable(),
  reasons:z.array(z.string()).default([]),
});
const ledgerSchema = z.object({
  status:z.enum(["active","planned","paused"]),
  equity:z.coerce.number().finite().nonnegative(),
  buying_power:z.coerce.number().finite().nullable(),
  open_planned_risk_pct:z.coerce.number().finite().nullable(),
  metadata:z.object({executionEnabled:z.boolean().optional()}).passthrough(),
});
const positionSchema=z.object({symbol:z.string(),quantity:z.coerce.number().finite().positive()});

function reply(body:unknown,status=200){
  return NextResponse.json(body,{status,headers:{"Cache-Control":"no-store"}});
}
function record(value:unknown):Record<string,unknown>{
  return value && typeof value==="object" && !Array.isArray(value) ? value as Record<string,unknown> : {};
}
function num(value:unknown){
  const parsed=typeof value==="number" ? value : typeof value==="string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}
function str(value:unknown){return typeof value==="string" && value.trim() ? value.trim() : null;}

export async function GET(request: Request){
  const supabaseSecret=process.env.SUPABASE_SECRET_KEY?.trim() ?? "";
  const alpacaKey=process.env.ALPACA_API_KEY_ID?.trim() ?? "";
  const alpacaSecret=process.env.ALPACA_API_SECRET_KEY?.trim() ?? "";
  if(!supabaseSecret || !alpacaKey || !alpacaSecret) return reply({error:"Squeeze readiness dependencies are not configured."},503);

  const dbHeaders:Record<string,string>={apikey:supabaseSecret,Accept:"application/json"};
  if(supabaseSecret.startsWith("eyJ")) dbHeaders.Authorization=`Bearer ${supabaseSecret}`;
  const db=async(path:string)=>{
    const response=await fetch(`${SUPABASE_URL}/rest/v1/${path}`,{headers:dbHeaders,cache:"no-store",signal:AbortSignal.timeout(15_000)});
    if(!response.ok) throw new Error(`Squeeze readiness storage returned HTTP ${response.status}.`);
    return response.json();
  };
  const alpacaHeaders={"APCA-API-KEY-ID":alpacaKey,"APCA-API-SECRET-KEY":alpacaSecret,Accept:"application/json"};
  const market=async(url:string)=>{
    const response=await fetch(url,{headers:alpacaHeaders,cache:"no-store",signal:AbortSignal.timeout(15_000)});
    if(!response.ok) throw new Error(`Squeeze readiness market data returned HTTP ${response.status}.`);
    return response.json();
  };

  try{
    const [prospectRaw,ledgerRaw,positionsRaw]=await Promise.all([
      db(`paper_squeeze_prospects?status=neq.expired&watchlist_eligible=eq.true&select=symbol,score,base_high,base_low,base_range_pct,relative_volume_pace,session_change_pct,spread_pct,average_dollar_volume,reasons&order=score.desc,last_seen_at.desc&limit=20`),
      db(`paper_bot_ledgers?bot_id=eq.${strategy.botProfileId}&select=status,equity,buying_power,open_planned_risk_pct,metadata&limit=1`),
      db(`paper_bot_positions?bot_id=eq.${strategy.botProfileId}&select=symbol,quantity&limit=20`),
    ]);

    const prospects=z.array(prospectSchema).parse(prospectRaw);
    const ledger=z.array(ledgerSchema).parse(ledgerRaw)[0];
    const positions=z.array(positionSchema).parse(positionsRaw);
    if(!ledger) return reply({error:"Squeeze Breakout virtual ledger is not configured."},503);

    const symbols=prospects.map(item=>item.symbol);
    let snapshots:Record<string,unknown>={};
    if(symbols.length){
      snapshots=record(await market(`${ALPACA_DATA}/v2/stocks/snapshots?feed=iex&symbols=${encodeURIComponent(symbols.join(","))}`));
    }
    const now=Date.now();
    const executionEnabled=ledger.metadata.executionEnabled === true;
    const plans=prospects.map(item=>{
      const snapshot=record(snapshots[item.symbol]);
      const quote=record(snapshot.latestQuote);
      const bid=num(quote.bp), ask=num(quote.ap), timestamp=str(quote.t);
      return evaluateSqueezeBreakoutCandidate({
        now,
        prospect:{
          symbol:item.symbol,
          scannerScore:item.score,
          baseHigh:item.base_high,
          baseLow:item.base_low,
          baseRangePct:item.base_range_pct,
          relativeVolumePace:item.relative_volume_pace,
          sessionChangePct:item.session_change_pct,
          spreadPct:item.spread_pct,
          averageDollarVolume:item.average_dollar_volume,
          reasons:item.reasons,
        },
        quote:{bid,ask,timestamp},
        ledger:{
          active:ledger.status==="active",
          equity:ledger.equity,
          buyingPower:ledger.buying_power ?? ledger.equity,
          openRiskPct:ledger.open_planned_risk_pct ?? 0,
          openPositions:positions.length,
          executionEnabled,
        },
      });
    }).sort((a,b)=>(b.score ?? -1)-(a.score ?? -1));

    const cronSecret=process.env.CRON_SECRET?.trim() ?? "";
    const isCron=Boolean(cronSecret && request.headers.get("authorization") === `Bearer ${cronSecret}`);
    if(isCron && plans.length){
      const response=await fetch(`${SUPABASE_URL}/rest/v1/paper_bot_journal`,{
        method:"POST",
        headers:{...dbHeaders,"Content-Type":"application/json",Prefer:"return=minimal"},
        body:JSON.stringify(plans.map(plan=>({
          bot_id:strategy.botProfileId,
          strategy_id:strategy.id,
          strategy_version:strategy.version,
          event_type:"candidate",
          symbol:plan.symbol,
          asset_class:"stock",
          occurred_at:new Date(now).toISOString(),
          score:plan.score,
          qualification:plan.score !== null && plan.score >= strategy.setup.readyScore
            ? "trade-ready"
            : plan.score !== null && plan.score >= strategy.setup.qualifiedScore
              ? "qualified"
              : plan.score !== null && plan.score >= strategy.setup.watchScore
                ? "watch"
                : "unqualified",
          regime:"unknown",
          component_scores:{prospectSource:strategy.scanner.id,compressionIgnition:true},
          market_snapshot:{currentPrice:plan.currentPrice},
          risk_plan:plan.plan,
          blockers:plan.blockers,
          warnings:plan.warnings,
          metadata:{executionEnabled,reviewOnly:!executionEnabled,targetOpportunityZonePct:strategy.opportunity.opportunityZonePct},
        }))),
        cache:"no-store",
        signal:AbortSignal.timeout(10_000),
      });
      if(!response.ok) throw new Error(`Squeeze readiness journal returned HTTP ${response.status}.`);
    }

    return reply({
      collectedAt:new Date(now).toISOString(),
      strategyId:strategy.id,
      strategyVersion:strategy.version,
      paperOnly:true,
      executionEnabled,
      opportunityZonePct:strategy.opportunity.opportunityZonePct,
      partialProfitPct:strategy.opportunity.partialProfitPct,
      primaryTargetPct:strategy.opportunity.primaryTargetPct,
      plans,
    });
  }catch(reason){
    return reply({error:reason instanceof Error ? reason.message : "Squeeze readiness unavailable."},503);
  }
}
