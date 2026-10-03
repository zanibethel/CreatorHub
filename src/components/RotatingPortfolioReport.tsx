"use client";

import MarketDataPanel, { type MarketSnapshot } from "./MarketDataPanel";
import styles from "./PaperTradingLab.module.css";
import { PAPER_STARTING_CASH, formatPaperMoney } from "@/lib/paper-trading-config";

export type ReportView = "portfolio" | "watchlist" | "trades" | "orders" | "positions";
export const REPORT_VIEWS: Array<[ReportView, string]> = [
  ["portfolio", "Portfolio"], ["watchlist", "Watchlist"], ["trades", "Trades"],
  ["orders", "Orders"], ["positions", "Positions"],
];

export default function RotatingPortfolioReport({ view, snapshot, stocks, crypto, onSetup }: { view: ReportView; snapshot: MarketSnapshot | null; stocks: string; crypto: string; onSetup: () => void }) {
  return <div className={styles.report}>
    {view === "portfolio" ? <section className={styles.card}>
      <div className={styles.cardHeader}><h2>Portfolio overview</h2><span className={styles.meta}>Since day one</span></div>
      <div className={`${styles.empty} ${styles.growth}`} role="img" aria-label={`No portfolio history recorded. Starting amount is ${PAPER_STARTING_CASH} dollars.`}>
        <strong>{formatPaperMoney(PAPER_STARTING_CASH)}</strong><span>Starting amount</span>
        <p>Portfolio history will appear when account snapshots are connected.</p>
      </div>
      <p className={styles.meta}>Account value and returns have not been recorded yet.</p>
    </section> : view === "watchlist" ? <MarketDataPanel snapshot={snapshot} stocks={stocks} crypto={crypto} onSetup={onSetup} />
    : view === "trades" ? <section className={styles.card}>
      <div className={styles.cardHeader}><h2>Recent trades</h2><span className={styles.meta}>Latest 10 completed trades</span></div>
      <div className={styles.empty}><h3>No completed trades recorded</h3><p>Completed trade reports will show entry, exit, costs, net result, and rationale.</p></div>
    </section> : view === "orders" ? <section className={styles.card}>
      <div className={styles.cardHeader}><h2>Upcoming orders</h2><span className={styles.meta}>Pending and partial entries</span></div>
      <div className={styles.empty}><h3>No open orders recorded</h3><p>Order status, limit price, and filled quantity will appear when the account ledger is connected.</p></div>
    </section> : <section className={styles.card}>
      <div className={styles.cardHeader}><h2>Open positions</h2><span className={styles.meta}>Positions and planned exits</span></div>
      <div className={styles.empty}><h3>No positions recorded</h3><p>Position size, entry price, and recorded stop and target levels will appear here.</p></div>
    </section>}
  </div>;
}
