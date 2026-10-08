import type { Metadata } from "next";
import Link from "next/link";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { flashDecisionClassification, flashEvidenceCounts, type FlashDecisionEvidence } from "@/lib/paper-flash-audit";
import shared from "../page.module.css";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Flash Forensic Audit | CreatorHub",
  description: "Decision-time evidence for Flash's paper-only counterfactual studies.",
};

const BOT_ID = "weekend-crypto-day-100";
type Shadow = {
  id: number; setup_key: string; symbol: string; decision_at: string;
  strategy_id: string | null; strategy_version: number | null;
  source_event_type: string; decision_state: string | null;
  score: number | string | null; status: string; first_outcome: string | null;
  trigger_price: number | string; max_entry_price: number | string;
  protective_stop: number | string; planned_take_profit: number | string | null;
  assumed_entry_price: number | string | null; one_r_price: number | string | null;
  two_r_price: number | string | null; triggered_at: string | null;
  stop_hit_at: string | null; one_r_hit_at: string | null; two_r_hit_at: string | null;
  mfe_r: number | string | null; mae_r: number | string | null;
  warnings: unknown; blockers: unknown; metadata: Record<string, unknown> | null;
};
type Journal = FlashDecisionEvidence & {
  id: number; symbol: string; occurred_at: string; event_type: string;
  qualification: string | null; market_snapshot: Record<string, unknown> | null;
  risk_plan: Record<string, unknown> | null;
};
type Audit = {
  strategy_id: string; strategy_version: number;
  starting_cash: number | string; cash: number | string; equity: number | string;
  realized_pl: number | string; execution_enabled: boolean | null;
  candidate_checks_7d: number | string; rejections_7d: number | string;
  authorizations_7d: number | string; broker_buy_orders: number | string;
  filled_buy_orders: number | string; closed_trades: number | string;
};
const n = (value: unknown) => value == null || !Number.isFinite(Number(value)) ? null : Number(value);
const fixed = (value: unknown, precision = 4) => {
  const x = n(value); return x == null ? "Not recorded" : x.toLocaleString("en-US", {maximumFractionDigits:precision});
};
const money = (value: unknown) => {
  const x = n(value); return x == null ? "Not recorded" : "$" + x.toFixed(2);
};
const date = (value: string | null | undefined) => value
  ? new Intl.DateTimeFormat("en-US", {
    timeZone:"America/Chicago", month:"short",day:"numeric",year:"numeric",
    hour:"numeric",minute:"2-digit",timeZoneName:"short",
  }).format(new Date(value)) : "Not recorded";
const strings = (value: unknown) => Array.isArray(value) ? value.filter((x): x is string => typeof x === "string") : [];
const valueOrEmpty = (value: unknown) => value == null ? "Not recorded" : String(value);
function matchDecision(shadow: Shadow, journal: Journal[]) {
  const at = Date.parse(shadow.decision_at);
  return journal.find(j => j.symbol === shadow.symbol &&
    ["candidate","rejected"].includes(j.event_type) &&
    Math.abs(Date.parse(j.occurred_at) - at) < 1500) ?? null;
}

export default async function FlashAuditPage() {
  let shadows: Shadow[] = [];
  let journal: Journal[] = [];
  let recent: Journal[] = [];
  let audit: Audit | null = null;
  const errors: string[] = [];
  try {
    const db = createAdminSupabaseClient();
    const [shadowsResult, auditResult, recentResult] = await Promise.all([
      db.from("paper_bot_counterfactuals")
        .select("id,setup_key,symbol,decision_at,strategy_id,strategy_version,source_event_type,decision_state,score,status,first_outcome,trigger_price,max_entry_price,protective_stop,planned_take_profit,assumed_entry_price,one_r_price,two_r_price,triggered_at,stop_hit_at,one_r_hit_at,two_r_hit_at,mfe_r,mae_r,warnings,blockers,metadata")
        .eq("bot_id",BOT_ID).order("decision_at",{ascending:false}).limit(200),
      db.from("paper_bot_performance_audit_v1").select("*").eq("bot_id",BOT_ID).maybeSingle(),
      db.from("paper_bot_journal")
        .select("id,symbol,occurred_at,event_type,score,qualification,market_snapshot,risk_plan,warnings,blockers,metadata")
        .eq("bot_id",BOT_ID).order("occurred_at",{ascending:false}).limit(80),
    ]);
    if (shadowsResult.error) errors.push("Counterfactual records are unavailable.");
    else shadows = (shadowsResult.data ?? []) as Shadow[];
    if (auditResult.error) errors.push("Ledger and execution summary are unavailable.");
    else audit = auditResult.data as Audit | null;
    if (recentResult.error) errors.push("Recent decision records are unavailable.");
    else recent = (recentResult.data ?? []) as Journal[];

    const successful = shadows.filter(s => s.status === "completed" && s.first_outcome === "two-r-before-stop");
    const timestamps = [...new Set(successful.map(s => s.decision_at))];
    if (timestamps.length) {
      const matching = await db.from("paper_bot_journal")
        .select("id,symbol,occurred_at,event_type,score,qualification,market_snapshot,risk_plan,warnings,blockers,metadata")
        .eq("bot_id",BOT_ID).in("occurred_at",timestamps).limit(150);
      if (matching.error) errors.push("Contemporaneous journal matching is unavailable; case classifications remain unresolved.");
      else journal = (matching.data ?? []) as Journal[];
    }
  } catch {
    errors.push("Flash audit could not load its private server-side evidence.");
  }
  const studies = flashEvidenceCounts(shadows);
  const successes = shadows.filter(s => s.status === "completed" && s.first_outcome === "two-r-before-stop")
    .sort((a,b) => Date.parse(a.decision_at)-Date.parse(b.decision_at));
  const assessments = successes.map(shadow => {
    const decision = matchDecision(shadow,journal);
    return {shadow,decision,classification:flashDecisionClassification(shadow,decision)};
  });
  const verified = assessments.filter(item => item.classification.verifiedMissedTrade).length;
  const recentExecution = recent.filter(j => j.metadata?.executionEligible === true).slice(0,20);

  return <main className={shared.page}>
    <header className={shared.header}>
      <div>
        <Link className={shared.back} href="/paper-trading/bots/performance">← All bots Performance Audit</Link>
        <h1>Flash · Decision Forensics</h1>
        <p>Original qualification evidence versus later hypothetical outcomes. PAPER execution only.</p>
        <span className={shared.asof}>Read-only live Supabase snapshot · timestamps in America/Chicago</span>
      </div>
      <div className={shared.headerLinks}><Link href={"/paper-trading/bots/" + BOT_ID}>Flash profile →</Link></div>
    </header>

    {errors.map(message => <p role="alert" className={shared.error} key={message}>{message}</p>)}
    <div className={shared.metrics}>
      <article><span>Candidate checks · 7d</span><strong>{audit ? fixed(audit.candidate_checks_7d,0) : "—"}</strong><small>Repeated observations, not unique trades</small></article>
      <article><span>Historical +2R scenarios</span><strong>{studies.twoR}</strong><small>Hypothetical candle outcomes</small></article>
      <article><span>Verified missed executable trades</span><strong>{verified}</strong><small>Among case records assessed below; never inferred from +2R alone</small></article>
      <article><span>Actual realized PAPER P/L</span><strong>{audit ? money(audit.realized_pl) : "—"}</strong><small>Realized results from isolated virtual ledger only</small></article>
    </div>

    <section className={shared.section}>
      <h2>Execution and study totals</h2>
      <div className={styles.dataGrid}>
        <div><span>Strategy</span><strong>{audit ? audit.strategy_id + " · v" + audit.strategy_version : "Unavailable"}</strong></div>
        <div><span>Virtual cash / equity</span><strong>{audit ? money(audit.cash) + " / " + money(audit.equity) : "Unavailable"}</strong></div>
        <div><span>Paper execution permission</span><strong>{audit?.execution_enabled === true ? "Enabled, qualification-gated" : "Disabled or unknown"}</strong></div>
        <div><span>Authorized / broker buys / filled / closed</span><strong>{audit ? [audit.authorizations_7d,audit.broker_buy_orders,audit.filled_buy_orders,audit.closed_trades].map(x=>fixed(x,0)).join(" / ") : "Unavailable"}</strong></div>
        <div><span>Tracked setup keys</span><strong>{studies.trackedSetupKeys}</strong></div>
        <div><span>Settled scenarios: +2R / stop before +1R / stop after +1R</span><strong>{studies.twoR} / {studies.stopBeforeOneR} / {studies.stopAfterOneR}</strong></div>
      </div>
      <p className={shared.explanation}>Tracked setup keys describe only scenarios stored by the counterfactual engine. They are not a verified count of distinct market opportunities. The v5 five-percent projected goal is separate from the +2R risk checkpoint. Fees, slippage and actual fill feasibility are NOT proven by an OHLC candle crossing +2R.</p>
    </section>

    <section className={shared.section}>
      <div className={shared.sectionHeader}><h2>Individual +2R hypotheses</h2><span>{successes.length} recorded · inspect each decision</span></div>
      {assessments.map(({shadow,decision,classification}) => {
        const snapshot = decision?.market_snapshot ?? {};
        const risk = decision?.risk_plan ?? {};
        const warnings = strings(decision?.warnings ?? shadow.warnings);
        const blockers = strings(decision?.blockers ?? shadow.blockers);
        return <details className={styles.case} key={shadow.id} id={"case-" + shadow.id}>
          <summary><span><strong>Case #{shadow.id} · {shadow.symbol}</strong><small>{date(shadow.decision_at)} · {shadow.strategy_id} · score {fixed(decision?.score ?? shadow.score,0)}</small></span><span className={styles.caseStatus}>{classification.label}</span></summary>
          <div className={styles.caseContent}>
            <p className={shared.explanation}>{classification.reason}</p>
            <div className={styles.dataGrid}>
              <div><span>Actual decision / qualification</span><strong>{valueOrEmpty(decision?.metadata?.state ?? shadow.decision_state)} / {valueOrEmpty(decision?.qualification)}</strong></div>
              <div><span>Selected / execution enabled</span><strong>{String(decision?.metadata?.selectedForSubmission === true)} / {String(decision?.metadata?.executionEnabled === true)}</strong></div>
              <div><span>Decision-time bid / ask</span><strong>{fixed(snapshot.bid,6)} / {fixed(snapshot.ask,6)}</strong></div>
              <div><span>Spread / quote age</span><strong>{fixed(snapshot.spreadPct,3)}% / {fixed(snapshot.quoteAgeSeconds,1)}s</strong></div>
              <div><span>Trigger / max permitted entry</span><strong>{fixed(shadow.trigger_price,6)} / {fixed(shadow.max_entry_price,6)}</strong></div>
              <div><span>Protective stop / projected goal</span><strong>{fixed(shadow.protective_stop,6)} / {fixed(shadow.planned_take_profit,6)}</strong></div>
              <div><span>Planned notional / risk</span><strong>{money(risk.plannedNotional)} / {money(risk.plannedRiskDollars)}</strong></div>
              <div><span>Fee estimate / fee coverage</span><strong>{money(risk.estimatedRoundTripFees)} / {fixed(risk.feeCoverageMultiple,2)}×</strong></div>
              <div><span>Hypothetical entry / +1R / +2R</span><strong>{fixed(shadow.assumed_entry_price,6)} / {fixed(shadow.one_r_price,6)} / {fixed(shadow.two_r_price,6)}</strong></div>
              <div><span>Hypothetical trigger / +2R observation</span><strong>{date(shadow.triggered_at)} / {date(shadow.two_r_hit_at)}</strong></div>
              <div><span>Recorded MFE / MAE</span><strong>{fixed(shadow.mfe_r,2)}R / {fixed(shadow.mae_r,2)}R</strong></div>
              <div><span>Actual broker order</span><strong>Not authorized at original decision</strong></div>
            </div>
            <div className={styles.evidence}>
              <strong>Entry checks not met at the original decision</strong>
              {warnings.length || blockers.length
                ? <ul>{[...blockers,...warnings].map((reason,i)=><li key={i}>{reason}</li>)}</ul>
                : <p>No decision-time reasons available; do not infer that the entry was valid.</p>}
            </div>
            <p className={styles.disclaimer}>The +2R event is a historical candle-based hypothesis, not an observed executable buy/sell. Intrabar order sequence, tradeable ask/bid, queue/partial fills, fee impact and live fill feasibility remain unverified. This record is not credited to equity or realized P/L.</p>
          </div>
        </details>;
      })}
      {!successes.length && <p className={shared.explanation}>No settled +2R cases returned in the current evidence window.</p>}
    </section>

    <section className={shared.section}>
      <div className={shared.sectionHeader}><h2>Recent execution-tier decisions</h2><span>Latest available sample; not a complete historical opportunity list</span></div>
      <div className={shared.tableWrap}><table><thead><tr><th>Time</th><th>Symbol</th><th>Score</th><th>Actual state</th><th>Primary reason</th></tr></thead><tbody>
        {recentExecution.map(j=><tr key={j.id}><td>{date(j.occurred_at)}</td><td>{j.symbol}</td><td>{fixed(j.score,0)}</td><td>{valueOrEmpty(j.metadata?.state)}</td><td>{strings(j.blockers)[0] ?? strings(j.warnings)[0] ?? "No reason recorded"}</td></tr>)}
        {!recentExecution.length && <tr><td colSpan={5}>No recent execution-tier decision records returned.</td></tr>}
      </tbody></table></div>
      <p className={shared.explanation}>A journal label of “qualified” can reflect score ≥80 while the actual candidate remains waiting. Only a decision with state ready, selection for submission, and passing venue/risk revalidation can authorize a PAPER order.</p>
    </section>
  </main>;
}
