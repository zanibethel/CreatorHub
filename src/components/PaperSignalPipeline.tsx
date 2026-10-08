"use client";

import type { PaperProspect } from "./usePaperProspects";
import type {
  PaperBrokerOrder,
  PaperPositionPlan,
  StagedPaperOrder,
} from "./usePaperBotLedgers";
import type { PaperSignalDeskEvent } from "./usePaperSignalDesk";
import styles from "./PaperTradingLab.module.css";

const money = (value: number | null | undefined) => {
  if (value == null || !Number.isFinite(value)) return "—";
  const absolute = Math.abs(value);
  const maximumFractionDigits = absolute >= 1 ? 2 : absolute >= 0.01 ? 4 : 6;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits,
  }).format(value);
};

const percent = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value) ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;

const stamp = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleString() : "—";

const numeric = (record: Record<string, unknown>, key: string) => {
  const raw = record[key];
  const parsed = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
};

function statusClass(state: string) {
  const normalized = state.toLowerCase();
  if (["staged","eligible","ready","filled","holding","submitted","partially_filled"].some(value => normalized.includes(value))) {
    return styles.signalStatePositive;
  }
  if (["rejected","blocked","error","canceled","expired"].some(value => normalized.includes(value))) {
    return styles.signalStateNegative;
  }
  return styles.signalStateNeutral;
}

function EmptyLane({ children }: { children: React.ReactNode }) {
  return <div className={styles.signalEmpty}>{children}</div>;
}

function StageHeader({ label, count, detail }: { label: string; count: number; detail: string }) {
  return <div className={styles.signalLaneHeader}>
    <div>
      <span>{label}</span>
      <strong>{count}</strong>
    </div>
    <small>{detail}</small>
  </div>;
}

export default function PaperSignalPipeline({
  botName,
  prospects,
  stagedOrders,
  brokerOrders,
  positions,
  intakeEvents,
  currentPriceFor,
  compact = false,
}: {
  botName: string;
  prospects: PaperProspect[];
  stagedOrders: StagedPaperOrder[];
  brokerOrders: PaperBrokerOrder[];
  positions: PaperPositionPlan[];
  intakeEvents: PaperSignalDeskEvent[];
  currentPriceFor?: (row: PaperProspect) => number | null;
  compact?: boolean;
}) {
  const comingUp = [...prospects]
    .filter(row => row.status === "review-ready" || row.status === "watchlist")
    .sort((a,b) => b.score - a.score || Date.parse(b.last_seen_at) - Date.parse(a.last_seen_at))
    .slice(0, compact ? 3 : 8);

  const prepared = [...stagedOrders]
    .sort((a,b) => Date.parse(b.expires_at ?? "0") - Date.parse(a.expires_at ?? "0"))
    .slice(0, compact ? 3 : 8);

  const activeOrders = brokerOrders
    .filter(order => !["canceled","cancelled","expired","rejected","filled"].includes(order.status.toLowerCase()))
    .slice(0, compact ? 3 : 8);

  const activePositions = positions.slice(0, compact ? 3 : 8);

  const latestDecisionBySymbol = new Map<string, PaperSignalDeskEvent>();
  for (const event of intakeEvents) {
    if (!event.symbol) continue;
    if (!latestDecisionBySymbol.has(event.symbol)) latestDecisionBySymbol.set(event.symbol, event);
  }
  const passed = [...latestDecisionBySymbol.values()]
    .filter(event => {
      if (event.event_type === "prospect-intake") {
        return !["staged","eligible"].includes((event.qualification ?? "").toLowerCase());
      }
      return ["strategy-rejected","broker-rejected","canceled","expired","execution-error"].includes(event.event_type);
    })
    .slice(0, compact ? 3 : 8);

  return <section className={[styles.signalDesk, compact ? styles.signalDeskCompact : ""].filter(Boolean).join(" ")}>
    <div className={styles.signalDeskHeader}>
      <div>
        <span className={styles.signalAutoBadge}>AUTO · SIMULATION</span>
        <h2>Live Trade Pipeline</h2>
        <p>{botName} is making its own simulated decisions. This view exposes what it sees before, during, and after execution.</p>
      </div>
      <div className={styles.signalEngineStatus}>
        <span>Decision engine</span>
        <strong>Running</strong>
        <small>Visual layer does not authorize trades</small>
      </div>
    </div>

    <div className={styles.signalFlowRail} aria-label="Automated trade lifecycle">
      <span>DISCOVER</span><i aria-hidden="true">→</i>
      <span>PREPARE</span><i aria-hidden="true">→</i>
      <span>EXECUTE</span><i aria-hidden="true">→</i>
      <span>MANAGE / EXIT</span>
    </div>

    <div className={styles.signalLanes}>
      <div className={styles.signalLane}>
        <StageHeader label="Coming Up" count={comingUp.length} detail="Scanner-qualified prospects the bot can evaluate next." />
        {comingUp.length ? comingUp.map(row => {
          const price = currentPriceFor?.(row) ?? row.price;
          const acceleration = row.score_components.acceleration ?? 0;
          const catalyst = row.score_components.catalyst ?? 0;
          const chase = row.score_components.chasePenalty ?? 0;
          return <article className={styles.signalCard} key={`prospect-${row.asset_class}-${row.symbol}`}>
            <div className={styles.signalCardTop}>
              <div><strong>{row.symbol}</strong><small>{row.asset_class.toUpperCase()} · {row.status.replace("-", " ")}</small></div>
              <div className={styles.signalScore}><span>Score</span><strong>{row.score.toFixed(0)}</strong></div>
            </div>
            <div className={styles.signalPriceRow}>
              <span>Now <strong>{money(price)}</strong></span>
              <span>Move <strong>{percent(row.percent_change)}</strong></span>
            </div>
            <div className={styles.signalMiniMetrics}>
              <span><small>Acceleration</small><strong>{acceleration.toFixed(0)}</strong></span>
              <span><small>Catalyst</small><strong>{catalyst.toFixed(0)}</strong></span>
              <span><small>Chase risk</small><strong>{chase.toFixed(0)}</strong></span>
            </div>
            <p>{row.reasons[0] ?? "Awaiting bot-specific review."}</p>
            <footer>Last observed {stamp(row.last_seen_at)}</footer>
          </article>;
        }) : <EmptyLane>No current prospects are assigned to this bot.</EmptyLane>}
      </div>

      <div className={styles.signalLane}>
        <StageHeader label="Prepared" count={prepared.length} detail="Plans waiting for their live entry and risk gates." />
        {prepared.length ? prepared.map(order => <article className={styles.signalCard} key={`prepared-${order.symbol}-${order.entry_trigger}`}>
          <div className={styles.signalCardTop}>
            <div><strong>{order.symbol}</strong><small>PREPARED PLAN</small></div>
            <span className={statusClass(order.status)}>{order.status.toUpperCase()}</span>
          </div>
          <div className={styles.signalPlanGrid}>
            <span><small>Trigger</small><strong>{money(order.entry_trigger)}</strong></span>
            <span><small>Max chase</small><strong>{money(order.max_entry_price)}</strong></span>
            <span><small>Stop</small><strong>{money(order.protective_stop)}</strong></span>
            <span><small>Target</small><strong>{money(order.take_profit_price)}</strong></span>
            <span><small>Planned buy</small><strong>{money(order.requested_notional)}</strong></span>
            <span><small>Max planned loss</small><strong>{money(order.planned_risk_dollars)}</strong></span>
          </div>
          <p>{order.stage_reason ?? "Prepared automatically; final execution gates still apply."}</p>
          <footer>Expires {stamp(order.expires_at)}</footer>
        </article>) : <EmptyLane>No prepared orders. The bot will populate this lane automatically when a prospect passes intake.</EmptyLane>}
      </div>

      <div className={styles.signalLane}>
        <StageHeader
          label="Executing / Holding"
          count={activeOrders.length + activePositions.length}
          detail="Orders submitted by the engine and positions currently under management."
        />
        {activeOrders.map((order,index) => <article className={styles.signalCard} key={`active-order-${order.symbol}-${index}`}>
          <div className={styles.signalCardTop}>
            <div><strong>{order.symbol}</strong><small>{order.side.toUpperCase()} · {order.order_class ?? order.order_type ?? "ORDER"}</small></div>
            <span className={statusClass(order.status)}>{order.status.replaceAll("_"," ").toUpperCase()}</span>
          </div>
          <div className={styles.signalPlanGrid}>
            <span><small>Quantity</small><strong>{order.quantity ?? "—"}</strong></span>
            <span><small>Filled</small><strong>{order.filled_quantity ?? "—"}</strong></span>
            <span><small>Avg fill</small><strong>{money(order.average_fill_price)}</strong></span>
          </div>
          <footer>Submitted {stamp(order.submitted_at)}</footer>
        </article>)}
        {activePositions.map(position => <article className={styles.signalCard} key={`holding-${position.symbol}`}>
          <div className={styles.signalCardTop}>
            <div><strong>{position.symbol}</strong><small>AUTOMATED POSITION</small></div>
            <span className={styles.signalStatePositive}>HOLDING</span>
          </div>
          <div className={styles.signalPlanGrid}>
            <span><small>Entry</small><strong>{money(position.average_entry)}</strong></span>
            <span><small>Quantity</small><strong>{position.quantity}</strong></span>
            <span><small>Stop</small><strong>{money(position.protective_stop)}</strong></span>
            <span><small>Target</small><strong>{money(position.take_profit_price)}</strong></span>
            <span><small>Current mark</small><strong>{money(position.exit_manager_state.markPrice)}</strong></span>
            <span><small>Manager</small><strong>{position.exit_manager_state.plannedAction?.replaceAll("_"," ") ?? "monitoring"}</strong></span>
          </div>
          {position.exit_manager_state.reason ? <p>{position.exit_manager_state.reason}</p> : null}
          <footer>Last managed {stamp(position.last_exit_manager_at)}</footer>
        </article>)}
        {!activeOrders.length && !activePositions.length ? <EmptyLane>No active execution or holdings for this bot.</EmptyLane> : null}
      </div>

      <div className={styles.signalLane}>
        <StageHeader label="Passed / Blocked" count={passed.length} detail="Recent setups the bot declined, deferred, or protected itself from." />
        {passed.length ? passed.map((event,index) => {
          const price = numeric(event.market_snapshot,"price") ?? numeric(event.market_snapshot,"ask");
          const move = numeric(event.market_snapshot,"percentChange");
          const qualification = event.event_type === "prospect-intake"
            ? event.qualification ?? "blocked"
            : event.event_type;
          return <article className={styles.signalCard} key={`decision-${event.symbol}-${event.occurred_at}-${index}`}>
            <div className={styles.signalCardTop}>
              <div><strong>{event.symbol ?? "Unknown"}</strong><small>{event.event_type === "prospect-intake" ? "BOT INTAKE DECISION" : "AUTOMATED SYSTEM DECISION"}</small></div>
              <span className={statusClass(qualification)}>{qualification.replaceAll("_"," ").replaceAll("-"," ").toUpperCase()}</span>
            </div>
            <div className={styles.signalPriceRow}>
              <span>Decision price <strong>{money(price)}</strong></span>
              <span>Session move <strong>{percent(move)}</strong></span>
            </div>
            <p>{event.blockers[0] ?? event.warnings[0] ?? "Setup did not advance to a prepared order."}</p>
            <footer>{event.score == null ? "" : `Scanner score ${event.score.toFixed(0)} · `}Decision {stamp(event.occurred_at)}</footer>
          </article>;
        }) : <EmptyLane>No recent bot-specific rejected or deferred intake decisions.</EmptyLane>}
      </div>
    </div>
  </section>;
}
