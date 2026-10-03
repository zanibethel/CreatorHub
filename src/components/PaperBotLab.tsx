"use client";

import Link from "next/link";
import { PAPER_BOT_PROFILES, type PaperBotProfile } from "@/lib/paper-bot-profiles";
import type { PaperBotSummary } from "@/lib/paper-bot-ledger";
import useAccountReport from "./useAccountReport";
import usePaperBotLedgers, { type StagedPaperOrder } from "./usePaperBotLedgers";
import styles from "./PaperTradingLab.module.css";

const money = (value: number | null | undefined) => value == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
const percent = (value: number | null | undefined) => value == null ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;

function maxDrawdown(history: Array<{ time: string; equity: number }>) {
  if (history.length < 2) return 0;
  let peak = history[0].equity;
  let worst = 0;
  for (const point of history) {
    peak = Math.max(peak, point.equity);
    if (peak > 0) worst = Math.min(worst, (point.equity / peak - 1) * 100);
  }
  return worst;
}

function OrderPlan({ order }: { order: StagedPaperOrder }) {
  return <div className={styles.botRuleGrid}>
    <div><span>Staged {order.symbol}</span><strong>{money(order.requested_notional)} · {order.pool_id ?? "unassigned"}</strong>
      <small>Trigger {money(order.entry_trigger)} · max chase {money(order.max_entry_price)} · stop {money(order.protective_stop)}</small>
      <small>Take profit {money(order.take_profit_price)} · sell {order.take_profit_fraction !== null ? `${(order.take_profit_fraction * 100).toFixed(0)}%` : "—"}{order.trail_remainder && order.take_profit_fraction !== null ? ` · trail remaining ${((1 - order.take_profit_fraction) * 100).toFixed(0)}%` : ""}</small>
      <small>Planned loss ≤ {money(order.planned_risk_dollars)} · expires {order.expires_at ? new Date(order.expires_at).toLocaleString() : "—"}</small>
      {order.stage_reason ? <small>{order.stage_reason}</small> : null}
    </div>
  </div>;
}

function BotCard({ profile, ledger, history, staged }: {
  profile: PaperBotProfile;
  ledger: PaperBotSummary | null;
  history: Array<{ time: string; equity: number }>;
  staged: StagedPaperOrder[];
}) {
  const active = (ledger?.status ?? profile.status) === "active";
  const equity = ledger?.equity ?? profile.challengeStartingCash;
  const returnPct = (equity / profile.challengeStartingCash - 1) * 100;
  const drawdown = ledger?.currentDrawdownPct ?? maxDrawdown(history);

  return <article className={styles.botCard}>
    <div className={styles.botCardHeader}>
      <div>
        <span className={active ? styles.botStatusActive : styles.botStatusPlanned}>{active ? "ACTIVE" : "PLANNED"}</span>
        <h2>{profile.name}</h2>
      </div>
      <strong className={styles.botCapital}>{money(equity)}</strong>
    </div>

    <p>{profile.style}</p>
    <div className={styles.botMetrics}>
      <div><span>Virtual equity</span><strong>{money(equity)}</strong></div>
      <div><span>Total return</span><strong>{percent(returnPct)}</strong></div>
      <div><span>Max drawdown</span><strong>{percent(drawdown)}</strong></div>
      <div><span>Open positions</span><strong>{ledger?.positionCount ?? 0}</strong></div>
      <div><span>Open planned risk</span><strong>{percent(ledger?.openPlannedRiskPct ?? 0)}</strong></div>
      <div><span>Ledger-applied fills</span><strong>{ledger?.brokerFillCount ?? 0}</strong></div>
    </div>

    <div className={styles.botRuleGrid}>
      <div><span>Strategy</span><strong>{ledger?.strategyId ?? profile.strategyId ?? "Pending"}</strong><small>{profile.cadence.description}</small></div>
      <div><span>Pool usage</span><strong>Day {percent(ledger?.poolUsage.day ?? 0)} · Multi-day {percent(ledger?.poolUsage["multi-day"] ?? 0)} · Multi-week {percent(ledger?.poolUsage["multi-week"] ?? 0)}</strong><small>Virtual equity allocation, not broker-account allocation.</small></div>
      <div><span>Risk state</span><strong>Daily loss {percent(ledger?.dailyRealizedLossPct ?? 0)} · Weekly drawdown {percent(ledger?.weeklyDrawdownPct ?? 0)}</strong><small>Alpaca paper activity only changes this challenge when it matches a prepared bot order.</small></div>
    </div>

    {staged.length ? <div>
      <h3>Staged plans</h3>
      {staged.map(order => <OrderPlan key={`${order.symbol}-${order.entry_trigger}`} order={order} />)}
      <p className={styles.meta}>Staged means prepared only. These plans require fresh quote/spread/risk revalidation before paper submission.</p>
    </div> : null}

    <ul className={styles.botNotes}>{profile.notes.map(note => <li key={note}>{note}</li>)}</ul>
    {active ? <Link className={styles.botLink} href="/paper-trading">Open live report →</Link> : <span className={styles.botDisabled}>Execution disabled</span>}
  </article>;
}

export default function PaperBotLab() {
  const { report: accountReport, error: accountError, refresh: refreshAccount } = useAccountReport();
  const { report: ledgerReport, error: ledgerError, refresh: refreshLedgers } = usePaperBotLedgers();
  const ledgerFor = (botId: string) => ledgerReport?.bots.find(bot => bot.botId === botId) ?? null;
  const stagedFor = (botId: string) => ledgerReport?.stagedOrders?.[botId] ?? [];
  const historyFor = (botId: string) => ledgerReport?.history?.[botId] ?? [];
  const brokerEquity = accountReport?.snapshot?.account.equity ?? null;

  return <main className={styles.botLab}>
    <header className={styles.botLabHeader}>
      <div>
        <Link href="/paper-trading">← Paper Trading Lab</Link>
        <h1>Bot Lab</h1>
        <p>Every challenge starts with $100 virtual capital. The larger Alpaca paper account is the execution sandbox and audit trail, never the bot bankroll.</p>
      </div>
      <div className={styles.botLabActions}><button onClick={() => { refreshLedgers(); refreshAccount(); }}>Refresh</button></div>
    </header>

    <section className={styles.botOverview}>
      <div><span>Challenge baseline</span><strong>$100 each</strong></div>
      <div><span>Active bots</span><strong>{PAPER_BOT_PROFILES.filter(profile => profile.status === "active").length}</strong></div>
      <div><span>Prepared plans</span><strong>{Object.values(ledgerReport?.stagedOrders ?? {}).reduce((sum, orders) => sum + orders.length, 0)}</strong></div>
      <div><span>Alpaca paper balance</span><strong>{money(brokerEquity)}</strong></div>
    </section>

    {ledgerError ? <p role="status" className={styles.error}>Bot ledger: {ledgerError}</p> : null}
    {accountError ? <p role="status" className={styles.error}>Alpaca audit feed: {accountError}</p> : null}

    <section className={styles.botGrid}>
      {PAPER_BOT_PROFILES.map(profile => <BotCard
        key={profile.id}
        profile={profile}
        ledger={ledgerFor(profile.id)}
        history={historyFor(profile.id)}
        staged={stagedFor(profile.id)}
      />)}
    </section>

    <section className={styles.botCompare}>
      <div className={styles.cardHeader}><div><h2>Common comparison board</h2><p>Same $100 baseline, separate ledgers, comparable risk metrics.</p></div></div>
      <div className={styles.botTableWrap}><table>
        <thead><tr><th>Metric</th>{PAPER_BOT_PROFILES.map(profile => <th key={profile.id}>{profile.name}</th>)}</tr></thead>
        <tbody>
          <tr><td>Status</td>{PAPER_BOT_PROFILES.map(profile => <td key={profile.id}>{ledgerFor(profile.id)?.status ?? profile.status}</td>)}</tr>
          <tr><td>Equity</td>{PAPER_BOT_PROFILES.map(profile => <td key={profile.id}>{money(ledgerFor(profile.id)?.equity ?? profile.challengeStartingCash)}</td>)}</tr>
          <tr><td>Prepared plans</td>{PAPER_BOT_PROFILES.map(profile => <td key={profile.id}>{stagedFor(profile.id).length}</td>)}</tr>
          <tr><td>Open risk</td>{PAPER_BOT_PROFILES.map(profile => <td key={profile.id}>{percent(ledgerFor(profile.id)?.openPlannedRiskPct ?? 0)}</td>)}</tr>
          <tr><td>Ledger-applied fills</td>{PAPER_BOT_PROFILES.map(profile => <td key={profile.id}>{ledgerFor(profile.id)?.brokerFillCount ?? 0}</td>)}</tr>
        </tbody>
      </table></div>
      <p className={styles.meta}>No performance winner is declared from an empty or tiny sample. Prepared plans are not broker orders.</p>
    </section>
  </main>;
}
