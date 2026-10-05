import { NextResponse } from "next/server";
import { scoreSqueezeProspect, type SqueezeDailyBar } from "@/lib/paper-squeeze-scanner";
import { SQUEEZE_BREAKOUT_STRATEGY_V1 as strategy } from "@/lib/paper-squeeze-breakout-strategy-config";

export const dynamic = "force-dynamic";

const DATA_URL = "https://data.alpaca.markets";
const TRADING_URL = "https://paper-api.alpaca.markets";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://yufptpfiwdbzzrvhkvux.supabase.co";

type JsonRecord = Record<string, unknown>;

function reply(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers:{ "Cache-Control":"no-store" } });
}
function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}
function array(value: unknown) { return Array.isArray(value) ? value : []; }
function str(value: unknown) { return typeof value === "string" && value.trim() ? value.trim() : null; }
function num(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}
function iso(value: unknown) {
  const valueString = str(value);
  return valueString && Number.isFinite(Date.parse(valueString)) ? valueString : null;
}
function chunk<T>(items: T[], size: number) {
  const result: T[][] = [];
  for (let index=0; index<items.length; index+=size) result.push(items.slice(index,index+size));
  return result;
}
function sourceAgeMinutes(timestamp: string | null, now: number) {
  return timestamp ? Math.max(0,(now-Date.parse(timestamp))/60_000) : Number.POSITIVE_INFINITY;
}
function spreadPct(snapshot: JsonRecord) {
  const quote = record(snapshot.latestQuote);
  const bid = num(quote.bp), ask = num(quote.ap);
  if (!(bid && ask && ask >= bid)) return null;
  const mid=(bid+ask)/2;
  return mid > 0 ? (ask-bid)/mid*100 : null;
}
function snapshotMetrics(snapshot: JsonRecord) {
  const quote=record(snapshot.latestQuote);
  const trade=record(snapshot.latestTrade);
  const minute=record(snapshot.minuteBar);
  const daily=record(snapshot.dailyBar);
  const previous=record(snapshot.prevDailyBar);
  const bid=num(quote.bp), ask=num(quote.ap);
  const midpoint=bid!==null && ask!==null && bid>0 && ask>=bid ? (bid+ask)/2 : null;
  return {
    price: midpoint ?? num(trade.p) ?? num(minute.c) ?? num(daily.c),
    previousClose: num(previous.c),
    currentVolume: num(daily.v),
    spreadPct: spreadPct(snapshot),
    quoteAt: iso(quote.t),
  };
}
function sessionElapsedFraction(now: number) {
  const parts = new Intl.DateTimeFormat("en-US",{
    timeZone:"America/New_York",hour:"2-digit",minute:"2-digit",hour12:false,
  }).formatToParts(new Date(now));
  const hour=Number(parts.find(part=>part.type==="hour")?.value ?? "0");
  const minute=Number(parts.find(part=>part.type==="minute")?.value ?? "0");
  const elapsed=hour*60+minute-(9*60+30);
  return Math.min(1,Math.max(0,elapsed/390));
}
function parseBars(raw: unknown): Record<string,SqueezeDailyBar[]> {
  const root=record(raw);
  const barsRoot=record(root.bars);
  const result: Record<string,SqueezeDailyBar[]> = {};
  for(const [symbol,value] of Object.entries(barsRoot)) {
    result[symbol]=array(value).map(item=>{
      const bar=record(item);
      return { t:str(bar.t) ?? "", o:num(bar.o) ?? 0, h:num(bar.h) ?? 0, l:num(bar.l) ?? 0, c:num(bar.c) ?? 0, v:num(bar.v) ?? 0 };
    }).filter(bar=>bar.t && bar.o>0 && bar.h>0 && bar.l>0 && bar.c>0);
  }
  return result;
}

export async function GET(request: Request) {
  const cronSecret=process.env.CRON_SECRET?.trim() ?? "";
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return reply({error:"Unauthorized."},401);
  }
  const alpacaKey=process.env.ALPACA_API_KEY_ID?.trim() ?? "";
  const alpacaSecret=process.env.ALPACA_API_SECRET_KEY?.trim() ?? "";
  const supabaseSecret=process.env.SUPABASE_SECRET_KEY?.trim() ?? "";
  if (!alpacaKey || !alpacaSecret || !supabaseSecret) {
    return reply({error:"Squeeze scanner dependencies are not configured."},503);
  }

  const alpacaHeaders={"APCA-API-KEY-ID":alpacaKey,"APCA-API-SECRET-KEY":alpacaSecret,Accept:"application/json"};
  const fetchJson=async(url:string)=>{
    const response=await fetch(url,{headers:alpacaHeaders,cache:"no-store",signal:AbortSignal.timeout(20_000)});
    if(!response.ok) throw new Error(`Squeeze market-data source returned HTTP ${response.status}.`);
    return response.json() as Promise<unknown>;
  };
  const dbHeaders:Record<string,string>={apikey:supabaseSecret,"Content-Type":"application/json",Accept:"application/json"};
  if(supabaseSecret.startsWith("eyJ")) dbHeaders.Authorization=`Bearer ${supabaseSecret}`;
  const db=async(path:string, init:RequestInit={})=>{
    const response=await fetch(`${SUPABASE_URL}/rest/v1/${path}`,{
      ...init,headers:{...dbHeaders,...(init.headers ?? {})},cache:"no-store",signal:AbortSignal.timeout(20_000),
    });
    if(!response.ok) throw new Error(`Squeeze scanner storage returned HTTP ${response.status}.`);
    if(response.status===204) return null;
    const text=await response.text();
    return text ? JSON.parse(text) : null;
  };

  const now=Date.now();
  const scannedAt=new Date(now).toISOString();
  const [moversRaw,activesRaw,existingRaw]=await Promise.all([
    fetchJson(`${DATA_URL}/v1beta1/screener/stocks/movers?top=50`),
    fetchJson(`${DATA_URL}/v1beta1/screener/stocks/most-actives?by=volume&top=100`),
    db("paper_squeeze_prospects?status=neq.expired&select=symbol&limit=100"),
  ]);

  const movers=record(moversRaw);
  const actives=record(activesRaw);
  const sourceUpdatedAt=[iso(movers.last_updated),iso(actives.last_updated)].filter((value):value is string=>Boolean(value)).sort().at(-1) ?? null;
  const sourceFresh=sourceAgeMinutes(sourceUpdatedAt,now) <= 90;
  if(!sourceFresh) {
    return reply({ok:true,paperResearchOnly:true,scannerId:strategy.scanner.id,scannedAt,skipped:"Stock screener source is stale.",sourceUpdatedAt});
  }

  const symbols=new Set<string>();
  for(const item of [...array(movers.gainers),...array(actives.most_actives),...array(existingRaw)]) {
    const symbol=str(record(item).symbol)?.toUpperCase();
    if(symbol && /^[A-Z][A-Z0-9.]{0,9}$/.test(symbol)) symbols.add(symbol);
  }
  const candidates=[...symbols].slice(0,180);

  const snapshots:Record<string,JsonRecord>={};
  for(const batch of chunk(candidates,45)) {
    if(!batch.length) continue;
    const payload=record(await fetchJson(`${DATA_URL}/v2/stocks/snapshots?feed=iex&symbols=${encodeURIComponent(batch.join(","))}`));
    for(const [symbol,value] of Object.entries(payload)) snapshots[symbol]=record(value);
  }

  const barsBySymbol:Record<string,SqueezeDailyBar[]>={};
  const end=new Date(now-24*60*60_000).toISOString();
  const start=new Date(now-130*24*60*60_000).toISOString();
  for(const batch of chunk(candidates,30)) {
    if(!batch.length) continue;
    const raw=await fetchJson(
      `${DATA_URL}/v2/stocks/bars?symbols=${encodeURIComponent(batch.join(","))}&timeframe=1Day&limit=10000&feed=iex&adjustment=all&sort=asc&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`,
    );
    Object.assign(barsBySymbol,parseBars(raw));
  }

  const elapsed=sessionElapsedFraction(now);
  const provisional=candidates.map(symbol=>{
    const snapshot=snapshots[symbol];
    const metrics=snapshot ? snapshotMetrics(snapshot) : null;
    const bars=barsBySymbol[symbol] ?? [];
    if(!metrics || metrics.price==null || metrics.price<strategy.scanner.minimumPriceUsd || metrics.price>strategy.scanner.maximumPriceUsd) return null;
    if(bars.length<strategy.scanner.minimumHistoryBars) return null;
    const result=scoreSqueezeProspect({
      symbol,bars,currentPrice:metrics.price,previousClose:metrics.previousClose,currentVolume:metrics.currentVolume,
      sessionElapsedFraction:elapsed,spreadPct:metrics.spreadPct,
    });
    return {symbol,metrics,result};
  }).filter((item):item is NonNullable<typeof item>=>Boolean(item));

  const needsValidation=provisional.filter(item=>item.result.watchlistEligible).map(item=>item.symbol);
  const validation=new Map<string,{valid:boolean;name:string|null}>();
  for(const batch of chunk(needsValidation,10)) {
    await Promise.all(batch.map(async symbol=>{
      try{
        const asset=record(await fetchJson(`${TRADING_URL}/v2/assets/${encodeURIComponent(symbol)}`));
        validation.set(symbol,{valid:asset.status==="active" && asset.tradable===true && asset.fractionable===true && asset.shortable!==false,name:str(asset.name)});
      }catch{validation.set(symbol,{valid:false,name:null});}
    }));
  }

  const rows=provisional.map(({symbol,metrics,result})=>{
    const valid=result.watchlistEligible ? validation.get(symbol) : null;
    const qualified=valid?.valid===false
      ? {...result,status:"candidate" as const,watchlistEligible:false,botReviewEligible:false,reasons:[...result.reasons,"Market-catalog validation did not pass"]}
      : result;
    return {
      symbol,
      scanner_id:strategy.scanner.id,
      scanner_version:strategy.scanner.version,
      status:qualified.status,
      score:qualified.score,
      price:metrics.price,
      previous_close:metrics.previousClose,
      spread_pct:metrics.spreadPct,
      current_volume:metrics.currentVolume,
      base_days:qualified.metrics.baseDays,
      base_high:qualified.metrics.baseHigh,
      base_low:qualified.metrics.baseLow,
      base_range_pct:qualified.metrics.baseRangePct,
      pre_ignition_position_pct:qualified.metrics.preIgnitionPositionPct,
      volume_dry_ratio:qualified.metrics.volumeDryRatio,
      relative_volume_pace:qualified.metrics.relativeVolumePace,
      breakout_distance_pct:qualified.metrics.breakoutDistancePct,
      session_change_pct:qualified.metrics.sessionChangePct,
      average_dollar_volume:qualified.metrics.averageDollarVolume,
      watchlist_eligible:qualified.watchlistEligible,
      bot_review_eligible:qualified.botReviewEligible,
      score_components:qualified.components,
      reasons:qualified.reasons,
      source_updated_at:sourceUpdatedAt,
      first_seen_at:scannedAt,
      last_seen_at:scannedAt,
      last_scanned_at:scannedAt,
      metadata:{
        assetName:valid?.name ?? null,
        quoteAt:metrics.quoteAt,
        sessionElapsedFraction:elapsed,
        paperResearchOnly:true,
        orderAuthorization:false,
      },
    };
  });

  if(rows.length) {
    await db("paper_squeeze_prospects?on_conflict=symbol",{
      method:"POST",
      headers:{Prefer:"resolution=merge-duplicates,return=minimal"},
      body:JSON.stringify(rows),
    });
  }
  const observations=rows.filter(row=>row.score>=strategy.scanner.thresholds.observationScore).map(row=>({
    scanned_at:scannedAt,scanner_id:row.scanner_id,scanner_version:row.scanner_version,symbol:row.symbol,status:row.status,
    score:row.score,price:row.price,spread_pct:row.spread_pct,current_volume:row.current_volume,base_days:row.base_days,
    base_high:row.base_high,base_low:row.base_low,base_range_pct:row.base_range_pct,pre_ignition_position_pct:row.pre_ignition_position_pct,
    volume_dry_ratio:row.volume_dry_ratio,relative_volume_pace:row.relative_volume_pace,breakout_distance_pct:row.breakout_distance_pct,
    session_change_pct:row.session_change_pct,average_dollar_volume:row.average_dollar_volume,watchlist_eligible:row.watchlist_eligible,
    bot_review_eligible:row.bot_review_eligible,score_components:row.score_components,reasons:row.reasons,metadata:row.metadata,
  }));
  if(observations.length) await db("paper_squeeze_observations",{method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify(observations)});
  await db("rpc/paper_expire_stale_squeeze_prospects",{method:"POST",body:JSON.stringify({p_now:scannedAt})});

  return reply({
    ok:true,paperResearchOnly:true,scannerId:strategy.scanner.id,scannerVersion:strategy.scanner.version,scannedAt,
    thresholds:strategy.scanner.thresholds,sources:{sourceUpdatedAt,sourceFresh,evaluatedUniverse:candidates.length},
    results:{
      evaluated:rows.length,
      observationsSaved:observations.length,
      watchlistReady:rows.filter(row=>row.watchlist_eligible).length,
      botReviewReady:rows.filter(row=>row.bot_review_eligible).length,
    },
  });
}
