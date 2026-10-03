"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import RotatingPortfolioReport, { REPORT_VIEWS, type ReportView } from "./RotatingPortfolioReport";
import useMarketMonitor from "./useMarketMonitor";
import useAccountReport from "./useAccountReport";
import useSharedWatchlist from "./useSharedWatchlist";\nimport usePaperBotLedgers from "./usePaperBotLedgers";
import TradingSponsorCard, { SPONSOR_SLOTS, safeDestination, type SponsorLinks } from "./TradingSponsorCard";
import styles from "./PaperTradingLab.module.css";
import { PAPER_STARTING_CASH, formatPaperMoney } from "@/lib/paper-trading-config";

function dateKey(date: Date) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2,"0"), String(date.getDate()).padStart(2,"0")].join("-");
}
function challengeDay(start: string | null, today: string) {
  if (!start || !/^\d{4}-\d{2}-\d{2}$/.test(start)) return null;
  const a = Date.parse(start), b = Date.parse(today);
  return Number.isFinite(a) && Number.isFinite(b) && a <= b ? Math.floor((b - a) / 86400000) + 1 : null;
}

export default function PaperTradingLab() {
  const [view,setView] = useState<ReportView>("portfolio");
  const [rotating,setRotating] = useState(true);
  const [sponsorIndex,setSponsorIndex] = useState(0);
  const [startedOn,setStartedOn] = useState<string | null>(null);
  const [today,setToday] = useState("");
  const [ready,setReady] = useState(false);
  const [storageError,setStorageError] = useState("");
  const [links,setLinks] = useState<SponsorLinks>({});
  const [draftLinks,setDraftLinks] = useState<SponsorLinks>({});
  const { watchlist, error: watchlistError } = useSharedWatchlist();
  const stocks = watchlist.stocks.map(item => item.symbol).join(",");
  const crypto = watchlist.crypto.map(item => item.symbol).join(",");
  const [error,setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const { snapshot, loading, error: feedError, status, enabled, setEnabled, refresh } = useMarketMonitor(stocks, crypto, ready);
  const { report: accountReport, error: accountError, refresh: refreshAccount } = useAccountReport();
  const { report: botLedgerReport, error: botLedgerError, refresh: refreshBotLedgers } = usePaperBotLedgers();
  const account = accountReport?.snapshot?.account;
  const defaultLedger = botLedgerReport?.bots.find(bot => bot.botId === "default-diverse") ?? null;
  const challengeEquity = defaultLedger?.equity ?? PAPER_STARTING_CASH;
  const startKey = "creatorhub:paper-trading:challenge-started-on:public-report";
  const settingsKey = "creatorhub:paper-trading:stream-settings:public-report";
  const day = challengeDay(startedOn,today);

  useEffect(() => {
    try {
      setStartedOn(window.localStorage.getItem(startKey));
      const parsed = JSON.parse(window.localStorage.getItem(settingsKey) ?? "{}");
      const saved = parsed && typeof parsed === "object" ? parsed : {};
      const clean: SponsorLinks = {};
      SPONSOR_SLOTS.forEach(slot => { clean[slot.id] = safeDestination(typeof saved.links?.[slot.id] === "string" ? saved.links[slot.id] : ""); });
      setLinks(clean);
    } catch { setStorageError("Browser settings could not be restored."); }
    setToday(dateKey(new Date()));
    setReady(true);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) setRotating(false);
    const timer = window.setInterval(() => setToday(dateKey(new Date())),30000);
    return () => window.clearInterval(timer);
  }, [startKey,settingsKey]);

  useEffect(() => {
    if (!rotating) return;
    const pages = window.setInterval(() => {
      if (!document.hidden) setView(current => REPORT_VIEWS[(REPORT_VIEWS.findIndex(([id]) => id === current) + 1) % REPORT_VIEWS.length][0]);
    },12000);
    const sponsors = window.setInterval(() => { if (!document.hidden) setSponsorIndex(i => i + 1); },24000);
    return () => { window.clearInterval(pages); window.clearInterval(sponsors); };
  },[rotating]);

  function choose(next: ReportView) { setView(next); setRotating(false); }
  function move() { choose(REPORT_VIEWS[(REPORT_VIEWS.findIndex(([id]) => id === view) + 1) % REPORT_VIEWS.length][0]); }
  function openSettings() {
    setRotating(false); setDraftLinks({...links}); setError(""); dialog.current?.showModal();
  }
  function startCounter() {
    const date = dateKey(new Date());
    try { window.localStorage.setItem(startKey,date); setStartedOn(date); setStorageError(""); }
    catch { setStorageError("Allow browser storage to save the day counter."); }
  }
  function saveSettings() {
    const clean: SponsorLinks = {};
    for (const slot of SPONSOR_SLOTS) {
      const value = (draftLinks[slot.id] ?? "").trim();
      if (value && !safeDestination(value)) { setError(`${slot.title}: enter an HTTPS link of at most 256 characters without embedded login details.`); return; }
      clean[slot.id] = safeDestination(value);
    }
    try {
      window.localStorage.setItem(settingsKey,JSON.stringify({ version:2, links:clean }));
      setLinks(clean); setSponsorIndex(0); setStorageError(""); dialog.current?.close();
    } catch { setError("Allow browser storage to save your report settings."); }
  }
  const monitorLabel = {
    off: "Quote monitor paused", connecting: "Fetching quotes…", monitoring: "Quotes refresh every 15s",
    partial: "Refreshing available feeds · some quotes unavailable", hidden: "Quotes paused while tab is hidden",
    retrying: "Feed unavailable · slowing retries", blocked: "Check feed access or symbols, then refresh",
  }[status];

  return <main className={styles.dashboard}>
    <header className={styles.header}>
      <div className={styles.brand}><Link href="/">CreatorHub</Link><h1>Day {day ?? "—"} of $100 Default Diverse Bot</h1><span className={styles.pill}>INTERACTIVE REPORT</span></div>
      <div className={styles.metrics}>
        <div className={styles.metric}><span>Challenge virtual equity</span><strong>{formatPaperMoney(challengeEquity)}</strong><small className={styles.meta}>Isolated Default Diverse ledger</small></div>
        <div className={styles.metric}><span>Alpaca paper account</span><strong>{account ? formatPaperMoney(account.equity) : "—"}</strong><small className={styles.meta}>Execution sandbox / audit trail · not bot buying power</small></div>
      </div>
    </header>
    <div className={styles.toolbar}>
      <nav className={styles.tabs} aria-label="Report screens">{REPORT_VIEWS.map(([id,label]) => <button key={id} aria-pressed={view === id} onClick={() => choose(id)}>{label}</button>)}</nav>
      <div className={styles.controls}>
        <button onClick={() => setRotating(v => !v)} aria-pressed={rotating}>{rotating ? "Pause report" : "Resume report"}</button>
        <button onClick={move}>Next</button>
        <details className={styles.controlMenu}>
          <summary>Controls</summary>
          <div className={styles.controlOptions}>
            <button onClick={openSettings}>Report settings</button>
            <button onClick={() => setEnabled(value => !value)} aria-pressed={enabled}>{enabled ? "Pause quotes" : "Monitor quotes"}</button>
            <button onClick={() => { refresh(); refreshAccount(); refreshBotLedgers(); }} disabled={!ready || loading}>{loading ? "Fetching…" : "Refresh now"}</button>
          </div>
        </details>
      </div>
      <div className={styles.sharedWatchlist} aria-label="Persistent shared watchlist"><span>Watching</span><div>{[...watchlist.stocks,...watchlist.crypto].map(item => <button key={item.symbol} onClick={() => choose("watchlist")} title={`${item.tier === "reserve" ? "Reserve · watched" : "Initial list"} · ${item.role}: ${item.rationale}`}>{item.symbol}</button>)}</div><Link href="/paper-trading/bots">Bot Lab</Link><Link href="/paper-trading/research">Selection report</Link></div>
      {watchlistError ? <p role="status" className={styles.error}>{watchlistError}</p> : null}
      {botLedgerError ? <p role="status" className={styles.error}>Challenge ledger: {botLedgerError}</p> : null}
    </div>
    <div className={styles.stage} onFocusCapture={() => setRotating(false)} onPointerDown={() => setRotating(false)}>
      <RotatingPortfolioReport view={view} snapshot={snapshot} stocks={stocks} crypto={crypto} onSetup={openSettings} accountReport={accountReport} accountError={accountError} watchlist={watchlist} strategyEquity={challengeEquity} />
      <TradingSponsorCard links={links} index={sponsorIndex} onSetup={openSettings} />
    </div>
    <footer className={styles.footer}><span role="status" title={feedError || storageError || monitorLabel}>{feedError ? `${monitorLabel}: ${feedError}` : storageError || `${monitorLabel} · read-only report`}</span><span>{REPORT_VIEWS.findIndex(([id]) => id === view) + 1}/{REPORT_VIEWS.length} · {rotating ? "Rotates every 12s" : "Paused"}</span></footer>
    <dialog ref={dialog} className={styles.dialog} aria-labelledby="paper-settings-title">
      <h2 id="paper-settings-title">Report settings</h2>
      <form onSubmit={event => { event.preventDefault(); saveSettings(); }}>
        <section><h3>Challenge counter</h3><p>{startedOn ? `Started ${startedOn}.` : "Choose when day one begins."} The counter and settings are saved in this browser. This sets the report day only.</p><button type="button" disabled={!ready || !!startedOn} onClick={startCounter}>{startedOn ? "Counter started" : "Start day counter"}</button></section>
        <section><h3>Shared watchlist</h3><p>One saved selection across every report screen and device. Historical review through {watchlist.dataThrough}; all reviewed candidates are watched. Initial/reserve labels set research priority and do not permanently exclude a symbol from funded pools. Watching is not an entry signal.</p><p>Stocks / ETFs: {stocks}</p><p>Crypto: {crypto}</p><Link href="/paper-trading/research">Read the history review and selection rationale</Link><p>Quotes refresh every 15 seconds while visible; market charts refresh every five minutes. Crypto quotes use Kraken. Display settings and QR destinations stay local to this browser.</p></section>
        <section><h3>Account reporting</h3><p>Every bot challenge starts with $100 in its own virtual ledger. The Alpaca paper account is the execution sandbox and independent audit trail, not the bot bankroll. Account data updates about every 30 seconds; bot-tagged fills will be reconciled into the appropriate virtual ledger. Refresh never places an order.</p></section>
        <section><h3>QR destinations</h3><p>Blank links stay out of rotation. Add CoOperative when ready. Each code opens that exact destination; donation and ad checkout pages must already exist.</p>
          {SPONSOR_SLOTS.map(slot => <label key={slot.id}>{slot.title}<input type="url" placeholder="https://…" maxLength={256} value={draftLinks[slot.id] ?? ""} onChange={e => setDraftLinks(current => ({...current,[slot.id]:e.target.value}))} /></label>)}
        </section>
        {error || storageError ? <p role="alert" className={styles.error}>{error || storageError}</p> : null}
        <div className={styles.dialogActions}><button type="button" onClick={() => dialog.current?.close()}>Close</button><button type="submit">Save settings</button></div>
      </form>
    </dialog>
  </main>;
}
