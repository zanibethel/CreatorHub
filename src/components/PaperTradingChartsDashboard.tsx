"use client";

import Link from "next/link";
import { useState } from "react";
import { PAPER_BOT_PROFILES, type PaperBotProfile } from "@/lib/paper-bot-profiles";
import usePaperBotLedgers from "./usePaperBotLedgers";
import usePaperProspects from "./usePaperProspects";
import usePaperChartData from "./usePaperChartData";
import { EquityCurve, PricePlanChart, ScoreSparkline, TradeOutcomeChart } from "./PaperTradingCharts";
import styles from "./PaperTradingLab.module.css";

const ACTIVE_PROFILES = PAPER_BOT_PROFILES.filter(profile => profile.status === "active");
const money = (value: number | null | undefined) => value == null ? "—" : new Intl.NumberFormat("en-US", {
  style:"currency",
  currency:"USD",
}).format(value);
const stamp = (value: string | null | undefined) => value ? new Date(value).toLocaleString() : "—";

function shortName(profile: PaperBotProfile) {
  return profile.codename ?? profile.name;
}

function Panel({ title, children }: { title:string; children:React.ReactNode }) {
  return <section className={styles.portfolioPanel}>
    <div className={styles.portfolioPanelHeader}><h2>{title}</h2></div>
    {children}
  </section>;
}

function Empty({ children }: { children:React.ReactNode }) {
  return <div className={styles.chartEmpty}>{children}</div>;
}

export default function PaperTradingChartsDashboard() {
  const [selectedBotId,setSelectedBotId] = useState(ACTIVE_PROFILES[0]?.id ?? "default-diverse");
  const { report:ledgerReport, error:ledgerError } = usePaperBotLedgers();
  const { report:prospectReport, error:prospectError } = usePaperProspects();

  const profile = ACTIVE_PROFILES.find(item => item.id === selectedBotId) ?? ACTIVE_PROFILES[0];
  const ledger = ledgerReport?.bots.find(bot => bot.botId === profile.id) ?? null;
  const history = ledgerReport?.history?.[profile.id] ?? [];
  const positions = ledgerReport?.positionPlans?.[profile.id] ?? [];
  const staged = ledgerReport?.stagedOrders?.[profile.id] ?? [];
  const trades = ledgerReport?.tradeMetrics?.[profile.id] ?? [];
  const closedTrades = trades.filter(trade => trade.status === "closed");
  const assignedProspects = prospectReport?.prospects.filter(item => item.assigned_bot_ids.includes(profile.id)) ?? [];

  const symbols = [...new Set([
    ...positions.map(item => item.symbol),
    ...staged.map(item => item.symbol),
    ...assignedProspects.map(item => item.symbol),
  ])].slice(0,20);

  const { report:chartReport, error:chartError } = usePaperChartData(profile.id,symbols);

  const seriesFor = (symbol: string) =>
    chartReport?.series?.[symbol]
    ?? chartReport?.series?.[symbol.replace("-", "/")]
    ?? [];

  return <main className={styles.botLab}>
    <header className={styles.botLabHeader}>
      <div>
        <Link href="/paper-trading/bots">← Bot Portfolios</Link>
        <h1>Trading Analytics Charts</h1>
        <p>Read-only visualizations for bot equity, open-position plans, prepared setups, prospect momentum, and completed trade outcomes.</p>
      </div>
    </header>

    <nav className={styles.botSwitcher} aria-label="Bot chart selection">
      {ACTIVE_PROFILES.map(item => {
        const itemLedger = ledgerReport?.bots.find(bot => bot.botId === item.id);
        return <button
          key={item.id}
          aria-pressed={item.id === profile.id}
          onClick={() => setSelectedBotId(item.id)}
        >
          <span>{shortName(item)}</span>
          <strong>{money(itemLedger?.equity ?? item.challengeStartingCash)}</strong>
          <small>{item.style}</small>
        </button>;
      })}
    </nav>

    {ledgerError || prospectError || chartError
      ? <div className={styles.portfolioWarnings}>
          {[ledgerError,prospectError,chartError].filter(Boolean).map((error,index) => <span key={index}>{error}</span>)}
        </div>
      : null}

    <div className={styles.chartPageGrid}>
      <div className={styles.chartPageFull}>
        <Panel title={`${shortName(profile)} equity curve`}>
          <EquityCurve points={history} startingCash={profile.challengeStartingCash} />
        </Panel>
      </div>

      <div className={styles.chartPageFull}>
        <Panel title="Open holding price plans">
          {positions.length ? <div className={styles.chartSymbolGrid}>
            {positions.map(position => {
              const candles = seriesFor(position.symbol);
              const latest = candles.at(-1)?.close ?? position.exit_manager_state.markPrice ?? position.average_entry;
              return <article className={styles.chartSymbolCard} key={position.symbol}>
                <div className={styles.chartSymbolHeader}>
                  <div><strong>{position.symbol}</strong><small>{position.quantity.toFixed(position.quantity < 1 ? 8 : 4)} units · holding</small></div>
                  <strong>{money(latest)}</strong>
                </div>
                <PricePlanChart
                  candles={candles}
                  current={latest}
                  fill={position.average_entry}
                  stop={position.protective_stop}
                  target={position.take_profit_price}
                  timeframe={chartReport?.timeframe}
                />
              </article>;
            })}
          </div> : <Empty>No open holdings for this bot yet.</Empty>}
        </Panel>
      </div>

      <div className={styles.chartPageFull}>
        <Panel title="Prepared setup charts">
          {staged.length ? <div className={styles.chartSymbolGrid}>
            {staged.map(order => {
              const candles = seriesFor(order.symbol);
              const latest = candles.at(-1)?.close ?? null;
              return <article className={styles.chartSymbolCard} key={`${order.symbol}-${order.entry_trigger}`}>
                <div className={styles.chartSymbolHeader}>
                  <div><strong>{order.symbol}</strong><small>prepared · {order.pool_id ?? "unassigned"}</small></div>
                  <strong>{money(latest)}</strong>
                </div>
                <PricePlanChart
                  candles={candles}
                  current={latest}
                  entry={order.entry_trigger}
                  stop={order.protective_stop}
                  target={order.take_profit_price}
                  timeframe={chartReport?.timeframe}
                />
              </article>;
            })}
          </div> : <Empty>No prepared plans for this bot yet.</Empty>}
        </Panel>
      </div>

      <Panel title="Prospect score trends">
        {assignedProspects.length ? <div className={styles.chartSymbolGrid}>
          {assignedProspects.slice(0,8).map(prospect => {
            const trend = prospectReport?.trends?.[`${prospect.asset_class}:${prospect.symbol}`] ?? [];
            return <article className={styles.chartSymbolCard} key={`${prospect.asset_class}-${prospect.symbol}`}>
              <div className={styles.chartSymbolHeader}>
                <div><strong>{prospect.symbol}</strong><small>scanner → {shortName(profile)}</small></div>
                <strong>{prospect.score.toFixed(0)}/100</strong>
              </div>
              <ScoreSparkline points={trend} compact={false} />
              <small className={styles.prospectReason}>{prospect.reasons.slice(0,3).join(" · ")}</small>
            </article>;
          })}
        </div> : <Empty>No scanner-assigned prospects for this bot right now.</Empty>}
      </Panel>

      <Panel title="Recent closed-trade outcomes">
        <TradeOutcomeChart trades={closedTrades} />
      </Panel>

      <div className={styles.chartPageFull}>
        <Panel title="Chart context">
          <div className={styles.portfolioStats}>
            <div className={styles.portfolioStat}><span>Bot</span><strong>{shortName(profile)}</strong><small>{profile.strategyId ?? "strategy pending"}</small></div>
            <div className={styles.portfolioStat}><span>Timeframe</span><strong>{chartReport?.timeframe ?? "Loading"}</strong><small>chosen for this bot&apos;s horizon</small></div>
            <div className={styles.portfolioStat}><span>Equity points</span><strong>{history.length}</strong><small>virtual ledger checkpoints</small></div>
            <div className={styles.portfolioStat}><span>Last chart refresh</span><strong>{stamp(chartReport?.collectedAt)}</strong><small>market history refreshes periodically</small></div>
          </div>
        </Panel>
      </div>
    </div>
  </main>;
}
