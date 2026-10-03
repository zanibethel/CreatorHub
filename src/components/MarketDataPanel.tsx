"use client";

import { useEffect, useState } from "react";
import { quoteAge, type Candle, type MarketSnapshot } from "@/lib/market-monitor";
import Link from "next/link";
import QualificationCard from "./QualificationCard";
import type { PaperWatchlist } from "@/lib/paper-watchlist";
import styles from "./PaperTradingLab.module.css";

export type { MarketSnapshot } from "@/lib/market-monitor";

function Sparkline({ candles, label }: { candles: Candle[]; label: string }) {
  const values = candles.map(c => c.close).filter(Number.isFinite);
  if (values.length < 2) return <span className={styles.priceLabel}>History unavailable</span>;
  const min = Math.min(...values), max = Math.max(...values);
  const spread = max - min || 1;
  const points = values.map((v, i) => `${i / (values.length - 1) * 200},${48 - (v - min) / spread * 44}`).join(" ");
  return <svg className={styles.spark} viewBox="0 0 200 52" preserveAspectRatio="none" role="img" aria-label={label}>
    <polyline points={points} fill="none" stroke={values.at(-1)! >= values[0] ? "#62d9aa" : "#ff8888"} strokeWidth="2" vectorEffect="non-scaling-stroke" />
  </svg>;
}

const price = (v: number | null | undefined) => v == null || !Number.isFinite(v) || v <= 0 ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: v < 1 ? 6 : 2 }).format(v);
const symbols = (value: string) => [...new Set(value.split(",").map(v => v.trim().toUpperCase()).filter(Boolean))].slice(0,20);

export default function MarketDataPanel({ snapshot, stocks, crypto, onSetup, watchlist, accountEquity }: {
  snapshot: MarketSnapshot | null;
  stocks: string;
  crypto: string;
  onSetup: () => void;
  watchlist: PaperWatchlist;
  accountEquity: number | null;
}) {
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(4);
  const [now, setNow] = useState(0);

  useEffect(() => {
    setNow(Date.now());
    const mobile = window.matchMedia("(max-width: 650px)");
    const resize = () => { setPageSize(mobile.matches ? 2 : 4); setPage(0); };
    resize();
    mobile.addEventListener("change", resize);
    const timer = window.setInterval(() => { if (!document.hidden) setNow(Date.now()); }, 1000);
    return () => { window.clearInterval(timer); mobile.removeEventListener("change", resize); };
  }, []);

  const stockBenchmark = snapshot?.stockBars.SPY ?? [];
  const cryptoBenchmark = snapshot?.crypto.find(book => book.product === "BTC-USD")?.candles ?? [];
  const entries = [
    ...symbols(stocks).map(symbol => ({
      symbol,
      assetClass: "stock" as const,
      quote: snapshot?.stocks[symbol],
      candles: snapshot?.stockBars[symbol] ?? [],
      benchmarkCandles: stockBenchmark,
      source: "IEX · daily chart",
      time: snapshot?.stocks[symbol]?.timestamp,
    })),
    ...symbols(crypto).map(symbol => {
      const book = snapshot?.crypto.find(b => b.product === symbol);
      return {
        symbol,
        assetClass: "crypto" as const,
        quote: book ? { bid: book.bestBid?.price ?? null, ask: book.bestAsk?.price ?? null } : null,
        candles: book?.candles ?? [],
        benchmarkCandles: cryptoBenchmark,
        source: "Kraken · hourly chart",
        time: book?.timestamp,
      };
    }),
  ];

  const selection = (symbol: string) => [...watchlist.stocks,...watchlist.crypto].find(item => item.symbol === symbol);
  const pages = Math.max(1, Math.ceil(entries.length / pageSize));
  const current = Math.min(page, pages - 1);

  return <section className={styles.card} aria-label="Watchlist quotes">
    <div className={styles.cardHeader}><h2>Watchlist</h2><div className={styles.watchActions}>
      {pages > 1 ? <button onClick={() => setPage((current + 1) % pages)}>Symbols {current + 1}/{pages}</button> : null}
      <button onClick={onSetup}>Shared list</button><Link href="/paper-trading/research">Selection report</Link>
    </div></div>
    <p className={styles.meta}>All candidates remain watched. Strategy v1 scores the current setup, while execution stays disabled until every risk veto is resolved.</p>
    <div className={styles.watchGrid}>
      {entries.slice(current * pageSize, current * pageSize + pageSize).map(entry => <article key={entry.symbol} className={styles.symbol}>
        <strong>{entry.symbol}</strong>
        <span className={styles.priceLabel}>{selection(entry.symbol)?.tier === "reserve" ? "Reserve · watched · " : "Initial list · "}{selection(entry.symbol)?.role}</span>
        <div className={styles.price}>{price(entry.quote?.bid)}</div>
        <span className={styles.priceLabel}>Bid · ask {price(entry.quote?.ask)}</span>
        <Sparkline candles={entry.candles} label={`${entry.symbol} ${entry.source} closing prices`} />
        <span className={styles.priceLabel}>{entry.source}{entry.time ? ` · ${new Date(entry.time).toLocaleString()}` : " · no quote"}</span>
        {selection(entry.symbol) ? <QualificationCard
          item={selection(entry.symbol)!}
          quote={entry.quote}
          timestamp={entry.time}
          candles={entry.candles}
          benchmarkCandles={entry.benchmarkCandles}
          assetClass={entry.assetClass}
          accountEquity={accountEquity}
          now={now}
          source={entry.source}
          dataThrough={watchlist.dataThrough}
        /> : null}
        {entry.quote ? <span className={quoteAge(entry.time, now).stale ? styles.stale : styles.fresh}>{quoteAge(entry.time, now).label}</span> : null}
      </article>)}
    </div>
    <span className={styles.meta}>{snapshot ? `Last fetch ${new Date(snapshot.collectedAt).toLocaleString()} · USD bids, not last trades` : "Waiting for market quotes"}</span>
    {snapshot?.errors && Object.keys(snapshot.errors).length ? <details className={styles.feedIssues}><summary>{Object.keys(snapshot.errors).length} feed issue(s)</summary><p>{Object.entries(snapshot.errors).map(([source, error]) => `${source}: ${error}`).join(" · ")}</p></details> : null}
  </section>;
}
