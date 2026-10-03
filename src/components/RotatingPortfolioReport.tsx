"use client";

import MarketDataPanel, { type MarketSnapshot } from "./MarketDataPanel";
import styles from "./PaperTradingLab.module.css";
import { PAPER_STARTING_CASH, PAPER_TRADE_CAP, PAPER_POOLS, formatPaperMoney } from "@/lib/paper-trading-config";

export type ReportView = "portfolio" | "trades" | "orders";
export const REPORT_VIEWS: Array<[ReportView, string]> = [["portfolio", "Portfolio & watchlist"], ["trades", "Trades & rules"], ["orders", "Upcoming orders"]];

function EmptyTable({ headings, message }: { headings: string[]; message: string }) {
  return <><table className={styles.table}><thead><tr>{headings.map(h => <th scope="col" key={h}>{h}</th>)}</tr></thead></table><div className={styles.empty}>{message}</div></>;
}

export default function RotatingPortfolioReport({ view, snapshot, stocks, crypto, onSetup }: { view: ReportView; snapshot: MarketSnapshot | null; stocks: string; crypto: string; onSetup: () => void }) {
  return <div className={`${styles.report} ${view === "trades" ? styles.activity : ""}`}>
    {view === "portfolio" ? <>
      <section className={styles.card}>
        <div className={styles.cardHeader}><h2>Portfolio value · since day one</h2><span className={styles.meta}>USD · paper account</span></div>
        <div className={`${styles.empty} ${styles.growth}`} role="img" aria-label={`No portfolio snapshots recorded. Virtual starting amount is ${PAPER_STARTING_CASH} dollars.`}><strong>{formatPaperMoney(PAPER_STARTING_CASH)}</strong><span>Virtual starting amount</span><span>Growth chart awaits recorded portfolio snapshots.</span></div>
      </section>
      <MarketDataPanel snapshot={snapshot} stocks={stocks} crypto={crypto} onSetup={onSetup} />
    </> : view === "trades" ? <>
      <section className={styles.card}><div className={styles.cardHeader}><h2>10 most recent trades</h2><span className={styles.meta}>Closed paper trades</span></div>
        <EmptyTable headings={["Closed", "Symbol", "Entry / exit", "Net P/L", "Report"]} message="No completed trades recorded. Purchase reports will include fill, cost, pool, and entry/exit rationale." />
      </section>
      <section className={styles.card}><div className={styles.cardHeader}><h2>Rules breakdown</h2><span className={styles.meta}>Unvalidated · simulator inactive</span></div>
        <div className={styles.rules}>
          <div><h3>20 / 40 / 40 pools</h3><p>Day / multi-day / multi-week. Inverse sleeve unallocated.</p></div>
          <div><h3>9% of pool per trade</h3><p>{PAPER_POOLS.filter(pool => pool.allocation > 0).map(pool => formatPaperMoney(PAPER_STARTING_CASH * pool.allocation / 100 * PAPER_TRADE_CAP)).join(" / ")} initial caps. Loss budget still needed.</p></div>
          <div><h3>Evidence before entry</h3><p>Setup, risk, spread and liquidity checks. Expiring limit entries.</p></div>
        </div>
        <p className={styles.meta}>Initial budgets: $200 day / $400 multi-day / $400 multi-week. Crypto shares these budgets. Filled trades stay in their entry pool.</p>
        <p className={styles.meta}>Linked stop and target after a fill. Costs and slippage included. Scores and exits need testing.</p>
      </section>
    </> : <>
      <section className={styles.card}><div className={styles.cardHeader}><h2>Upcoming open orders</h2><span className={styles.meta}>Ledger not connected</span></div>
        <EmptyTable headings={["Symbol", "Pool", "Status", "Limit", "Filled / requested"]} message="No pending or partially filled paper entries recorded." />
      </section>
      <section className={styles.card}><div className={styles.cardHeader}><h2>Open positions & planned sells</h2><span className={styles.meta}>Linked exits</span></div>
        <EmptyTable headings={["Symbol", "Position", "Avg. fill", "Stop", "Target"]} message="No filled positions or linked sell orders recorded. Targets appear after a simulated fill." />
      </section>
    </>}
  </div>;
}
