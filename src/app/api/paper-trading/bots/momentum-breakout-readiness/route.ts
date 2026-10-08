import { NextResponse } from "next/server";
import { z } from "zod";
import { fetchPreferredStockQuotes } from "@/lib/live-stock-market-data";
import { evaluateMomentumBreakoutCandidate, type MomentumBar } from "@/lib/paper-momentum-breakout-readiness";
import { MOMENTUM_BREAKOUT_STRATEGY_V1 as strategy } from "@/lib/paper-momentum-breakout-strategy-config";
import { classifyPulseJournalPlan } from "@/lib/paper-pulse-journal-contract";

export const dynamic="force-dynamic";

const SUPABASE_URL=process.env.NEXT_PUBLIC_SUPABASE_URL||"https://yufptpfiwdbzzrvhkvux.supabase.co";
const ALPACA_DATA="https://data.alpaca.markets";

const prospectSchema=z.object({
  symbol:z.string(),
  scanner_version:z.coerce.number().int(),
  score:z.coerce.number().finite(),
  percent_change:z.coerce.number().finite().nullable(),
  score_components:z.object({
    acceleration:z.coerce.number().finite().optional().default(0),
    catalyst:z.coerce.number().finite().optional().default(0),
    chasePenalty:z.coerce.number().finite().optional().default(0),
  }).passthrough(),
  reasons:z.array(z.string()).default([]),
  last_seen_at:z.string(),
  assigned_bot_ids:z.array(z.string()).default([]),
});
const ledgerSchema=z.object({
  status:z.enum(["active","planned","paused"]),
  equity:z.coerce.number().finite().nonnegative(),
  buying_power:z.coerce.number().finite().nullable(),
  open_planned_risk_pct:z.coerce.number().finite().nullable(),
  daily_realized_loss_pct:z.coerce.number().finite().nullable(),
  metadata:z.object({executionEnabled:z.boolean().optional()}).passthrough(),
});
const positionSchema=z.object({bot_id:z.string(),symbol:z.string(),quantity:z.coerce.number().finite().positive()});
const orderSchema=z.object({status:z.string(),created_at:z.string()});
const rawBarSchema=z.object({
  t:z.string(),o:z.coerce.number().finite().positive(),h:z.coerce.number().finite().positive(),
  l:z.coerce.number().finite().positive(),c:z.coerce.number().finite().positive(),v:z.coerce.number().finite().nonnegative(),
});

function reply(body:unknown,status=200){return NextResponse.json(body,{status,headers:{"Cache-Control":"no-store"}});}
function chicagoDate(value:number){
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"America/Chicago",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date(value));
  const map=Object.fromEntries(parts.map(part=>[part.type,part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

export async function GET(request:Request){
  const supabaseSecret=process.env.SUPABASE_SECRET_KEY?.trim()??"";
  const alpacaKey=process.env.ALPACA_API_KEY_ID?.trim()??"";
  const alpacaSecret=process.env.ALPACA_API_SECRET_KEY?.trim()??"";
  if(!supabaseSecret||!alpacaKey||!alpacaSecret)return reply({error:"Pulse readiness dependencies are not configured."},503);

  const dbHeaders:Record<string,string>={apikey:supabaseSecret,Accept:"application/json"};
  if(supabaseSecret.startsWith("eyJ"))dbHeaders.Authorization=`Bearer ${supabaseSecret}`;
  const db=async(path:string)=>{
    const response=await fetch(`${SUPABASE_URL}/rest/v1/${path}`,{headers:dbHeaders,cache:"no-store",signal:AbortSignal.timeout(12_000)});
    if(!response.ok)throw new Error(`Pulse storage returned HTTP ${response.status}.`);
    return response.json();
  };

  try{
    const now=Date.now();
    const orderCutoff=encodeURIComponent(new Date(now-36*60*60*1000).toISOString());
    const [prospectRaw,ledgerRaw,positionsRaw,ordersRaw]=await Promise.all([
      db("paper_prospects?asset_class=eq.stock&status=eq.review-ready&bot_review_eligible=eq.true&select=symbol,scanner_version,score,percent_change,score_components,reasons,last_seen_at,assigned_bot_ids&order=score.desc,last_seen_at.desc&limit=30"),
      db(`paper_bot_ledgers?bot_id=eq.${strategy.botProfileId}&select=status,equity,buying_power,open_planned_risk_pct,daily_realized_loss_pct,metadata&limit=1`),
      db("paper_bot_positions?select=bot_id,symbol,quantity&quantity=gt.0"),
      db(`paper_bot_orders?bot_id=eq.${strategy.botProfileId}&side=eq.buy&created_at=gte.${orderCutoff}&select=status,created_at&order=created_at.desc&limit=100`),
    ]);
    const ledger=z.array(ledgerSchema).parse(ledgerRaw)[0];
    if(!ledger)return reply({error:"Pulse virtual ledger is not configured."},503);
    const prospects=z.array(prospectSchema).parse(prospectRaw)
      .filter(row=>row.assigned_bot_ids.includes(strategy.botProfileId));
    const positions=z.array(positionSchema).parse(positionsRaw);
    const recentOrders=z.array(orderSchema).parse(ordersRaw);

    const symbols=[...new Set(prospects.map(row=>row.symbol))];
    const quoteBatch=await fetchPreferredStockQuotes(symbols);
    const bars:Record<string,MomentumBar[]>={};
    if(symbols.length){
      const query=new URLSearchParams({
        symbols:symbols.join(","),timeframe:"5Min",
        start:new Date(now-8*60*60*1000).toISOString(),
        end:new Date(now).toISOString(),limit:"10000",sort:"asc",feed:"iex",
      });
      const response=await fetch(`${ALPACA_DATA}/v2/stocks/bars?${query.toString()}`,{
        headers:{"APCA-API-KEY-ID":alpacaKey,"APCA-API-SECRET-KEY":alpacaSecret,Accept:"application/json"},
        cache:"no-store",signal:AbortSignal.timeout(15_000),
      });
      if(!response.ok)throw new Error(`Pulse 5-minute market data returned HTTP ${response.status}.`);
      const payload=await response.json() as {bars?:Record<string,unknown>};
      for(const symbol of symbols){
        const parsed=z.array(rawBarSchema).safeParse(payload.bars?.[symbol]);
        bars[symbol]=parsed.success?parsed.data.filter(bar=>Date.parse(bar.t)+5*60_000<=now):[];
      }
    }

    const today=chicagoDate(now);
    const counted=new Set(["submitted","partially_filled","filled","closed","replaced"]);
    const dailyNewEntries=recentOrders.filter(order=>counted.has(order.status)&&chicagoDate(Date.parse(order.created_at))===today).length;
    const ownPositions=positions.filter(position=>position.bot_id===strategy.botProfileId);
    const occupiedByOther=new Set(positions.filter(position=>position.bot_id!==strategy.botProfileId).map(position=>position.symbol));
    const executionEnabled=ledger.metadata.executionEnabled===true;

    const plans=prospects.map(row=>evaluateMomentumBreakoutCandidate({
      now,
      prospect:{
        symbol:row.symbol,scannerScore:row.score,scannerVersion:row.scanner_version,lastSeenAt:row.last_seen_at,
        percentChange:row.percent_change,acceleration:row.score_components.acceleration,
        catalyst:row.score_components.catalyst,chasePenalty:row.score_components.chasePenalty,reasons:row.reasons,
      },
      quote:{
        bid:quoteBatch.quotes[row.symbol]?.bid??null,
        ask:quoteBatch.quotes[row.symbol]?.ask??null,
        timestamp:quoteBatch.quotes[row.symbol]?.timestamp??null,
      },
      bars5m:bars[row.symbol]??[],
      ledger:{
        active:ledger.status==="active",equity:ledger.equity,buyingPower:ledger.buying_power??ledger.equity,
        openRiskPct:ledger.open_planned_risk_pct??0,dailyRealizedLossPct:ledger.daily_realized_loss_pct??0,
        openPositions:ownPositions.length,dailyNewEntries,executionEnabled,
      },
      symbolOccupiedByOtherBot:occupiedByOther.has(row.symbol),
    })).sort((a,b)=>b.scannerScore-a.scannerScore||b.acceleration-a.acceleration||(a.spreadPct??999)-(b.spreadPct??999));

    const ready=plans.filter(plan=>plan.state==="ready");
    if(ready[0]&&executionEnabled)ready[0].selectedForSubmission=true;

    const cronSecret=process.env.CRON_SECRET?.trim()??"";
    const isCron=Boole    if(isCron){
      // Record an actual evaluated setup, or a genuine empty-scan heartbeat.
      // No phantom trades are created when the scanner has no Pulse assignments.
      const events=plans.length===0
        ? [{
          bot_id:strategy.botProfileId,strategy_id:strategy.id,strategy_version:strategy.version,
          event_type:"system",asset_class:"stock",occurred_at:new Date(now).toISOString(),
          qualification:null,regime:"unknown",component_scores:{},market_snapshot:{},risk_plan:{},
          blockers:[],warnings:["No scanner-qualified stocks currently assigned to Pulse."],
          metadata:{source:"pulse-5m-readiness",executionEnabled,paperOnly:true,noCandidates:true,
            scannerScope:"review-ready stock prospects assigned to Pulse"},
        }]
        : plans.map(plan=>{
          const classification=classifyPulseJournalPlan(plan);
          return {
            bot_id:strategy.botProfileId,strategy_id:strategy.id,strategy_version:strategy.version,
            event_type:classification.eventType,symbol:plan.symbol,asset_class:"stock",occurred_at:new Date(now).toISOString(),
            score:plan.scannerScore,qualification:classification.qualification,regime:"unknown",
            component_scores:{acceleration:plan.acceleration,catalyst:plan.catalyst,chasePenalty:plan.chasePenalty,
              fastMomentumPct:plan.fastMomentumPct,relativeVolume:plan.relativeVolume},
            market_snapshot:{bid:plan.bid,ask:plan.ask,spreadPct:plan.spreadPct,
              percentChange:prospects.find(row=>row.symbol===plan.symbol)?.percent_change??null},
            risk_plan:{entryTrigger:plan.trigger,maxEntryPrice:plan.maxEntry,protectiveStop:plan.protectiveStop,
              takeProfitPrice:plan.takeProfit,plannedNotional:plan.plannedNotional,plannedRiskDollars:plan.plannedRiskDollars},
            blockers:plan.blockers,warnings:plan.waitingOn,
            metadata:{source:"pulse-5m-readiness",executionEnabled,paperOnly:true,
              strategyState:plan.state,selectedForSubmission:plan.selectedForSubmission},
          };
        });
      const response=await fetch(`${SUPABASE_URL}/rest/v1/paper_bot_journal`,{
        method:"POST",
        headers:{...dbHeaders,"Content-Type":"application/json",Prefer:"return=minimal"},
        body:JSON.stringify(events),
        cache:"no-store",signal:AbortSignal.timeout(10_000),
      });
      if(!response.ok)throw new Error(`Pulse journal returned HTTP ${response.status}.`);
    }se.ok)throw new Error(`Pulse journal returned HTTP ${response.status}.`);
    }

    return reply({
      collectedAt:new Date(now).toISOString(),strategyId:strategy.id,strategyVersion:strategy.version,paperOnly:true,
      executionEnabled,submissionReady:Boolean(executionEnabled&&ready[0]?.selectedForSubmission),
      selectedSymbol:ready[0]?.symbol??null,
      marketData:{source:quoteBatch.source,fallback:quoteBatch.fallback,providerError:quoteBatch.providerError},
      dailyEntriesRemaining:Math.max(0,strategy.cadence.maximumNewEntriesPerDay-dailyNewEntries),
      openPositionSlotsRemaining:Math.max(0,strategy.cadence.maximumOpenPositions-ownPositions.length),
      plans,
    });
  }catch(error){
    return reply({error:error instanceof Error?error.message:"Pulse readiness unavailable."},503);
  }
}
