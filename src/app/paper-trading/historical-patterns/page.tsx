import type {Metadata} from "next";
import Link from "next/link";
import {createAdminSupabaseClient} from "@/lib/supabase-admin";

export const dynamic="force-dynamic";
export const metadata:Metadata={
  title:"Historical Pattern Lab | CreatorHub",
  description:"Read-only research on historical stock and crypto patterns and their subsequent outcomes.",
};
type Pattern={
  asset_class:string;symbol:string;horizon:string;target_pct:number;
  model_version:number;as_of:string;status:string;shadow_score:number|null;
  matched_count:number;baseline_hit_rate:number|null;similar_hit_rate:number|null;
  backtest_evidence:{total?:number;successes?:number;stops?:number;timeouts?:number;holdoutCount?:number;scoredHoldout?:number;status?:string};
};

type IntradayPattern={
 asset_class:string;symbol:string;horizon:string;target_pct:number;as_of:string;status:string;
 shadow_score:number|null;compared_examples:number;
 baseline_hit_rate:number|null;matched_hit_rate:number|null;
 outcome_summary:{total?:number;successes?:number;stops?:number;timeouts?:number;ambiguous?:number;stale?:boolean};
 features?:{move1hPct:number;move6hPct:number;move24hPct:number;volumeRatio24h:number;observedHours24h:number};
 micro?:{complete:boolean;bars5m:number;move15mPct:number|null;move60mPct:number|null};
};
export default async function HistoricalPatternLab() {
  let patterns:Pattern[]=[];
  let intraday:IntradayPattern[]=[];
  let error="";
  let intradayError="";
  try {
    const db=createAdminSupabaseClient();
    const result=await db.from("paper_historical_pattern_scores")
      .select("asset_class,symbol,horizon,target_pct,model_version,as_of,status,shadow_score,matched_count,baseline_hit_rate,similar_hit_rate,backtest_evidence")
      .order("as_of",{ascending:false}).limit(120);
    if(result.error) throw result.error;
    patterns=(result.data??[]) as Pattern[];
  } catch {
    error="The historical research database is unavailable.";
  }
  try{
    const db=createAdminSupabaseClient();
    const result=await db.from("paper_intraday_pattern_scores")
      .select("asset_class,symbol,horizon,target_pct,as_of,status,shadow_score,compared_examples,baseline_hit_rate,matched_hit_rate,outcome_summary,features,micro")
      .order("as_of",{ascending:false}).limit(120);
    if(result.error)throw result.error;
    intraday=(result.data??[]) as IntradayPattern[];
  }catch{intradayError="Intraday research data is temporarily unavailable.";}
  const percentage=(v:number|null)=>v===null?"—":(v*100).toFixed(1)+"%";
  return <main style={{maxWidth:1100,margin:"0 auto",padding:"32px 20px 80px",color:"var(--foreground)"}}>
    <p style={{fontSize:13,opacity:.75}}><Link href="/paper-trading/bots">← Bot Lab</Link> · Research-only</p>
    <h1 style={{fontSize:30,fontWeight:750,marginTop:18}}>Historical Pattern Lab</h1>
    <p style={{maxWidth:780,opacity:.8,lineHeight:1.7,marginTop:10}}>
      Studies historical 4–20% stock and crypto moves over the next session, three sessions, and up to two weeks.
      Compares preceding 24-hour (daily proxy), 3-month, 6-month and 12-month market context against past successes,
      stops and timeouts. All scores are independent of live Prospect Scores and cannot authorize orders.
    </p>
    <p style={{fontSize:13,opacity:.65,marginTop:12}}>
      Two independent layers: daily backtests over longer periods, and v2 hourly research over the recent 105 days with five-minute acceleration snapshots.\n      Five-minute signals are observations, not score inputs or proof of predictive value. No live execution or bot risk changes.
    </p>
    <section style={{marginTop:28}}>
      <h2 style={{fontSize:23,fontWeight:750}}>Hourly lead-up research <span style={{fontSize:13,fontWeight:400,opacity:.7}}>v2 · shadow only</span></h2>
      <p style={{maxWidth:750,fontSize:13,opacity:.8,lineHeight:1.6,marginTop:6}}>
        Uses the last 24 actual clock hours and the previous completed daily context. The stock market has overnight gaps,
        so the observed-hour count matters. Each setup is evaluated from the next hourly opening candle, not hindsight highs.
      </p>
      {intradayError?<p role="alert">{intradayError}</p>:null}
      {!intradayError&&!intraday.length?<p style={{padding:18,border:"1px solid #64748b66",borderRadius:12,marginTop:16}}>
        Hourly studies are collecting. No completed v2 backfill is recorded yet.
      </p>:null}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(275px,1fr))",gap:14,marginTop:16}}>
        {intraday.slice(0,90).map(p=><article key={["intra",p.asset_class,p.symbol,p.horizon,p.target_pct].join(":")}
          style={{background:"var(--card, #142027)",border:"1px solid #64748b55",borderRadius:14,padding:16}}>
          <div style={{display:"flex",justifyContent:"space-between",gap:8}}>
            <strong>{p.symbol}</strong><span style={{opacity:.65,fontSize:12}}>{p.asset_class} · {p.horizon}</span>
          </div>
          <p style={{fontSize:13,opacity:.75,marginTop:7}}>+{p.target_pct}% target · 3% hypothetical stop</p>
          <strong style={{fontSize:26,display:"block",marginTop:8,color:"#38bdf8"}}>
            {p.shadow_score===null?"Collecting":p.shadow_score+"/100"}
          </strong>
          <p style={{fontSize:12,opacity:.65}}>Similarity index · {p.compared_examples} near matches · {p.outcome_summary.total??0} study anchors</p>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginTop:12}}>
            <div><small>Similar target hit</small><div>{percentage(p.matched_hit_rate)}</div></div>
            <div><small>Historical baseline</small><div>{percentage(p.baseline_hit_rate)}</div></div>
          </div>
          {p.features?<p style={{fontSize:12,marginTop:10,opacity:.75}}>
            Prior 24h {p.features.move24hPct.toFixed(2)}% · {p.features.observedHours24h} observed hourly bars
            · volume ratio {p.features.volumeRatio24h.toFixed(2)}×
          </p>:null}
          <p style={{fontSize:12,opacity:.7,marginTop:8}}>
            Five-minute signal: {p.micro?.complete?"coverage verified":"incomplete coverage"}
            {p.micro?.complete&&p.micro.move15mPct!==null? " · last 15m "+p.micro.move15mPct.toFixed(2)+"%" : ""}
          </p>
          <p style={{fontSize:12,marginTop:8,opacity:.65}}>
            {new Date(p.as_of).toLocaleString("en-US",{timeZone:"America/Chicago"})} CT · {p.status}
          </p>
        </article>)}
      </div>
    </section>
    <h2 style={{fontSize:23,fontWeight:750,marginTop:34}}>Daily historical baseline <span style={{fontSize:13,fontWeight:400,opacity:.7}}>v1</span></h2>
    {error?<p role="alert" style={{marginTop:24}}>{error}</p>:null}
    {!error&&!patterns.length?<section style={{padding:24,border:"1px solid #64748b66",borderRadius:12,marginTop:24}}>
      No historical studies have finished yet. The scheduled research runner will populate this page once the pilot is enabled.
    </section>:null}
    <section style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(265px,1fr))",gap:14,marginTop:26}}>
      {patterns.map(p=><article key={[p.asset_class,p.symbol,p.horizon,p.target_pct].join(":")}
        style={{background:"var(--card, #142027)",border:"1px solid #64748b55",borderRadius:14,padding:16}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10}}>
          <strong>{p.symbol}</strong><span style={{fontSize:12,opacity:.7}}>{p.asset_class.toUpperCase()}</span>
        </div>
        <p style={{fontSize:13,marginTop:10,opacity:.8}}>{p.horizon} · +{p.target_pct}% target</p>
        <p style={{fontSize:28,fontWeight:750,marginTop:8,color:"#38bdf8"}}>
          {p.shadow_score===null?"Insufficient data":p.shadow_score+"/100"}
        </p>
        <p style={{fontSize:12,opacity:.7}}>Historical similarity index · {p.matched_count} comparisons</p>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginTop:14}}>
          <div><div style={{fontSize:12,opacity:.7}}>Matched target rate</div><strong>{percentage(p.similar_hit_rate)}</strong></div>
          <div><div style={{fontSize:12,opacity:.7}}>Baseline target rate</div><strong>{percentage(p.baseline_hit_rate)}</strong></div>
        </div>
        <div style={{fontSize:12,opacity:.7,marginTop:12}}>
          {p.backtest_evidence?.total??0} historical examples · {p.backtest_evidence?.scoredHoldout??0} holdout comparisons
          <div>As of {new Date(p.as_of).toLocaleDateString("en-US",{timeZone:"UTC"})} · {p.status}</div>
        </div>
      </article>)}
    </section>
  </main>;
}
