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
export default async function HistoricalPatternLab() {
  let patterns:Pattern[]=[];
  let error="";
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
      Pilot limitation: completed daily bars, not minute-level pre-breakout patterns; stock horizons use trading sessions.
      Shadow similarity is not an estimated win probability. Historical patterns may not repeat.
    </p>
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
