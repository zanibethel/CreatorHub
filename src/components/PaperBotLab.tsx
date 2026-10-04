"use client";

import Link from "next/link";
import { PAPER_BOT_PROFILES, type PaperBotProfile } from "@/lib/paper-bot-profiles";
import type { PaperBotSummary } from "@/lib/paper-bot-ledger";
import useAccountReport from "./useAccountReport";
import usePaperBotLedgers, { type PaperCounterfactual, type PaperPositionPlan, type PaperTradeMetric, type StagedPaperOrder } from "./usePaperBotLedgers";
import usePaperStrategyReview, { type PaperStrategyReviewBot } from "./usePaperStrategyReview";
import useSwingReadiness from "./useSwingReadiness";
import useWeekendCryptoReadiness from "./useWeekendCryptoReadiness";
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

function ExitManagerRow({ position, metric }: { position: PaperPositionPlan; metric?: PaperTradeMetric }) {
  const manager = position.exit_manager_state;
  const rMultiple = manager.rMultiple;
  return <div>
    <span>{position.symbol}</span>
    <strong>{(manager.plannedAction ?? "hold").replaceAll("_", " ")}{rMultiple !== undefined ? ` · ${rMultiple >= 0 ? "+" : ""}${rMultiple.toFixed(2)}R` : ""}</strong>
    <small>Mark {money(manager.markPrice ?? null)} · stop {money(position.protective_stop)}{manager.desiredStop ? ` · planned stop ${money(manager.desiredStop)}` : ""}</small>
    <small>{manager.reason ?? "Waiting for evaluation."}</small>
    {metric ? <small>MFE {metric.mfe_r >= 0 ? "+" : ""}{metric.mfe_r.toFixed(2)}R · MAE {metric.mae_r >= 0 ? "+" : ""}{metric.mae_r.toFixed(2)}R · {metric.mark_count} marks</small> : null}
  </div>;
}

function StrategyReviewCard({ review }: { review: PaperStrategyReviewBot }) {
  const maturityLabel = review.evidenceMaturity.level.toUpperCase();
  const sampleTarget = review.evidenceMaturity.minimumForRecommendations;
  const topSymbols = review.symbols.filter(item => item.observations || item.closedTrades || item.resolvedCounterfactuals).slice(0, 5);
  const usefulBands = review.scoreBands.filter(item => item.observations || item.resolvedStudies);

  return <article className={styles.botCard}>
    <div className={styles.botCardHeader}>
      <div>
        <span className={review.evidenceMaturity.level === "collecting" ? styles.botStatusPlanned : styles.botStatusActive}>{maturityLabel}</span>
        <h2>{review.displayName}</h2>
      </div>
      <strong className={styles.botCapital}>{review.evidenceMaturity.resolvedOutcomeSamples} outcomes</strong>
    </div>
    <p>{review.strategyId ?? "Strategy pending"}{review.strategyVersion ? ` · v${review.strategyVersion}` : ""}</p>

    <div className={styles.botMetrics}>
      <div><span>Decision observations</span><strong>{review.decisions.executionRelevantObservations} execute · {review.decisions.monitorOnlyObservations} monitor</strong></div>
      <div><span>Closed trades</span><strong>{review.executed.closedTrades}</strong></div>
      <div><span>Average realized R</span><strong>{review.executed.averageR === null ? "—" : `${review.executed.averageR >= 0 ? "+" : ""}${review.executed.averageR.toFixed(2)}R`}</strong></div>
      <div><span>Win rate</span><strong>{review.executed.winRatePct === null ? "—" : `${review.executed.winRatePct.toFixed(0)}%`}</strong></div>
      <div><span>Counterfactual studies</span><strong>{review.counterfactual.total}</strong></div>
      <div><span>Resolved studies</span><strong>{review.counterfactual.analyzable}</strong></div>
    </div>

    <div className={styles.botRuleGrid}>
      <div>
        <span>Counterfactual threshold paths</span>
        <strong>{review.counterfactual.missedOpportunities} reached +2R first · {review.counterfactual.protectiveRejections} hit stop before +1R</strong>
        <small>{review.counterfactual.mixed} mixed · {review.counterfactual.neverTriggered} never triggered · {review.counterfactual.ambiguous} ambiguous</small>
        <small>Counterfactual threshold paths are evidence, not virtual or realized P/L.</small>
      </div>
      <div>
        <span>Execution evidence</span>
        <strong>{money(review.executed.totalRealizedPl)} realized · {money(review.executed.totalEstimatedFees)} estimated fees</strong>
        <small>MFE {review.executed.averageMfeR === null ? "—" : `${review.executed.averageMfeR >= 0 ? "+" : ""}${review.executed.averageMfeR.toFixed(2)}R`} · MAE {review.executed.averageMaeR === null ? "—" : `${review.executed.averageMaeR >= 0 ? "+" : ""}${review.executed.averageMaeR.toFixed(2)}R`}</small>
      </div>
      <div>
        <span>Decision lifecycle</span>
        <strong>{review.decisions.strategyRejectedEvents} strategy rejects · {review.decisions.brokerRejectedEvents} broker rejects</strong>
        <small>{review.decisions.canceledEvents} canceled · {review.decisions.expiredEvents} expired · {review.decisions.replacedEvents} replaced · {review.decisions.executionErrors} execution errors</small>
      </div>
      <div>
        <span>Evidence maturity</span>
        <strong>{maturityLabel}</strong>
        <small>{review.evidenceMaturity.resolvedOutcomeSamples < sampleTarget ? `${sampleTarget - review.evidenceMaturity.resolvedOutcomeSamples} more resolved outcomes before parameter recommendations unlock.` : "Minimum evidence threshold reached; recommendations remain advisory and version-gated."}</small>
      </div>
    </div>

    {review.decisions.topReasons.length ? <div>
      <h3>Most common gates / waiting reasons</h3>
      <div className={styles.botRuleGrid}>{review.decisions.topReasons.map(item => <div key={item.reason}><span>{item.reason}</span><strong>{item.count} observations</strong></div>)}</div>
    </div> : null}

    {usefulBands.length ? <div>
      <h3>Score-band evidence</h3>
      <div className={styles.botRuleGrid}>{usefulBands.map(item => <div key={item.band}>
        <span>Score {item.band}</span>
        <strong>{item.observations} scans · {item.resolvedStudies} resolved studies</strong>
        <small>Missed +2R rate {item.missedOpportunityRatePct === null ? "—" : `${item.missedOpportunityRatePct.toFixed(0)}%`} · protective rejection rate {item.protectiveRejectionRatePct === null ? "—" : `${item.protectiveRejectionRatePct.toFixed(0)}%`}</small>
      </div>)}</div>
    </div> : null}

    {topSymbols.length ? <div>
      <h3>Symbol evidence</h3>
      <div className={styles.botRuleGrid}>{topSymbols.map(item => <div key={item.symbol}>
        <span>{item.symbol}</span>
        <strong>{item.observations} observations · max score {item.maxScore === null ? "—" : item.maxScore.toFixed(0)}</strong>
        <small>{item.closedTrades} closed trades · avg executed R {item.averageExecutedR === null ? "—" : `${item.averageExecutedR >= 0 ? "+" : ""}${item.averageExecutedR.toFixed(2)}R`} · {item.resolvedCounterfactuals} resolved counterfactuals</small>
      </div>)}</div>
    </div> : null}

    <div>
      <h3>Strategy recommendations</h3>
      <div className={styles.botRuleGrid}>{review.recommendations.map(item => <div key={item.id}>
        <span>{item.severity === "review" ? "REVIEW" : "ADVISORY"}</span>
        <strong>{item.title}</strong>
        <small>{item.rationale}</small>
        <small>{item.evidenceCount} outcome samples · requires new version + PAPER validation</small>
      </div>)}</div>
    </div>
  </article>;
}

function BotCard({ profile, ledger, history, staged, positions, trades, counterfactuals }: {
  profile: PaperBotProfile;
  ledger: PaperBotSummary | null;
  history: Array<{ time: string; equity: number }>;
  staged: StagedPaperOrder[];
  positions: PaperPositionPlan[];
  trades: PaperTradeMetric[];
  counterfactuals: PaperCounterfactual[];
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

    {positions.length ? <div>
      <h3>Exit manager</h3>
      <div className={styles.botRuleGrid}>{positions.map(position => <ExitManagerRow key={position.symbol} position={position} metric={trades.find(trade => trade.symbol === position.symbol && trade.status !== "closed")} />)}</div>
    </div> : null}

    {staged.length ? <div>
      <h3>Staged plans</h3>
      {staged.map(order => <OrderPlan key={`${order.symbol}-${order.entry_trigger}`} order={order} />)}
      <p className={styles.meta}>Staged means prepared only. These plans require fresh quote/spread/risk revalidation before paper submission.</p>
    </div> : null}

    {counterfactuals.length ? <div>
      <h3>Counterfactual studies</h3>
      <div className={styles.botRuleGrid}>
        {counterfactuals.slice(0, 3).map(item => <div key={`${item.symbol}-${item.decision_at}`}>
          <span>{item.symbol} · {item.source_event_type.replaceAll("_"," ")}</span>
          <strong>{item.status.toUpperCase()}{item.first_outcome ? ` · ${item.first_outcome.replaceAll("-"," ")}` : ""}</strong>
          <small>Decision {new Date(item.decision_at).toLocaleString()} · score {item.score === null ? "—" : item.score.toFixed(0)}</small>
          <small>Trigger {money(item.trigger_price)} · max entry {money(item.max_entry_price)} · stop {money(item.protective_stop)}</small>
          <small>Assumed entry {money(item.assumed_entry_price)} · +1R {money(item.one_r_price)} · +2R {money(item.two_r_price)}</small>
          <small>MFE {item.mfe_r >= 0 ? "+" : ""}{item.mfe_r.toFixed(2)}R · MAE {item.mae_r >= 0 ? "+" : ""}{item.mae_r.toFixed(2)}R · {item.mark_count} completed bars</small>
          {item.triggered_at ? <small>Triggered {new Date(item.triggered_at).toLocaleString()}{item.one_r_hit_at ? ` · +1R ${new Date(item.one_r_hit_at).toLocaleTimeString()}` : ""}{item.two_r_hit_at ? ` · +2R ${new Date(item.two_r_hit_at).toLocaleTimeString()}` : ""}{item.stop_hit_at ? ` · stop ${new Date(item.stop_hit_at).toLocaleTimeString()}` : ""}</small> : null}
        </div>)}
      </div>
      <p className={styles.meta}>Counterfactuals are observation-only. They never submit broker orders; same-candle stop/target sequencing is labeled ambiguous instead of guessed.</p>
    </div> : null}


    {trades.some(trade => trade.status === "closed") ? <div>
      <h3>Recent trade outcomes</h3>
      <div className={styles.botRuleGrid}>
        {trades.filter(trade => trade.status === "closed").slice(0, 3).map(trade => <div key={`${trade.symbol}-${trade.opened_at}`}>
          <span>{trade.symbol}</span>
          <strong>{trade.r_multiple === null ? "R pending" : `${trade.r_multiple >= 0 ? "+" : ""}${trade.r_multiple.toFixed(2)}R`} · {money(trade.realized_pl)}</strong>
          <small>Entry {money(trade.entry_price)} · exit {money(trade.exit_price)} · fees {money(trade.estimated_fees)}</small>
          <small>MFE {trade.mfe_r >= 0 ? "+" : ""}{trade.mfe_r.toFixed(2)}R · MAE {trade.mae_r >= 0 ? "+" : ""}{trade.mae_r.toFixed(2)}R · {trade.mark_count} marks</small>
          <small>{trade.exit_reason ?? "Broker exit"}{trade.closed_at ? ` · closed ${new Date(trade.closed_at).toLocaleString()}` : ""}</small>
        </div>)}
      </div>
    </div> : null}


    <ul className={styles.botNotes}>{profile.notes.map(note => <li key={note}>{note}</li>)}</ul>
    {active ? <Link className={styles.botLink} href="/paper-trading">Open live report →</Link> : <span className={styles.botDisabled}>Execution disabled</span>}
  </article>;
}

export default function PaperBotLab() {
  const { report: accountReport, error: accountError, refresh: refreshAccount } = useAccountReport();
  const { report: ledgerReport, error: ledgerError, refresh: refreshLedgers } = usePaperBotLedgers();
  const { report: strategyReview, error: strategyReviewError, refresh: refreshStrategyReview } = usePaperStrategyReview();
  const { report: swingReadiness, error: swingReadinessError } = useSwingReadiness();
  const { report: weekendCrypto, error: weekendCryptoError } = useWeekendCryptoReadiness();
  const ledgerFor = (botId: string) => ledgerReport?.bots.find(bot => bot.botId === botId) ?? null;
  const stagedFor = (botId: string) => ledgerReport?.stagedOrders?.[botId] ?? [];
  const positionsFor = (botId: string) => ledgerReport?.positionPlans?.[botId] ?? [];
  const tradesFor = (botId: string) => ledgerReport?.tradeMetrics?.[botId] ?? [];
  const counterfactualsFor = (botId: string) => ledgerReport?.counterfactuals?.[botId] ?? [];
  const historyFor = (botId: string) => ledgerReport?.history?.[botId] ?? [];
  const brokerEquity = accountReport?.snapshot?.account.equity ?? null;

  return <main className={styles.botLab}>
    <header className={styles.botLabHeader}>
      <div>
        <Link href="/paper-trading">← Paper Trading Lab</Link>
        <h1>Bot Lab</h1>
        <p>Every challenge starts with $100 virtual capital. The larger Alpaca paper account is the execution sandbox and audit trail, never the bot bankroll.</p>
      </div>
      <div className={styles.botLabActions}><button onClick={() => { refreshLedgers(); refreshAccount(); refreshStrategyReview(); }}>Refresh</button></div>
    </header>

    <section className={styles.botOverview}>
      <div><span>Challenge baseline</span><strong>$100 each</strong></div>
      <div><span>Active bots</span><strong>{PAPER_BOT_PROFILES.filter(profile => profile.status === "active").length}</strong></div>
      <div><span>Prepared plans</span><strong>{Object.values(ledgerReport?.stagedOrders ?? {}).reduce((sum, orders) => sum + orders.length, 0)}</strong></div>
      <div><span>Counterfactual studies</span><strong>{Object.values(ledgerReport?.counterfactuals ?? {}).reduce((sum, items) => sum + items.length, 0)}</strong></div>
      <div><span>Alpaca paper balance</span><strong>{money(brokerEquity)}</strong></div>
    </section>

    {ledgerError ? <p role="status" className={styles.error}>Bot ledger: {ledgerError}</p> : null}
    {accountError ? <p role="status" className={styles.error}>Alpaca audit feed: {accountError}</p> : null}
    {swingReadinessError ? <p role="status" className={styles.error}>Swing readiness: {swingReadinessError}</p> : null}
    {weekendCryptoError ? <p role="status" className={styles.error}>Daily crypto readiness: {weekendCryptoError}</p> : null}
    {strategyReviewError ? <p role="status" className={styles.error}>Strategy review: {strategyReviewError}</p> : null}

    <section className={styles.botCompare}>
      <div className={styles.cardHeader}>
        <div>
          <h2>Monday swing readiness</h2>
          <p>Read-only revalidation. A READY result is permission for the future PAPER executor to consider a plan; it does not submit an order.</p>
        </div>
        <span className={styles.meta}>{swingReadiness?.paperOnly === false ? "BLOCKED" : `PAPER ONLY · EXECUTOR ${swingReadiness?.executionEnabled ? "ARMED" : "DISABLED"}`}</span>
      </div>
      <div className={styles.botOverview}>
        <div><span>Selected now</span><strong>{swingReadiness?.readyCount ?? 0}</strong></div>
        <div><span>Weekly slots</span><strong>{swingReadiness?.weeklySlotsRemaining ?? "—"}</strong></div>
        <div><span>Position slots</span><strong>{swingReadiness?.openPositionSlotsRemaining ?? "—"}</strong></div>
        <div><span>Broad market</span><strong>{swingReadiness ? (swingReadiness.broadMarketSupportive ? "Supportive" : "Blocked") : "—"}</strong></div>
      </div>
      {swingReadiness?.nextMarketOpen ? <p className={styles.meta}>Next market open: {new Date(swingReadiness.nextMarketOpen).toLocaleString()}</p> : null}
      <p className={styles.meta}>Broker protection: {swingReadiness?.brokerProtection ?? "—"} · submission gate: {swingReadiness?.submissionReady ? "ready" : "closed"} · an execution preview is only generated after same-session selection.</p>
      <div className={styles.botRuleGrid}>
        {(swingReadiness?.plans ?? []).map(plan => <div key={plan.symbol}>
          <span>{plan.symbol}</span>
          <strong className={plan.state === "ready" ? styles.fresh : plan.state === "blocked" ? styles.stale : styles.meta}>
            {plan.state.toUpperCase()}{plan.selectedForSubmission ? " · SELECTED" : ""}
          </strong>
          <small>Bid {money(plan.bid)} · ask {money(plan.ask)} · spread {plan.spreadPct === null ? "—" : `${plan.spreadPct.toFixed(3)}%`} · quote age {plan.quoteAgeSeconds === null ? "—" : `${Math.round(plan.quoteAgeSeconds)}s`}</small>
          <small>Allocation {percent(plan.allocationPct)} · planned risk {percent(plan.plannedRiskPct)}{plan.correlationGroup ? ` · ${plan.correlationGroup}` : ""}</small>
          {plan.executionPreview ? <small>Bracket preview: {plan.executionPreview.quantity.toFixed(9)} shares · {money(plan.executionPreview.estimatedNotional)} · stop {money(plan.executionPreview.stopLoss)} · target {money(plan.executionPreview.takeProfit)}</small> : null}
          {plan.waitingOn.length ? <small>Waiting: {plan.waitingOn.join(" · ")}</small> : null}
          {plan.blockers.length ? <small>Blocked: {plan.blockers.join(" · ")}</small> : null}
        </div>)}
      </div>
    </section>

    <section className={styles.botCompare}>
      <div className={styles.cardHeader}>
        <div>
          <h2>Daily crypto day readiness</h2>
          <p>Continuous 24/7 crypto scanner. BTC / ETH / SOL / LINK / DOT are execution-eligible; XRP / LTC / AVAX / DOGE / ADA / BCH / AAVE / HYPE / RENDER are monitor-only.</p>
        </div>
        <span className={styles.meta}>{weekendCrypto ? `PAPER ONLY · EXECUTOR ${weekendCrypto.executionEnabled ? "ARMED" : "DISABLED"}` : "PAPER ONLY"}</span>
      </div>
      <div className={styles.botOverview}>
        <div><span>Session</span><strong>{weekendCrypto ? `${weekendCrypto.session.localWeekday} ${weekendCrypto.session.localTime}` : "—"}</strong></div>
        <div><span>BTC regime</span><strong>{weekendCrypto ? (weekendCrypto.broadCryptoSupportive ? "Supportive" : "Waiting") : "—"}</strong></div>
        <div><span>Entries left today</span><strong>{weekendCrypto?.dailyEntriesRemaining ?? "—"}</strong></div>
        <div><span>Selected</span><strong>{weekendCrypto?.selectedSymbol ?? "None"}</strong></div>
      </div>
      <p className={styles.meta}>
        24/7 entries {weekendCrypto?.session.entriesOpen ? "enabled" : "disabled"} · one-position slots {weekendCrypto?.openPositionSlotsRemaining ?? "—"} · submission gate {weekendCrypto?.submissionReady ? "ready" : "closed"} · execute pool {weekendCrypto?.executionUniverse.length ?? "—"} · monitor pool {weekendCrypto?.monitorOnlyUniverse.length ?? "—"}
        {weekendCrypto?.occupiedByOtherBots.length ? ` · held by other bots: ${weekendCrypto.occupiedByOtherBots.join(", ")}` : ""}
      </p>
      <div className={styles.botRuleGrid}>
        {(weekendCrypto?.candidates ?? []).map(candidate => <div key={candidate.symbol}>
          <span>{candidate.symbol} · {candidate.executionEligible ? "EXECUTE" : "MONITOR ONLY"}</span>
          <strong className={candidate.state === "ready" ? styles.fresh : candidate.state === "blocked" ? styles.stale : styles.meta}>
            {candidate.state.toUpperCase()}{candidate.selectedForSubmission ? " · SELECTED" : ""} · {candidate.score}/100
          </strong>
          <small>
            Bid {money(candidate.bid)} · ask {money(candidate.ask)} · spread {candidate.spreadPct === null ? "—" : `${candidate.spreadPct.toFixed(3)}%`} · quote age {candidate.quoteAgeSeconds === null ? "—" : `${Math.round(candidate.quoteAgeSeconds)}s`}
          </small>
          <small>
            5m momentum {percent(candidate.fastMomentumPct)} · 15m momentum {percent(candidate.slowMomentumPct)} · 5m ATR {percent(candidate.atrPct)}
          </small>
          <small>
            Trigger {money(candidate.trigger)} · max chase {money(candidate.maxEntry)} · stop {money(candidate.protectiveStop)} · target {money(candidate.takeProfit)}
          </small>
          <small>
            Planned {money(candidate.plannedNotional)} · risk {money(candidate.plannedRiskDollars)} ({percent(candidate.plannedRiskPct)}) · est. round-trip fees {money(candidate.estimatedRoundTripFees)} · target/fees {candidate.feeCoverageMultiple === null ? "—" : `${candidate.feeCoverageMultiple.toFixed(2)}×`}
          </small>
          {candidate.waitingOn.length ? <small>Waiting: {candidate.waitingOn.join(" · ")}</small> : null}
          {candidate.blockers.length ? <small>Blocked: {candidate.blockers.join(" · ")}</small> : null}
        </div>)}
      </div>
    </section>

    <section className={styles.botCompare}>
      <div className={styles.cardHeader}>
        <div>
          <h2>Strategy review</h2>
          <p>Executed trades, counterfactual paths, rejected/staged lifecycle evidence, score bands, and recurring blockers are reviewed together. Recommendations cannot modify a strategy.</p>
        </div>
        <span className={styles.meta}>ADVISORY ONLY · NEW VERSION + PAPER VALIDATION REQUIRED</span>
      </div>
      <div className={styles.botOverview}>
        <div><span>Auto strategy mutation</span><strong>{strategyReview?.policy.automaticStrategyMutation ? "ON" : "OFF"}</strong></div>
        <div><span>Auto risk increases</span><strong>{strategyReview?.policy.automaticRiskIncrease ? "ON" : "OFF"}</strong></div>
        <div><span>Live-money changes</span><strong>{strategyReview?.policy.liveMoneyChangesAllowed ? "ON" : "OFF"}</strong></div>
        <div><span>Recommendation threshold</span><strong>{strategyReview?.policy.minimumResolvedOutcomesForRecommendations ?? 20} outcomes</strong></div>
      </div>
      <div className={styles.botGrid}>
        {(strategyReview?.bots ?? []).filter(bot => bot.status === "active").map(review => <StrategyReviewCard key={review.botId} review={review} />)}
      </div>
      <p className={styles.meta}>A counterfactual reaching +2R before the original stop is labeled a missed-opportunity path, not hypothetical profit. Same-bar ambiguity remains excluded from directional conclusions.</p>
    </section>

    <section className={styles.botGrid}>
      {PAPER_BOT_PROFILES.map(profile => <BotCard
        key={profile.id}
        profile={profile}
        ledger={ledgerFor(profile.id)}
        history={historyFor(profile.id)}
        staged={stagedFor(profile.id)}
        positions={positionsFor(profile.id)}
        trades={tradesFor(profile.id)}
        counterfactuals={counterfactualsFor(profile.id)}
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
          <tr><td>Counterfactual studies</td>{PAPER_BOT_PROFILES.map(profile => <td key={profile.id}>{counterfactualsFor(profile.id).length}</td>)}</tr>
        </tbody>
      </table></div>
      <p className={styles.meta}>No performance winner is declared from an empty or tiny sample. Prepared plans are not broker orders.</p>
    </section>
  </main>;
}
