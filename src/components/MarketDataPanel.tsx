"use client";

import { useState } from "react";
import { card, colors, secondaryButton } from "@/lib/ui";

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
};

type MarketSnapshot = {
  collectedAt: string;
  sources: { stocks: string | null; crypto: string | null };
  stocks: Record<string, StockQuote>;
  crypto: CryptoBook[];
  note: string;
};

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
