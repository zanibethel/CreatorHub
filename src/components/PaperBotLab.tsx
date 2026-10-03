"use client";

import Link from "next/link";
import { PAPER_BOT_PROFILES, type PaperBotProfile } from "@/lib/paper-bot-profiles";
import useAccountReport from "./useAccountReport";
import usePaperBotLedgers from "./usePaperBotLedgers";
import styles from "./PaperTradingLab.module.css";

const money = (value: number | null) => value == null ? "Awaiting data" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
const percent = (value: number | null) => value == null ? "Awaiting data" : `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;

function maxDrawdown(history: Array<{ time: string; equity: number }>) {
  if (history.length < 2) return null;
  let peak = history[0].equity;
  let worst = 0;
  for (const point of history) {
    peak = Math.max(peak, point.equity);
    if (peak > 0) worst = Math.min(worst, (point.equity / peak - 1) * 100);
  }
  return worst;
}

function BotCard({ profile, currentEquity, drawdown, positions }: {
  profile: PaperBotProfile;
  currentEquity: number | null;
  drawdown: number | null;
  positions: number | null;
}) {
  const active = profile.status === "active";
  const returnPct = active && currentEquity !== null
    ? (currentEquity / profile.challengeStartingCash - 1) * 100
    : null;

  return <article className={styles.botCard}>
    <div className={styles.botCardHeader}>
      <div>
        <span className={active ? styles.botStatusActive : styles.botStatusPlanned}>{active ? "ACTIVE" : "PLANNED"}</span>
        <h2>{profile.name}</h2>
      </div>
      <strong className={styles.botCapital}>{money(profile.challengeStartingCash)}</strong>
    </div>

    <p>{profile.style}</p>

    <div className={styles.botMetrics}>
      <div><span>Current equity</span><strong>{active ? money(currentEquity) : money(profile.challengeStartingCash)}</strong></div>
      <div><span>Total return</span><strong>{active ? percent(returnPct) : "Not started"}</strong></div>
      <div><span>Max drawdown</span><strong>{active ? percent(drawdown) : "Not started"}</strong></div>
      <div><span>Open positions</span><strong>{active ? positions ?? "Awaiting data" : "0"}</strong></div>
    </div>

    <div className={styles.botRuleGrid}>
      <div><span>Universe</span><strong>{profile.universe.assetClasses.join(" · ")}</strong><small>{profile.universe.description}</small></div>
      <div><span>Cadence</span><strong>{profile.cadence.intradayOnly ? "Intraday only" : profile.cadence.swingOnly ? "Swing only" : "Opportunity driven"}</strong><small>{profile.cadence.description}</small></div>
      <div><span>Strategy</span><strong>{profile.strategyId ?? "Separate strategy pending"}</strong><small>{active ? "Current decision engine" : "Disabled until explicitly designed and validated"}</small></div>
      <div><span>Ledger</span><strong>Isolated</strong><small>No shared positions, P/L, buying power, or risk budget.</small></div>
    </div>

    <ul className={styles.botNotes}>{profile.notes.map(note => <li key={note}>{note}</li>)}</ul>
    {active ? <Link className={styles.botLink} href="/paper-trading">Open live bot report →</Link> : <span className={styles.botDisabled}>Execution disabled</span>}
  </article>;
}

export default function PaperBotLab() {
  const { report: accountReport, error: accountError, refresh: refreshAccount } = useAccountReport();
  const { report: ledgerReport, error: ledgerError, refresh: refreshLedgers } = usePaperBotLedgers();
  const defaultProfile = PAPER_BOT_PROFILES.find(profile => profile.id === "default-diverse")!;
  const defaultLedger = ledgerReport?.bots.find(bot => bot.botId === defaultProfile.id) ?? null;
  const equity = defaultLedger?.equity ?? defaultProfile.challengeStartingCash;
  const drawdown = maxDrawdown(ledgerReport?.history[defaultProfile.id] ?? []);
  const positions = defaultLedger?.positionCount ?? 0;
  const brokerEquity = accountReport?.snapshot?.account.equity ?? null;

  return <main className={styles.botLab}>
    <header className={styles.botLabHeader}>
      <div>
        <Link href="/paper-trading">← Paper Trading Lab</Link>
        <h1>Bot Lab</h1>
        <p>Every strategy challenge starts with an isolated $100 virtual bankroll. Alpaca paper trading remains the shared execution sandbox and audit trail.</p>
      </div>
      <div className={styles.botLabActions}>
        <button onClick={() => { refreshLedgers(); refreshAccount(); }}>Refresh</button>
      </div>
    </header>

    <section className={styles.botOverview}>
      <div><span>Challenge baseline</span><strong>$100 each</strong></div>
      <div><span>Profiles</span><strong>{PAPER_BOT_PROFILES.length}</strong></div>
      <div><span>Default Diverse equity</span><strong>{money(equity)}</strong></div>
      <div><span>Alpaca paper balance</span><strong>{money(brokerEquity)}</strong></div>
    </section>

    <p className={styles.meta}>The Alpaca balance is not bot buying power. Only bot-attributed paper fills may change a challenge ledger.</p>
    {ledgerError ? <p role="status" className={styles.error}>Bot ledger: {ledgerError}</p> : null}
    {accountError ? <p role="status" className={styles.error}>Alpaca audit feed: {accountError}</p> : null}

    <section className={styles.botGrid}>
      {PAPER_BOT_PROFILES.map(profile => <BotCard
        key={profile.id}
        profile={profile}
        currentEquity={profile.id === defaultProfile.id ? equity : null}
        drawdown={profile.id === defaultProfile.id ? drawdown : null}
        positions={profile.id === defaultProfile.id ? positions : null}
      />)}
    </section>

    <section className={styles.botCompare}>
      <div className={styles.cardHeader}>
        <div><h2>Common comparison board</h2><p>All bots will be measured using the same scorecard once they have real paper results.</p></div>
      </div>
      <div className={styles.botTableWrap}>
        <table>
          <thead><tr><th>Metric</th>{PAPER_BOT_PROFILES.map(profile => <th key={profile.id}>{profile.name}</th>)}</tr></thead>
          <tbody>
            <tr><td>Status</td>{PAPER_BOT_PROFILES.map(profile => <td key={profile.id}>{profile.status}</td>)}</tr>
            <tr><td>Starting capital</td>{PAPER_BOT_PROFILES.map(profile => <td key={profile.id}>{money(profile.challengeStartingCash)}</td>)}</tr>
            <tr><td>Current equity</td>{PAPER_BOT_PROFILES.map(profile => <td key={profile.id}>{profile.id === defaultProfile.id ? money(equity) : "Not started"}</td>)}</tr>
            <tr><td>Total return</td>{PAPER_BOT_PROFILES.map(profile => <td key={profile.id}>{profile.id === defaultProfile.id && equity !== null ? percent((equity / profile.challengeStartingCash - 1) * 100) : "Not started"}</td>)}</tr>
            <tr><td>Max drawdown</td>{PAPER_BOT_PROFILES.map(profile => <td key={profile.id}>{profile.id === defaultProfile.id ? percent(drawdown) : "Not started"}</td>)}</tr>
            <tr><td>Expectancy / avg R</td>{PAPER_BOT_PROFILES.map(profile => <td key={profile.id}>Awaiting journal</td>)}</tr>
            <tr><td>Profit factor</td>{PAPER_BOT_PROFILES.map(profile => <td key={profile.id}>Awaiting journal</td>)}</tr>
            <tr><td>MFE / MAE</td>{PAPER_BOT_PROFILES.map(profile => <td key={profile.id}>Awaiting journal</td>)}</tr>
            <tr><td>Kill-switch events</td>{PAPER_BOT_PROFILES.map(profile => <td key={profile.id}>Awaiting risk log</td>)}</tr>
          </tbody>
        </table>
      </div>
      <p className={styles.meta}>All challenges use the same $100 baseline. No ranking is shown yet because only one bot is active and no bot-attributed trade sample exists yet.</p>
    </section>
  </main>;
}
