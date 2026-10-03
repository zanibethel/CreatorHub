"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import RotatingPortfolioReport, { REPORT_VIEWS, type ReportView } from "./RotatingPortfolioReport";
import { type MarketSnapshot } from "./MarketDataPanel";
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

export default function PaperTradingLab({ userId }: { userId: string }) {
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
  const [snapshot,setSnapshot] = useState<MarketSnapshot | null>(null);
  const [loading,setLoading] = useState(false);
  const [error,setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const request = useRef<AbortController | null>(null);
  const startKey = `creatorhub:paper-trading:challenge-started-on:${userId}`;
  const settingsKey = `creatorhub:paper-trading:stream-settings:${userId}`;
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
    return () => { window.clearInterval(timer); request.current?.abort(); };
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
      request.current?.abort(); setLoading(false);
      if (stocks !== draftStocks || crypto !== draftCrypto) setSnapshot(null);
      setStocks(draftStocks); setCrypto(draftCrypto); setLinks(clean); setSponsorIndex(0); setStorageError(""); dialog.current?.close();
    } catch { setError("Allow browser storage to save your stream settings."); }
  }
  async function refresh() {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setLoading(true); setError("");
    try {
      const query = new URLSearchParams({stocks:draftStocks,crypto:draftCrypto});
      const response = await fetch(`/api/paper-trading/market-data?${query}`,{ cache:"no-store",signal:controller.signal });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not load quotes.");
      if (controller.signal.aborted) return;
      setSnapshot(result); setStocks(draftStocks); setCrypto(draftCrypto);
    } catch (caught) {
      if (!controller.signal.aborted) { setSnapshot(null); setError(caught instanceof Error ? caught.message : "Could not load quotes."); }
    } finally { if (!controller.signal.aborted) setLoading(false); }
  }

  return <main className={styles.dashboard}>
    <header className={styles.header}>
      <div className={styles.brand}><Link href="/">CreatorHub</Link><h1>Day {day ?? "—"} of $1,000 Bot Trader</h1><span className={styles.pill}>PAPER ONLY · simulator inactive</span></div>
      <div className={styles.metrics}>
        <div className={styles.metric}><span>Virtual starting cash</span><strong>{formatPaperMoney(PAPER_STARTING_CASH)}</strong><small className={styles.meta}>Account ledger not connected</small></div>
        <div className={styles.metric}><span>Today’s P/L</span><strong>—</strong><small className={styles.meta}>Not recorded</small></div>
      </div>
    </header>
    <div className={styles.toolbar}>
      <nav className={styles.tabs} aria-label="Report screens">{REPORT_VIEWS.map(([id,label]) => <button key={id} aria-pressed={view === id} onClick={() => choose(id)}>{label}</button>)}</nav>
      <div className={styles.controls}>
        <button onClick={() => setRotating(v => !v)} aria-pressed={rotating}>{rotating ? "Pause" : "Resume"}</button>
        <button onClick={move}>Next</button><button onClick={openSettings}>Stream settings</button>
      </div>
    </div>
    <div className={styles.stage} onFocusCapture={() => setRotating(false)}>
      <RotatingPortfolioReport view={view} snapshot={snapshot} stocks={stocks} crypto={crypto} onSetup={openSettings} />
      <TradingSponsorCard links={links} index={sponsorIndex} onSetup={openSettings} />
    </div>
    <footer className={styles.footer}><span>{storageError || "Manual quotes · no real orders · no account history recorded"}</span><span>{REPORT_VIEWS.findIndex(([id]) => id === view) + 1}/3 · {rotating ? "Rotates every 12s" : "Paused"}</span></footer>
    <dialog ref={dialog} className={styles.dialog} aria-labelledby="paper-settings-title" onClose={() => { request.current?.abort(); setLoading(false); }}>
      <h2 id="paper-settings-title">Stream settings</h2>
      <form onSubmit={event => { event.preventDefault(); saveSettings(); }}>
        <section><h3>Challenge counter</h3><p>{startedOn ? `Started ${startedOn}.` : "Choose when day one begins."} The counter and settings are saved in this browser. Starting it does not run the simulator.</p><button type="button" disabled={!ready || !!startedOn} onClick={startCounter}>{startedOn ? "Counter started" : "Start day counter"}</button></section>
        <section><h3>Market snapshots</h3><p>Sample symbols are editable. Stocks require Alpaca keys on the server; leave stocks blank to check crypto only. Prices are manual snapshots, not streaming quotes.</p>
          <label>Stocks / ETFs<input value={draftStocks} maxLength={120} onChange={e => setDraftStocks(e.target.value)} placeholder="SPY,QQQ" /></label>
          <label>USD crypto pairs<input value={draftCrypto} maxLength={180} onChange={e => setDraftCrypto(e.target.value)} placeholder="BTC-USD,ETH-USD" /></label>
          <button type="button" disabled={loading} onClick={refresh}>{loading ? "Fetching…" : "Refresh quotes"}</button>
        </section>
        <section><h3>QR destinations</h3><p>Blank links stay out of rotation. Add CoOperative when ready. Each code opens that exact destination; donation and ad checkout pages must already exist.</p>
          {SPONSOR_SLOTS.map(slot => <label key={slot.id}>{slot.title}<input type="url" placeholder="https://…" maxLength={256} value={draftLinks[slot.id] ?? ""} onChange={e => setDraftLinks(current => ({...current,[slot.id]:e.target.value}))} /></label>)}
        </section>
        {error || storageError ? <p role="alert" className={styles.error}>{error || storageError}</p> : null}
        <div className={styles.dialogActions}><button type="button" onClick={() => dialog.current?.close()}>Close</button><button type="submit">Save settings</button></div>
      </form>
    </dialog>
  </main>;
}
