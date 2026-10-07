import { NextResponse } from "next/server";
import { z } from "zod";
import { fetchPreferredStockQuotes } from "@/lib/live-stock-market-data";
import {
  evaluateSwingProspectIntake,
  SWING_PROSPECT_INTAKE,
  type SwingProspectBar,
} from "@/lib/paper-swing-prospect-intake";
import { THREE_TRADE_SWING_STRATEGY_V1 as strategy } from "@/lib/paper-swing-strategy-config";

export const dynamic = "force-dynamic";

const BOT_ID = strategy.botProfileId;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://yufptpfiwdbzzrvhkvux.supabase.co";
const ALPACA_DATA = "https://data.alpaca.markets";
const ALPACA_TRADING = "https://paper-api.alpaca.markets";

const ledgerSchema = z.object({
  status:z.enum(["active","planned","paused"]),
  equity:z.coerce.number().finite().nonnegative(),
  buying_power:z.coerce.number().finite().nonnegative().nullable(),
  metadata:z.object({
    stagingEnabled:z.boolean().optional(),
    executionEnabled:z.boolean().optional(),
  }).passthrough(),
});

const prospectSchema = z.object({
  symbol:z.string().min(1).max(16),
  scanner_id:z.string(),
  scanner_version:z.coerce.number().int().positive(),
  status:z.enum(["candidate","watchlist","review-ready","expired"]),
  score:z.coerce.number().finite().min(0).max(100),
  price:z.coerce.number().finite().positive().nullable(),
  percent_change:z.coerce.number().finite().nullable(),
  spread_pct:z.coerce.number().finite().nonnegative().nullable(),
  assigned_bot_ids:z.array(z.string()),
  score_components:z.record(z.string(),z.unknown()),
  reasons:z.array(z.string()),
  source_flags:z.array(z.string()),
  last_seen_at:z.string(),
  metadata:z.record(z.string(),z.unknown()),
});

const positionSchema=z.object({
  bot_id:z.string(),
  symbol:z.string(),
  quantity:z.coerce.number().finite().positive(),
});

const activeOrderSchema=z.object({
  bot_id:z.string(),
  symbol:z.string(),
  status:z.string(),
});

type Clock={is_open?:boolean;next_open?:string;next_close?:string};

function reply(body:unknown,status=200){
  return NextResponse.json(body,{status,headers:{"Cache-Control":"no-store"}});
}

function marketSessionAt(timestamp:number):"premarket"|"regular"|"after-hours"|"closed"{
  const parts=new Intl.DateTimeFormat("en-US",{
    timeZone:"America/New_York",weekday:"short",hour:"2-digit",minute:"2-digit",hourCycle:"h23",
  }).formatToParts(new Date(timestamp));
  const weekday=parts.find(part=>part.type==="weekday")?.value ?? "";
  if(weekday==="Sat"||weekday==="Sun") return "closed";
  const hour=Number(parts.find(part=>part.type==="hour")?.value ?? "0");
  const minute=Number(parts.find(part=>part.type==="minute")?.value ?? "0");
  const value=hour*60+minute;
  if(value>=240&&value<570) return "premarket";
  if(value>=570&&value<960) return "regular";
  if(value>=960&&value<1200) return "after-hours";
  return "closed";
}

function numberRecord(value:Record<string,unknown>,key:string){
  const raw=value[key];
  const parsed=typeof raw==="number"?raw:typeof raw==="string"?Number(raw):Number.NaN;
  return Number.isFinite(parsed)?parsed:0;
}

function yyyymmdd(timestamp:number){
  return new Intl.DateTimeFormat("en-CA",{
    timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit",
  }).format(new Date(timestamp)).replace(/-/g,"");
}

export async function GET(request:Request){
  const cronSecret=process.env.CRON_SECRET?.trim() ?? "";
  if(!cronSecret||request.headers.get("authorization")!==`Bearer ${cronSecret}`){
    return reply({error:"Unauthorized."},401);
  }

  const supabaseSecret=process.env.SUPABASE_SECRET_KEY?.trim() ?? "";
  const alpacaKey=process.env.ALPACA_API_KEY_ID?.trim() ?? "";
  const alpacaSecret=process.env.ALPACA_API_SECRET_KEY?.trim() ?? "";
  if(!supabaseSecret||!alpacaKey||!alpacaSecret){
    return reply({error:"Swing prospect intake dependencies are not configured."},503);
  }

  const now=Date.now();
  const collectedAt=new Date(now).toISOString();
  const session=marketSessionAt(now);
  if(session!=="premarket"&&session!=="regular"){
    return reply({ok:true,action:"none",reason:"outside-stock-intake-session",session});
  }

  const dbHeaders:Record<string,string>={apikey:supabaseSecret,Accept:"application/json"};
  if(supabaseSecret.startsWith("eyJ")) dbHeaders.Authorization=`Bearer ${supabaseSecret}`;

  const readDb=async(path:string)=>{
    const response=await fetch(`${SUPABASE_URL}/rest/v1/${path}`,{
      headers:dbHeaders,cache:"no-store",signal:AbortSignal.timeout(10_000),
    });
    if(!response.ok) throw new Error(`Swing intake storage read returned HTTP ${response.status}.`);
    return response.json();
  };

  const writeDb=async(path:string,body:unknown,prefer="return=minimal")=>{
    const response=await fetch(`${SUPABASE_URL}/rest/v1/${path}`,{
      method:"POST",
      headers:{...dbHeaders,"Content-Type":"application/json",Prefer:prefer},
      body:JSON.stringify(body),cache:"no-store",signal:AbortSignal.timeout(10_000),
    });
    if(!response.ok) throw new Error(`Swing intake storage write returned HTTP ${response.status}.`);
    const text=await response.text();
    return text?JSON.parse(text):null;
  };

  const alpacaHeaders={
    "APCA-API-KEY-ID":alpacaKey,
    "APCA-API-SECRET-KEY":alpacaSecret,
    Accept:"application/json",
  };

  const fetchMarket=async(url:string)=>{
    const response=await fetch(url,{
      headers:alpacaHeaders,cache:"no-store",signal:AbortSignal.timeout(15_000),
    });
    if(!response.ok) throw new Error(`Swing intake market data returned HTTP ${response.status}.`);
    return response.json();
  };

  try{
    const [ledgerRaw,prospectsRaw,positionsRaw,ordersRaw,clockRaw]=await Promise.all([
      readDb(`paper_bot_ledgers?select=status,equity,buying_power,metadata&bot_id=eq.${BOT_ID}&limit=1`),
      readDb(`paper_prospects?select=symbol,scanner_id,scanner_version,status,score,price,percent_change,spread_pct,assigned_bot_ids,score_components,reasons,source_flags,last_seen_at,metadata&asset_class=eq.stock&status=eq.review-ready&bot_review_eligible=eq.true&order=score.desc,last_seen_at.desc&limit=20`),
      readDb("paper_bot_positions?select=bot_id,symbol,quantity&quantity=gt.0"),
      readDb("paper_bot_orders?select=bot_id,symbol,status&side=eq.buy&status=in.(prepared,submitted,partially_filled)&limit=500"),
      fetchMarket(`${ALPACA_TRADING}/v2/clock`),
    ]);

    const ledger=z.array(ledgerSchema).parse(ledgerRaw)[0];
    if(!ledger) return reply({error:"Swing bot virtual ledger is unavailable."},503);
    if(ledger.status!=="active"||ledger.metadata.stagingEnabled!==true){
      return reply({ok:true,action:"none",reason:"swing-staging-disabled"});
    }

    const prospects=z.array(prospectSchema).parse(prospectsRaw)
      .filter(row=>row.assigned_bot_ids.includes(BOT_ID))
      .sort((a,b)=>b.score-a.score||Date.parse(b.last_seen_at)-Date.parse(a.last_seen_at));
    const positions=z.array(positionSchema).parse(positionsRaw);
    const activeOrders=z.array(activeOrderSchema).parse(ordersRaw);
    const exposureSymbols=new Set([
      ...positions.map(row=>row.symbol),
      ...activeOrders.map(row=>row.symbol),
    ]);

    if(!prospects.length){
      return reply({ok:true,action:"none",reason:"no-review-ready-swing-prospects",session});
    }

    const symbols=[...new Set(prospects.map(row=>row.symbol))];
    const liveQuotes=await fetchPreferredStockQuotes(symbols);

    const completedEndDate=new Date(now);
    completedEndDate.setUTCDate(completedEndDate.getUTCDate()-1);
    completedEndDate.setUTCHours(23,59,59,999);
    const historyStart=new Date(now-60*86_400_000).toISOString();
    const barsBySymbol:Record<string,SwingProspectBar[]>={};

    for(let index=0;index<symbols.length;index+=35){
      const batch=symbols.slice(index,index+35);
      const url=new URL("/v2/stocks/bars",ALPACA_DATA);
      url.searchParams.set("symbols",batch.join(","));
      url.searchParams.set("timeframe","1Day");
      url.searchParams.set("start",historyStart);
      url.searchParams.set("end",completedEndDate.toISOString());
      url.searchParams.set("limit","5000");
      url.searchParams.set("feed","sip");
      url.searchParams.set("adjustment","split");
      url.searchParams.set("sort","asc");
      const payload=await fetchMarket(url.toString()) as {bars?:Record<string,unknown[]>};
      for(const symbol of batch){
        const raw=Array.isArray(payload.bars?.[symbol])?payload.bars?.[symbol]??[]:[];
        barsBySymbol[symbol]=raw.flatMap(value=>{
          if(!value||typeof value!=="object"||Array.isArray(value)) return [];
          const row=value as Record<string,unknown>;
          const t=typeof row.t==="string"?row.t:"";
          const o=Number(row.o),h=Number(row.h),l=Number(row.l),c=Number(row.c);
          return t&&[o,h,l,c].every(Number.isFinite)?[{t,o,h,l,c}]:[];
        });
      }
    }

    const clock=clockRaw as Clock;
    const expiresAt=typeof clock.next_close==="string"&&Number.isFinite(Date.parse(clock.next_close))
      ? clock.next_close
      : null;
    if(!expiresAt) return reply({error:"Next stock-market close is unavailable for plan expiry."},503);

    const journalRows:Record<string,unknown>[]=[];
    const staged:Record<string,unknown>[]=[];
    const dispositions:Record<string,unknown>[]=[];
    let stageSlots=3;

    for(const prospect of prospects){
      const quote=liveQuotes.quotes[prospect.symbol];
      const components=prospect.score_components;
      const disposition=evaluateSwingProspectIntake({
        symbol:prospect.symbol,
        scannerId:prospect.scanner_id,
        scannerVersion:prospect.scanner_version,
        scannerScore:prospect.score,
        lastSeenAt:prospect.last_seen_at,
        assignedBotIds:prospect.assigned_bot_ids,
        price:prospect.price,
        percentChange:prospect.percent_change,
        spreadPct:prospect.spread_pct,
        scoreComponents:{
          momentum:numberRecord(components,"momentum"),
          activity:numberRecord(components,"activity"),
          liquidity:numberRecord(components,"liquidity"),
          volumeExpansion:numberRecord(components,"volumeExpansion"),
          structure:numberRecord(components,"structure"),
          news:numberRecord(components,"news"),
          acceleration:numberRecord(components,"acceleration"),
          catalyst:numberRecord(components,"catalyst"),
          chasePenalty:numberRecord(components,"chasePenalty"),
        },
        currentAsk:quote?.ask??null,
        currentBid:quote?.bid??null,
        quoteAt:quote?.timestamp??null,
        dailyBars:barsBySymbol[prospect.symbol]??[],
        equity:ledger.equity,
        buyingPower:ledger.buying_power??0,
        now,
        expiresAt,
        existingExposure:exposureSymbols.has(prospect.symbol),
      });

      let qualification=disposition.eligible?"eligible":"rejected";
      const blockers=[...disposition.blockers];
      if(disposition.eligible&&stageSlots<=0){
        qualification="deferred";
        blockers.push("Per-cycle prospect staging limit has been reached.");
      }

      let clientOrderId:string|null=null;
      if(disposition.eligible&&disposition.plan&&stageSlots>0){
        clientOrderId=`chb-sw3-p3-${yyyymmdd(now)}-${prospect.symbol.toLowerCase()}-${Math.floor(now/1000)}`;
        const order={
          client_order_id:clientOrderId,
          bot_id:BOT_ID,
          strategy_id:strategy.id,
          strategy_version:strategy.version,
          symbol:prospect.symbol,
          asset_class:"stock",
          side:"buy",
          status:"prepared",
          requested_notional:disposition.plan.requestedNotional,
          pool_id:"multi-day",
          entry_trigger:disposition.plan.entryTrigger,
          max_entry_price:disposition.plan.maxEntryPrice,
          protective_stop:disposition.plan.protectiveStop,
          planned_risk_dollars:disposition.plan.plannedRiskDollars,
          expires_at:disposition.plan.expiresAt,
          stage_reason:disposition.plan.stageReason,
          take_profit_price:disposition.plan.takeProfitPrice,
          take_profit_fraction:disposition.plan.takeProfitFraction,
          take_profit_r:disposition.plan.takeProfitR,
          protect_winner_at_r:disposition.plan.protectWinnerAtR,
          trail_remainder:disposition.plan.trailRemainder,
          metadata:{
            requiresRevalidation:true,
            liveMoneyEnabled:false,
            intakeVersion:1,
            scannerSource:"broad-prospect",
            scannerId:prospect.scanner_id,
            scannerVersion:prospect.scanner_version,
            scannerScore:prospect.score,
            scannerComponents:prospect.score_components,
            scannerReasons:prospect.reasons,
            scannerSourceFlags:prospect.source_flags,
            prospectLastSeenAt:prospect.last_seen_at,
            intakeAt:collectedAt,
            marketSession:session,
            quoteAt:quote?.timestamp??null,
            quoteSource:liveQuotes.source,
            technicalMetrics:disposition.metrics,
            orderAuthorizationOrigin:"swing-prospect-intake",
          },
        };
        await writeDb("paper_bot_orders",order);
        exposureSymbols.add(prospect.symbol);
        stageSlots-=1;
        qualification="staged";
        staged.push({
          symbol:prospect.symbol,
          score:prospect.score,
          clientOrderId,
          entryTrigger:disposition.plan.entryTrigger,
          maxEntryPrice:disposition.plan.maxEntryPrice,
          protectiveStop:disposition.plan.protectiveStop,
          takeProfitPrice:disposition.plan.takeProfitPrice,
          requestedNotional:disposition.plan.requestedNotional,
          plannedRiskDollars:disposition.plan.plannedRiskDollars,
        });
      }

      journalRows.push({
        bot_id:BOT_ID,
        strategy_id:strategy.id,
        strategy_version:strategy.version,
        event_type:"prospect-intake",
        symbol:prospect.symbol,
        asset_class:"stock",
        occurred_at:collectedAt,
        score:prospect.score,
        qualification,
        component_scores:prospect.score_components,
        market_snapshot:{
          price:prospect.price,
          percentChange:prospect.percent_change,
          spreadPct:prospect.spread_pct,
          bid:quote?.bid??null,
          ask:quote?.ask??null,
          quoteAt:quote?.timestamp??null,
          marketSession:session,
        },
        risk_plan:disposition.plan??{},
        blockers,
        warnings:disposition.warnings,
        client_order_id:clientOrderId,
        metadata:{
          scannerId:prospect.scanner_id,
          scannerVersion:prospect.scanner_version,
          prospectLastSeenAt:prospect.last_seen_at,
          scannerReasons:prospect.reasons,
          scannerSourceFlags:prospect.source_flags,
          intakeMetrics:disposition.metrics,
          liveMoneyEnabled:false,
        },
      });
      dispositions.push({
        symbol:prospect.symbol,
        score:prospect.score,
        qualification,
        blockers,
        warnings:disposition.warnings,
      });
    }

    if(journalRows.length) await writeDb("paper_bot_journal",journalRows);

    return reply({
      ok:true,
      action:staged.length?"staged":"none",
      session,
      collectedAt,
      scannerGate:SWING_PROSPECT_INTAKE,
      marketData:{source:liveQuotes.source,fallback:liveQuotes.fallback,providerError:liveQuotes.providerError},
      staged,
      dispositions,
    });
  }catch(error){
    return reply({error:error instanceof Error?error.message:"Swing prospect intake failed."},503);
  }
}
