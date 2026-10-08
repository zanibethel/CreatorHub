import {NextResponse} from "next/server";
import {createAdminSupabaseClient} from "@/lib/supabase-admin";
import {
  HISTORY_VERSION, normalizeHistoryBars, researchSummary, extractHistoryExamples,
  type HistoryAssetClass, type HistoryBar, type HistoryExample,
} from "@/lib/historical-pattern-intelligence";

export const dynamic="force-dynamic";
export const maxDuration=60;
const DATA_URL="https://data.alpaca.markets";
const STOCK=/^[A-Z][A-Z0-9.]{0,9}$/;
const CRYPTO=/^[A-Z0-9]{2,16}\/USD$/;
const UNIVERSE=[
  {assetClass:"stock" as const,symbol:"AAPL"},
  {assetClass:"stock" as const,symbol:"MSFT"},
  {assetClass:"stock" as const,symbol:"NVDA"},
  {assetClass:"stock" as const,symbol:"QQQ"},
  {assetClass:"crypto" as const,symbol:"BTC/USD"},
  {assetClass:"crypto" as const,symbol:"ETH/USD"},
  {assetClass:"crypto" as const,symbol:"SOL/USD"},
  {assetClass:"crypto" as const,symbol:"ADA/USD"},
];
function reply(data:unknown,status=200) {
  return NextResponse.json(data,{status,headers:{"Cache-Control":"no-store"}});
}
function selectAsset(request:Request) {
  const url=new URL(request.url);
  const defaultItem=UNIVERSE[Math.floor(Date.now()/86_400_000)%UNIVERSE.length];
  const assetClass=url.searchParams.get("assetClass") ?? defaultItem.assetClass;
  const symbol=(url.searchParams.get("symbol") ?? (assetClass===defaultItem.assetClass?defaultItem.symbol:""))
    .toUpperCase().replace("-", "/");
  if(assetClass!=="stock"&&assetClass!=="crypto") throw new Error("assetClass must be stock or crypto.");
  if(!(assetClass==="stock"?STOCK:CRYPTO).test(symbol)) throw new Error("Invalid USD pair or stock symbol.");
  return {assetClass:assetClass as HistoryAssetClass,symbol};
}
function valid(value:unknown):value is number {return typeof value==="number"&&Number.isFinite(value);}
function parseBar(value:unknown):HistoryBar|null {
  if(!value||typeof value!=="object") return null;
  const b=value as Record<string,unknown>;
  if(typeof b.t!=="string"||!valid(b.o)||!valid(b.h)||!valid(b.l)||!valid(b.c)||!valid(b.v)) return null;
  return {t:b.t,o:b.o,h:b.h,l:b.l,c:b.c,v:b.v};
}
async function loadHistory(assetClass:HistoryAssetClass,symbol:string) {
  const key=process.env.ALPACA_API_KEY_ID?.trim(),secret=process.env.ALPACA_API_SECRET_KEY?.trim();
  if(!key||!secret) throw new Error("Historical market-data credentials are not configured.");
  const headers={"APCA-API-KEY-ID":key,"APCA-API-SECRET-KEY":secret,Accept:"application/json"};
  const start=new Date(Date.now()-1240*86_400_000).toISOString();
  const end=new Date().toISOString();
  const stock=assetClass==="stock";
  const path=stock?"/v2/stocks/"+encodeURIComponent(symbol)+"/bars":"/v1beta3/crypto/us/bars";
  const fetchFeed=async(feed:"sip"|"iex")=>{
    const params=new URLSearchParams({timeframe:"1Day",start,end,sort:"asc",limit:"10000"});
    if(stock) {params.set("feed",feed);params.set("adjustment","split");}
    else params.set("symbols",symbol);
    const bars:HistoryBar[]=[];
    const seen=new Set<string>();
    let finished=false;
    for(let page=0;page<8;page++) {
      const res=await fetch(DATA_URL+path+"?"+params.toString(),{
        headers,cache:"no-store",signal:AbortSignal.timeout(18000),
      });
      if(!res.ok) throw new Error("Historical "+(stock?feed:"crypto")+" feed returned HTTP "+res.status);
      const payload=await res.json() as {bars?:HistoryBar[]|Record<string,HistoryBar[]>;next_page_token?:string|null};
      const raw=Array.isArray(payload.bars)?payload.bars:payload.bars?.[symbol]??[];
      for(const row of raw) {
        const b=parseBar(row);
        if(b&&!seen.has(b.t)) {bars.push(b);seen.add(b.t);}
      }
      if(!payload.next_page_token) {finished=true;break;}
      params.set("page_token",payload.next_page_token);
    }
    if(!finished) throw new Error("Market history pagination incomplete; no partial result saved.");
    const today=new Date().toISOString().slice(0,10);
    return normalizeHistoryBars(bars.filter(b=>b.t.slice(0,10)<today));
  };
  if(!stock) return {bars:await fetchFeed("sip"),source:"alpaca-crypto-us-daily"};
  try {return {bars:await fetchFeed("sip"),source:"alpaca-sip-split-adjusted-daily"};}
  catch(error) {
    const msg=error instanceof Error?error.message:"";
    if(!msg.includes("HTTP 403")&&!msg.includes("HTTP 422")) throw error;
    return {bars:await fetchFeed("iex"),source:"alpaca-iex-split-adjusted-daily-fallback"};
  }
}
function sampleEvidence(examples:HistoryExample[]) {
  const buckets=new Map<string,HistoryExample[]>();
  for(const e of examples) {
    const key=[e.horizon,e.targetPct,e.status].join(":");
    const bucket=buckets.get(key)??[];
    bucket.push(e);buckets.set(key,bucket);
  }
  const sample:HistoryExample[]=[];
  for(const bucket of buckets.values()) {
    bucket.sort((a,b)=>Date.parse(b.decisionAt)-Date.parse(a.decisionAt));
    sample.push(...bucket.slice(0,12));
  }
  return sample;
}
export async function GET(request:Request) {
  const cronSecret=process.env.CRON_SECRET?.trim();
  if(!cronSecret||request.headers.get("authorization")!=="Bearer "+cronSecret) return reply({error:"Unauthorized."},401);
  let assetClass:HistoryAssetClass,symbol:string;
  try {({assetClass,symbol}=selectAsset(request));}
  catch(error){return reply({error:error instanceof Error?error.message:"Invalid request."},400);}
  try {
    const {bars,source}=await loadHistory(assetClass,symbol);
    const report=researchSummary(symbol,assetClass,bars);
    const examples=extractHistoryExamples(symbol,assetClass,bars);
    const db=createAdminSupabaseClient();
    const run=await db.from("paper_historical_research_runs").upsert({
      asset_class:assetClass,symbol,model_version:HISTORY_VERSION,as_of:report.asOf,
      data_source:source,completed_bar_count:bars.length,historical_example_count:examples.length,
      feature_snapshot:report.features,evaluation_summary:report.rows,
    },{onConflict:"asset_class,symbol,model_version,as_of"}).select("id").single();
    if(run.error||!run.data) throw new Error("History run persistence failed: "+(run.error?.message??"missing id"));
    const runId=run.data.id as string;
    const scores=report.rows.map(row=>({
      asset_class:assetClass,symbol,horizon:row.horizon,target_pct:row.targetPct,
      model_version:HISTORY_VERSION,as_of:report.asOf,status:row.match.status,
      shadow_score:row.match.score,matched_count:row.match.matchedCount,
      baseline_hit_rate:row.match.baselineTargetRate,similar_hit_rate:row.match.similarTargetRate,
      ambiguous_count:row.match.ambiguousCount,
      backtest_evidence:{total:row.total,successes:row.successes,stops:row.stops,
        timeouts:row.timeouts,ambiguous:row.ambiguous,holdoutCount:row.holdoutCount,
        scoredHoldout:row.scoredHoldout,status:row.status},
      research_run_id:runId,updated_at:new Date().toISOString(),
    }));
    const scoreWrite=await db.from("paper_historical_pattern_scores").upsert(scores,{
      onConflict:"asset_class,symbol,horizon,target_pct",
    });
    if(scoreWrite.error) throw new Error("Shadow score persistence failed: "+scoreWrite.error.message);
    const sample=sampleEvidence(examples);
    for(let i=0;i<sample.length;i+=150) {
      const rows=sample.slice(i,i+150).map(e=>({
        asset_class:e.assetClass,symbol:e.symbol,model_version:HISTORY_VERSION,
        horizon:e.horizon,target_pct:e.targetPct,decision_at:e.decisionAt,
        entry_at:e.entryAt,outcome_end_at:e.outcomeEndAt,entry_price:e.entryPrice,
        outcome:e.status,max_gain_pct:e.maxGainPct,max_drawdown_pct:e.maxDrawdownPct,
        terminal_return_pct:e.terminalReturnPct,features:e.features,research_run_id:runId,
      }));
      const saved=await db.from("paper_historical_event_samples").upsert(rows,{
        onConflict:"asset_class,symbol,model_version,horizon,target_pct,decision_at",
      });
      if(saved.error) throw new Error("Sample persistence failed: "+saved.error.message);
    }
    return reply({success:true,advisoryOnly:true,executionEnabled:false,
      source,runId,report:{...report,sampledEvidenceCount:sample.length}});
  } catch(error) {
    return reply({error:error instanceof Error?error.message:"Historical research unavailable.",
      advisoryOnly:true,executionEnabled:false,symbol,assetClass},503);
  }
}
