"use client";

import Link from "next/link";
import { PAPER_BOT_PROFILES, type PaperBotProfile } from "@/lib/paper-bot-profiles";
import useAccountReport from "./useAccountReport";
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
  const { report, error, refresh } = useAccountReport();
  const equity = report?.snapshot?.account.equity ?? null;
  const drawdown = report ? maxDrawdown(report.history) : null;
  const positions = report?.snapshot?.positions?.length ?? null;
  const defaultProfile = PAPER_BOT_PROFILES.find(profile => profile.id === "default-diverse")!;

  return <main className={styles.botLab}>
    <header className={styles.botLabHeader}>
      <div>
        <Link href="/paper-trading">← Paper Trading Lab</Link>
        <h1>Bot Lab</h1>
        <p>Run isolated paper strategies side by side and compare what actually works without mixing capital or risk.</p>
      </div>
      <div className={styles.botLabActions}>
        <button onClick={refresh}>Refresh live bot</button>
      </div>
    </header>

    <section className={styles.botOverview}>
      <div><span>Profiles</span><strong>{PAPER_BOT_PROFILES.length}</strong></div>
      <div><span>Active</span><strong>{PAPER_BOT_PROFILES.filter(profile => profile.status === "active").length}</strong></div>
      <div><span>Planned</span><strong>{PAPER_BOT_PROFILES.filter(profile => profile.status === "planned").length}</strong></div>
      <div><span>Live default equity</span><strong>{money(equity)}</strong></div>
    </section>

    {error ? <p role="status" className={styles.error}>Live Default Diverse data: {error}</p> : null}

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
      <p className={styles.meta}>No ranking is shown yet because only one bot is active and trade-journal metrics are not persisted yet. Planned bots remain completely disabled.</p>
    </section>
  </main>;
}
