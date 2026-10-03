"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import RotatingPortfolioReport, { REPORT_VIEWS, type ReportView } from "./RotatingPortfolioReport";
import useMarketMonitor from "./useMarketMonitor";
import useAccountReport from "./useAccountReport";
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
  const [stocks,setStocks] = useState("SPY,QQQ");
  const [crypto,setCrypto] = useState("BTC-USD,ETH-USD");
  const [draftStocks,setDraftStocks] = useState(stocks);
  const [draftCrypto,setDraftCrypto] = useState(crypto);
  const [error,setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const { snapshot, loading, error: feedError, status, enabled, setEnabled, refresh } = useMarketMonitor(stocks, crypto, ready);
  const { report: accountReport, error: accountError, refresh: refreshAccount } = useAccountReport();
  const account = accountReport?.snapshot?.account;
  const dayChange = account && account.previousCloseEquity !== null ? account.equity - account.previousCloseEquity : null;
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
      if (typeof saved.stocks === "string") setStocks(saved.stocks);
      if (typeof saved.crypto === "string") setCrypto(saved.crypto);
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
    setRotating(false); setDraftLinks({...links}); setDraftStocks(stocks); setDraftCrypto(crypto); setError(""); dialog.current?.showModal();
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
      window.localStorage.setItem(settingsKey,JSON.stringify({ version:1, links:clean, stocks:draftStocks, crypto:draftCrypto }));
      setStocks(draftStocks); setCrypto(draftCrypto); setLinks(clean); setSponsorIndex(0); setStorageError(""); dialog.current?.close();
    } catch { setError("Allow browser storage to save your report settings."); }
  }
  const monitorLabel = {
    off: "Quote monitor paused", connecting: "Fetching quotes…", monitoring: "Quotes refresh every 15s",
    partial: "Refreshing available feeds · some quotes unavailable", hidden: "Quotes paused while tab is hidden",
    retrying: "Feed unavailable · slowing retries", blocked: "Check feed access or symbols, then refresh",
  }[status];

  return <main className={styles.dashboard}>
    <header className={styles.header}>
      <div className={styles.brand}><Link href="/">CreatorHub</Link><h1>Day {day ?? "—"} of $1,000 Bot Trader</h1><span className={styles.pill}>INTERACTIVE REPORT</span></div>
      <div className={styles.metrics}>
        <div className={styles.metric}><span>{account ? "Paper account value" : "Challenge starting amount"}</span><strong>{formatPaperMoney(account?.equity ?? PAPER_STARTING_CASH)}</strong><small className={styles.meta}>{account ? "Recorded Alpaca paper balance" : "Awaiting account snapshots"}</small></div>
        <div className={styles.metric}><span>Day equity change</span><strong>{dayChange === null ? "—" : formatPaperMoney(dayChange)}</strong><small className={styles.meta}>{account ? "Includes cashflows" : "Not recorded"}</small></div>
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
            <button onClick={() => { refresh(); refreshAccount(); }} disabled={!ready || loading}>{loading ? "Fetching…" : "Refresh now"}</button>
          </div>
        </details>
      </div>
    </div>
    <div className={styles.stage} onFocusCapture={() => setRotating(false)} onPointerDown={() => setRotating(false)}>
      <RotatingPortfolioReport view={view} snapshot={snapshot} stocks={stocks} crypto={crypto} onSetup={openSettings} accountReport={accountReport} accountError={accountError} />
      <TradingSponsorCard links={links} index={sponsorIndex} onSetup={openSettings} />
    </div>
    <footer className={styles.footer}><span role="status" title={feedError || storageError || monitorLabel}>{feedError ? `${monitorLabel}: ${feedError}` : storageError || `${monitorLabel} · read-only report`}</span><span>{REPORT_VIEWS.findIndex(([id]) => id === view) + 1}/{REPORT_VIEWS.length} · {rotating ? "Rotates every 12s" : "Paused"}</span></footer>
    <dialog ref={dialog} className={styles.dialog} aria-labelledby="paper-settings-title">
      <h2 id="paper-settings-title">Report settings</h2>
      <form onSubmit={event => { event.preventDefault(); saveSettings(); }}>
        <section><h3>Challenge counter</h3><p>{startedOn ? `Started ${startedOn}.` : "Choose when day one begins."} The counter and settings are saved in this browser. This sets the report day only.</p><button type="button" disabled={!ready || !!startedOn} onClick={startCounter}>{startedOn ? "Counter started" : "Start day counter"}</button></section>
        <section><h3>Market monitor</h3><p>Save symbols to apply your watchlist. Quotes refresh every 15 seconds while this page is visible; charts refresh every five minutes. Stocks require Alpaca keys on the server. Crypto uses the public Kraken feed. Monitoring pauses when the page is closed.</p>
          <label>Stocks / ETFs<input value={draftStocks} maxLength={120} onChange={e => setDraftStocks(e.target.value)} placeholder="SPY,QQQ" /></label>
          <label>USD crypto pairs<input value={draftCrypto} maxLength={180} onChange={e => setDraftCrypto(e.target.value)} placeholder="BTC-USD,ETH-USD" /></label>
        </section>
        <section><h3>Account reporting</h3><p>Account data updates about every 30 seconds in the background. This page checks for the latest saved report every 15 seconds. Chart checkpoints are recorded each minute. Refresh now reads that saved report; it does not place orders or force a broker update.</p></section>
        <section><h3>QR destinations</h3><p>Blank links stay out of rotation. Add CoOperative when ready. Each code opens that exact destination; donation and ad checkout pages must already exist.</p>
          {SPONSOR_SLOTS.map(slot => <label key={slot.id}>{slot.title}<input type="url" placeholder="https://…" maxLength={256} value={draftLinks[slot.id] ?? ""} onChange={e => setDraftLinks(current => ({...current,[slot.id]:e.target.value}))} /></label>)}
        </section>
        {error || storageError ? <p role="alert" className={styles.error}>{error || storageError}</p> : null}
        <div className={styles.dialogActions}><button type="button" onClick={() => dialog.current?.close()}>Close</button><button type="submit">Save settings</button></div>
      </form>
    </dialog>
  </main>;
}
