"use client";

import Link from "next/link";
import { PAPER_BOT_PROFILES, type PaperBotProfile } from "@/lib/paper-bot-profiles";
import type { PaperBotSummary } from "@/lib/paper-bot-ledger";
import useAccountReport from "./useAccountReport";
import usePaperBotLedgers from "./usePaperBotLedgers";
import styles from "./PaperTradingLab.module.css";

const money = (value: number | null) => value == null ? "Awaiting data" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
const percent = (value: number | null) => value == null ? "Awaiting data" : `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;

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

function BotCard({ profile, ledger, history }: {
  profile: PaperBotProfile;
  ledger: PaperBotSummary | null;
  history: Array<{ time: string; equity: number }>;
}) {
  const status = ledger?.status ?? profile.status;
  const active = status === "active";
  const startingCash = ledger?.startingCash ?? profile.challengeStartingCash;
  const equity = ledger?.equity ?? startingCash;
  const returnPct = startingCash > 0 ? (equity / startingCash - 1) * 100 : null;
  const drawdown = ledger?.currentDrawdownPct ?? maxDrawdown(history);

  return <article className={styles.botCard}>
    <div className={styles.botCardHeader}>
      <div>
        <span className={active ? styles.botStatusActive : styles.botStatusPlanned}>{status.toUpperCase()}</span>
        <h2>{profile.name}</h2>
      </div>
      <strong className={styles.botCapital}>{money(startingCash)}</strong>
    </div>

    <p>{profile.style}</p>

    <div className={styles.botMetrics}>
      <div><span>Virtual equity</span><strong>{money(equity)}</strong></div>
      <div><span>Total return</span><strong>{percent(returnPct)}</strong></div>
      <div><span>Max drawdown</span><strong>{percent(drawdown)}</strong></div>
      <div><span>Open positions</span><strong>{ledger?.positionCount ?? 0}</strong></div>
    </div>

    <div className={styles.botRuleGrid}>
      <div><span>Universe</span><strong>{profile.universe.assetClasses.join(" · ")}</strong><small>{profile.universe.description}</small></div>
      <div><span>Cadence</span><strong>{profile.cadence.intradayOnly ? "Intraday only" : profile.cadence.swingOnly ? "Swing only" : "Opportunity driven"}</strong><small>{profile.cadence.description}</small></div>
      <div><span>Strategy</span><strong>{ledger?.strategyId ?? profile.strategyId ?? "Separate strategy pending"}</strong><small>{active ? "Current decision engine" : "Disabled until explicitly designed and validated"}</small></div>
      <div><span>Ledger</span><strong>{money(ledger?.cash ?? startingCash)} cash</strong><small>Isolated virtual capital. The Alpaca account is only the execution venue and audit source.</small></div>
      <div><span>Risk state</span><strong>{ledger ? `${(ledger.openPlannedRiskPct ?? 0).toFixed(2)}% open risk` : "Awaiting ledger"}</strong><small>Correlated risk {(ledger?.correlatedRiskPct ?? 0).toFixed(2)}% · daily loss {(ledger?.dailyRealizedLossPct ?? 0).toFixed(2)}% · weekly drawdown {(ledger?.weeklyDrawdownPct ?? 0).toFixed(2)}%</small></div>
      <div><span>Journal</span><strong>{ledger?.journalCount ?? 0} events</strong><small>Future orders/fills must be bot-tagged before they can alter this ledger.</small></div>
    </div>

    <ul className={styles.botNotes}>{profile.notes.map(note => <li key={note}>{note}</li>)}</ul>
    {active ? <Link className={styles.botLink} href="/paper-trading">Open broker/report view →</Link> : <span className={styles.botDisabled}>Execution disabled</span>}
  </article>;
}

export default function PaperBotLab() {
  const { report: ledgerReport, error: ledgerError, refresh: refreshLedgers } = usePaperBotLedgers();
  const { report: accountReport, error: accountError, refresh: refreshAccount } = useAccountReport();
  const brokerEquity = accountReport?.snapshot?.account.equity ?? null;
  const brokerFills = accountReport?.snapshot?.fills?.length ?? null;

  const ledgerFor = (botId: string) => ledgerReport?.bots.find(bot => bot.botId === botId) ?? null;
  const historyFor = (botId: string) => ledgerReport?.history[botId] ?? [];

  return <main className={styles.botLab}>
    <header className={styles.botLabHeader}>
      <div>
        <Link href="/paper-trading">← Paper Trading Lab</Link>
        <h1>Bot Lab</h1>
        <p>Every challenge starts with the same $100 virtual bankroll. Alpaca paper trading is the shared execution sandbox and audit trail, not the source of a bot&apos;s buying power.</p>
      </div>
      <div className={styles.botLabActions}>
        <button onClick={() => { refreshLedgers(); refreshAccount(); }}>Refresh</button>
      </div>
    </header>

    <section className={styles.botOverview}>
      <div><span>Challenge baseline</span><strong>$100 each</strong></div>
      <div><span>Profiles</span><strong>{PAPER_BOT_PROFILES.length}</strong></div>
      <div><span>Alpaca paper balance</span><strong>{money(brokerEquity)}</strong></div>
      <div><span>Recent broker fills</span><strong>{brokerFills ?? "Awaiting data"}</strong></div>
    </section>

    <p className={styles.meta}>The broker balance can be much larger than $100. It is used to execute and verify paper trades. Only bot-attributed fills are allowed to change a challenge ledger.</p>
    {ledgerError ? <p role="status" className={styles.error}>Bot ledger: {ledgerError}</p> : null}
    {accountError ? <p role="status" className={styles.error}>Alpaca audit feed: {accountError}</p> : null}

    <section className={styles.botGrid}>
      {PAPER_BOT_PROFILES.map(profile => <BotCard
        key={profile.id}
        profile={profile}
        ledger={ledgerFor(profile.id)}
        history={historyFor(profile.id)}
      />)}
    </section>

    <section className={styles.botCompare}>
      <div className={styles.cardHeader}>
        <div><h2>Common comparison board</h2><p>Equal $100 starting capital makes strategy comparisons directly understandable while risk metrics stay visible.</p></div>
      </div>
      <div className={styles.botTableWrap}>
        <table>
          <thead><tr><th>Metric</th>{PAPER_BOT_PROFILES.map(profile => <th key={profile.id}>{profile.name}</th>)}</tr></thead>
          <tbody>
            <tr><td>Status</td>{PAPER_BOT_PROFILES.map(profile => <td key={profile.id}>{ledgerFor(profile.id)?.status ?? profile.status}</td>)}</tr>
            <tr><td>Starting capital</td>{PAPER_BOT_PROFILES.map(profile => <td key={profile.id}>{money(ledgerFor(profile.id)?.startingCash ?? profile.challengeStartingCash)}</td>)}</tr>
            <tr><td>Current equity</td>{PAPER_BOT_PROFILES.map(profile => <td key={profile.id}>{money(ledgerFor(profile.id)?.equity ?? profile.challengeStartingCash)}</td>)}</tr>
            <tr><td>Total return</td>{PAPER_BOT_PROFILES.map(profile => {
              const ledger=ledgerFor(profile.id); const start=ledger?.startingCash ?? profile.challengeStartingCash; const equity=ledger?.equity ?? start;
              return <td key={profile.id}>{percent(start > 0 ? (equity / start - 1) * 100 : null)}</td>;
            })}</tr>
            <tr><td>Max drawdown</td>{PAPER_BOT_PROFILES.map(profile => <td key={profile.id}>{percent(ledgerFor(profile.id)?.currentDrawdownPct ?? maxDrawdown(historyFor(profile.id)))}</td>)}</tr>
            <tr><td>Open planned risk</td>{PAPER_BOT_PROFILES.map(profile => <td key={profile.id}>{percent(ledgerFor(profile.id)?.openPlannedRiskPct ?? 0)}</td>)}</tr>
            <tr><td>Expectancy / avg R</td>{PAPER_BOT_PROFILES.map(profile => <td key={profile.id}>{(ledgerFor(profile.id)?.journalCount ?? 0) ? "Journal analysis pending" : "No trades yet"}</td>)}</tr>
            <tr><td>Profit factor</td>{PAPER_BOT_PROFILES.map(profile => <td key={profile.id}>{(ledgerFor(profile.id)?.journalCount ?? 0) ? "Journal analysis pending" : "No trades yet"}</td>)}</tr>
            <tr><td>MFE / MAE</td>{PAPER_BOT_PROFILES.map(profile => <td key={profile.id}>{(ledgerFor(profile.id)?.journalCount ?? 0) ? "Journal analysis pending" : "No trades yet"}</td>)}</tr>
            <tr><td>Journal events</td>{PAPER_BOT_PROFILES.map(profile => <td key={profile.id}>{ledgerFor(profile.id)?.journalCount ?? 0}</td>)}</tr>
          </tbody>
        </table>
      </div>
      <p className={styles.meta}>No performance winner is declared from an empty or tiny sample. The paper account remains the independent broker record used to reconcile bot-tagged activity.</p>
    </section>
  </main>;
}
