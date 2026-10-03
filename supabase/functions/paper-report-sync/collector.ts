export type PaperReport = {
  collectedAt: string;
  account: { equity: number; cash: number | null; previousCloseEquity: number | null; currency: string };
  positions: Array<{ symbol: string; side: string; quantity: number | null; entry: number | null; marketValue: number | null; unrealizedPl: number | null }> | null;
  orders: Array<{ symbol: string; side: string; type: string; status: string; quantity: number | null; filled: number | null; limit: number | null; stop: number | null; submittedAt: string | null }> | null;
  fills: Array<{ symbol: string; side: string; quantity: number | null; price: number | null; time: string | null }> | null;
  errors: Record<string, string>;
  ordersMayBeTruncated: boolean;
};

const object = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const text = (v: unknown, fallback = "") => typeof v === "string" ? v.slice(0, 80) : fallback;
const number = (v: unknown) => {
  if ((typeof v !== "string" && typeof v !== "number") || (typeof v === "string" && !v.trim())) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const time = (v: unknown) => typeof v === "string" && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : null;
const rows = (v: unknown) => {
  if (!Array.isArray(v)) throw new Error("Unexpected provider response.");
  return v.map(object);
};

export async function collectPaperReport(key: string, secret: string, fetcher: typeof fetch = fetch) {
  if (!key || !secret) throw new Error("Add ALPACA_PAPER_API_KEY_ID and ALPACA_PAPER_API_SECRET_KEY to the collector secrets.");
  const read = async (path: string) => {
    const response = await fetcher(`https://paper-api.alpaca.markets/v2/${path}`, {
      method: "GET", headers: { "APCA-API-KEY-ID": key, "APCA-API-SECRET-KEY": secret, Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Alpaca paper API returned HTTP ${response.status}.`);
    return response.json() as Promise<unknown>;
  };
  const [accountResult, positionsResult, ordersResult, fillsResult] = await Promise.allSettled([
    read("account"), read("positions"), read("orders?status=open&limit=500&nested=false&direction=desc"),
    read("account/activities/FILL?direction=desc&page_size=10"),
  ]);
  if (accountResult.status !== "fulfilled") throw accountResult.reason;
  const account = object(accountResult.value);
  const equity = number(account.equity);
  if (equity === null || !text(account.id)) throw new Error("Paper account response is incomplete.");
  const errors: Record<string, string> = {};
  const list = <T>(name: string, result: PromiseSettledResult<unknown>, map: (row: Record<string, unknown>) => T) => {
    if (result.status === "rejected") { errors[name] = result.reason instanceof Error ? result.reason.message : "Source unavailable."; return null; }
    try { return rows(result.value).map(map); }
    catch { errors[name] = "Unexpected provider response."; return null; }
  };
  const report: PaperReport = {
    collectedAt: new Date().toISOString(),
    account: { equity, cash: number(account.cash), previousCloseEquity: number(account.last_equity), currency: text(account.currency, "USD") },
    positions: list("positions", positionsResult, p => ({ symbol: text(p.symbol), side: text(p.side), quantity: number(p.qty), entry: number(p.avg_entry_price), marketValue: number(p.market_value), unrealizedPl: number(p.unrealized_pl) })),
    orders: list("orders", ordersResult, o => ({ symbol: text(o.symbol), side: text(o.side), type: text(o.type), status: text(o.status), quantity: number(o.qty), filled: number(o.filled_qty), limit: number(o.limit_price), stop: number(o.stop_price), submittedAt: time(o.submitted_at) })),
    fills: list("fills", fillsResult, f => ({ symbol: text(f.symbol), side: text(f.side), quantity: number(f.qty), price: number(f.price), time: time(f.transaction_time) }))?.slice(0, 10) ?? null,
    errors, ordersMayBeTruncated: false,
  };
  report.ordersMayBeTruncated = (report.orders?.length ?? 0) >= 500;
  // The account ID is hashed only to separate history when the connected account changes.
  // Raw account/order IDs, client IDs, personal details and credentials are never stored.
  const sourceKey = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text(account.id))))).map(b => b.toString(16).padStart(2, "0")).join("");
  return { report, sourceKey };
}
