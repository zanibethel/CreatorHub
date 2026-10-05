"use client";

import Link from "next/link";
import { useState } from "react";
import { PAPER_BOT_PROFILES, type PaperBotProfile } from "@/lib/paper-bot-profiles";
import type { PaperBotSummary } from "@/lib/paper-bot-ledger";
import {
  PAPER_BOT_TRADE_PLAN_CONTRACT_VERSION,
  derivePaperBotLifecycle,
  paperBotPlanLabel,
  type PaperBotLifecycleStage,
  type PaperBotTradePlan,
} from "@/lib/paper-bot-trade-plan";
import { evaluatePaperCandidate } from "@/lib/paper-decision-engine";
import useAccountReport from "./useAccountReport";
import useMarketMonitor from "./useMarketMonitor";
import usePaperBotLedgers, {
  type PaperBrokerFill,
  type PaperBrokerOrder,
  type PaperPositionPlan,
  type PaperTradeMetric,
  type StagedPaperOrder,
} from "./usePaperBotLedgers";
import usePaperStrategyReview from "./usePaperStrategyReview";
import usePaperProspects, { type PaperProspect } from "./usePaperProspects";
import useSharedWatchlist from "./useSharedWatchlist";
import useSwingReadiness from "./useSwingReadiness";
import useCryptoSwingReadiness from "./useCryptoSwingReadiness";
import useSqueezeBreakoutReadiness from "./useSqueezeBreakoutReadiness";
import useWeekendCryptoReadiness from "./useWeekendCryptoReadiness";
import styles from "./PaperTradingLab.module.css";

type PortfolioView = "portfolio" | "holdings" | "watchlist" | "prospects" | "orders" | "trades" | "strategy";

type WatchRow = {
  symbol: string;
  label: string;
  currentPrice: number | null;
  state: string;
  score: number | null;
  detail: string;
  strategies: Array<"day" | "swing" | "long">;
  targetEntry?: number | null;
  projectedPurchase?: number | null;
  stopPrice?: number | null;
  projectedLoss?: number | null;
  exitPrice?: number | null;
  projectedProfit?: number | null;
  projectedProfitPct?: number | null;
  planLabel?: "REFERENCE PLAN" | "PREPARED PLAN" | "READY PLAN" | "AWAITING DATA";
  lifecycleStage?: PaperBotLifecycleStage;
  lifecycleDetail?: string;
  executionEligible?: boolean;
};

const ACTIVE_PROFILES = PAPER_BOT_PROFILES.filter(profile => {
  if (profile.status !== "active") return false;
  if (profile.tradePlan.source === "not-configured") {
    throw new Error(`Active bot ${profile.id} is missing a trade-plan adapter.`);
  }
  return true;
});
const money = (value: number | null | undefined) => value == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
const marketPriceMoney = (value: number | null | undefined) => {
  if (value == null) return "—";
  const absolute = Math.abs(value);
  const maximumFractionDigits = absolute >= 1 ? 2 : absolute >= 0.01 ? 4 : absolute >= 0.0001 ? 6 : 8;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits,
  }).format(value);
};
const signedMoney = (value: number | null | undefined) => value == null ? "—" : `${value >= 0 ? "+" : ""}${money(value)}`;
const percent = (value: number | null | undefined) => value == null ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
const stamp = (value: string | null | undefined) => value ? new Date(value).toLocaleString() : "—";
const midPrice = (bid: number | null | undefined, ask: number | null | undefined) =>
  bid != null && ask != null && bid > 0 && ask > 0 ? (bid + ask) / 2 : bid ?? ask ?? null;
const normalizedSymbol = (value: string) => value.replace("/", "-").toUpperCase();
const projectedProfit = (entry: number | null | undefined, target: number | null | undefined, quantity: number | null | undefined, fraction = 1) =>
  entry != null && target != null && quantity != null && entry > 0 && quantity > 0 ? (target - entry) * quantity * fraction : null;

function botShortName(profile: PaperBotProfile) {
  if (profile.id === "weekend-crypto-day-100") return "Daily Crypto";
  if (profile.id === "three-trade-weekly-swing-100") return "Weekly Swing";
  if (profile.id === "crypto-swing-100") return "Crypto Swing";
  if (profile.id === "squeeze-breakout-100") return "Squeeze Breakout";
  if (profile.id === "penny-volatility-day-100") return "Penny Volatility";
  return "Default Diverse";
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return <div className={styles.portfolioEmpty}>{children}</div>;
}

function SummaryCard({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return <div className={styles.portfolioStat}>
    <span>{label}</span>
    <strong>{value}</strong>
    {detail ? <small>{detail}</small> : null}
  </div>;
}

function HoldingRows({ positions, trades, accountPositions, compact = false }: {
  positions: PaperPositionPlan[];
  trades: PaperTradeMetric[];
  accountPositions: Array<{ symbol: string; quantity: number | null; marketValue: number | null }> | null | undefined;
  compact?: boolean;
}) {
  const visible = compact ? positions.slice(0, 3) : positions;
  if (!visible.length) return <EmptyState>No open holdings for this bot.</EmptyState>;

  return <div className={styles.holdingGrid}>
    {visible.map(position => {
      const metric = trades.find(item => item.symbol === position.symbol && item.status !== "closed");
      const accountPosition = accountPositions?.find(item => normalizedSymbol(item.symbol) === normalizedSymbol(position.symbol));
      const accountMark = accountPosition?.quantity && accountPosition.marketValue != null
        ? Math.abs(accountPosition.marketValue / accountPosition.quantity)
        : null;
      const currentPrice = position.exit_manager_state.markPrice ?? metric?.last_mark_price ?? accountMark;
      const fillPrice = position.average_entry;
      const markPl = fillPrice != null && currentPrice != null
        ? (currentPrice - fillPrice) * position.quantity
        : null;
      const positionCost = fillPrice != null ? fillPrice * position.quantity : null;
      const markPct = markPl != null && positionCost != null && positionCost > 0 ? markPl / positionCost * 100 : null;
      const targetFraction = position.take_profit_fraction ?? 1;
      const targetPl = projectedProfit(fillPrice, position.take_profit_price, position.quantity, targetFraction);
      const targetMovePct = fillPrice != null && position.take_profit_price != null && fillPrice > 0
        ? (position.take_profit_price / fillPrice - 1) * 100
        : null;
      const activeStop = position.protective_stop;
      const stopPl = fillPrice != null && activeStop != null
        ? (activeStop - fillPrice) * position.quantity
        : null;
      const stopMovePct = fillPrice != null && activeStop != null && fillPrice > 0
        ? (activeStop / fillPrice - 1) * 100
        : null;
      const marketValue = currentPrice != null ? currentPrice * position.quantity : null;
      const exitAction = position.exit_manager_state.plannedAction
        ? position.exit_manager_state.plannedAction.replaceAll("_", " ")
        : "monitoring";
      const desiredStop = position.exit_manager_state.desiredStop;
      const takeLabel = targetFraction < 1
        ? `Take profit · ${Math.round(targetFraction * 100)}%`
        : "Take profit";

      return <div className={styles.holdingCard} key={position.symbol}>
        <div className={styles.holdingHeader}>
          <div>
            <strong>{position.symbol}</strong>
            <small>{position.quantity.toFixed(position.quantity < 1 ? 8 : 4)} units</small>
          </div>
          <div>
            <small>Current</small>
            <strong>{money(currentPrice)}</strong>
          </div>
        </div>

        <div className={styles.holdingStatus}>
          <span>HOLDING</span>
          <small>Exit manager: {exitAction}</small>
        </div>

        <div className={styles.holdingMetrics}>
          <span><small>Filled price</small><strong>{money(fillPrice)}</strong></span>
          <span><small>Position value</small><strong>{money(marketValue)}</strong></span>
          <span><small>Unrealized P/L</small><strong>{signedMoney(markPl)}{markPct == null ? "" : ` · ${percent(markPct)}`}</strong></span>
          <span><small>{takeLabel}</small><strong>{money(position.take_profit_price)}</strong></span>
          <span><small>Profit at target</small><strong>{signedMoney(targetPl)}{targetMovePct == null ? "" : ` · ${percent(targetMovePct)}`}</strong></span>
          <span><small>Stop loss</small><strong>{money(activeStop)}</strong></span>
          <span><small>P/L at stop</small><strong>{signedMoney(stopPl)}{stopMovePct == null ? "" : ` · ${percent(stopMovePct)}`}</strong></span>
          <span><small>Exit target</small><strong>{money(position.take_profit_price)}</strong></span>
          {desiredStop != null && desiredStop !== activeStop
            ? <span><small>Next stop</small><strong>{money(desiredStop)}</strong></span>
            : null}
        </div>

        {position.exit_manager_state.reason
          ? <small className={styles.holdingReason}>{position.exit_manager_state.reason}</small>
          : null}
      </div>;
    })}
  </div>;
}

function StrategyLegend() {
  return <div className={styles.strategyLegend} aria-label="Strategy horizon legend">
    <span><strong>D</strong> Day trade</span>
    <span><strong>S</strong> Swing / multi-day</span>
    <span><strong>L</strong> Longer-term / multi-week</span>
  </div>;
}

const WATCH_LIFECYCLE: Array<{ id: PaperBotLifecycleStage; short: string; label: string }> = [
  { id: "WATCHING", short: "Watch", label: "Watching" },
  { id: "PREPARED", short: "Plan", label: "Prepared plan" },
  { id: "READY", short: "Ready", label: "Ready to act" },
  { id: "ORDERED", short: "Order", label: "Order placed" },
  { id: "HOLDING", short: "Hold", label: "Filled / holding" },
  { id: "EXITED", short: "Exit", label: "Exited" },
];

function WatchLifecycle({ stage = "WATCHING", detail }: { stage?: PaperBotLifecycleStage; detail?: string }) {
  const activeIndex = Math.max(0, WATCH_LIFECYCLE.findIndex(item => item.id === stage));
  const active = WATCH_LIFECYCLE[activeIndex];
  return <div className={styles.watchLifecycle}>
    <div className={styles.watchLifecycleHeader}>
      <strong>{active.label}</strong>
      {detail ? <small>{detail}</small> : null}
    </div>
    <div className={styles.watchLifecycleSteps} aria-label={`Trade lifecycle: ${active.label}`}>
      {WATCH_LIFECYCLE.map((item, index) => <span
        key={item.id}
        className={[
          styles.watchLifecycleStep,
          index < activeIndex ? styles.watchLifecycleComplete : "",
          index === activeIndex ? styles.watchLifecycleActive : "",
        ].filter(Boolean).join(" ")}
        title={item.label}
      >{item.short}</span>)}
    </div>
  </div>;
}

function WatchRows({ rows, compact = false }: { rows: WatchRow[]; compact?: boolean }) {
  const visible = compact ? rows.slice(0, 8) : rows;
  if (!visible.length) return <EmptyState>Watchlist data is loading.</EmptyState>;
  return <div className={styles.watchPortfolioGrid}>
    {visible.map(row => <div className={styles.watchPortfolioItem} key={row.symbol}>
      <div className={styles.watchTop}>
        <div className={styles.watchIdentity}>
          <strong>{row.symbol}</strong>
          <small>{row.label}</small>
        </div>
        <strong className={styles.watchPrice}>{money(row.currentPrice)}</strong>
      </div>

      <div className={styles.watchStatusRow}>
        <span className={styles.portfolioBadge}>{row.state}</span>
        <div className={styles.strategyMarkers} aria-label={row.strategies.length ? `Strategy fit: ${row.strategies.join(", ")}` : "No funded strategy horizon"}>
          {row.strategies.includes("day") ? <span title="Day trade">D</span> : null}
          {row.strategies.includes("swing") ? <span title="Swing / multi-day">S</span> : null}
          {row.strategies.includes("long") ? <span title="Longer-term / multi-week">L</span> : null}
          {!row.strategies.length ? <span className={styles.strategyMarkerNone}>—</span> : null}
        </div>
      </div>

      <WatchLifecycle stage={row.lifecycleStage} detail={row.lifecycleDetail} />
      <div className={styles.watchPlan}>
        <div className={styles.watchPlanMode}>{row.planLabel ?? "REFERENCE PLAN"}</div>
        <span><small>Target entry</small><strong>{money(row.targetEntry)}</strong></span>
        <span><small>Planned buy</small><strong>{money(row.projectedPurchase)}</strong></span>
        <span><small>Stop price</small><strong>{money(row.stopPrice)}</strong></span>
        <span><small>Max loss</small><strong>{row.projectedLoss == null ? "—" : signedMoney(-Math.abs(row.projectedLoss))}</strong></span>
        <span><small>Exit price</small><strong>{money(row.exitPrice)}</strong></span>
        <span><small>Projected profit</small><strong>{signedMoney(row.projectedProfit)}{row.projectedProfitPct == null ? "" : ` · ${percent(row.projectedProfitPct)}`}</strong></span>
      </div>

      <div className={styles.watchMeta}>
        <span className={styles.portfolioScore}>Score <strong>{row.score !== null ? `${row.score.toFixed(1)}/100` : "N/A"}</strong></span>
        <small className={styles.watchDetail}>{row.detail}</small>
      </div>
    </div>)}
  </div>;
}

function BrokerOrderRows({ orders, compact = false }: { orders: PaperBrokerOrder[]; compact?: boolean }) {
  const visible = compact ? orders.slice(0, 4) : orders;
  if (!visible.length) return <EmptyState>No live simulated execution orders for this bot.</EmptyState>;
  return <div className={styles.portfolioRows}>
    {visible.map((order, index) => <div className={styles.portfolioRow} key={`${order.symbol}-${order.submitted_at ?? order.last_seen_at}-${index}`}>
      <div className={styles.portfolioRowMain}><strong>{order.symbol}</strong><span>{order.side.toUpperCase()} · {order.order_type ?? "order"}</span></div>
      <div><span>Status</span><strong>{order.status.replaceAll("_", " ")}</strong></div>
      <div><span>Quantity</span><strong>{order.quantity ?? "—"}</strong></div>
      <div><span>Filled</span><strong>{order.filled_quantity ?? "—"}</strong></div>
      <div><span>Avg fill</span><strong>{money(order.average_fill_price)}</strong></div>
      <div><span>Submitted</span><strong>{stamp(order.submitted_at)}</strong></div>
    </div>)}
  </div>;
}

function StagedOrderRows({ orders, watchRows, compact = false }: { orders: StagedPaperOrder[]; watchRows: WatchRow[]; compact?: boolean }) {
  const visible = compact ? orders.slice(0, 4) : orders;
  if (!visible.length) return <EmptyState>No prepared entry plans for this bot.</EmptyState>;
  return <div className={styles.portfolioRows}>
    {visible.map(order => {
      const currentPrice = watchRows.find(row => normalizedSymbol(row.symbol) === normalizedSymbol(order.symbol))?.currentPrice ?? null;
      const quantity = order.requested_quantity ?? (
        order.requested_notional != null && order.entry_trigger != null && order.entry_trigger > 0
          ? order.requested_notional / order.entry_trigger
          : null
      );
      const targetFraction = order.take_profit_fraction ?? 1;
      const targetPl = projectedProfit(order.entry_trigger, order.take_profit_price, quantity, targetFraction);
      return <div className={styles.portfolioRow} key={`${order.symbol}-${order.entry_trigger}`}>
        <div className={styles.portfolioRowMain}><strong>{order.symbol}</strong><span>PREPARED · {order.pool_id ?? "unassigned"}</span></div>
        <div><span>Current</span><strong>{money(currentPrice)}</strong></div>
        <div><span>Entry / max</span><strong>{money(order.entry_trigger)} / {money(order.max_entry_price)}</strong></div>
        <div><span>Stop</span><strong>{money(order.protective_stop)}</strong></div>
        <div><span>Target</span><strong>{money(order.take_profit_price)}</strong></div>
        <div><span>{targetFraction < 1 ? "1st-target P/L" : "Target P/L"}</span><strong>{signedMoney(targetPl)}</strong></div>
        <div><span>Expires</span><strong>{stamp(order.expires_at)}</strong></div>
      </div>;
    })}
  </div>;
}

function TradeRows({ closedTrades, fills, compact = false }: { closedTrades: PaperTradeMetric[]; fills: PaperBrokerFill[]; compact?: boolean }) {
  const closed = compact ? closedTrades.slice(0, 2) : closedTrades.slice(0, 10);
  const executions = compact ? fills.slice(0, Math.max(0, 5 - closed.length)) : fills.slice(0, 15);
  if (!closed.length && !executions.length) return <EmptyState>No tagged trade activity yet for this bot.</EmptyState>;

  return <div className={styles.portfolioRows}>
    {closed.map(trade => <div className={styles.portfolioRow} key={`closed-${trade.symbol}-${trade.opened_at}`}>
      <div className={styles.portfolioRowMain}><strong>{trade.symbol}</strong><span>CLOSED TRADE</span></div>
      <div><span>Entry</span><strong>{money(trade.entry_price)}</strong></div>
      <div><span>Exit</span><strong>{money(trade.exit_price)}</strong></div>
      <div><span>Realized P/L</span><strong>{signedMoney(trade.realized_pl)}</strong></div>
      <div><span>R multiple</span><strong>{trade.r_multiple == null ? "—" : `${trade.r_multiple >= 0 ? "+" : ""}${trade.r_multiple.toFixed(2)}R`}</strong></div>
      <div><span>Closed</span><strong>{stamp(trade.closed_at)}</strong></div>
    </div>)}
    {executions.map((fill, index) => <div className={styles.portfolioRow} key={`fill-${fill.symbol}-${fill.transaction_time}-${index}`}>
      <div className={styles.portfolioRowMain}><strong>{fill.symbol}</strong><span>{fill.side.toUpperCase()} FILL</span></div>
      <div><span>Quantity</span><strong>{fill.quantity}</strong></div>
      <div><span>Fill price</span><strong>{money(fill.price)}</strong></div>
      <div><span>Time</span><strong>{stamp(fill.transaction_time)}</strong></div>
      <div><span>Ledger</span><strong>{fill.ledger_applied_at ? "Applied" : "Pending"}</strong></div>
    </div>)}
  </div>;
}

function PortfolioPanel({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return <section className={styles.portfolioPanel}>
    <div className={styles.portfolioPanelHeader}><h2>{title}</h2>{action}</div>
    {children}
  </section>;
}

function prospectBotLabel(id: string) {
  const profile = PAPER_BOT_PROFILES.find(item => item.id === id);
  return profile ? botShortName(profile) : id;
}

function ProspectRows({ rows, currentPriceFor, compact = false }: {
  rows: PaperProspect[];
  currentPriceFor?: (row: PaperProspect) => number | null;
  compact?: boolean;
}) {
  const visible = compact ? rows.slice(0, 4) : rows;
  if (!visible.length) return <EmptyState>No scanner prospects currently meet this level.</EmptyState>;

  return <div className={styles.prospectGrid}>
    {visible.map(row => {
      const isNew = row.metadata.alreadyKnown !== true;
      const isPenny = row.asset_class === "stock" && row.price != null && row.price >= 0.08 && row.price <= 5;
      const isSqueeze = row.source_flags.includes("squeeze-scanner") || row.metadata.scannerSource === "squeeze";
      const labels = [
        row.asset_class === "crypto" ? "Crypto" : "Stock",
        isPenny ? "PENNY" : null,
        isSqueeze ? "SQUEEZE" : null,
        isNew ? "NEW PROSPECT" : "already monitored",
      ].filter(Boolean).join(" · ");
      return <article className={styles.prospectCard} key={`${row.asset_class}-${row.symbol}`}>
        <div className={styles.prospectHeader}>
          <div>
            <strong>{row.symbol}</strong>
            <small>{labels}</small>
          </div>
          <div className={styles.prospectScore}><span>Prospect score</span><strong>{row.score.toFixed(0)}/100</strong></div>
        </div>
        <div className={styles.prospectStatus}>
          <span>{row.status === "review-ready" ? "BOT REVIEW READY" : "PROSPECT WATCHLIST"}</span>
          <div className={styles.prospectCurrentPrice}>
            <small>Current price</small>
            <strong>{marketPriceMoney(currentPriceFor?.(row) ?? row.price)}</strong>
          </div>
        </div>
        <div className={styles.prospectMetrics}>
          <span><small>Change</small><strong>{percent(row.percent_change)}</strong></span>
          <span><small>Volume vs prior</small><strong>{row.volume_ratio == null ? "—" : `${row.volume_ratio.toFixed(2)}×`}</strong></span>
          <span><small>Spread</small><strong>{row.spread_pct == null ? "—" : `${row.spread_pct.toFixed(2)}%`}</strong></span>
          <span><small>From high</small><strong>{row.near_high_pct == null ? "—" : `${row.near_high_pct.toFixed(2)}%`}</strong></span>
          <span><small>Activity rank</small><strong>{row.activity_rank == null ? "—" : `#${row.activity_rank}`}</strong></span>
          <span><small>First seen</small><strong>{stamp(row.first_seen_at)}</strong></span>
        </div>
        {(row.assigned_bot_ids.length || row.suggested_bot_ids.length)
          ? <div className={styles.prospectBots}>
              <small>{row.assigned_bot_ids.length ? "Assigned for bot review" : "Suggested next review"}</small>
              <strong>{(row.assigned_bot_ids.length ? row.assigned_bot_ids : row.suggested_bot_ids).map(prospectBotLabel).join(" · ")}</strong>
            </div>
          : null}
        <small className={styles.prospectReason}>{row.reasons.slice(0, 4).join(" · ")}</small>
      </article>;
    })}
  </div>;
}

export default function PaperBotLab() {
  const [selectedBotId, setSelectedBotId] = useState(ACTIVE_PROFILES[0]?.id ?? "default-diverse");
  const [view, setView] = useState<PortfolioView>("portfolio");
  const { report: accountReport, error: accountError, refresh: refreshAccount } = useAccountReport();
  const { report: ledgerReport, error: ledgerError, refresh: refreshLedgers } = usePaperBotLedgers();
  const { report: swingReadiness, error: swingReadinessError } = useSwingReadiness();
  const { report: cryptoSwingReadiness, error: cryptoSwingReadinessError } = useCryptoSwingReadiness();
  const { report: squeezeReadiness, error: squeezeReadinessError } = useSqueezeBreakoutReadiness();
  const { report: cryptoReadiness, error: cryptoReadinessError } = useWeekendCryptoReadiness();
  const { report: strategyReview, error: strategyReviewError, refresh: refreshStrategyReview } = usePaperStrategyReview();
  const { report: prospectReport, error: prospectError } = usePaperProspects();
  const { watchlist, error: watchlistError } = useSharedWatchlist();

  const stockSymbols = watchlist.stocks.map(item => item.symbol).join(",");
  const cryptoSymbols = watchlist.crypto.map(item => item.symbol).join(",");
  const { snapshot: marketSnapshot, error: marketError, refresh: refreshMarket } = useMarketMonitor(stockSymbols, cryptoSymbols, true);

  const prospectQuoteRows = [...(prospectReport?.prospects ?? []), ...(prospectReport?.nearMisses ?? [])];
  const prospectStockSymbols = [...new Set(prospectQuoteRows
    .filter(item => item.asset_class === "stock")
    .map(item => item.symbol))]
    .slice(0, 20)
    .join(",");
  const prospectCryptoSymbols = [...new Set(prospectQuoteRows
    .filter(item => item.asset_class === "crypto")
    .map(item => normalizedSymbol(item.symbol)))]
    .slice(0, 10)
    .join(",");
  const {
    snapshot: prospectMarketSnapshot,
    error: prospectMarketError,
    refresh: refreshProspectMarket,
  } = useMarketMonitor(
    prospectStockSymbols,
    prospectCryptoSymbols,
    Boolean(prospectStockSymbols || prospectCryptoSymbols),
  );

  const currentProspectPrice = (row: PaperProspect) => {
    if (row.asset_class === "stock") {
      const quote = prospectMarketSnapshot?.stocks[row.symbol];
      return quote ? midPrice(quote.bid, quote.ask) : row.price;
    }
    const quote = prospectMarketSnapshot?.crypto.find(
      item => normalizedSymbol(item.product) === normalizedSymbol(row.symbol),
    );
    return quote ? midPrice(quote.bestBid?.price, quote.bestAsk?.price) : row.price;
  };

  const profile = ACTIVE_PROFILES.find(item => item.id === selectedBotId) ?? ACTIVE_PROFILES[0];
  const ledger = ledgerReport?.bots.find(bot => bot.botId === profile.id) ?? null;
  const positions = ledgerReport?.positionPlans?.[profile.id] ?? [];
  const trades = ledgerReport?.tradeMetrics?.[profile.id] ?? [];
  const closedTrades = trades.filter(trade => trade.status === "closed");
  const stagedOrders = ledgerReport?.stagedOrders?.[profile.id] ?? [];
  const brokerOrders = ledgerReport?.brokerOrders?.[profile.id] ?? [];
  const fills = ledgerReport?.brokerFills?.[profile.id] ?? [];
  const terminalStatuses = new Set(["filled", "canceled", "cancelled", "rejected", "expired", "replaced", "closed", "done_for_day"]);
  const liveBrokerOrders = brokerOrders.filter(order => !terminalStatuses.has(order.status.toLowerCase()));
  const history = ledgerReport?.history?.[profile.id] ?? [];
  const review = strategyReview?.bots.find(item => item.botId === profile.id) ?? null;
  const counterfactuals = ledgerReport?.counterfactuals?.[profile.id] ?? [];
  const assignedProspects = prospectReport?.prospects.filter(item => item.assigned_bot_ids.includes(profile.id)) ?? [];

  const defaultTradePlans: PaperBotTradePlan[] = [...watchlist.stocks, ...watchlist.crypto].map(item => {
    const stockQuote = marketSnapshot?.stocks[item.symbol];
    const cryptoQuote = marketSnapshot?.crypto.find(entry => normalizedSymbol(entry.product) === normalizedSymbol(item.symbol));
    const currentPrice = stockQuote
      ? midPrice(stockQuote.bid, stockQuote.ask)
      : cryptoQuote
        ? midPrice(cryptoQuote.bestBid?.price, cryptoQuote.bestAsk?.price)
        : null;
    const assetClass = watchlist.stocks.some(stock => stock.symbol === item.symbol) ? "stock" as const : "crypto" as const;
    const decision = marketSnapshot ? (() => {
      const now = Date.parse(marketSnapshot.collectedAt);
      if (assetClass === "stock") {
        return evaluatePaperCandidate({
          candidate: item,
          assetClass,
          quote: {
            bid: stockQuote?.bid ?? null,
            ask: stockQuote?.ask ?? null,
            timestamp: stockQuote?.timestamp ?? null,
          },
          candles: marketSnapshot.stockBars[item.symbol] ?? [],
          benchmarkCandles: marketSnapshot.stockBars.SPY ?? [],
          now,
          risk: { accountEquity: ledger?.equity ?? profile.challengeStartingCash },
        });
      }
      return evaluatePaperCandidate({
        candidate: item,
        assetClass,
        quote: {
          bid: cryptoQuote?.bestBid?.price ?? null,
          ask: cryptoQuote?.bestAsk?.price ?? null,
          timestamp: cryptoQuote?.timestamp ?? null,
        },
        candles: cryptoQuote?.candles ?? [],
        benchmarkCandles: marketSnapshot.crypto.find(entry => normalizedSymbol(entry.product) === "BTC-USD")?.candles ?? [],
        now,
        risk: { accountEquity: ledger?.equity ?? profile.challengeStartingCash },
      });
    })() : null;

    const stagedPlan = stagedOrders.find(order => normalizedSymbol(order.symbol) === normalizedSymbol(item.symbol));
    const stagedQuantity = stagedPlan?.requested_quantity ?? (
      stagedPlan?.requested_notional != null && stagedPlan.entry_trigger != null && stagedPlan.entry_trigger > 0
        ? stagedPlan.requested_notional / stagedPlan.entry_trigger
        : null
    );
    const referenceEntry = decision?.referencePlan.entryTrigger ?? null;
    const referenceStop = decision?.referencePlan.stopPrice ?? null;
    const referenceExit = decision?.referencePlan.exitPrice ?? null;
    const availableCash = Math.max(0, ledger?.cash ?? ledger?.equity ?? profile.challengeStartingCash);
    const referencePurchase = decision?.referencePlan.uncappedPositionValue != null
      ? Math.min(decision.referencePlan.uncappedPositionValue, availableCash)
      : null;
    const referenceQuantity = referencePurchase != null && referenceEntry != null && referenceEntry > 0
      ? referencePurchase / referenceEntry
      : null;
    const referenceProfit = projectedProfit(referenceEntry, referenceExit, referenceQuantity);
    const referenceLoss = referenceEntry != null && referenceStop != null && referenceQuantity != null && referenceStop < referenceEntry
      ? (referenceEntry - referenceStop) * referenceQuantity
      : null;
    const stagedProfit = stagedPlan
      ? projectedProfit(stagedPlan.entry_trigger, stagedPlan.take_profit_price, stagedQuantity, stagedPlan.take_profit_fraction ?? 1)
      : null;
    const stagedPurchase = stagedPlan?.requested_notional ?? (
      stagedQuantity != null && stagedPlan?.entry_trigger != null
        ? stagedQuantity * stagedPlan.entry_trigger
        : null
    );
    const phase = stagedPlan
      ? "prepared" as const
      : referenceEntry != null && referenceStop != null && referenceExit != null
        ? "reference" as const
        : "awaiting-data" as const;

    return {
      contractVersion: PAPER_BOT_TRADE_PLAN_CONTRACT_VERSION,
      botId: profile.id,
      strategyId: decision?.strategyId ?? profile.strategyId,
      strategyVersion: decision?.strategyVersion ?? null,
      symbol: item.symbol.replace("-", "/"),
      label: item.label,
      assetClass,
      currentPrice,
      score: decision?.score ?? null,
      state: item.tier === "reserve" ? "RESERVE" : "WATCHING",
      detail: decision?.blockers[0] ?? decision?.warnings[0] ?? item.role,
      horizons: [
        ...(item.pools.includes("day") ? ["day" as const] : []),
        ...(item.pools.includes("multi-day") ? ["swing" as const] : []),
        ...(item.pools.includes("multi-week") ? ["long" as const] : []),
      ],
      executionEligible: item.tradable && item.pools.length > 0,
      selectedForSubmission: false,
      blockers: decision?.blockers ?? [],
      warnings: decision?.warnings ?? [],
      plan: {
        phase,
        entryPrice: stagedPlan?.entry_trigger ?? referenceEntry,
        purchaseAmount: stagedPurchase ?? referencePurchase,
        stopPrice: stagedPlan?.protective_stop ?? referenceStop,
        maxLossDollars: stagedPlan?.planned_risk_dollars ?? referenceLoss,
        exitPrice: stagedPlan?.take_profit_price ?? referenceExit,
        projectedProfitDollars: stagedPlan ? stagedProfit : referenceProfit,
        projectedProfitPct: stagedPlan && stagedPurchase != null && stagedPurchase > 0
          ? (stagedProfit ?? 0) / stagedPurchase * 100
          : referenceProfit != null && referencePurchase != null && referencePurchase > 0
            ? referenceProfit / referencePurchase * 100
            : null,
      },
    };
  });

  const swingTradePlans: PaperBotTradePlan[] = (swingReadiness?.plans ?? []).map(plan => {
    const activePlan = plan.executionPreview ?? plan.referencePlan;
    const planProfit = plan.executionPreview
      ? projectedProfit(plan.executionPreview.entryReference, plan.executionPreview.takeProfit, plan.executionPreview.quantity)
      : plan.referencePlan?.projectedProfitDollars ?? null;
    const planProfitPct = plan.executionPreview?.estimatedNotional
      ? ((planProfit ?? 0) / plan.executionPreview.estimatedNotional) * 100
      : plan.referencePlan?.projectedProfitPct ?? null;
    const phase = plan.executionPreview
      ? "ready" as const
      : plan.referencePlan
        ? "reference" as const
        : "awaiting-data" as const;

    return {
      contractVersion: PAPER_BOT_TRADE_PLAN_CONTRACT_VERSION,
      botId: profile.id,
      strategyId: swingReadiness?.strategyId ?? profile.strategyId,
      strategyVersion: swingReadiness?.strategyVersion ?? null,
      symbol: plan.symbol,
      label: "Weekly swing candidate",
      assetClass: plan.symbol === "QQQ" ? "etf" : "stock",
      currentPrice: midPrice(plan.bid, plan.ask),
      state: plan.selectedForSubmission ? "SELECTED" : plan.state.toUpperCase(),
      score: null,
      detail: plan.waitingOn[0] ?? plan.blockers[0] ?? "All currently evaluated gates pass.",
      horizons: ["swing"],
      executionEligible: true,
      selectedForSubmission: plan.selectedForSubmission,
      blockers: plan.blockers,
      warnings: plan.waitingOn,
      plan: {
        phase,
        entryPrice: activePlan?.entryReference ?? null,
        purchaseAmount: activePlan?.estimatedNotional ?? null,
        stopPrice: activePlan?.stopLoss ?? null,
        maxLossDollars: activePlan?.plannedRiskDollars ?? null,
        exitPrice: activePlan?.takeProfit ?? null,
        projectedProfitDollars: planProfit,
        projectedProfitPct: planProfitPct,
      },
    };
  });

  const cryptoTradePlans: PaperBotTradePlan[] = (cryptoReadiness?.candidates ?? []).map(candidate => {
    const readyForExecution = candidate.selectedForSubmission || candidate.state === "ready";
    const reference = candidate.referencePlan;
    const executionEntry = candidate.ask ?? candidate.trigger;
    const executionPurchase = candidate.plannedNotional ?? (
      executionEntry != null && candidate.plannedQuantity != null
        ? executionEntry * candidate.plannedQuantity
        : null
    );
    const executionProfit = candidate.estimatedGrossTargetDollars
      ?? projectedProfit(executionEntry, candidate.takeProfit, candidate.plannedQuantity);

    const entryPrice = readyForExecution
      ? executionEntry
      : reference?.entryPrice ?? candidate.trigger;
    const purchaseAmount = readyForExecution
      ? executionPurchase
      : reference?.plannedNotional ?? null;
    const stopPrice = readyForExecution
      ? candidate.protectiveStop
      : reference?.protectiveStop ?? null;
    const exitPrice = readyForExecution
      ? candidate.takeProfit
      : reference?.takeProfit ?? null;
    const maxLossDollars = readyForExecution
      ? candidate.plannedRiskDollars
      : reference?.plannedRiskDollars ?? null;
    const profit = readyForExecution
      ? executionProfit
      : reference?.estimatedGrossTargetDollars ?? null;
    const profitPct = readyForExecution
      ? purchaseAmount != null && purchaseAmount > 0 && profit != null
        ? profit / purchaseAmount * 100
        : null
      : reference?.projectedProfitPct ?? null;
    const phase = readyForExecution
      ? "ready" as const
      : reference
        ? "reference" as const
        : "awaiting-data" as const;

    return {
      contractVersion: PAPER_BOT_TRADE_PLAN_CONTRACT_VERSION,
      botId: profile.id,
      strategyId: cryptoReadiness?.strategyId ?? profile.strategyId,
      strategyVersion: cryptoReadiness?.strategyVersion ?? null,
      symbol: candidate.symbol,
      label: candidate.executionEligible ? "Execution eligible" : "Monitor only",
      assetClass: "crypto",
      currentPrice: midPrice(candidate.bid, candidate.ask),
      state: candidate.selectedForSubmission ? "SELECTED" : candidate.state.toUpperCase(),
      score: candidate.score,
      detail: candidate.blockers[0] ?? candidate.waitingOn[0] ?? "All currently evaluated gates pass.",
      horizons: ["day"],
      executionEligible: candidate.executionEligible,
      selectedForSubmission: candidate.selectedForSubmission,
      blockers: candidate.blockers,
      warnings: candidate.waitingOn,
      plan: {
        phase,
        entryPrice,
        purchaseAmount,
        stopPrice,
        maxLossDollars,
        exitPrice,
        projectedProfitDollars: profit,
        projectedProfitPct: profitPct,
      },
    };
  });

  const tradePlansBySource = {
    "decision-engine": defaultTradePlans,
    "swing-readiness": swingTradePlans,
    "crypto-readiness": cryptoTradePlans,
    "crypto-swing-readiness": cryptoSwingReadiness?.plans ?? [],
    "squeeze-breakout-readiness": squeezeReadiness?.plans ?? [],
  } satisfies Record<Exclude<PaperBotProfile["tradePlan"]["source"], "not-configured">, PaperBotTradePlan[]>;

  const candidateTradePlans = profile.tradePlan.source === "not-configured"
    ? []
    : tradePlansBySource[profile.tradePlan.source];

  const watchRows: WatchRow[] = candidateTradePlans.map(tradePlan => {
    const symbol = normalizedSymbol(tradePlan.symbol);
    const position = positions.find(item => normalizedSymbol(item.symbol) === symbol);
    const activeOrder = liveBrokerOrders.find(item => normalizedSymbol(item.symbol) === symbol);
    const latestClosed = closedTrades
      .filter(item => normalizedSymbol(item.symbol) === symbol)
      .sort((a, b) => Date.parse(b.closed_at ?? b.opened_at) - Date.parse(a.closed_at ?? a.opened_at))[0];
    const lifecycle = derivePaperBotLifecycle(tradePlan, {
      openPosition: Boolean(position),
      activeOrder: activeOrder ? { side: activeOrder.side, status: activeOrder.status } : null,
      latestClosedTrade: latestClosed ? { realizedPl: latestClosed.realized_pl } : null,
    });

    return {
      symbol: tradePlan.symbol,
      label: tradePlan.label,
      currentPrice: tradePlan.currentPrice,
      state: tradePlan.state,
      score: tradePlan.score,
      detail: tradePlan.detail,
      strategies: tradePlan.horizons,
      targetEntry: tradePlan.plan.entryPrice,
      projectedPurchase: tradePlan.plan.purchaseAmount,
      stopPrice: tradePlan.plan.stopPrice,
      projectedLoss: tradePlan.plan.maxLossDollars,
      exitPrice: tradePlan.plan.exitPrice,
      projectedProfit: tradePlan.plan.projectedProfitDollars,
      projectedProfitPct: tradePlan.plan.projectedProfitPct,
      planLabel: paperBotPlanLabel(tradePlan.plan.phase),
      lifecycleStage: lifecycle.stage,
      lifecycleDetail: lifecycle.detail,
      executionEligible: tradePlan.executionEligible,
    };
  });

  const equity = ledger?.equity ?? profile.challengeStartingCash;
  const realized = ledger?.realizedPl ?? 0;
  const unrealized = ledger?.unrealizedPl ?? 0;
  const totalPl = equity - profile.challengeStartingCash;
  const totalReturn = (equity / profile.challengeStartingCash - 1) * 100;
  const openOrderCount = liveBrokerOrders.length + stagedOrders.length;

  const views: Array<{ id: PortfolioView; label: string }> = [
    { id: "portfolio", label: "Portfolio" },
    { id: "holdings", label: `Holdings ${positions.length}` },
    { id: "watchlist", label: `Watchlist ${watchRows.length}` },
    { id: "prospects", label: `Prospects ${prospectReport?.prospects.length ?? 0}` },
    { id: "orders", label: `Orders ${openOrderCount}` },
    { id: "trades", label: "Recent trades" },
    { id: "strategy", label: "Strategy" },
  ];

  const refreshAll = () => {
    refreshLedgers();
    refreshAccount();
    refreshStrategyReview();
    refreshMarket();
    refreshProspectMarket();
  };

  const capitalModel = ledgerReport?.accountingModel;
  const programCapital = capitalModel?.programStartingCapital ?? 1000;
  const reservedBotPools = capitalModel?.reservedBotPools ?? 6;
  const botPoolCapital = capitalModel?.challengeStartingCash ?? 100;
  const unallocatedReserve = capitalModel?.unallocatedReserve ?? 400;

  return <main className={styles.botLab}>
    <header className={styles.botLabHeader}>
      <div>
        <Link href="/paper-trading">← Trading Lab</Link>
        <h1>Bot Portfolios</h1>
        <p>A $1,000 virtual trading fund reserves six $100 bot pools now, with the remaining $400 held for future bots. Holdings, P/L, orders, fills, and trade history stay attributed to the assigned bot.</p>
      </div>
      <div className={styles.botLabActions}><button onClick={refreshAll}>Refresh</button></div>
    </header>

    <nav className={styles.botSwitcher} aria-label="Bot portfolios">
      {PAPER_BOT_PROFILES.map(item => {
        const itemLedger = ledgerReport?.bots.find(bot => bot.botId === item.id);
        const active = item.status === "active";
        return <button
          key={item.id}
          aria-pressed={active && item.id === profile.id}
          disabled={!active}
          onClick={() => { if (active) { setSelectedBotId(item.id); setView("portfolio"); } }}
          title={active ? item.style : "Reserved $100 pool · strategy setup pending"}
        >
          <span>{botShortName(item)}</span>
          <strong>{money(itemLedger?.equity ?? item.challengeStartingCash)}</strong>
          <small>{active ? signedMoney((itemLedger?.equity ?? item.challengeStartingCash) - item.challengeStartingCash) : "Reserved · planned"}</small>
        </button>;
      })}
    </nav>

    <section className={styles.portfolioHero}>
      <div className={styles.portfolioHeroTitle}>
        <div>
          <span className={styles.botStatusActive}>ACTIVE · SIMULATION</span>
          <h2>{profile.name}</h2>
          <p>{profile.style}</p>
        </div>
        <div className={styles.portfolioHeroValue}>
          <span>Portfolio value</span>
          <strong>{money(equity)}</strong>
          <small>{signedMoney(totalPl)} · {percent(totalReturn)}</small>
        </div>
      </div>
      <div className={styles.portfolioStats}>
        <SummaryCard label="Total P/L" value={signedMoney(totalPl)} detail="vs. $100 start" />
        <SummaryCard label="Realized P/L" value={signedMoney(realized)} />
        <SummaryCard label="Unrealized P/L" value={signedMoney(unrealized)} />
        <SummaryCard label="Cash" value={money(ledger?.cash ?? profile.challengeStartingCash)} />
        <SummaryCard label="Holdings" value={String(positions.length)} />
        <SummaryCard label="Open / planned orders" value={String(openOrderCount)} />
      </div>
      <div className={styles.portfolioMeta}>
        <span>Strategy {(ledger?.strategyId ?? profile.strategyId ?? "pending").replace(/^paper-/, "").replaceAll("-", " ")}{ledger?.strategyVersion ? ` · v${ledger.strategyVersion}` : ""}</span>
        <span>Virtual fund {money(programCapital)} · {reservedBotPools} × {money(botPoolCapital)} pools · {money(unallocatedReserve)} reserve</span>
        <span>Last ledger sync {stamp(ledger?.lastSyncedAt)}</span>
      </div>
    </section>

    <nav className={styles.portfolioNav} aria-label="Portfolio sections">
      {views.map(item => <button key={item.id} aria-pressed={view === item.id} onClick={() => setView(item.id)}>{item.label}</button>)}
    </nav>

    {ledgerError || accountError || swingReadinessError || cryptoSwingReadinessError || squeezeReadinessError || cryptoReadinessError || strategyReviewError || prospectError || watchlistError || marketError || prospectMarketError
      ? <div className={styles.portfolioWarnings}>
          {[ledgerError, accountError, swingReadinessError, cryptoSwingReadinessError, squeezeReadinessError, cryptoReadinessError, strategyReviewError, prospectError, watchlistError, marketError, prospectMarketError].filter(Boolean).map((error, index) => <span key={index}>{error}</span>)}
        </div>
      : null}

    {view === "portfolio" ? <div className={styles.portfolioDashboard}>
      <PortfolioPanel title="Holdings" action={<button onClick={() => setView("holdings")}>View all</button>}>
        <HoldingRows positions={positions} trades={trades} accountPositions={accountReport?.snapshot?.positions} compact />
      </PortfolioPanel>
      <PortfolioPanel title="Orders" action={<button onClick={() => setView("orders")}>View all</button>}>
        {liveBrokerOrders.length
          ? <BrokerOrderRows orders={liveBrokerOrders} compact />
          : <StagedOrderRows orders={stagedOrders} watchRows={watchRows} compact />}
      </PortfolioPanel>
      <PortfolioPanel title="Watchlist" action={<button onClick={() => setView("watchlist")}>View all</button>}>
        <StrategyLegend />
        <WatchRows rows={watchRows} compact />
      </PortfolioPanel>
      <PortfolioPanel title="Recent trades" action={<button onClick={() => setView("trades")}>View all</button>}>
        <TradeRows closedTrades={closedTrades} fills={fills} compact />
      </PortfolioPanel>
    </div> : null}

    {view === "holdings" ? <PortfolioPanel title={`${botShortName(profile)} holdings`}>
      <HoldingRows positions={positions} trades={trades} accountPositions={accountReport?.snapshot?.positions} />
    </PortfolioPanel> : null}

    {view === "watchlist" ? <PortfolioPanel title={`${botShortName(profile)} watchlist`} action={<Link href="/paper-trading/research">Research →</Link>}>
      <StrategyLegend />
      <WatchRows rows={watchRows} />
      <p className={styles.portfolioNote}>D / S / L describes the strategy horizon this symbol is currently configured to be considered for. It is not trade authorization; score, setup state, risk, liquidity, and execution gates still have to pass.</p>
      {profile.id === "weekend-crypto-day-100" ? <p className={styles.portfolioNote}>Only BTC/USD, ETH/USD, SOL/USD, LINK/USD, and DOT/USD are execution-eligible. Monitor-only crypto remains research evidence and cannot trigger a READY submission by itself.</p> : null}
      {profile.id === "three-trade-weekly-swing-100" ? <p className={styles.portfolioNote}>QQQ, NVDA, and MSFT are revalidated against live quotes before a simulated submission can be selected. Swing v1 deliberately uses READY/waiting/blocked revalidation rather than a synthetic 0–100 score, so its Score field shows N/A.</p> : null}
      {profile.id === "crypto-swing-100" ? <p className={styles.portfolioNote}>Crypto Swing v1 uses 1-hour trend, momentum, volume expansion and breakout structure for 1-7 day reference plans. It receives only scanner-assigned crypto prospects. Automated execution is intentionally disabled while we collect initial swing evidence.</p> : null}
      {profile.id === "squeeze-breakout-100" ? <p className={styles.portfolioNote}>Squeeze Breakout v1 looks for an extended compressed stock base, historically quieter volume, then increasing relative-volume pace as price presses toward or through the base high. The 20–30% opportunity zone is a target scenario, not a prediction. Automated execution stays disabled while we validate the signal.</p> : null}
    </PortfolioPanel> : null}

    {view === "prospects" ? <div className={styles.portfolioSingleColumn}>
      <PortfolioPanel title={`${botShortName(profile)} prospect review queue`}>
        <ProspectRows rows={assignedProspects} currentPriceFor={currentProspectPrice} />
        <p className={styles.portfolioNote}>These symbols crossed the 80-point Prospect Score and were automatically assigned to this bot for strategy review. They are candidates for the bot to evaluate next, not READY trades.</p>
      </PortfolioPanel>
      <PortfolioPanel title="Market Prospect Scanner">
        <div className={styles.portfolioStats}>
          <SummaryCard label="Watchlist threshold" value={`${prospectReport?.thresholds.watchlistScore ?? 65}/100`} />
          <SummaryCard label="Bot-review threshold" value={`${prospectReport?.thresholds.botReviewScore ?? 80}/100`} />
          <SummaryCard label="Prospects" value={String(prospectReport?.prospects.length ?? 0)} />
          <SummaryCard label="Review ready" value={String(prospectReport?.counts.reviewReady ?? 0)} />
          <SummaryCard label="New symbols" value={String(prospectReport?.counts.newToExistingLists ?? 0)} />
          <SummaryCard label="Last scan" value={stamp(prospectReport?.lastSeenAt)} />
        </div>
        <ProspectRows rows={prospectReport?.prospects ?? []} currentPriceFor={currentProspectPrice} />
        <p className={styles.portfolioNote}>The scanner is discovery-only. A score of 65 adds a symbol to the prospect watchlist; 80 automatically assigns it to the appropriate bot review queue. That assignment is review-only: it cannot authorize an order or silently expand a bot&apos;s execution universe.</p>
      </PortfolioPanel>
      <PortfolioPanel title="Near the watchlist threshold">
        <ProspectRows rows={prospectReport?.nearMisses ?? []} currentPriceFor={currentProspectPrice} />
        <p className={styles.portfolioNote}>Near-miss prospects are retained so we can see which high-volume or fast-moving symbols are approaching the discovery threshold before their normal bot score becomes compelling.</p>
      </PortfolioPanel>
    </div> : null}

    {view === "orders" ? <div className={styles.portfolioSingleColumn}>
      <PortfolioPanel title="Live tagged simulation orders">
        <BrokerOrderRows orders={liveBrokerOrders} />
      </PortfolioPanel>
      <PortfolioPanel title="Prepared plans">
        <StagedOrderRows orders={stagedOrders} watchRows={watchRows} />
      </PortfolioPanel>
    </div> : null}

    {view === "trades" ? <div className={styles.portfolioSingleColumn}>
      <PortfolioPanel title="Completed trades">
        {closedTrades.length ? <TradeRows closedTrades={closedTrades} fills={[]} /> : <EmptyState>No completed round-trip trades recorded for this bot yet.</EmptyState>}
      </PortfolioPanel>
      <PortfolioPanel title="Recent executions">
        {fills.length ? <TradeRows closedTrades={[]} fills={fills} /> : <EmptyState>No tagged fills recorded for this bot yet.</EmptyState>}
      </PortfolioPanel>
    </div> : null}

    {view === "strategy" ? <div className={styles.portfolioSingleColumn}>
      <PortfolioPanel title="Strategy evidence">
        {review ? <>
          <div className={styles.portfolioStats}>
            <SummaryCard label="Decision observations" value={String(review.decisions.executionRelevantObservations)} />
            <SummaryCard label="Closed trades" value={String(review.executed.closedTrades)} />
            <SummaryCard label="Average realized R" value={review.executed.averageR == null ? "—" : `${review.executed.averageR >= 0 ? "+" : ""}${review.executed.averageR.toFixed(2)}R`} />
            <SummaryCard label="Win rate" value={review.executed.winRatePct == null ? "—" : `${review.executed.winRatePct.toFixed(0)}%`} />
            <SummaryCard label="Counterfactuals" value={String(review.counterfactual.total)} />
            <SummaryCard label="Resolved evidence" value={String(review.evidenceMaturity.resolvedOutcomeSamples)} />
          </div>
          <div className={styles.strategyRecommendations}>
            {review.recommendations.map(item => <div key={item.id}><strong>{item.title}</strong><span>{item.rationale}</span><small>{item.evidenceCount} outcome samples · advisory only</small></div>)}
          </div>
        </> : <EmptyState>Strategy-review evidence is loading.</EmptyState>}
      </PortfolioPanel>
      <PortfolioPanel title="Recent counterfactual studies">
        {counterfactuals.length ? <div className={styles.portfolioRows}>{counterfactuals.slice(0, 8).map(item => <div className={styles.portfolioRow} key={`${item.symbol}-${item.decision_at}`}>
          <div className={styles.portfolioRowMain}><strong>{item.symbol}</strong><span>{item.source_event_type.replaceAll("_", " ")}</span></div>
          <div><span>Status</span><strong>{item.status}</strong></div>
          <div><span>Score</span><strong>{item.score ?? "—"}</strong></div>
          <div><span>Trigger</span><strong>{money(item.trigger_price)}</strong></div>
          <div><span>MFE / MAE</span><strong>{item.mfe_r >= 0 ? "+" : ""}{item.mfe_r.toFixed(2)}R / {item.mae_r >= 0 ? "+" : ""}{item.mae_r.toFixed(2)}R</strong></div>
          <div><span>Decision</span><strong>{stamp(item.decision_at)}</strong></div>
        </div>)}</div> : <EmptyState>No counterfactual studies recorded for this bot yet.</EmptyState>}
      </PortfolioPanel>
    </div> : null}

    <footer className={styles.portfolioFooter}>
      <span>Virtual bot ledgers are authoritative for strategy performance. Market data and execution infrastructure are shared services, not strategy capital.</span>
      <span>{history.length} equity checkpoints recorded.</span>
    </footer>
  </main>;
}
