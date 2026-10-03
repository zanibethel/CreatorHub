export type BotPositionForMark = {
  symbol: string;
  asset_class: "stock" | "etf" | "crypto" | "unknown";
};

export type BotMark = {
  symbol: string;
  price: number;
  timestamp: string;
  source: string;
};

const finitePositive = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;

export async function collectPaperBotMarks(
  key: string,
  secret: string,
  positions: BotPositionForMark[],
  fetcher: typeof fetch = fetch,
): Promise<BotMark[]> {
  const unique = [...new Map(positions.filter(p => p?.symbol).map(p => [p.symbol, p])).values()];
  if (!unique.length) return [];
  const headers = { "APCA-API-KEY-ID": key, "APCA-API-SECRET-KEY": secret, Accept: "application/json" };
  const stocks = unique.filter(p => p.asset_class !== "crypto").map(p => p.symbol);
  const crypto = unique.filter(p => p.asset_class === "crypto").map(p => p.symbol);
  const marks: BotMark[] = [];

  if (stocks.length) {
    const query = new URLSearchParams({ symbols: stocks.join(","), feed: "iex" });
    const response = await fetcher(`https://data.alpaca.markets/v2/stocks/trades/latest?${query.toString()}`, {
      headers, cache: "no-store", signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Stock mark request returned HTTP ${response.status}.`);
    const body = await response.json() as { trades?: Record<string, { p?: number; t?: string }> };
    for (const symbol of stocks) {
      const trade = body.trades?.[symbol];
      if (finitePositive(trade?.p) && trade?.t) marks.push({ symbol, price: trade.p, timestamp: trade.t, source: "alpaca-iex-latest-trade" });
    }
  }

  if (crypto.length) {
    const query = new URLSearchParams({ symbols: crypto.join(",") });
    const response = await fetcher(`https://data.alpaca.markets/v1beta3/crypto/us/latest/trades?${query.toString()}`, {
      headers, cache: "no-store", signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Crypto mark request returned HTTP ${response.status}.`);
    const body = await response.json() as { trades?: Record<string, { p?: number; t?: string }> };
    for (const symbol of crypto) {
      const trade = body.trades?.[symbol];
      if (finitePositive(trade?.p) && trade?.t) marks.push({ symbol, price: trade.p, timestamp: trade.t, source: "alpaca-crypto-latest-trade" });
    }
  }

  return marks;
}
