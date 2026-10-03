"use client";

import MarketDataPanel, { type MarketSnapshot } from "./MarketDataPanel";
import AccountReportPanels from "./AccountReportPanels";
import type { AccountReport } from "@/lib/account-report";
import type { PaperWatchlist } from "@/lib/paper-watchlist";
import styles from "./PaperTradingLab.module.css";

export type ReportView = "portfolio" | "watchlist" | "trades" | "orders" | "positions";
export const REPORT_VIEWS: Array<[ReportView, string]> = [
  ["portfolio", "Portfolio"], ["watchlist", "Watchlist"], ["trades", "Trades"],
  ["orders", "Orders"], ["positions", "Positions"],
];

export default function RotatingPortfolioReport({ view, snapshot, stocks, crypto, onSetup, accountReport, accountError, watchlist }: { view: ReportView; snapshot: MarketSnapshot | null; stocks: string; crypto: string; onSetup: () => void; accountReport: AccountReport | null; accountError: string; watchlist: PaperWatchlist }) {
  return <div className={styles.report}>
    {view === "watchlist" ? <MarketDataPanel snapshot={snapshot} stocks={stocks} crypto={crypto} onSetup={onSetup} watchlist={watchlist} />
    : <AccountReportPanels view={view} report={accountReport} error={accountError} />}
  </div>;
}
