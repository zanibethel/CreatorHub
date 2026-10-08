import {NextResponse} from "next/server";
import {createAdminSupabaseClient} from "@/lib/supabase-admin";
import {type HistoryAssetClass,type HistoryBar} from "@/lib/historical-pattern-intelligence";
import {
  INTRADAY_VERSION,INTRADAY_TARGETS,currentIntradaySnapshot,extractIntradayEvents,
  intradayMatch,type IntradayEvent,type IntradayHorizon,
} from "@/lib/historical-intraday-intelligence";
import {historicalResearchUniverse,scheduledResearchAsset} from "@/lib/historical-research-universe";

export const dynamic="force-dynamic";
export const maxDuration=60;
const BASE="https://data.alpaca.markets";
const DAY=86400000;
function response(body:unknown,status=200) {
  return NextResponse.json(body,{status,headers:{"Cache-Control":"no-store"}});
}
function parseBar(x:unknown):HistoryBar|null {
  if(!x||typeof x!=="object")return null;
  const b=x as Record<string,unknown>;
  if(typeof b.t!=="string"||![b.o,b.h,b.l,b.c,b.v].every(v=>typeof v==="number"&&Number.isFinite(v)))return null;
  return {t:b.t,o:b.o as number,h:b.h as number,l:b.l as number,c:b.c as number,v:b.v as number};
}
async function fetchBars(assetClass:HistoryAssetClass,symbol:string,timeframe:"1Day"|"1Hour"|"5Min",
  lookbackDays:number,cutoff:number) {
  const key=process.env.ALPACA_API_KEY_ID?.trim(),secret=process.env.ALPACA_API_SECRET_KEY?.trim();
  if(!key||!secret) throw new Error("Alpaca history credentials unavailable.");
  const isStock=assetClass==="stock";
  const path=isStock?"/v2/stocks/"+encodeURIComponent(symbol)+"/bars":"/v1beta3/crypto/us/bars";
  const params=new URLSearchParams({timeframe,start:new Date(cutoff-lookbackDays*DAY).toISOString(),
    end:new Date(cutoff).toISOString(),sort:"asc",limit:"10000"});
  if(isStock){params.set("feed","sip");params.set("adjustment","split");}
  else params.set("symbols",symbol);
  const headers={"APCA-API-KEY-ID":key,"APCA-API-SECRET-KEY":secret,Accept:"application/json"};
  const collect=async()=>{
    const data:HistoryBar[]=[];
    let done=false;
    for(let page=0;page<24;page++){
      const r=await fetch(BASE+path+"?"+params.toString(),{
        headers,signal:AbortSignal.timeout(16000),cache:"no-store",
      });
      if(!r.ok)throw new Error("Alpaca "+timeframe+" returned HTTP "+r.status);
      const payload=await r.json() as {bars?:HistoryBar[]|Record<string,HistoryBar[]>;next_page_token?:string|null};
      const rows=Array.isArray(payload.bars)?payload.bars:payload.bars?.[symbol]??[];
      for(const raw of rows){const b=parseBar(raw);if(b)data.push(b);}
      if(!payload.next_page_token){done=true;break;}
      params.set("page_token",payload.next_page_token);
    }
    if(!done)throw new Error("Historical "+timeframe+" pagination incomplete.");
    return data;
  };
  if(!isStock)return {bars:await collect(),source:"alpaca-crypto-us-"+timeframe};
  try{return {bars:await collect(),source:"alpaca-sip-split-"+timeframe};}
  catch(error){
    const message=error instanceof Error?error.message:"";
    if(!message.includes("HTTP 403")&&!message.includes("HTTP 422"))throw error;
    params.delete("page_token");params.set("feed","iex");
    return {bars:await collect(),source:"alpaca-iex-split-"+timeframe+"-fallback"};
  }
}
function researchSample(events:IntradayEvent[]) {
  const groups=new Map<string,IntradayEvent[]>();
  for(const e of events){
    const k=[e.horizon,e.targetPct,e.status].join(":");
    const g=groups.get(k)??[];g.push(e);groups.set(k,g);
  }
  return [...groups.values()].flatMap(g=>g.slice(-4));
}
export async function GET(request:Request){
  const cronSecret=process.env.CRON_SECRET?.trim();
  if(!cronSecret||request.headers.get("authorization")!=="Bearer "+cronSecret)
    return response({error:"Unauthorized."},401);
  try{
    const db=createAdminSupabaseClient();
    const discoveriesResult=await db.from("paper_prospects")
      .select("asset_class,symbol").order("last_seen_at",{ascending:false}).limit(20);
    const discoveries=discoveriesResult.error?[]:discoveriesResult.data??[];
    const universe=historicalResearchUniverse(discoveries);
    const url=new URL(request.url);
    const selected=scheduledResearchAsset(universe,Date.now());
    const cls=url.searchParams.get("assetClass")??selected.assetClass;
    const symbol=(url.searchParams.get("symbol")??(cls===selected.assetClass?selected.symbol:""))
      .toUpperCase().replace("-","/");
    const assetClass=cls as HistoryAssetClass;
    if(!["stock","crypto"].includes(cls)||!(cls==="stock"
      ?/^[A-Z][A-Z0-9.]{0,9}$/:/^[A-Z0-9]{2,16}\/USD$/).test(symbol))
      return response({error:"Invalid asset class or ticker."},400);
    // Up to three bounded requests, no all-universe fan-out. Avoid incomplete latest bars.
    const cutoff=Date.now()-20*60000;
    const [daily,hourly,five]=await Promise.all([
      fetchBars(assetClass,symbol,"1Day",535,cutoff),
      fetchBars(assetClass,symbol,"1Hour",105,cutoff),
      fetchBars(assetClass,symbol,"5Min",3,cutoff),
    ]);
    const events=extractIntradayEvents(symbol,assetClass,hourly.bars,daily.bars,cutoff);
    const snapshot=currentIntradaySnapshot(assetClass,hourly.bars,daily.bars,five.bars,cutoff);
    if(!snapshot||!snapshot.features)throw new Error("Insufficient completed hourly/long-term context for research.");
    const ageHours=(cutoff-Date.parse(snapshot.decisionAt))/3600000;
    const stale=ageHours>(assetClass==="crypto"?6:96);
    const rows=(["24h","72h","14d"] as IntradayHorizon[]).flatMap(horizon=>
      INTRADAY_TARGETS.map(targetPct=>{
        const cohort=events.filter(e=>e.horizon===horizon&&e.targetPct===targetPct);
        const result=intradayMatch(events,snapshot.features!,horizon,targetPct,snapshot.decisionAt,assetClass);
        return {horizon,targetPct,
          match:stale?{...result,status:"insufficient-coverage" as const,score:null}:result,
          total:cohort.length,successes:cohort.filter(x=>x.status==="target").length,
          stops:cohort.filter(x=>x.status==="stop").length,
          timeouts:cohort.filter(x=>x.status==="timeout").length,
          ambiguous:cohort.filter(x=>x.status==="ambiguous").length};
      }));
    const run=await db.from("paper_intraday_research_runs").upsert({
      asset_class:assetClass,symbol,model_version:INTRADAY_VERSION,as_of:snapshot.decisionAt,
      hourly_provider:hourly.source,daily_provider:daily.source,micro_provider:five.source,
      hourly_bars:hourly.bars.length,five_minute_bars:five.bars.length,daily_bars:daily.bars.length,
      labeled_examples:events.length,current_features:snapshot.features,current_micro:snapshot.micro,
      run_summary:{stale,ageHours,universeSize:universe.length,rows,advisoryOnly:true},
    },{onConflict:"asset_class,symbol,model_version,as_of"}).select("id").single();
    if(run.error||!run.data)throw new Error("Intraday run persistence failed: "+(run.error?.message??"missing id"));
    const id=run.data.id as string;
    const scores=rows.map(r=>({
      asset_class:assetClass,symbol,model_version:INTRADAY_VERSION,as_of:snapshot.decisionAt,
      horizon:r.horizon,target_pct:r.targetPct,status:r.match.status,shadow_score:r.match.score,
      compared_examples:r.match.comparisons,baseline_hit_rate:r.match.baselineRate,
      matched_hit_rate:r.match.matchedRate,
      outcome_summary:{total:r.total,successes:r.successes,stops:r.stops,timeouts:r.timeouts,
        ambiguous:r.ambiguous,knownCount:r.match.knownCount,stale},
      features:snapshot.features,micro:snapshot.micro,research_run_id:id,
      updated_at:new Date().toISOString(),
    }));
    const saved=await db.from("paper_intraday_pattern_scores").upsert(scores,{
      onConflict:"asset_class,symbol,horizon,target_pct",
    });
    if(saved.error)throw new Error("Intraday score persistence failed: "+saved.error.message);
    const samples=researchSample(events);
    for(let i=0;i<samples.length;i+=150){
      const data=samples.slice(i,i+150).map(e=>({
        asset_class:e.assetClass,symbol:e.symbol,model_version:INTRADAY_VERSION,
        horizon:e.horizon,target_pct:e.targetPct,decision_at:e.decisionAt,entry_at:e.entryAt,
        outcome_end_at:e.outcomeEndAt,status:e.status,entry_price:e.entryPrice,
        max_gain_pct:e.maxGainPct,max_drawdown_pct:e.maxDrawdownPct,
        terminal_return_pct:e.terminalReturnPct,features:e.features,research_run_id:id,
      }));
      const w=await db.from("paper_intraday_event_samples").upsert(data,{
        onConflict:"asset_class,symbol,model_version,horizon,target_pct,decision_at",
      });
      if(w.error)throw new Error("Intraday evidence persistence failed: "+w.error.message);
    }
    return response({success:true,advisoryOnly:true,executionEnabled:false,symbol,assetClass,
      researchRunId:id,universeSize:universe.length,dailyBars:daily.bars.length,hourlyBars:hourly.bars.length,
      fiveMinuteBars:five.bars.length,examples:events.length,persistedSamples:samples.length,
      snapshot:{...snapshot,stale,ageHours},scores:rows,source:{
        daily:daily.source,hourly:hourly.source,fiveMinute:five.source}});
  }catch(error){
    return response({error:error instanceof Error?error.message:"Intraday analysis unavailable",
      advisoryOnly:true,executionEnabled:false},503);
  }
}
