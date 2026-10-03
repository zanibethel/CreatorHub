"use client";

import { useEffect, useState } from "react";
import type { AccountReport, AccountHistoryPoint } from "@/lib/account-report";
import { PAPER_STARTING_CASH, formatPaperMoney } from "@/lib/paper-trading-config";
import styles from "./PaperTradingLab.module.css";

const money = (value: number | null) => value === null ? "—" : formatPaperMoney(value);
const stamp = (value: string | null) => value ? new Date(value).toLocaleString() : "—";

function History({ points }: { points: AccountHistoryPoint[] }) {
  if (points.length < 2) return <p>{points.length ? "First account snapshot recorded. The next minute checkpoint will extend the chart." : "Portfolio history begins with the first saved account snapshot."}</p>;
  const values = points.map(p => p.equity);
  const low = Math.min(...values), high = Math.max(...values);
  const first = Date.parse(points[0].time), last = Date.parse(points.at(-1)!.time);
  const path = points.map(p => `${12 + (Date.parse(p.time) - first) / (last - first || 1) * 576},${164 - (p.equity - low) / (high - low || 1) * 144}`).join(" ");
  return <div className={styles.accountChart}>
    <svg viewBox="0 0 600 184" role="img" aria-label={`${points.length} recorded paper-account equity snapshots, from ${formatPaperMoney(values[0])} to ${formatPaperMoney(values.at(-1)!)}`}><polyline points={path} fill="none" stroke="#62d9aa" strokeWidth="3" /></svg>
    <div className={styles.chartRange}><span>{stamp(points[0].time)}</span><span>{stamp(points.at(-1)!.time)}</span></div>
    <p className={styles.meta}>Recorded account equity · includes cashflows · latest {points.length} minute checkpoints</p>
  </div>;
}

export default function AccountReportPanels({ view, report, error }: { view: "portfolio" | "trades" | "orders" | "positions"; report: AccountReport | null; error: string }) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => { if (!document.hidden) setNow(Date.now()); }, 15_000);
    return () => window.clearInterval(timer);
  }, []);
  const snapshot = report?.snapshot;
  const title = { portfolio: "Portfolio overview", trades: "Recent fills", orders: "Upcoming orders", positions: "Open positions" }[view];
  const waiting = error || report?.message || "Waiting for the first saved Alpaca paper-account snapshot.";
  const snapshotAge = snapshot ? now - Date.parse(snapshot.collectedAt) : 0;
  return <section className={styles.card}>
    <div className={styles.cardHeader}><h2>{title}</h2><span className={styles.meta}>{snapshot ? "Alpaca paper account" : "Account collection pending"}</span></div>
    {snapshot ? <p className={snapshotAge > 90_000 ? styles.stale : styles.meta}>Account snapshot {stamp(snapshot.collectedAt)} · updates about every 30 seconds{snapshotAge > 90_000 ? " · update overdue" : ""}</p> : null}
    {snapshot && (error || report?.message) ? <p role="status" className={styles.error}>{error || report?.message} Showing the last saved snapshot.</p> : null}
    {!snapshot ? <div className={styles.empty}>{view === "portfolio" ? <><strong className={styles.accountValue}>{formatPaperMoney(PAPER_STARTING_CASH)}</strong><span>Challenge starting amount</span></> : null}<p>{waiting}</p></div>
    : view === "portfolio" ? <>
      <div className={`${styles.empty} ${styles.growth}`}><strong>{money(snapshot.account.equity)}</strong><span>Recorded paper account value · {snapshot.account.currency}</span><History points={report?.history ?? []} /></div>
      <div className={styles.accountStats}><div><span>Paper cash</span><strong>{money(snapshot.account.cash)}</strong></div><div><span>Change vs previous close</span><strong>{money(snapshot.account.previousCloseEquity === null ? null : snapshot.account.equity - snapshot.account.previousCloseEquity)}</strong></div></div>
      <p className={styles.meta}>Challenge baseline: {formatPaperMoney(PAPER_STARTING_CASH)}. The balance above is Alpaca’s actual paper balance and is not scaled to the baseline. Equity change includes cashflows.</p>
    </> : view === "trades" ? <>
      <p className={styles.meta}>Latest 10 executions, including partial fills and buys/sells. These are fills, not matched round-trip trade reports; fees, realized net P/L, and strategy rationale are not inferred.</p>
      {snapshot.fills === null ? <div className={styles.empty}>{snapshot.errors.fills || "Fill history unavailable."}</div> : !snapshot.fills.length ? <div className={styles.empty}>No fills recorded in this paper account.</div>
      : <div className={styles.recordList}>{snapshot.fills.map((fill, index) => <article className={styles.record} key={index}><h3>{fill.symbol} · {fill.side}</h3><div className={styles.recordFields}><span>Quantity <strong>{fill.quantity ?? "—"}</strong></span><span>Fill price <strong>{money(fill.price)}</strong></span></div><p className={styles.meta}>{stamp(fill.time)}</p></article>)}</div>}
    </> : view === "orders" ? <>
      {snapshot.orders === null ? <div className={styles.empty}>{snapshot.errors.orders || "Order data unavailable."}</div> : !snapshot.orders.length ? <div className={styles.empty}>No open orders in this paper account.</div>
      : <div className={styles.recordList}>{snapshot.orders.slice(0, 50).map((order, index) => <article className={styles.record} key={index}><div className={styles.cardHeader}><h3>{order.symbol} · {order.side}</h3><span className={styles.meta}>{order.status.replaceAll("_", " ")}</span></div><div className={styles.recordFields}><span>Filled / requested <strong>{order.filled ?? "—"} / {order.quantity ?? "—"}</strong></span><span>Limit <strong>{money(order.limit)}</strong></span><span>Stop <strong>{money(order.stop)}</strong></span></div><p className={styles.meta}>{order.type} · submitted {stamp(order.submittedAt)}</p></article>)}</div>}
      {snapshot.orders && snapshot.orders.length > 50 ? <p className={styles.meta}>Showing the latest 50 of {snapshot.orders.length} returned open orders.</p> : null}
      {snapshot.ordersMayBeTruncated ? <p className={styles.stale}>The provider’s 500-order limit was reached; additional orders may exist.</p> : null}
    </> : <>
      {snapshot.positions === null ? <div className={styles.empty}>{snapshot.errors.positions || "Position data unavailable."}</div> : !snapshot.positions.length ? <div className={styles.empty}>No open positions in this paper account.</div>
      : <div className={styles.recordList}>{snapshot.positions.slice(0, 50).map((position, index) => <article className={styles.record} key={index}><h3>{position.symbol} · {position.side}</h3><div className={styles.recordFields}><span>Quantity <strong>{position.quantity ?? "—"}</strong></span><span>Average entry <strong>{money(position.entry)}</strong></span><span>Market value <strong>{money(position.marketValue)}</strong></span><span>Unrealized P/L <strong>{money(position.unrealizedPl)}</strong></span></div></article>)}</div>}
      {snapshot.positions && snapshot.positions.length > 50 ? <p className={styles.meta}>Showing 50 of {snapshot.positions.length} open positions.</p> : null}
      <p className={styles.meta}>Recorded stop and limit sell/cover orders appear on the Orders page. The report does not invent planned exits.</p>
    </>}
  </section>;
}
