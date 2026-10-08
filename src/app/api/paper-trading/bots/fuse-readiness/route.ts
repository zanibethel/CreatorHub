import { NextResponse } from "next/server";
import { z } from "zod";
import { fetchPreferredStockQuotes } from "@/lib/live-stock-market-data";
import { evaluateFuseCandidate, fuseSession, type FuseBar } from "@/lib/paper-fuse-readiness";
import { buildFuseShadowSeeds } from "@/lib/paper-fuse-counterfactual";
import { advancePaperCounterfactual, counterfactualPatch, type PaperCounterfactualState } from "@/lib/paper-counterfactual";
import { FUSE_PENNY_STRATEGY_V1 as cfg } from "@/lib/paper-fuse-strategy-config";

export const dynamic = "force-dynamic";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://yufptpfiwdbzzrvhkvux.supabase.co";
const ALPACA_DATA = "https://data.alpaca.markets";
const prospectSchema = z.object({
  symbol:z.string(),price:z.coerce.number().finite().nullable(),score:z.coerce.number().finite(),
  scanner_version:z.coerce.number().int(),last_seen_at:z.string(),
  percent_change:z.coerce.number().finite().nullable(),volume:z.coerce.number().finite().nullable(),
  assigned_bot_ids:z.array(z.string()).default([]),
});
const ledgerSchema = z.object({
  status:z.enum(["active","planned","paused"]),equity:z.coerce.number().finite().nonnegative(),
  buying_power:z.coerce.number().finite().nullable(),open_planned_risk_pct:z.coerce.number().finite().nullable(),
  daily_realized_loss_pct:z.coerce.number().finite().nullable(),metadata:z.record(z.string(),z.unknown()),
});
const positionSchema=z.object({symbol:z.string(),quantity:z.coerce.number().finite().positive()});
const orderSchema=z.object({symbol:z.string(),status:z.string(),created_at:z.string()});
const barSchema=z.object({
  t:z.string(),o:z.coerce.number().positive(),h:z.coerce.number().positive(),l:z.coerce.number().positive(),
  c:z.coerce.number().positive(),v:z.coerce.number().finite().nonnegative(),
});
const historicalSchema=z.object({symbol:z.string(),shadow_score:z.coerce.number().finite().nullable(),matched_count:z.coerce.number().int().nonnegative()});
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{"Cache-Control":"no-store"}});
const shadowRowSchema=z.object({
  id:z.coerce.number().int().positive(),setup_key:z.string(),bot_id:z.string(),strategy_id:z.string().nullable(),
  strategy_version:z.coerce.number().int().nullable(),symbol:z.string(),asset_class:z.string(),
  decision_at:z.string(),session_key:z.string().nullable(),
  status:z.enum(["watching","triggered","completed","expired","ambiguous","superseded"]),
  score:z.coerce.number().nullable(),trigger_price:z.coerce.number().positive(),
  max_entry_price:z.coerce.number().positive(),protective_stop:z.coerce.number().positive(),
  planned_take_profit:z.coerce.number().nullable(),assumed_entry_price:z.coerce.number().nullable(),
  risk_per_unit:z.coerce.number().nullable(),one_r_price:z.coerce.number().nullable(),two_r_price:z.coerce.number().nullable(),
  triggered_at:z.string().nullable(),stop_hit_at:z.string().nullable(),
  one_r_hit_at:z.string().nullable(),two_r_hit_at:z.string().nullable(),first_outcome:z.string().nullable(),
  peak_price:z.coerce.number().nullable(),trough_price:z.coerce.number().nullable(),
  last_bar_at:z.string().nullable(),mark_count:z.coerce.number().int().nonnegative(),
  mfe_r:z.coerce.number(),mae_r:z.coerce.number(),
  blockers:z.array(z.string()),warnings:z.array(z.string()),
  metadata:z.record(z.string(),z.unknown()),
});
function shadowState(row:z.infer<typeof shadowRowSchema>):PaperCounterfactualState {
  return {
    id:row.id,setupKey:row.setup_key,botId:row.bot_id,strategyId:row.strategy_id,
    strategyVersion:row.strategy_version,symbol:row.symbol,assetClass:row.asset_class,
    decisionAt:row.decision_at,sessionKey:row.session_key,status:row.status,score:row.score,
    triggerPrice:row.trigger_price,maxEntryPrice:row.max_entry_price,protectiveStop:row.protective_stop,
    plannedTakeProfit:row.planned_take_profit,assumedEntryPrice:row.assumed_entry_price,
    riskPerUnit:row.risk_per_unit,oneRPrice:row.one_r_price,twoRPrice:row.two_r_price,
    triggeredAt:row.triggered_at,stopHitAt:row.stop_hit_at,oneRHitAt:row.one_r_hit_at,
    twoRHitAt:row.two_r_hit_at,firstOutcome:row.first_outcome,
    peakPrice:row.peak_price,troughPrice:row.trough_price,lastBarAt:row.last_bar_at,
    markCount:row.mark_count,mfeR:row.mfe_r,maeR:row.mae_r,
    blockers:row.blockers,warnings:row.warnings,metadata:row.metadata,
  };
}
function nyDate(when:number) {
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date(when));
  const p=Object.fromEntries(parts.map(item=>[item.type,item.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

export async function GET(request:Request) {
  const secret=process.env.SUPABASE_SECRET_KEY?.trim()??"";
  const alpacaKey=process.env.ALPACA_API_KEY_ID?.trim()??"";
  const alpacaSecret=process.env.ALPACA_API_SECRET_KEY?.trim()??"";
  if(!secret||!alpacaKey||!alpacaSecret)return reply({error:"Fuse read-only research dependencies are not configured."},503);
  const dbHeaders:Record<string,string>={apikey:secret,Accept:"application/json"};
  if(secret.startsWith("eyJ"))dbHeaders.Authorization=`Bearer ${secret}`;
  const db=async(path:string)=>{
    const r=await fetch(`${SUPABASE_URL}/rest/v1/${path}`,{headers:dbHeaders,cache:"no-store",signal:AbortSignal.timeout(12_000)});
    if(!r.ok)throw new Error(`Fuse storage returned HTTP ${r.status}.`);
    return r.json();
  };
  try {
    const now=Date.now();
    const cronSecret=process.env.CRON_SECRET?.trim()??"";
    const isCron=Boolean(cronSecret && request.headers.get("authorization")===`Bearer ${cronSecret}`);
    const activeShadow=z.array(shadowRowSchema).parse(isCron
      ? await db(`paper_bot_counterfactuals?bot_id=eq.${cfg.botProfileId}&status=in.(watching,triggered)&select=*&order=decision_at.asc&limit=30`)
      : []);
    const cutoff=encodeURIComponent(new Date(now-36*3600_000).toISOString());
    const freshCutoff=encodeURIComponent(new Date(now-3*3600_000).toISOString());
    const [prospectsRaw,ledgerRaw,positionsRaw,ordersRaw,historicalRaw]=await Promise.all([
      db(`paper_prospects?asset_class=eq.stock&price=gte.0.08&price=lte.5&last_seen_at=gte.${freshCutoff}&select=symbol,price,score,scanner_version,last_seen_at,percent_change,volume,assigned_bot_ids&order=last_seen_at.desc&limit=150`),
      db(`paper_bot_ledgers?bot_id=eq.${cfg.botProfileId}&select=status,equity,buying_power,open_planned_risk_pct,daily_realized_loss_pct,metadata&limit=1`),
      db(`paper_bot_positions?bot_id=eq.${cfg.botProfileId}&quantity=gt.0&select=symbol,quantity&limit=20`),
      db(`paper_bot_orders?bot_id=eq.${cfg.botProfileId}&created_at=gte.${cutoff}&select=symbol,status,created_at&limit=100`),
      db(`paper_historical_pattern_scores?asset_class=eq.stock&horizon=eq.intraday&select=symbol,shadow_score,matched_count&order=updated_at.desc&limit=100`),
    ]);
    const ledger=z.array(ledgerSchema).parse(ledgerRaw)[0];
    if(!ledger)return reply({error:"Fuse virtual ledger does not exist."},503);
    const prospects=z.array(prospectSchema).parse(prospectsRaw)
      .filter(row=>row.assigned_bot_ids.includes(cfg.botProfileId)).slice(0,25);
    const positions=z.array(positionSchema).parse(positionsRaw);
    const orders=z.array(orderSchema).parse(ordersRaw);
    const historical=z.array(historicalSchema).parse(historicalRaw);
    const historicalBySymbol=new Map(historical.map(row=>[row.symbol,row]));
    const symbols=[...new Set([...prospects.map(row=>row.symbol),...activeShadow.map(row=>row.symbol)])];
    const quoteBatch=await fetchPreferredStockQuotes(symbols);
    const bars:Record<string,FuseBar[]>={};
    if(symbols.length) {
      const query=new URLSearchParams({symbols:symbols.join(","),timeframe:"5Min",
        start:new Date(now-9*3600_000).toISOString(),end:new Date(now).toISOString(),
        limit:"10000",sort:"asc",feed:"iex"});
      const response=await fetch(`${ALPACA_DATA}/v2/stocks/bars?${query}`,{
        headers:{"APCA-API-KEY-ID":alpacaKey,"APCA-API-SECRET-KEY":alpacaSecret,Accept:"application/json"},
        cache:"no-store",signal:AbortSignal.timeout(15_000),
      });
      if(!response.ok)throw new Error(`Fuse 5-minute bar feed returned HTTP ${response.status}.`);
      const raw=await response.json() as {bars?:Record<string,unknown>};
      for(const symbol of symbols) {
        const parsed=z.array(barSchema).safeParse(raw.bars?.[symbol]);
        const all=parsed.success?parsed.data:[];
        const sessionDay=nyDate(now);
        // Exclude previous-session bars and premarket bars so cross-session gaps cannot trigger the strategy.
        bars[symbol]=all.filter(bar=>{
          const start=Date.parse(bar.t);
          if(!Number.isFinite(start)||start+300_000>now||nyDate(start)!==sessionDay)return false;
          const p=new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date(start));
          const parts=Object.fromEntries(p.map(item=>[item.type,item.value]));
          const minute=Number(parts.hour)*60+Number(parts.minute);
          return minute>=570 && minute<960;
        });
      }
    }
    const entriesToday=orders.filter(order=>["submitted","partially_filled","filled","closed","replaced"].includes(order.status)&&nyDate(Date.parse(order.created_at))===nyDate(now)).length;
    const plans=prospects.map(row=>evaluateFuseCandidate({
      now,prospect:{symbol:row.symbol,scannerScore:row.score,scannerVersion:row.scanner_version,lastSeenAt:row.last_seen_at,
        price:row.price,sessionChangePct:row.percent_change,volume:row.volume,assigned:true},
      quote:{bid:quoteBatch.quotes[row.symbol]?.bid??null,ask:quoteBatch.quotes[row.symbol]?.ask??null,
        timestamp:quoteBatch.quotes[row.symbol]?.timestamp??null,source:quoteBatch.quotes[row.symbol]?.source},
      bars5m:bars[row.symbol]??[],
      ledger:{active:ledger.status==="active",equity:ledger.equity,buyingPower:ledger.buying_power??ledger.equity,
        openRiskPct:ledger.open_planned_risk_pct??0,dailyLossPct:ledger.daily_realized_loss_pct??0,
        openPositions:positions.length,dailyEntries:entriesToday,
        hasExistingOrderOrPosition:positions.some(p=>p.symbol===row.symbol)||
          orders.some(o=>o.symbol===row.symbol&&!["canceled","rejected","expired","closed","error"].includes(o.status))},
      historicalPatternScore:historicalBySymbol.get(row.symbol)?.shadow_score??null,
      historicalSampleCount:historicalBySymbol.get(row.symbol)?.matched_count??0,
    })).sort((a,b)=>b.fuseScore-a.fuseScore);

    // Only authenticated scheduler requests journal observations. Public dashboard reads NEVER mutate data.
    let persisted=0;
    if(isCron && plans.length) {
      const bucket=new Date(Math.floor(now/300_000)*300_000).toISOString();
      const rows=plans.map(plan=>({
        bot_id:cfg.botProfileId,strategy_id:cfg.id,strategy_version:cfg.version,
        symbol:plan.symbol,bar_bucket_at:bucket,evaluated_at:new Date(now).toISOString(),
        readiness:plan.readiness,fuse_score:plan.fuseScore,
        scanner_score:prospects.find(p=>p.symbol===plan.symbol)?.score??null,
        market_snapshot:{currentPrice:plan.currentPrice,spreadPct:plan.spreadPct,quoteAgeSeconds:plan.quoteAgeSeconds,
          recentDollarVolume:plan.recentDollarVolume,relativeVolume:plan.relativeVolume,
          fastMomentumPct:plan.fastMomentumPct,chasePct:plan.chasePct,lastCompletedBarAt:plan.lastCompletedBarAt,
          quoteProvider:quoteBatch.source,quoteFallback:quoteBatch.fallback},
        trade_plan:plan.plan,blockers:plan.blockers,warnings:plan.warnings,
        metadata:{paperOnly:true,researchOnly:true,executionEnabled:false,brokerTag:cfg.brokerTag},
      }));
      const r=await fetch(`${SUPABASE_URL}/rest/v1/paper_fuse_observations?on_conflict=bot_id,strategy_version,symbol,bar_bucket_at`,{
        method:"POST",headers:{...dbHeaders,"Content-Type":"application/json",Prefer:"resolution=ignore-duplicates,return=representation"},
        body:JSON.stringify(rows),cache:"no-store",signal:AbortSignal.timeout(12_000),
      });
      if(!r.ok)throw new Error(`Fuse decision evidence write returned HTTP ${r.status}.`);
      const newObservations=z.array(z.object({symbol:z.string()})).parse(await r.json());
      persisted=newObservations.length;
      if(persisted) {
        const events=rows.filter(row=>newObservations.some(saved=>saved.symbol===row.symbol)).map(row=>({
          bot_id:cfg.botProfileId,strategy_id:cfg.id,strategy_version:cfg.version,event_type:row.readiness==="rejected"?"rejected":"candidate",
          symbol:row.symbol,asset_class:"stock",occurred_at:row.evaluated_at,
          score:row.fuse_score,qualification:row.readiness==="research-ready"?"qualified":row.readiness==="rejected"?"unqualified":"watch",
          regime:"unknown",component_scores:{fuseScore:row.fuse_score,scannerScore:row.scanner_score},
          market_snapshot:row.market_snapshot,risk_plan:row.trade_plan,blockers:row.blockers,warnings:row.warnings,
          metadata:{source:"fuse-penny-research-v1",researchOnly:true,brokerTag:cfg.brokerTag},
        }));
        const journal=await fetch(`${SUPABASE_URL}/rest/v1/paper_bot_journal`,{
          method:"POST",headers:{...dbHeaders,"Content-Type":"application/json",Prefer:"return=minimal"},
          body:JSON.stringify(events),cache:"no-store",signal:AbortSignal.timeout(12_000),
        });
        if(!journal.ok)throw new Error(`Fuse shared journal returned HTTP ${journal.status} (observations preserved).`);
      }
    }
    const shadowTracking:{ok:boolean;seeds:number;updates:number;error?:string}={ok:!isCron,seeds:0,updates:0};
    if(isCron){
      try{
        const headers={...dbHeaders,"Content-Type":"application/json"};
        const seeds=buildFuseShadowSeeds(plans,new Date(now).toISOString(),nyDate(now));
        if(seeds.length){
          const response=await fetch(`${SUPABASE_URL}/rest/v1/paper_bot_counterfactuals?on_conflict=setup_key`,{
            method:"POST",headers:{...headers,Prefer:"resolution=ignore-duplicates,return=representation"},
            body:JSON.stringify(seeds),cache:"no-store",signal:AbortSignal.timeout(12_000),
          });
          if(!response.ok)throw new Error(`Fuse shadow seed persistence HTTP ${response.status}`);
          shadowTracking.seeds=z.array(z.object({id:z.coerce.number()})).parse(await response.json()).length;
        }
        const expireSession=!fuseSession(now).inRegularHours;
        for(const row of activeShadow){
          const updated=advancePaperCounterfactual(shadowState(row),bars[row.symbol]??[],{
            expire:expireSession||row.session_key!==nyDate(now),
          });
          if(!updated.changed)continue;
          const response=await fetch(
            `${SUPABASE_URL}/rest/v1/paper_bot_counterfactuals?bot_id=eq.${cfg.botProfileId}&id=eq.${row.id}`,{
              method:"PATCH",headers:{...headers,Prefer:"return=minimal"},
              body:JSON.stringify(counterfactualPatch(updated.state)),
              cache:"no-store",signal:AbortSignal.timeout(12_000),
            },
          );
          if(!response.ok)throw new Error(`Fuse shadow outcome persistence HTTP ${response.status}`);
          shadowTracking.updates++;
        }
        shadowTracking.ok=true;
      }catch(error){
        shadowTracking.ok=false;
        shadowTracking.error=error instanceof Error?error.message:"Fuse shadow tracking error";
      }
    }
    const evidence=z.array(z.object({
      symbol:z.string(),readiness:z.string(),fuse_score:z.coerce.number(),bar_bucket_at:z.string(),
      blockers:z.array(z.string()),warnings:z.array(z.string()),
    })).parse(await db(`paper_fuse_observations?bot_id=eq.${cfg.botProfileId}&select=symbol,readiness,fuse_score,bar_bucket_at,blockers,warnings&order=bar_bucket_at.desc&limit=60`));
    return reply({collectedAt:new Date(now).toISOString(),strategyId:cfg.id,strategyVersion:cfg.version,paperOnly:true,
      researchOnly:true,executionEnabled:false,submissionReady:false,persisted,shadowTracking,evidence,
      marketData:{source:quoteBatch.source,fallback:quoteBatch.fallback,providerError:quoteBatch.providerError,barFeed:"alpaca-iex"},
      ledger:{status:ledger.status,equity:ledger.equity,buyingPower:ledger.buying_power??ledger.equity},
      plans});
  } catch(error) {
    return reply({error:error instanceof Error?error.message:"Fuse research readiness failed."},503);
  }
}
