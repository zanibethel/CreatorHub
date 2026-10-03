import { qualificationEvidence, type Candidate } from "@/lib/paper-qualification";
import type { Candle } from "@/lib/market-monitor";
import styles from "./PaperTradingLab.module.css";
const percent = (value: number | null) => value === null ? "Unavailable" : `${value.toFixed(2)}%`;

export default function QualificationCard({ item, quote, timestamp, candles, now, source, dataThrough }: {
  item: Candidate; quote: { bid: number | null; ask: number | null } | null | undefined;
  timestamp: string | null | undefined; candles: Candle[]; now: number; source: string; dataThrough: string;
}) {
  const evidence = qualificationEvidence(item, quote, timestamp, candles, now);
  return <div className={styles.qualification}>
    <span className={styles.stale}>{evidence.status}</span>
    <details>
      <summary>Qualification details · {item.symbol}</summary>
      <div className={styles.qualificationBody}>
        <h3>Possible pools</h3>
        {evidence.pools.length ? <><div className={styles.poolOptions}>{evidence.pools.map(pool => <div key={pool.id}><strong>{pool.label}</strong><span>Up to ${pool.cap} position value</span><span>Pending validation</span></div>)}</div><p>Any funded pool may qualify after holding-period and risk checks. Historical pool suggestions are research priorities. Filled trades keep their entry pool.</p></> : <p>Watched without a funded pool. Allocation must be configured before qualification.</p>}
        <h3>Observed evidence</h3>
        <dl><dt>Quote check</dt><dd>{evidence.valid && evidence.fresh ? "Fresh, non-crossed quote" : "Needs attention"} · data check only</dd><dt>Quoted spread / midpoint</dt><dd>{percent(evidence.spread)} · no approved limit</dd><dt>Recent chart close change</dt><dd>{percent(evidence.change)} · {evidence.historyCount} observations{evidence.historyFrom && evidence.historyThrough ? ` · ${new Date(evidence.historyFrom).toISOString().slice(0,10)}–${new Date(evidence.historyThrough).toISOString().slice(0,10)}` : ""}</dd><dt>Historical review through {dataThrough}</dt><dd>1-year volatility {item.volatility.toFixed(1)}% · max close drawdown {item.maxDrawdown.toFixed(1)}%</dd></dl>
        <p>{item.rationale}</p><p>{source}. Chart change describes the displayed window; it is not a strategy score. Crypto execution prices and costs need Alpaca verification.</p>
        <h3>Before an order can qualify</h3><ul>{evidence.blockers.map(reason => <li key={reason}>{reason}</li>)}</ul>
        <p>No candidate is order-qualified yet. Daily/hourly charts do not establish an intraday entry. Historical results need out-of-sample validation with costs.</p>
      </div>
    </details>
  </div>;
}
