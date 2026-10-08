"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { PAPER_BOT_PROFILES, type PaperBotProfile } from "@/lib/paper-bot-profiles";
import PaperSignalPipeline from "./PaperSignalPipeline";
import usePaperBotLedgers from "./usePaperBotLedgers";
import usePaperProspects, { type PaperProspect } from "./usePaperProspects";
import usePaperSignalDesk, { type PaperSignalDeskEvent } from "./usePaperSignalDesk";
import useMarketMonitor from "./useMarketMonitor";
import useSwingReadiness from "./useSwingReadiness";
import useCryptoSwingReadiness from "./useCryptoSwingReadiness";
import useSqueezeBreakoutReadiness from "./useSqueezeBreakoutReadiness";
import useWeekendCryptoReadiness from "./useWeekendCryptoReadiness";
import styles from "./PaperTradingLab.module.css";

const ACTIVE_PROFILES = PAPER_BOT_PROFILES.filter(profile => profile.status === "active");
const TERMINAL_ORDER_STATUSES = new Set(["filled","canceled","cancelled","rejected","expired","replaced","closed","done_for_day"]);

function shortName(profile: PaperBotProfile) {
  return profile.codename ?? profile.role ?? profile.name;
}

function normalizedSymbol(value: string) {
  return value.replace("/", "-").toUpperCase();
}

function midPrice(bid: number | null | undefined, ask: number | null | undefined) {
  return bid != null && ask != null && bid > 0 && ask > 0 ? (bid + ask) / 2 : bid ?? ask ?? null;
}

function Metric({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return <div className={styles.portfolioStat}>
    <span>{label}</span>
    <strong>{value}</strong>
    {detail ? <small>{detail}</small> : null}
  </div>;
}

export default function SignalDesk() {
  const [selectedBotId, setSelectedBotId] = useState<"all" | string>("all");
  const { report: ledgers, error: ledgerError, refresh: refreshLedgers } = usePaperBotLedgers();
  const { report: prospects, error: prospectError } = usePaperProspects();
  const { report: signalDesk, error: signalError, refresh: refreshSignals } = usePaperSignalDesk();
  const { report: swing, error: swingError } = useSwingReadiness();
  const { report: cryptoSwing, error: cryptoSwingError } = useCryptoSwingReadiness();
  const { report: squeeze, error: squeezeError } = useSqueezeBreakoutReadiness();
  const { report: dailyCrypto, error: dailyCryptoError } = useWeekendCryptoReadiness();

  const quoteRows = prospects?.prospects ?? [];
  const stockSymbols = [...new Set(quoteRows.filter(row => row.asset_class === "stock").map(row => row.symbol))]
    .slice(0,30)
    .join(",");
  const cryptoSymbols = [...new Set(quoteRows.filter(row => row.asset_class === "crypto").map(row => normalizedSymbol(row.symbol)))]
    .slice(0,15)
    .join(",");
  const { snapshot: market, error: marketError, refresh: refreshMarket } = useMarketMonitor(
    stockSymbols,
    cryptoSymbols,
    Boolean(stockSymbols || cryptoSymbols),
  );

  const visibleProfiles = selectedBotId === "all"
    ? ACTIVE_PROFILES
    : ACTIVE_PROFILES.filter(profile => profile.id === selectedBotId);

  const automationEnabled = (profile: PaperBotProfile) =>
    ledgers?.bots.find(bot => bot.botId === profile.id)?.executionEnabled === true;

  const currentPriceFor = (row: PaperProspect) => {
    if (row.asset_class === "stock") {
      const quote = market?.stocks[row.symbol];
      return quote ? midPrice(quote.bid, quote.ask) : row.price;
    }
    const quote = market?.crypto.find(item => normalizedSymbol(item.product) === normalizedSymbol(row.symbol));
    return quote ? midPrice(quote.bestBid?.price, quote.bestAsk?.price) : row.price;
  };

  const summary = useMemo(() => {
    const visibleIds = new Set(visibleProfiles.map(profile => profile.id));
    let assignedProspects = 0;
    let prepared = 0;
    let liveOrders = 0;
    let holdings = 0;
    let terminalDecisions = 0;
    let automaticBots = 0;

    for (const profile of visibleProfiles) {
      if (automationEnabled(profile)) automaticBots += 1;
      prepared += ledgers?.stagedOrders?.[profile.id]?.length ?? 0;
      liveOrders += (ledgers?.brokerOrders?.[profile.id] ?? [])
        .filter(order => !TERMINAL_ORDER_STATUSES.has(order.status.toLowerCase())).length;
      holdings += ledgers?.positionPlans?.[profile.id]?.length ?? 0;
      const latestBySymbol = new Map<string, PaperSignalDeskEvent>();
      for (const event of signalDesk?.events?.[profile.id] ?? []) {
        if (!event.symbol || latestBySymbol.has(event.symbol)) continue;
        latestBySymbol.set(event.symbol, event);
      }
      terminalDecisions += [...latestBySymbol.values()].filter(event => {
        if (event.event_type === "prospect-intake") {
          return !["staged","eligible"].includes((event.qualification ?? "").toLowerCase());
        }
        return true;
      }).length;
    }

    for (const row of prospects?.prospects ?? []) {
      assignedProspects += row.assigned_bot_ids.filter(id => visibleIds.has(id)).length;
    }

    return { assignedProspects, prepared, liveOrders, holdings, terminalDecisions, automaticBots };
  }, [visibleProfiles, ledgers, signalDesk, prospects]);

  const errors = [ledgerError, prospectError, signalError, swingError, cryptoSwingError, squeezeError, dailyCryptoError, marketError].filter(Boolean);

  const refresh = () => {
    refreshLedgers();
    refreshSignals();
    refreshMarket();
  };

  return <main className={styles.botLab}>
    <header className={styles.botLabHeader}>
      <div>
        <Link href="/paper-trading">← Trading Report</Link>
        <h1>Signal Desk</h1>
        <p>One read-only view of what the automated market system is discovering, preparing, executing, managing, and declining across every active bot.</p>
      </div>
      <div className={styles.botLabActions}>
        <Link href="/paper-trading/bots">Bot Portfolios</Link>
        <Link href="/paper-trading/movers">Market Movers</Link>
        <button type="button" onClick={refresh}>Refresh</button>
      </div>
    </header>

    <section className={styles.portfolioHero}>
      <div className={styles.portfolioHeroTitle}>
        <div>
          <span className={styles.botStatusActive}>LIVE SYSTEM VIEW</span>
          <h2>{selectedBotId === "all" ? "All active strategies" : shortName(visibleProfiles[0])}</h2>
          <p>The scanner can surface ideas early; each bot still owns its strategy-specific qualification, risk gates, and execution permissions.</p>
        </div>
        <div className={styles.portfolioHeroValue}>
          <span>Automatic bots shown</span>
          <strong>{summary.automaticBots}/{visibleProfiles.length}</strong>
          <small>Simulation only · live-money execution disabled</small>
        </div>
      </div>

      <div className={styles.portfolioStats}>
        <Metric label="Coming up" value={String(summary.assignedProspects)} detail="bot assignments" />
        <Metric label="Prepared" value={String(summary.prepared)} detail="planned entries" />
        <Metric label="Live orders" value={String(summary.liveOrders)} detail="submitted / working" />
        <Metric label="Holdings" value={String(summary.holdings)} detail="under management" />
        <Metric label="Passed / blocked" value={String(summary.terminalDecisions)} detail="latest symbol states" />
        <Metric label="Active bots" value={String(visibleProfiles.length)} />
      </div>
    </section>

    <nav className={styles.botSwitcher} aria-label="Signal Desk strategy filter">
      <button type="button" aria-pressed={selectedBotId === "all"} onClick={() => setSelectedBotId("all")}>
        <span>All Bots</span>
        <strong>{ACTIVE_PROFILES.length}</strong>
        <small>Cross-strategy view</small>
      </button>
      {ACTIVE_PROFILES.map(profile => {
        const ledger = ledgers?.bots.find(bot => bot.botId === profile.id);
        const auto = automationEnabled(profile);
        return <button
          type="button"
          key={profile.id}
          aria-pressed={selectedBotId === profile.id}
          onClick={() => setSelectedBotId(profile.id)}
        >
          <span>{shortName(profile)}</span>
          <strong>{ledger ? new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(ledger.equity) : "$100.00"}</strong>
          <small>{auto ? "Automatic simulation" : "Review / evidence"}</small>
        </button>;
      })}
    </nav>

    {errors.length ? <div className={styles.portfolioWarnings}>
      {errors.map((error,index) => <span key={index}>{error}</span>)}
    </div> : null}

    <div className={styles.signalDeskStack}>
      {visibleProfiles.map(profile => {
        const assigned = prospects?.prospects.filter(row => row.assigned_bot_ids.includes(profile.id)) ?? [];
        const stagedOrders = ledgers?.stagedOrders?.[profile.id] ?? [];
        const brokerOrders = (ledgers?.brokerOrders?.[profile.id] ?? [])
          .filter(order => !TERMINAL_ORDER_STATUSES.has(order.status.toLowerCase()));
        const positions = ledgers?.positionPlans?.[profile.id] ?? [];
        const intakeEvents = signalDesk?.events?.[profile.id] ?? [];

        return <section className={styles.signalStrategySection} key={profile.id}>
          <div className={styles.signalStrategyHeader}>
            <div>
              <span>{automationEnabled(profile) ? "AUTOMATIC SIMULATION" : "REVIEW / EVIDENCE"}</span>
              <h2>{shortName(profile)}</h2>
              <p>{profile.style}</p>
            </div>
            <Link href={`/paper-trading/bots/${profile.id}`}>Open bot profile →</Link>
          </div>
          <PaperSignalPipeline
            botName={shortName(profile)}
            automationEnabled={automationEnabled(profile)}
            prospects={assigned}
            stagedOrders={stagedOrders}
            brokerOrders={brokerOrders}
            positions={positions}
            intakeEvents={intakeEvents}
            currentPriceFor={currentPriceFor}
            compact={selectedBotId === "all"}
          />
        </section>;
      })}
    </div>

    <footer className={styles.portfolioFooter}>
      <span>Signal Desk is observational. It does not authorize or mutate trades.</span>
      <span>Internal route/table names may retain legacy simulation terminology for historical continuity.</span>
    </footer>
  </main>;
}
