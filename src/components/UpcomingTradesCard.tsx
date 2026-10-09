"use client";

import Link from "next/link";
import useUpcomingTrades, {type UpcomingStock} from "./useUpcomingTrades";
import styles from "./UpcomingTradesCard.module.css";

const price=(n:number|null)=>n===null?"—":new Intl.NumberFormat("en-US",{
  style:"currency",currency:"USD",minimumFractionDigits:2,
  maximumFractionDigits:n<1?5:n<10?4:2,
}).format(n);
const time=(t:string|null)=>t?new Intl.DateTimeFormat("en-US",{
  timeZone:"America/Chicago",month:"short",day:"numeric",hour:"numeric",minute:"2-digit",
}).format(new Date(t)):"—";
function TradeRow({trade}:{trade:UpcomingStock}){
  const planDescription=trade.planSource==="prepared-order"?
    "PREPARED • pending revalidation":trade.planSource==="strategy-reference"?
      "REFERENCE • not execution-ready":"AWAITING PLAN";
  return <article className={styles.tradeRow}>
    <div className={styles.identity}>
      <div className={styles.symbolAndState}>
        <strong>{trade.symbol}</strong>
        <span className={styles.state}>{planDescription}</span>
      </div>
      <span className={styles.bot}>
        <Link href={`/paper-trading/bots/${trade.assignedBotId}`}>{trade.assignedBotName}</Link>
        <small>Assigned bot review</small>
      </span>
      {trade.reviewingBots.length>1?<small className={styles.also}>Also reviewed by {trade.reviewingBots.filter(n=>n!==trade.assignedBotName).join(", ")}</small>:null}
    </div>
    <div className={styles.plan}>
      <div><span>Entry</span><strong>{price(trade.entryPrice)}</strong></div>
      <div><span>Stop</span><strong>{price(trade.stopPrice)}</strong></div>
      <div><span>Exit target</span><strong>{price(trade.targetPrice)}</strong></div>
      <div><span>Net R:R est.</span><strong>{trade.netRewardRisk===null?"—":`${trade.netRewardRisk.toFixed(2)}:1`}</strong></div>
    </div>
    <div className={styles.details}>
      <span>Watchlist score {trade.watchlistScore.toFixed(0)}/100</span>
      <span>{trade.quoteFresh?"Quote recently verified":"Quote needs refreshing"}</span>
      {trade.planCheckedAt?<span>Checked {time(trade.planCheckedAt)}</span>:null}
    </div>
    <p className={styles.explanation}>{trade.reason}</p>
  </article>;
}
export default function UpcomingTradesCard({compact=false}:{compact?:boolean}){
  const {report,error}=useUpcomingTrades();
  const displayed=report?.candidates.slice(0,compact?2:3)??[];
  return <section className={styles.card} aria-label="Upcoming Trades">
    <header className={styles.heading}>
      <div>
        <span className={styles.eyebrow}>STOCK WATCHLIST • PAPER RESEARCH</span>
        <h2>Upcoming Trades</h2>
      </div>
      <Link href="/paper-trading/bots">All bots ↗</Link>
    </header>
    {displayed.length?<div className={styles.trades}>{displayed.map(trade=>
      <TradeRow trade={trade} key={trade.symbol}/>)}</div>:
      <p className={styles.empty}>{error||(!report?
        "Loading the bots’ latest watchlist plans…":
        "No stock watchlist assignments with a current plan. The bots are still evaluating candidates.")}</p>}
    <footer className={styles.note}>
      <span>{report?.sharedPortfolio?
        `Shared PAPER model ${price(report.sharedPortfolio.equityUsd)} · observation only`:
        "Shared PAPER model · observation only"}</span>
      <span>Plans are reference estimates; no shared-capital order authorized.</span>
    </footer>
    {error&&displayed.length?<p className={styles.error}>{error} · Showing last retrieved snapshot.</p>:null}
  </section>;
}
