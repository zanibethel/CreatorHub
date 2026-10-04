"use client";

import { useEffect, useState } from "react";
import type { AccountReport, AccountHistoryPoint } from "@/lib/account-report";
import { PAPER_STARTING_CASH, formatPaperMoney } from "@/lib/paper-trading-config";
import usePaperBotLedgers, { type PaperCounterfactual, type PaperPositionPlan, type StagedPaperOrder } from "./usePaperBotLedgers";
import useSwingReadiness from "./useSwingReadiness";
import useWeekendCryptoReadiness, { type WeekendCryptoCandidate } from "./useWeekendCryptoReadiness";
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
  const manager = plan.exit_manager_state;
  const managerR = manager.rMultiple;
  const managerAction = manager.plannedAction ?? "hold";
  return <div className={styles.botRuleGrid}>
    <div>
      <span>{botName} · planned profit management</span>
      <strong>Take profit {money(plan.take_profit_price)} · sell {pct(plan.take_profit_fraction)}</strong>
      <small>Approx. {quantity.toFixed(8)} units · {money(proceeds)} at that price</small>
      <small>{plan.protect_winner_at_r ? `Tighten protection around +${plan.protect_winner_at_r.toFixed(0)}R` : "Protection adjustment not set"}{plan.trail_remainder ? ` · trail remaining ${pct(remainder)}` : ""}</small>
      <small>Exit manager: <strong>{managerAction.replaceAll("_", " ")}</strong>{managerR !== undefined ? ` · ${managerR >= 0 ? "+" : ""}${managerR.toFixed(2)}R` : ""}{manager.desiredStop ? ` · planned stop ${money(manager.desiredStop)}` : ""}</small>
      <small>{manager.reason ?? "Waiting for the next marked exit evaluation."}{plan.last_exit_manager_at ? ` · evaluated ${stamp(plan.last_exit_manager_at)}` : ""}</small>
      <small>Planned level only unless a separate take-profit order is shown as live above.</small>
    </div>
  </div>;
}

function CryptoSetupPlan({ candidate, collectedAt, evidence }: { candidate: WeekendCryptoCandidate; collectedAt: string; evidence: PaperCounterfactual | null }) {
  const validUntil = new Date(Date.parse(collectedAt) + 5 * 60_000).toISOString();
  const observedEntry = evidence?.triggered_at && evidence.assumed_entry_price !== null
    ? { price: evidence.assumed_entry_price, at: evidence.triggered_at }
    : null;
  const headline = candidate.trigger === null
    ? "No executable trigger is available yet."
    : `Enter near ${money(candidate.trigger)} if reached before ${stamp(validUntil)} and all gates still pass.`;
  const status = candidate.selectedForSubmission
    ? "selected for PAPER submission"
    : observedEntry
      ? "entry observed"
      : candidate.state === "blocked"
        ? "blocked"
        : candidate.state === "ready"
          ? "ready"
          : "watching";
  const reasons = candidate.blockers.length ? candidate.blockers : candidate.waitingOn;

  return <article className={styles.record}>
    <div className={styles.cardHeader}><h3>{candidate.symbol} · Daily Crypto</h3><span className={styles.meta}>{status}</span></div>
    <p><strong>{headline}</strong></p>
    <div className={styles.recordFields}>
      <span>Score <strong>{candidate.score.toFixed(0)}/100</strong></span>
      <span>Planned entry <strong>{money(candidate.trigger)}</strong></span>
      <span>Maximum entry <strong>{money(candidate.maxEntry)}</strong></span>
      <span>Current bid / ask <strong>{money(candidate.bid)} / {money(candidate.ask)}</strong></span>
      <span>Observed entry <strong>{observedEntry ? money(observedEntry.price) : "—"}</strong></span>
      <span>Setup valid through <strong>{stamp(validUntil)}</strong></span>
      <span>Protective stop <strong>{money(candidate.protectiveStop)}</strong></span>
      <span>Take profit <strong>{money(candidate.takeProfit)}</strong></span>
      <span>Planned notional <strong>{money(candidate.plannedNotional)}</strong></span>
      <span>Planned risk <strong>{money(candidate.plannedRiskDollars)}</strong></span>
    </div>
    <p className={styles.meta}>{reasons.length ? reasons.join(" · ") : "All currently evaluated gates pass."}</p>
    <p className={styles.meta}>{observedEntry ? `Entry condition observed ${stamp(observedEntry.at)} · review evidence only, not an Alpaca fill.` : "Scanner setup only · actual broker fill appears separately above as Average entry fill."}</p>
  </article>;
}

function StagedPlan({ order, botName, evidence, now, entryWindowStart, entryWindowEnd }: { order: StagedPaperOrder; botName: string; evidence: PaperCounterfactual | null; now: number; entryWindowStart?: string | null; entryWindowEnd?: string | null }) {
  const fraction = order.take_profit_fraction;
  const observedEntry = evidence?.triggered_at && evidence.assumed_entry_price !== null
    ? { price: evidence.assumed_entry_price, at: evidence.triggered_at }
    : null;
  const actualWindowStart = entryWindowStart ?? null;
  const actualWindowEnd = entryWindowEnd ?? order.expires_at;
  const expired = actualWindowEnd ? now > Date.parse(actualWindowEnd) : false;
  const windowOpen = actualWindowStart ? now >= Date.parse(actualWindowStart) : true;
  const entryPlan = order.entry_trigger === null
    ? "No entry trigger recorded."
    : actualWindowStart && actualWindowEnd
      ? `Enter near ${money(order.entry_trigger)} only between ${stamp(actualWindowStart)} and ${stamp(actualWindowEnd)}.`
      : actualWindowEnd
        ? `Enter near ${money(order.entry_trigger)} if reached by ${stamp(actualWindowEnd)}.`
        : `Enter near ${money(order.entry_trigger)} when the setup confirms.`;
  const windowStatus = observedEntry
    ? `Entry condition observed at ${money(observedEntry.price)} · ${stamp(observedEntry.at)}`
    : expired
      ? "Entry window ended without an observed qualifying entry."
      : !windowOpen
        ? `Entry window has not opened yet · starts ${stamp(actualWindowStart)}`
        : "Entry window is open · waiting for the planned entry condition.";

  return <article className={styles.record}>
    <div className={styles.cardHeader}><h3>{order.symbol} · {botName}</h3><span className={styles.meta}>{observedEntry ? "entry observed" : expired ? "window ended" : "prepared"}</span></div>
    <p><strong>{entryPlan}</strong></p>
    <div className={styles.recordFields}>
      <span>Planned entry <strong>{money(order.entry_trigger)}</strong></span>
      <span>Maximum entry <strong>{money(order.max_entry_price)}</strong></span>
      <span>Observed entry <strong>{observedEntry ? money(observedEntry.price) : "—"}</strong></span>
      <span>Entry window starts <strong>{stamp(actualWindowStart)}</strong></span>
      <span>Entry window ends <strong>{stamp(actualWindowEnd)}</strong></span>
      <span>Protective stop <strong>{money(order.protective_stop)}</strong></span>
      <span>Take profit <strong>{money(order.take_profit_price)}</strong></span>
      <span>Profit sale <strong>{pct(fraction)}</strong></span>
      <span>Planned risk <strong>{money(order.planned_risk_dollars)}</strong></span>
    </div>
    <p className={styles.meta}>{windowStatus}{observedEntry ? " · review evidence only, not an Alpaca fill" : ""}</p>
    <p className={styles.meta}>{order.stage_reason ?? "Prepared strategy plan."}{order.trail_remainder && fraction ? ` · trail remaining ${pct(1 - fraction)}` : ""}</p>
    <p className={styles.meta}>Prepared only · not yet an Alpaca broker order</p>
  </article>;
}

export default function AccountReportPanels({ view, report, error }: { view: "portfolio" | "trades" | "orders" | "positions"; report: AccountReport | null; error: string }) {
  const [now, setNow] = useState(0);
  const { report: botReport } = usePaperBotLedgers();
  const { report: swingReadiness } = useSwingReadiness();
  const { report: cryptoReadiness } = useWeekendCryptoReadiness();

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
  const planEvidence = (botId: string, order: StagedPaperOrder) =>
    (botReport?.counterfactuals?.[botId] ?? []).find(item =>
      item.symbol === order.symbol
      && item.strategy_id === order.strategy_id
      && item.strategy_version === order.strategy_version
    ) ?? null;
  const cryptoEvidence = (symbol: string) =>
    (botReport?.counterfactuals?.["weekend-crypto-day-100"] ?? []).find(item =>
      item.symbol === symbol
      && item.strategy_id === cryptoReadiness?.strategyId
      && item.strategy_version === cryptoReadiness?.strategyVersion
      && ["watching","triggered"].includes(item.status)
    ) ?? null;
  const cryptoPlans = (cryptoReadiness?.candidates ?? [])
    .filter(candidate => candidate.executionEligible && candidate.score >= 60)
    .sort((a,b) => b.score - a.score)
    .slice(0,3);

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
            <span>{order.side === "buy" ? "Average entry fill" : "Average fill"} <strong>{money(order.averageFillPrice)}</strong></span>
            <span>{stopLimit ? "Stop-limit floor" : "Limit"} <strong>{money(order.limit)}</strong></span>
            <span>Stop trigger <strong>{money(order.stop)}</strong></span>
          </div>
          <p className={styles.meta}>{order.type} · submitted {stamp(order.submittedAt)}</p>
          {plans.map(({ botId, plan }) => <ProfitPlan key={`${botId}-${plan.symbol}`} plan={plan} botName={botName(botId)} />)}
        </article>;
      })}</div>}
      {snapshot.orders && snapshot.orders.length > 50 ? <p className={styles.meta}>Showing the latest 50 of {snapshot.orders.length} returned open orders.</p> : null}
      {snapshot.ordersMayBeTruncated ? <p className={styles.stale}>The provider’s 500-order limit was reached; additional orders may exist.</p> : null}

      {cryptoPlans.length && cryptoReadiness ? <>
        <div className={styles.cardHeader}><h3>Current crypto setup plans</h3><span className={styles.meta}>24/7 · 5-minute setup horizon</span></div>
        <div className={styles.recordList}>{cryptoPlans.map(candidate => <CryptoSetupPlan
          key={candidate.symbol}
          candidate={candidate}
          collectedAt={cryptoReadiness.collectedAt}
          evidence={cryptoEvidence(candidate.symbol)}
        />)}</div>
        <p className={styles.meta}>Showing execution-tier Daily Crypto candidates scoring 60+ for review. The bot still requires 80+ plus all other gates before PAPER submission.</p>
      </> : null}

      {staged.length ? <>
        <div className={styles.cardHeader}><h3>Prepared bot plans</h3><span className={styles.meta}>not submitted</span></div>
        <div className={styles.recordList}>{staged.map(({ botId, order }) => <StagedPlan
          key={`${botId}-${order.symbol}`}
          order={order}
          botName={botName(botId)}
          evidence={planEvidence(botId, order)}
          now={now}
          entryWindowStart={botId === "three-trade-weekly-swing-100" ? swingReadiness?.entryWindowStart : null}
          entryWindowEnd={botId === "three-trade-weekly-swing-100" ? swingReadiness?.entryWindowEnd : null}
        />)}</div>
      </> : null}
    </> : <>
      {snapshot.positions === null ? <div className={styles.empty}>{snapshot.errors.positions || "Position data unavailable."}</div> : !snapshot.positions.length ? <div className={styles.empty}>No open positions in this paper account.</div>
      : <div className={styles.recordList}>{snapshot.positions.slice(0, 50).map((position, index) => <article className={styles.record} key={index}><h3>{position.symbol} · {position.side}</h3><div className={styles.recordFields}><span>Quantity <strong>{position.quantity ?? "—"}</strong></span><span>Average entry <strong>{money(position.entry)}</strong></span><span>Market value <strong>{money(position.marketValue)}</strong></span><span>Unrealized P/L <strong>{money(position.unrealizedPl)}</strong></span></div>{matchingPlans(position.symbol).map(({ botId, plan }) => <ProfitPlan key={`${botId}-${plan.symbol}`} plan={plan} botName={botName(botId)} />)}</article>)}</div>}
      {snapshot.positions && snapshot.positions.length > 50 ? <p className={styles.meta}>Showing 50 of {snapshot.positions.length} open positions.</p> : null}
      <p className={styles.meta}>Recorded protective orders appear on Orders. Planned take-profit/trailing levels come from the bot strategy and are labeled separately until submitted.</p>
    </>}
  </section>;
}
