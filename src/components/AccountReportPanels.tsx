"use client";

import { useEffect, useState } from "react";
import type { AccountReport, AccountHistoryPoint } from "@/lib/account-report";
import { PAPER_STARTING_CASH, formatPaperMoney } from "@/lib/paper-trading-config";
import usePaperBotLedgers, { type PaperPositionPlan, type StagedPaperOrder } from "./usePaperBotLedgers";
import styles from "./PaperTradingLab.module.css";

const money = (value: number | null | undefined) => value == null ? "—" : formatPaperMoney(value);
const stamp = (value: string | null | undefined) => value ? new Date(value).toLocaleString() : "—";
const pct = (value: number | null | undefined) => value == null ? "—" : `${(value * 100).toFixed(0)}%`;

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

function ProfitPlan({ plan, botName }: { plan: PaperPositionPlan; botName: string }) {
  if (plan.take_profit_price === null || plan.take_profit_fraction === null) return null;
  const quantity = plan.quantity * plan.take_profit_fraction;
  const proceeds = quantity * plan.take_profit_price;
  const remainder = Math.max(0, 1 - plan.take_profit_fraction);
  return <div className={styles.botRuleGrid}>
    <div>
      <span>{botName} · planned profit management</span>
      <strong>Take profit {money(plan.take_profit_price)} · sell {pct(plan.take_profit_fraction)}</strong>
      <small>Approx. {quantity.toFixed(8)} units · {money(proceeds)} at that price</small>
      <small>{plan.protect_winner_at_r ? `Tighten protection around +${plan.protect_winner_at_r.toFixed(0)}R` : "Protection adjustment not set"}{plan.trail_remainder ? ` · trail remaining ${pct(remainder)}` : ""}</small>
      <small>Planned level only unless a separate take-profit order is shown as live above.</small>
    </div>
  </div>;
}

function StagedPlan({ order, botName }: { order: StagedPaperOrder; botName: string }) {
  const fraction = order.take_profit_fraction;
  return <article className={styles.record}>
    <div className={styles.cardHeader}><h3>{order.symbol} · {botName}</h3><span className={styles.meta}>prepared</span></div>
    <div className={styles.recordFields}>
      <span>Entry trigger <strong>{money(order.entry_trigger)}</strong></span>
      <span>Max entry <strong>{money(order.max_entry_price)}</strong></span>
      <span>Protective stop <strong>{money(order.protective_stop)}</strong></span>
      <span>Take profit <strong>{money(order.take_profit_price)}</strong></span>
      <span>Profit sale <strong>{pct(fraction)}</strong></span>
      <span>Planned risk <strong>{money(order.planned_risk_dollars)}</strong></span>
    </div>
    <p className={styles.meta}>{order.stage_reason ?? "Prepared strategy plan."}{order.trail_remainder && fraction ? ` · trail remaining ${pct(1 - fraction)}` : ""}</p>
    <p className={styles.meta}>Prepared only · not yet an Alpaca broker order · expires {stamp(order.expires_at)}</p>
  </article>;
}

export default function AccountReportPanels({ view, report, error }: { view: "portfolio" | "trades" | "orders" | "positions"; report: AccountReport | null; error: string }) {
  const [now, setNow] = useState(0);
  const { report: botReport } = usePaperBotLedgers();

  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => { if (!document.hidden) setNow(Date.now()); }, 15_000);
    return () => window.clearInterval(timer);
  }, []);

  const snapshot = report?.snapshot;
  const title = { portfolio: "Portfolio overview", trades: "Recent fills", orders: "Upcoming orders", positions: "Open positions" }[view];
  const waiting = error || report?.message || "Waiting for the first saved Alpaca paper-account snapshot.";
  const snapshotAge = snapshot ? now - Date.parse(snapshot.collectedAt) : 0;
  const botName = (botId: string) => botReport?.bots.find(bot => bot.botId === botId)?.displayName ?? botId;
  const matchingPlans = (symbol: string) => Object.entries(botReport?.positionPlans ?? {})
    .flatMap(([botId, plans]) => plans.filter(plan => plan.symbol === symbol).map(plan => ({ botId, plan })));
  const staged = Object.entries(botReport?.stagedOrders ?? {})
    .flatMap(([botId, orders]) => orders.map(order => ({ botId, order })));

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
      <p className={styles.meta}>Latest 10 executions, including partial fills and buys/sells. These are fills, not matched round-trip trade reports.</p>
      {snapshot.fills === null ? <div className={styles.empty}>{snapshot.errors.fills || "Fill history unavailable."}</div> : !snapshot.fills.length ? <div className={styles.empty}>No fills recorded in this paper account.</div>
      : <div className={styles.recordList}>{snapshot.fills.map((fill, index) => <article className={styles.record} key={index}><h3>{fill.symbol} · {fill.side}</h3><div className={styles.recordFields}><span>Quantity <strong>{fill.quantity ?? "—"}</strong></span><span>Fill price <strong>{money(fill.price)}</strong></span></div><p className={styles.meta}>{stamp(fill.time)}</p></article>)}</div>}
    </> : view === "orders" ? <>
      <p className={styles.meta}>Live Alpaca orders are shown first. Bot take-profit levels are shown as planned unless a separate live broker order exists.</p>
      {snapshot.orders === null ? <div className={styles.empty}>{snapshot.errors.orders || "Order data unavailable."}</div> : !snapshot.orders.length ? <div className={styles.empty}>No open orders in this paper account.</div>
      : <div className={styles.recordList}>{snapshot.orders.slice(0, 50).map((order, index) => {
        const plans = matchingPlans(order.symbol);
        const stopLimit = order.type.includes("stop") && order.stop !== null;
        return <article className={styles.record} key={index}>
          <div className={styles.cardHeader}><h3>{order.symbol} · {order.side}</h3><span className={styles.meta}>{order.status.replaceAll("_", " ")}</span></div>
          <div className={styles.recordFields}>
            <span>Filled / requested <strong>{order.filled ?? "—"} / {order.quantity ?? "—"}</strong></span>
            <span>{stopLimit ? "Stop-limit floor" : "Limit"} <strong>{money(order.limit)}</strong></span>
            <span>Stop trigger <strong>{money(order.stop)}</strong></span>
          </div>
          <p className={styles.meta}>{order.type} · submitted {stamp(order.submittedAt)}</p>
          {plans.map(({ botId, plan }) => <ProfitPlan key={`${botId}-${plan.symbol}`} plan={plan} botName={botName(botId)} />)}
        </article>;
      })}</div>}
      {snapshot.orders && snapshot.orders.length > 50 ? <p className={styles.meta}>Showing the latest 50 of {snapshot.orders.length} returned open orders.</p> : null}
      {snapshot.ordersMayBeTruncated ? <p className={styles.stale}>The provider’s 500-order limit was reached; additional orders may exist.</p> : null}

      {staged.length ? <>
        <div className={styles.cardHeader}><h3>Prepared bot plans</h3><span className={styles.meta}>not submitted</span></div>
        <div className={styles.recordList}>{staged.map(({ botId, order }) => <StagedPlan key={`${botId}-${order.symbol}`} order={order} botName={botName(botId)} />)}</div>
      </> : null}
    </> : <>
      {snapshot.positions === null ? <div className={styles.empty}>{snapshot.errors.positions || "Position data unavailable."}</div> : !snapshot.positions.length ? <div className={styles.empty}>No open positions in this paper account.</div>
      : <div className={styles.recordList}>{snapshot.positions.slice(0, 50).map((position, index) => <article className={styles.record} key={index}><h3>{position.symbol} · {position.side}</h3><div className={styles.recordFields}><span>Quantity <strong>{position.quantity ?? "—"}</strong></span><span>Average entry <strong>{money(position.entry)}</strong></span><span>Market value <strong>{money(position.marketValue)}</strong></span><span>Unrealized P/L <strong>{money(position.unrealizedPl)}</strong></span></div>{matchingPlans(position.symbol).map(({ botId, plan }) => <ProfitPlan key={`${botId}-${plan.symbol}`} plan={plan} botName={botName(botId)} />)}</article>)}</div>}
      {snapshot.positions && snapshot.positions.length > 50 ? <p className={styles.meta}>Showing 50 of {snapshot.positions.length} open positions.</p> : null}
      <p className={styles.meta}>Recorded protective orders appear on Orders. Planned take-profit/trailing levels come from the bot strategy and are labeled separately until submitted.</p>
    </>}
  </section>;
}
