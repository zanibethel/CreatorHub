"use client";

import { useState } from "react";
import { card, colors, secondaryButton } from "@/lib/ui";

type Candle = { time: string; close: number };

type StockQuote = {
  bid: number | null;
  bidSize: number | null;
  ask: number | null;
  askSize: number | null;
  timestamp: string | null;
} | null;

type CryptoBook = {
  product: string;
  timestamp: string;
  bestBid: { price: number; size: number } | null;
  bestAsk: { price: number; size: number } | null;
  bids: Array<{ price: number; size: number }>;
  asks: Array<{ price: number; size: number }>;
  candles: Candle[];
};

type MarketSnapshot = {
  collectedAt: string;
  sources: { stocks: string | null; crypto: string | null };
  stocks: Record<string, StockQuote>;
  stockBars: Record<string, Candle[]>;
  crypto: CryptoBook[];
  note: string;
};

function Sparkline({ candles, label }: { candles: Candle[]; label: string }) {
  const values = candles.map((candle) => candle.close).filter(Number.isFinite);
  if (values.length < 2) {
    return <div style={{ minHeight: 62, display: "grid", placeItems: "center", color: colors.muted, fontSize: 11 }}>Chart appears when history is available</div>;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = max - min || Math.max(Math.abs(max) * 0.01, 0.01);
  const points = values.map((value, index) => {
    const x = (index / (values.length - 1)) * 240;
    const y = 54 - ((value - min) / spread) * 46;
    return `${x},${y}`;
  }).join(" ");
  const first = values[0];
  const last = values[values.length - 1];
  return (
    <div>
      <svg viewBox="0 0 240 60" role="img" aria-label={label} style={{ width: "100%", height: 62, display: "block" }}>
        <line x1="0" y1="56" x2="240" y2="56" stroke={colors.border} strokeWidth="1" />
        <polyline points={points} fill="none" stroke={last >= first ? "#62d9aa" : "#ff8888"} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", color: colors.muted, fontSize: 10 }}>
        <span>{candles.length} data points</span><span>{((last / first - 1) * 100).toFixed(2)}% over shown period</span>
      </div>
    </div>
  );
}

const formatPrice = (value: number | null | undefined) => value == null
  ? "—"
  : new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 8 }).format(value);

export default function MarketDataPanel() {
  const [stocks, setStocks] = useState("SPY,QQQ");
  const [crypto, setCrypto] = useState("BTC-USD,ETH-USD");
  const [snapshot, setSnapshot] = useState<MarketSnapshot | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams({ stocks, crypto });
      const response = await fetch(`/api/paper-trading/market-data?${query.toString()}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not load market data.");
      setSnapshot(result as MarketSnapshot);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load market data.");
      setSnapshot(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section style={{ ...card, marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20 }}>Market data check</h2>
          <p style={{ margin: "5px 0 0", color: colors.muted, fontSize: 13 }}>
            Read-only snapshot from Alpaca IEX and Kraken. Sample symbols are editable and do not create trades.
          </p>
        </div>
        {snapshot ? <span style={{ color: colors.muted, fontSize: 12 }}>Fetched {new Date(snapshot.collectedAt).toLocaleString()}</span> : null}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 10, marginTop: 13 }}>
        <label style={{ display: "grid", gap: 5, color: colors.muted, fontSize: 12 }}>
          Stock / ETF symbols
          <input value={stocks} onChange={(event) => setStocks(event.target.value)} placeholder="SPY,QQQ" aria-label="Stock and ETF symbols" />
        </label>
        <label style={{ display: "grid", gap: 5, color: colors.muted, fontSize: 12 }}>
          USD crypto pairs
          <input value={crypto} onChange={(event) => setCrypto(event.target.value)} placeholder="BTC-USD,ETH-USD" aria-label="USD crypto pairs" />
        </label>
        <div style={{ display: "flex", alignItems: "end" }}>
          <button type="button" onClick={refresh} disabled={loading} style={{ ...secondaryButton, opacity: loading ? 0.65 : 1 }}>
            {loading ? "Loading quotes…" : "Refresh market data"}
          </button>
        </div>
      </div>

      {error ? <p role="alert" style={{ color: "#ff9b9b", margin: "12px 0 0", fontSize: 13 }}>{error}</p> : null}
      {snapshot ? (
        <div style={{ display: "grid", gap: 12, marginTop: 14 }}>
          <div>
            <strong style={{ fontSize: 13 }}>Stocks · {snapshot.sources.stocks ?? "not requested"}</strong>
            <div style={{ overflowX: "auto", marginTop: 6 }}>
              <table style={{ width: "100%", minWidth: 500, borderCollapse: "collapse", textAlign: "left", fontSize: 12 }}>
                <thead><tr style={{ color: colors.muted }}>
                  {["Symbol", "Bid", "Ask", "Quote time"].map((heading) => <th key={heading} scope="col" style={{ padding: "7px 8px", borderBottom: `1px solid ${colors.border}` }}>{heading}</th>)}
                </tr></thead>
                <tbody>{Object.entries(snapshot.stocks).map(([symbol, quote]) => (
                  <tr key={symbol}>
                    <td style={{ padding: "8px", borderBottom: `1px solid ${colors.border}` }}>{symbol}</td>
                    <td style={{ padding: "8px", borderBottom: `1px solid ${colors.border}` }}>{formatPrice(quote?.bid)}</td>
                    <td style={{ padding: "8px", borderBottom: `1px solid ${colors.border}` }}>{formatPrice(quote?.ask)}</td>
                    <td style={{ padding: "8px", borderBottom: `1px solid ${colors.border}`, color: colors.muted }}>{quote?.timestamp ? new Date(quote.timestamp).toLocaleTimeString() : "No quote"}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 8, marginTop: 8 }}>
              {Object.entries(snapshot.stockBars).map(([symbol, candles]) => (
                <article key={symbol} style={{ border: "1px solid " + colors.border, borderRadius: 11, padding: 11 }}>
                  <strong>{symbol} · 30 daily closes</strong>
                  <Sparkline candles={candles} label={symbol + " daily closing price history"} />
                </article>
              ))}
            </div>
          </div>
          <div>
            <strong style={{ fontSize: 13 }}>Crypto order books · {snapshot.sources.crypto ?? "not requested"}</strong>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 8, marginTop: 6 }}>
              {snapshot.crypto.map((book) => (
                <article key={book.product} style={{ border: `1px solid ${colors.border}`, borderRadius: 11, padding: 11 }}>
                  <strong>{book.product}</strong>
                  <div style={{ color: colors.muted, fontSize: 12, marginTop: 6 }}>Best bid <span style={{ color: colors.text }}>{formatPrice(book.bestBid?.price)}</span></div>
                  <div style={{ color: colors.muted, fontSize: 12, marginTop: 3 }}>Best ask <span style={{ color: colors.text }}>{formatPrice(book.bestAsk?.price)}</span></div>
                  <div style={{ color: colors.muted, fontSize: 11, marginTop: 6 }}>Top {Math.min(book.bids.length, book.asks.length)} levels · fetched {new Date(book.timestamp).toLocaleTimeString()}</div>
                  <div style={{ marginTop: 8 }}><Sparkline candles={book.candles} label={book.product + " hourly closing price history"} /></div>
                </article>
              ))}
            </div>
          </div>
          <p style={{ color: colors.muted, fontSize: 11, lineHeight: 1.5, margin: 0 }}>{snapshot.note} Kraken depth describes Kraken's book only; this manual check does not persist history or activate hourly scans.</p>
        </div>
      ) : null}
    </section>
  );
}
