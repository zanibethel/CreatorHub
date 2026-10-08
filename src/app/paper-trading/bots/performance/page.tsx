import type { Metadata } from "next";
import type { CSSProperties } from "react";
import Link from "next/link";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { PAPER_BOT_PROFILES } from "@/lib/paper-bot-profiles";
import { BotMascot, BOT_COLORS } from "@/components/BotMascot";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Bot Performance Audit | CreatorHub",
  description: "Read-only, evidence-labeled audit of trading bot decisions, fills, rejections, and counterfactual outcomes.",
};

type AuditRow = {
  bot_id: string; display_name: string; status: string; execution_enabled: boolean | null;
  starting_cash: number | string; equity: number | string; realized_pl: number | string;
  last_synced_at: string | null; latest_journal_at: string | null; latest_candidate_at: string | null;
  events_24h: number | string; events_7d: number | string;
  candidate_checks_24h: number | string; candidate_checks_7d: number | string;
  rejections_7d: number | string; authorizations_7d: number | string; system_checks_7d: number | string;
  distinct_symbols_24h: number | string; distinct_symbols_7d: number | string;
  current_assigned: number | string; current_suggested: number | string; current_review_ready: number | string;
  staged_buy_orders: number | string; expired_buy_orders: number | string; prepared_buy_orders: number | string;
  broker_buy_orders: number | string; filled_buy_orders: number | string; unfilled_buy_orders: number | string;
  closed_trades: number | string; winning_trades: number | string; losing_trades: number | string;
  open_trade_metrics: number | string; latest_closed_at: string | null;
  completed_shadow_scenarios: number | string; shadow_2r_before_stop: number | string;
  shadow_stop_before_1r: number | string; shadow_stop_after_1r: number | string;
  unsettled_shadow_scenarios: number | string; superseded_shadow_scenarios: number | string;
};
type ShadowExample = {
  bot_id: string; symbol: string; source_event_type: string;
  decision_state: string | null; decision_at: string;
  first_outcome: string | null; score: number | string | null;
  mfe_r: number | string | null; mae_r: number | string | null;
};
type TradeExample = { bot_id: string; symbol: string; opened_at: string; closed_at: string | null;
  status: string; realized_pl: number | string | null; r_multiple: number | string | null; exit_reason: string | null;
};
type FuseObservation = {readiness: string; evaluated_at: string};
type AtlasJournal = {id:number;symbol:string|null;event_type:string;occurred_at:string;score:number|string|null;
  qualification:string|null;component_scores:Record<string,unknown>;blockers:string[];
  market_snapshot:Record<string,unknown>;risk_plan:Record<string,unknown>;metadata:Record<string,unknown>};
const number = (value: number | string | null | undefined) => Number.isFinite(Number(value)) ? Number(value) : 0;
const count = (value: number | string | null | undefined) => number(value).toLocaleString("en-US");
const dollars = (value: number | string | null | undefined) =>
  new Intl.NumberFormat("en-US", {style: "currency", currency: "USD"}).format(number(value));
const central = (value: string | null | undefined) =>
  value ? new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(value)) : "Not recorded";
const profileName = (id: string) => PAPER_BOT_PROFILES.find(p => p.id === id)?.codename ?? id;
const signal = (row: AuditRow, fuse: FuseObservation[]) => {
  if (row.bot_id === "momentum-breakout-100" && number(row.current_assigned) === 0 &&
    number(row.current_suggested) > 0) return {label:"Pulse assignment mismatch",detail:"Current scanner suggestions include Pulse, but no matching assignments are stored. Investigate scanner-to-bot routing."};
  if (row.bot_id === "momentum-breakout-100" && number(row.current_assigned) === 0 &&
    number(row.system_checks_7d) > 0) return {label:"No currently assigned Pulse setup",detail:"Automated Pulse checks are running. No current scanner record assigns a qualifying stock; inspect Pulse's timestamped handoff diagnostics before treating this as a defect."};
  if (row.bot_id === "default-diverse" && number(row.filled_buy_orders) > 0 &&
    number(row.candidate_checks_7d) === 0) return {label:"Decision history incomplete",detail:"Atlas has a recorded fill but no candidate-decision journal entries in the seven-day window."};
  if (row.bot_id === "penny-volatility-day-100" && fuse.length > 0) return {
    label:"Dedicated research logging",
    detail:`${fuse.length} recent Fuse research checks · ${fuse.filter(x => x.readiness === "rejected").length} rejected. These are separate from the main journal.`,
  };
  if (number(row.shadow_2r_before_stop) > 0) return {
    label:"Review shadow +2R cases", detail:"Some hypothetical candidate/waiting setups reached +2R; this does not prove a missed executable trade.",
  };
  if (number(row.completed_shadow_scenarios) > 0) return {
    label:"Shadow outcomes available",detail:"Hypothetical outcomes are recorded separately from actual trades and fills.",
  };
  if (number(row.expired_buy_orders) > 0) return {
    label:"Prepared orders expired",detail:"Inspect stage timing and expired opportunities before changing any gate.",
  };
  if (number(row.candidate_checks_7d) > 0) return {
    label:row.execution_enabled === false ? "Research only" : "Candidate logging active",
    detail:"Repeat evaluations are being recorded; not every check represents a unique eligible opportunity.",
  };
  return {label:"Limited decision evidence",detail:"No candidate-decision journal entries in this window. This is not proof the scanner is offline."};
};

export default async function BotPerformanceAuditPage() {
  const capturedAt = new Date().toISOString();
  let rows: AuditRow[] = [];
  let trades: TradeExample[] = [];
  let shadows: ShadowExample[] = [];
  let fuse: FuseObservation[] = [];
  let atlasEvaluations: AtlasJournal[] = [];
  let atlasScannerEvents: AtlasJournal[] = [];
  const errors: string[] = [];
  try {
    const db = createAdminSupabaseClient();
    const lookback = new Date(Date.now() - 7 * 86400_000).toISOString();
    const [auditResult, tradeResult, shadowResult, fuseResult, atlasResult, atlasScannerResult] = await Promise.all([
      db.from("paper_bot_performance_audit_v1").select("*").order("bot_id"),
      db.from("paper_bot_trade_metrics").select("bot_id,symbol,opened_at,closed_at,status,realized_pl,r_multiple,exit_reason")
        .order("opened_at",{ascending:false}).limit(18),
      db.from("paper_bot_counterfactuals").select("bot_id,symbol,source_event_type,decision_state,decision_at,first_outcome,score,mfe_r,mae_r")
        .eq("status","completed").in("first_outcome",["two-r-before-stop","stop-before-one-r","stop-after-one-r"])
        .order("decision_at",{ascending:false}).limit(18),
      db.from("paper_fuse_observations").select("readiness,evaluated_at").gte("evaluated_at",lookback)
        .order("evaluated_at",{ascending:false}).limit(500),
      db.from("paper_bot_journal").select("id,symbol,event_type,occurred_at,score,qualification,component_scores,blockers,market_snapshot,risk_plan,metadata")
        .eq("bot_id","default-diverse").eq("event_type","candidate").order("occurred_at",{ascending:false}).limit(30),
      db.from("paper_bot_journal").select("id,symbol,event_type,occurred_at,score,qualification,component_scores,blockers,market_snapshot,risk_plan,metadata")
        .eq("bot_id","default-diverse").in("event_type",["scanner_observed","scanner_assigned"]).order("occurred_at",{ascending:false}).limit(40),

    ]);
    if (auditResult.error) errors.push("Performance summary unavailable.");
    else rows = auditResult.data as AuditRow[] ?? [];
    if (tradeResult.error) errors.push("Trade detail temporarily unavailable.");
    else trades = tradeResult.data as TradeExample[] ?? [];
    if (shadowResult.error) errors.push("Counterfactual detail temporarily unavailable.");
    else shadows = shadowResult.data as ShadowExample[] ?? [];
    if (fuseResult.error) errors.push("Fuse research detail temporarily unavailable.");
    else fuse = fuseResult.data as FuseObservation[] ?? [];
    if (atlasResult.error) errors.push("Atlas strategy evidence temporarily unavailable.");
    else atlasEvaluations = atlasResult.data as AtlasJournal[] ?? [];
    if (atlasScannerResult.error) errors.push("Atlas scanner attribution temporarily unavailable.");
    else atlasScannerEvents = atlasScannerResult.data as AtlasJournal[] ?? [];

  } catch {
    errors.push("Audit storage is temporarily unavailable.");
  }
  const ordered = [...rows].sort((a,b) =>
    PAPER_BOT_PROFILES.findIndex(x=>x.id===a.bot_id)-PAPER_BOT_PROFILES.findIndex(x=>x.id===b.bot_id));
  const total = (key: keyof AuditRow) => rows.reduce((sum,row) => sum + number(row[key] as number | string | null),0);
  const closed = total("closed_trades");
  const wins = total("winning_trades");
  const checkCount = total("candidate_checks_7d");
  const settled = total("completed_shadow_scenarios");
  return <main className={styles.page}>
    <header className={styles.header}>
      <div>
        <Link href="/paper-trading/bots" className={styles.back}>← Bot Lab</Link>
        <h1>Bot Performance Audit</h1>
        <p>Actual trades, repeated scanner decisions and hypothetical outcomes — reported separately.</p>
        <span className={styles.asof}>Snapshot {central(capturedAt)} · rolling 7-day decision window</span>
      </div>
      <div className={styles.headerLinks}>
        <Link href="/paper-trading/signals">Signal Desk →</Link>
        <Link href="/paper-trading/historical-patterns">Catalog research →</Link>
        <Link href="/paper-trading/movers">Midas research →</Link>
      </div>
    </header>
    <section id="atlas-decisions" className={styles.section}>
      <div className={styles.sectionHeader}><h2>Atlas · decision evidence trail</h2><span>Read-only evaluation · never order authorization</span></div>
      <p className={styles.explanation}>Scanner observations and suggestions are source evidence, NOT Atlas strategy approval. Atlas&apos;s scheduled engine evaluations below use persisted watchlist candidates only, and do not submit orders. A symbol/day key groups repeated checks; it does not identify separate executable trade opportunities.</p>
      <div className={styles.metrics}>
        <article><span>Recent strategy evaluations</span><strong>{count(atlasEvaluations.length)}</strong><small>Newest 30 decisions · five-minute deduplication</small></article>
        <article><span>Blocked / not eligible</span><strong>{count(atlasEvaluations.filter(e=>e.blockers?.length).length)}</strong><small>Includes pool-capacity authorization veto</small></article>
        <article><span>Recent scanner observations</span><strong>{count(atlasScannerEvents.filter(e=>e.event_type==="scanner_observed").length)}</strong><small>Newest 40 scanner journal events</small></article>
        <article><span>Scanner suggestions</span><strong>{count(atlasScannerEvents.filter(e=>e.event_type==="scanner_assigned").length)}</strong><small>Not orders or strategy approvals</small></article>
      </div>
      <div className={styles.tableWrap}><table><thead><tr><th>Recorded (CT)</th><th>Symbol</th><th>Atlas score</th><th>Qualification</th><th>Blockers</th><th>Full trace</th></tr></thead><tbody>
      {atlasEvaluations.slice(0,16).map(e=><tr key={e.id}><td>{central(e.occurred_at)}</td><td>{e.symbol}</td>
        <td>{e.score==null?"—":Number(e.score).toFixed(1)}</td><td>{e.qualification??"Unavailable"}</td>
        <td>{e.blockers?.length??0}</td><td><details><summary>Evidence</summary><pre style={{whiteSpace:"pre-wrap",maxWidth:440,overflowWrap:"anywhere"}}>{JSON.stringify({id:e.metadata?.decisionId,correlationId:e.metadata?.correlationId,source:e.metadata?.source,components:e.component_scores,blockers:e.blockers,market:e.market_snapshot,risk:e.risk_plan,provenance:e.metadata?.inputProvenance},null,2)}</pre></details></td>
      </tr>)}
      {!atlasEvaluations.length?<tr><td colSpan={6}>No Atlas engine evaluation recorded yet. Scanner events alone cannot establish strategy decisions.</td></tr>:null}
      </tbody></table></div>
      <p className={styles.explanation}>Historical SOL/USD execution has a broker-attributed fill and exit, but no recoverable originating candidate decision. No historical evaluation has been invented or backdated.</p>
    </section>
    {errors.map(error=><p className={styles.error} key={error} role="alert">{error}</p>)}
    {!rows.length?<section className={styles.empty}><h2>No audit summary available</h2><p>The read-only audit view has not returned any portfolios. No trading settings were changed.</p></section>:<>
      <div className={styles.metrics}>
        <article><span>Completed simulated trades</span><strong>{count(closed)}</strong><small>Real broker-attributed virtual trades</small></article>
        <article><span>Closed winners</span><strong>{closed ? `${wins}/${closed}` : "—"}</strong><small>{closed ? "Small sample; not a reliable win rate" : "No closed trades to assess"}</small></article>
        <article><span>Seven-day candidate checks</span><strong>{count(checkCount)}</strong><small>Repeated scans, not independent opportunities</small></article>
        <article><span>Completed shadow scenarios</span><strong>{count(settled)}</strong><small>{count(total("shadow_2r_before_stop"))} hit hypothetical +2R before stop</small></article>
      </div>
      <section className={styles.section}>
        <div className={styles.sectionHeader}><h2>Trading bots · evidence by strategy</h2><span>Virtual funds only</span></div>
        <div className={styles.botGrid}>{ordered.map(row=>{
          const name=profileName(row.bot_id);
          const accent=BOT_COLORS[row.bot_id]??"#66d5ec";
          const note=signal(row,fuse);
          const closedCount=number(row.closed_trades);
          const winCount=number(row.winning_trades);
          return <article className={styles.botCard} key={row.bot_id} style={{"--bot-accent":accent} as CSSProperties}>
            <div className={styles.botTop}>
              <BotMascot botId={row.bot_id} size="switcher"/>
              <div><h3><Link href={`/paper-trading/bots/${row.bot_id}`}>{name}</Link></h3>
                <span>{row.execution_enabled === true?"Simulated execution enabled":row.execution_enabled === false?"Research / execution disabled":"Execution permission not recorded"}</span>
              </div>
              <strong className={styles.equity}>{dollars(row.equity)}</strong>
            </div>
            <div className={styles.botMetrics}>
              <div><span>Candidate checks · 7d</span><strong>{count(row.candidate_checks_7d)}</strong></div>
              <div><span>Symbols evaluated · 7d</span><strong>{count(row.distinct_symbols_7d)}</strong></div>
              <div><span>Rejected events · 7d</span><strong>{count(row.rejections_7d)}</strong></div>
              <div><span>Currently assigned</span><strong>{count(row.current_assigned)}</strong></div>
              <div><span>Filled entry orders</span><strong>{count(row.filled_buy_orders)}</strong></div>
              <div><span>Closed trades · wins</span><strong>{closedCount} · {closedCount?winCount:"—"}</strong></div>
              <div><span>Realized virtual P/L</span><strong className={number(row.realized_pl)<0?styles.loss:styles.gain}>{dollars(row.realized_pl)}</strong></div>
              <div><span>Shadow +2R / settled</span><strong>{count(row.shadow_2r_before_stop)} / {count(row.completed_shadow_scenarios)}</strong></div>
            </div>
            <div className={styles.diagnostic}><strong>{note.label}</strong><p>{note.detail}</p></div>
            {row.bot_id === "weekend-crypto-day-100" && <Link className={styles.back} href="/paper-trading/bots/performance/flash">Inspect Flash decision-time evidence and +2R scenarios →</Link>}
            <div className={styles.timestamps}><span>Last decision: {central(row.latest_journal_at)}</span><span>Last candidate: {central(row.latest_candidate_at)}</span></div>
          </article>;
        })}</div>
      </section>
      <section className={styles.section}>
        <div className={styles.sectionHeader}><h2>Recent completed virtual trades</h2><span>Executed results · not hypothetical</span></div>
        <div className={styles.tableWrap}><table><thead><tr><th>Bot</th><th>Asset</th><th>Opened</th><th>Closed</th><th>Realized P/L</th><th>R multiple</th></tr></thead><tbody>
        {trades.filter(t=>t.status==="closed").map((t,i)=><tr key={`${t.bot_id}-${t.symbol}-${t.opened_at}-${i}`}>
          <td>{profileName(t.bot_id)}</td><td>{t.symbol}</td><td>{central(t.opened_at)}</td><td>{central(t.closed_at)}</td>
          <td className={number(t.realized_pl)<0?styles.loss:styles.gain}>{dollars(t.realized_pl)}</td>
          <td>{t.r_multiple==null?"—":number(t.r_multiple).toFixed(2)+"R"}</td>
        </tr>)}
        {!trades.some(t=>t.status==="closed")?<tr><td colSpan={6}>No completed trade detail recorded.</td></tr>:null}
        </tbody></table></div>
      </section>
      <section className={styles.section}>
        <div className={styles.sectionHeader}><h2>Counterfactual outcomes</h2><span>Research only · zero broker executions implied</span></div>
        <p className={styles.explanation}>These results evaluate hypothetical entry and stop scenarios after an observed bot decision. A +2R result does not establish that the bot could or should have traded it, and it is not a proven missed profit. The decision states below identify waiting/unconfirmed candidates.</p>
        <div className={styles.tableWrap}><table><thead><tr><th>Bot</th><th>Symbol</th><th>Decision</th><th>Outcome</th><th>Recorded</th></tr></thead><tbody>
        {shadows.map((s,i)=><tr key={`${s.bot_id}-${s.symbol}-${s.decision_at}-${i}`}><td>{profileName(s.bot_id)}</td><td>{s.symbol}</td><td>{s.decision_state??"Not recorded"}</td>
          <td>{s.first_outcome === "two-r-before-stop"?"+2R before stop (hypothetical)":s.first_outcome === "stop-before-one-r"?"Stop before +1R":"Stop after +1R"}</td><td>{central(s.decision_at)}</td></tr>)}
        {!shadows.length?<tr><td colSpan={5}>No settled counterfactual detail recorded.</td></tr>:null}
        </tbody></table></div>
      </section>
      <section className={styles.section}>
        <h2>What still cannot be measured reliably</h2>
        <p className={styles.explanation}>There is no verified count of market movers the scanner never detected. Repeated candidate evaluations cannot be divided into a valid trade-conversion rate without stable opportunity IDs. The counterfactual records cover selected observed setups, not all rejected stocks or crypto. A bot with zero fills has unmeasured trading performance, not a 0% win rate.</p>
        <div className={styles.researchLinks}><Link href="/paper-trading/historical-patterns"><BotMascot botId="catalog" size="badge"/> Catalog · Historical patterns</Link><Link href="/paper-trading/movers"><BotMascot botId="midas" size="badge"/> Midas · Market movers</Link></div>
      </section>
    </>}
  </main>;
}
