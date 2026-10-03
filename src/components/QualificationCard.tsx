import { qualificationEvidence, type Candidate } from "@/lib/paper-qualification";
import { evaluatePaperCandidate } from "@/lib/paper-decision-engine";
import type { Candle } from "@/lib/market-monitor";
import styles from "./PaperTradingLab.module.css";

const percent = (value: number | null) => value === null ? "Unavailable" : `${value.toFixed(2)}%`;
const money = (value: number | null) => value === null ? "Unavailable" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
const componentLabels = {
  trend: "Trend",
  momentum: "Momentum",
  relativeStrength: "Relative strength",
  setupQuality: "Setup quality",
  volumeConfirmation: "Volume",
  volatilityQuality: "Volatility",
} as const;

export default function QualificationCard({ item, quote, timestamp, candles, benchmarkCandles, assetClass, accountEquity, now, source, dataThrough }: {
  item: Candidate;
  quote: { bid: number | null; ask: number | null } | null | undefined;
  timestamp: string | null | undefined;
  candles: Candle[];
  benchmarkCandles: Candle[];
  assetClass: "stock" | "crypto";
  accountEquity: number | null;
  now: number;
  source: string;
  dataThrough: string;
}) {
  const evidence = qualificationEvidence(item, quote, timestamp, candles, now);
  const decision = evaluatePaperCandidate({
    candidate: item,
    assetClass,
    quote: { bid: quote?.bid ?? null, ask: quote?.ask ?? null, timestamp: timestamp ?? null },
    candles,
    benchmarkCandles,
    now,
    risk: { accountEquity },
  });
  const qualification = decision.qualification.replace("-", " ");

  return <div className={styles.qualification}>
    <span className={decision.qualification === "trade-ready" ? styles.fresh : styles.stale}>
      {decision.strategyName} · v{decision.strategyVersion} · {decision.score.toFixed(1)}/100 · {qualification}
    </span>
    <details>
      <summary>Qualification details · {item.symbol}</summary>
      <div className={styles.qualificationBody}>
        <h3>Decision-engine score</h3>
        <p><strong>{decision.score.toFixed(1)}/100 · {qualification}</strong> · {decision.regime} market regime. This is a paper-only analytical score, not an order.</p>
        <dl>
          {Object.entries(decision.components).map(([key, component]) => <div key={key}>
            <dt>{componentLabels[key as keyof typeof componentLabels]}</dt>
            <dd>{component.points.toFixed(1)}/{component.maximum} · {component.evidence.join(" ")}</dd>
          </div>)}
        </dl>

        <h3>Risk draft</h3>
        <dl>
          <dt>Planned account risk</dt><dd>{decision.riskPlan.riskPct.toFixed(2)}% · {money(decision.riskPlan.riskDollars)}</dd>
          <dt>Derived protective stop</dt><dd>{money(decision.riskPlan.chosenStop)} · {percent(decision.riskPlan.stopDistancePct)} below midpoint</dd>
          <dt>Projected 2R reference</dt><dd>{money(decision.riskPlan.projectedTwoR)} · reference only, not a guaranteed target</dd>
          <dt>Risk-sized position before caps</dt><dd>{money(decision.riskPlan.uncappedPositionValue)}</dd>
          <dt>ATR / price</dt><dd>{percent(decision.metrics.atrPct)}</dd>
          <dt>Quoted spread / midpoint</dt><dd>{percent(decision.metrics.spreadPct)}</dd>
        </dl>

        <h3>Possible pools</h3>
        {evidence.pools.length ? <><div className={styles.poolOptions}>{evidence.pools.map(pool => <div key={pool.id}><strong>{pool.label}</strong><span>{pool.allocationPct}% allocation ceiling</span><span>${(100 * pool.allocationPct / 100).toFixed(0)} of the $100 challenge</span></div>)}</div><p>These are portfolio allocation ceilings, not fixed position sizes. The strategy risk engine determines each position from planned loss risk, and available pool capacity must still pass before an order can qualify.</p></> : <p>Watched without a funded pool. Allocation must be configured before qualification.</p>}

        <h3>Observed evidence</h3>
        <dl>
          <dt>Quote check</dt><dd>{evidence.valid && evidence.fresh ? "Fresh, non-crossed quote" : "Needs attention"}</dd>
          <dt>Recent chart close change</dt><dd>{percent(evidence.change)} · {evidence.historyCount} observations{evidence.historyFrom && evidence.historyThrough ? ` · ${new Date(evidence.historyFrom).toISOString().slice(0,10)}–${new Date(evidence.historyThrough).toISOString().slice(0,10)}` : ""}</dd>
          <dt>Historical review through {dataThrough}</dt><dd>1-year volatility {item.volatility.toFixed(1)}% · max close drawdown {item.maxDrawdown.toFixed(1)}%</dd>
        </dl>
        <p>{item.rationale}</p><p>{source}. Crypto execution prices still require Alpaca verification before a future paper order.</p>

        <h3>Execution vetoes</h3>
        {decision.blockers.length ? <ul>{decision.blockers.map(reason => <li key={reason}>{reason}</li>)}</ul> : <p>No deterministic veto is active for the supplied dry-run context.</p>}
        {decision.warnings.length ? <><h3>Warnings</h3><ul>{decision.warnings.map(reason => <li key={reason}>{reason}</li>)}</ul></> : null}
        <p>Order submission remains disabled. Daily/weekly loss state, open portfolio risk, correlated exposure, and current 20/40/40 pool capacity must all be available and pass before execution can ever qualify.</p>
      </div>
    </details>
  </div>;
}
