"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./PaperTradingLab.module.css";

type FusePlan = {
  symbol:string;currentPrice:number|null;fuseScore:number;readiness:string;detail:string;
  spreadPct:number|null;quoteAgeSeconds:number|null;relativeVolume:number|null;recentDollarVolume:number|null;
  fastMomentumPct:number|null;chasePct:number|null;plannedShares:number;
  blockers:string[];warnings:string[];entryTrigger:number|null;maximumEntry:number|null;
  plan:{phase:string;entryPrice:number|null;purchaseAmount:number|null;stopPrice:number|null;maxLossDollars:number|null;exitPrice:number|null;projectedProfitDollars:number|null};
};
type FuseEvidence = {symbol:string;readiness:string;fuse_score:number;bar_bucket_at:string;blockers:string[];warnings:string[]};
type FuseReport = {
  collectedAt:string;strategyId:string;researchOnly:true;executionEnabled:false;submissionReady:false;
  ledger:{status:string;equity:number;buyingPower:number};
  marketData:{source:string;fallback:boolean;barFeed:string};
  plans:FusePlan[];evidence:FuseEvidence[];
};
const price=(n:number|null|undefined)=>n==null?"—":`$${n.toFixed(n<1?4:2)}`;
const pct=(n:number|null|undefined)=>n==null?"—":`${n.toFixed(2)}%`;
const time=(value:string)=>new Date(value).toLocaleString("en-US",{timeZone:"America/Chicago",month:"short",day:"numeric",hour:"numeric",minute:"2-digit"});

function EquityMiniChart({points}:{points:Array<{time:string;equity:number}>}) {
  const values=points.slice(-90);
  if(values.length<2)return <p>Equity history will appear after snapshots are collected. No performance is assumed.</p>;
  const min=Math.min(...values.map(x=>x.equity)),max=Math.max(...values.map(x=>x.equity));
  const span=Math.max(0.01,max-min);
  const data=values.map((v,i)=>`${i*480/(values.length-1)},${110-(v.equity-min)/span*90}`).join(" ");
  return <div>
    <svg viewBox="0 0 480 130" role="img" aria-label="Fuse virtual equity history" style={{width:"100%",maxHeight:180}}>
      <polyline points={data} fill="none" stroke="#7de6e8" strokeWidth="3" strokeLinejoin="round"/>
      <text x="6" y="126" fontSize="13" fill="currentColor">{price(min)} minimum</text>
      <text x="340" y="16" fontSize="13" fill="currentColor">{price(max)} maximum</text>
    </svg>
  </div>;
}

export default function FuseResearchPanel({history,refreshVersion}:{history:Array<{time:string;equity:number}>;refreshVersion:number}) {
  const [report,setReport]=useState<FuseReport|null>(null);
  const [error,setError]=useState("");
  const [loading,setLoading]=useState(true);
  useEffect(()=>{
    const controller=new AbortController();
    let running=false;
    const update=async()=>{
      if(document.hidden||running||controller.signal.aborted)return;
      running=true;
      try{
        const response=await fetch("/api/paper-trading/bots/fuse-readiness",{cache:"no-store",signal:AbortSignal.any([controller.signal,AbortSignal.timeout(20_000)])});
        const payload=await response.json();
        if(!response.ok)throw new Error(payload.error??"Fuse research unavailable.");
        if(!controller.signal.aborted){setReport(payload);setError("");}
      }catch(reason){
        if(!controller.signal.aborted)setError(reason instanceof Error?reason.message:"Research unavailable.");
      }finally{running=false;if(!controller.signal.aborted)setLoading(false);}
    };
    void update();
    const id=window.setInterval(()=>void update(),60_000);
    return ()=>{controller.abort();window.clearInterval(id);};
  },[refreshVersion]);
  const counts=useMemo(()=>({
    ready:report?.plans.filter(p=>p.readiness==="research-ready").length??0,
    rejected:report?.plans.filter(p=>p.readiness==="rejected").length??0,
    historical:report?.evidence.length??0,
  }),[report]);
  return <section aria-label="Fuse independent research pipeline">
    <h2>Fuse · independent 5-minute research</h2>
    <p>Research signals are NOT orders. Execution is disabled; prices, entries, stops and targets below are hypothetical plans, not fills or expected returns.</p>
    {error?<div className={styles.portfolioWarnings}><span>{error}</span></div>:null}
    {loading&&!report?<p>Loading the latest market research snapshot…</p>:null}
    {report?<section className={styles.portfolioStats}>
      <div className={styles.portfolioStat}><span>Current evaluated</span><strong>{report.plans.length}</strong><small>from assigned scanner prospects</small></div>
      <div className={styles.portfolioStat}><span>Research-ready</span><strong>{counts.ready}</strong><small>no submission permission</small></div>
      <div className={styles.portfolioStat}><span>Rejected</span><strong>{counts.rejected}</strong><small>explicit safety or eligibility refusal</small></div>
      <div className={styles.portfolioStat}><span>Saved decisions</span><strong>{counts.historical}</strong><small>last 60 observations shown</small></div>
      <div className={styles.portfolioStat}><span>Market source</span><strong>{report.marketData.source}</strong><small>5m bars: {report.marketData.barFeed}</small></div>
    </section>:null}
    <div className={styles.botProfileGrid}>
      <section className={styles.botProfileList}>
        <h3>Current prospects & plans</h3>
        {!report?.plans.length?<p>No assigned recent penny prospects to evaluate. No trade is forced.</p>:null}
        {report?.plans.slice(0,15).map(p=><article key={p.symbol}>
          <h4>{p.symbol} · Fuse {p.fuseScore}/100 · {p.readiness.toUpperCase()}</h4>
          <p>Quote {price(p.currentPrice)} · RVOL {p.relativeVolume?.toFixed(2)??"—"}× · Spread {pct(p.spreadPct)} · Fast momentum {pct(p.fastMomentumPct)}</p>
          <p>Entry {price(p.entryTrigger)} · Chase ceiling {price(p.maximumEntry)} · Stop {price(p.plan.stopPrice)} · Target {price(p.plan.exitPrice)} · {p.plannedShares} shares / {price(p.plan.purchaseAmount)} planned</p>
          <p>{p.blockers.length? `REFUSED: ${p.blockers.join(" | ")}` : p.warnings.length?p.warnings.join(" | "):p.detail}</p>
        </article>)}
      </section>
      <section className={styles.botProfileList}>
        <h3>Recorded refusals & research history</h3>
        {!report?.evidence.length?<p>No persisted Fuse decisions yet. Scheduled weekday research will populate this after deployment.</p>:null}
        {report?.evidence.slice(0,25).map((item,i)=><article key={item.symbol+item.bar_bucket_at+i}>
          <p><strong>{item.symbol}</strong> · {item.fuse_score}/100 · {item.readiness} · {time(item.bar_bucket_at)}</p>
          <p>{item.blockers[0]??item.warnings[0]??"Research criteria passed; no order submitted."}</p>
        </article>)}
      </section>
      <section className={styles.botProfileList}>
        <h3>Virtual account performance</h3>
        <EquityMiniChart points={history}/>
      </section>
      <section className={styles.botProfileList}>
        <h3>Execution roadmap</h3>
        <p>Discovery → Evaluation → Prepared → Research-ready. Automated simulated orders, fills, trailing/forced exits and counterfactual MFE/MAE require the next independently tested execution phase.</p>
        <p>Future historical pattern and market-mover signals remain shadow research until point-in-time validation proves predictive value.</p>
      </section>
    </div>
  </section>;
}
