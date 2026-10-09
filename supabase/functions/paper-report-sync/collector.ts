export type PaperReport = {
  collectedAt: string;
  account: { equity: number; cash: number | null; previousCloseEquity: number | null; currency: string };
  positions: Array<{ symbol: string; side: string; quantity: number | null; entry: number | null; marketValue: number | null; unrealizedPl: number | null }> | null;
  orders: Array<{ symbol: string; side: string; type: string; status: string; quantity: number | null; filled: number | null; averageFillPrice: number | null; limit: number | null; stop: number | null; submittedAt: string | null }> | null;
  fills: Array<{ symbol: string; side: string; quantity: number | null; price: number | null; time: string | null }> | null;
  errors: Record<string, string>;
  ordersMayBeTruncated: boolean;
};

export type PaperBrokerActivity = {
  orders: Array<{
    brokerOrderId: string;
    clientOrderId: string;
    attributionClientOrderId: string;
    parentBrokerOrderId: string | null;
    symbol: string;
    assetClass: "stock" | "crypto" | "unknown";
    side: string;
    orderType: string;
    orderClass: string;
    status: string;
    quantity: number | null;
    filledQuantity: number | null;
    averageFillPrice: number | null;
    submittedAt: string | null;
    filledAt: string | null;
    canceledAt: string | null;
    replacedAt: string | null;
    updatedAt: string | null;
  }>;
  fills: Array<{
    fillActivityId: string;
    brokerOrderId: string;
    symbol: string;
    side: string;
    quantity: number | null;
    price: number | null;
    cumulativeQuantity: number | null;
    leavesQuantity: number | null;
    transactionTime: string | null;
  }>;
};

const object = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const text = (v: unknown, fallback = "") => typeof v === "string" ? v.slice(0, 160) : fallback;
const number = (v: unknown) => {
  if ((typeof v !== "string" && typeof v !== "number") || (typeof v === "string" && !v.trim())) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const time = (v: unknown) => typeof v === "string" && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : null;
// Broker order cancellation is subsecond-sensitive: Date.toISOString()
// rounds to milliseconds and destroys the actual REST nanosecond evidence.
// Preserve the original validated UTC string in the PRIVATE ledger feed.
const brokerTime = (v: unknown) => typeof v === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(v) &&
  Number.isFinite(Date.parse(v)) ? v : null;
const rows = (v: unknown) => {
  if (!Array.isArray(v)) throw new Error("Unexpected provider response.");
  return v.map(object);
};
const taggedClientOrderId = (value: string) => /^chb-[a-z0-9]{2,12}-v[1-9][0-9]*-[a-z0-9]+-[a-z0-9]{6,24}$/.test(value);
const assetClass = (value: unknown): "stock" | "crypto" | "unknown" => value === "crypto" ? "crypto" : value === "us_equity" ? "stock" : "unknown";

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

  const [accountResult, positionsResult, ordersResult, brokerOrdersResult, fillsResult] = await Promise.allSettled([
    read("account"),
    read("positions"),
    read("orders?status=open&limit=500&nested=false&direction=desc"),
    read("orders?status=all&limit=500&nested=true&direction=desc"),
    read("account/activities/FILL?direction=desc&page_size=100"),
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

  const publicFills = list("fills", fillsResult, f => ({
    symbol: text(f.symbol), side: text(f.side), quantity: number(f.qty), price: number(f.price), time: time(f.transaction_time),
  }));

  const report: PaperReport = {
    collectedAt: new Date().toISOString(),
    account: { equity, cash: number(account.cash), previousCloseEquity: number(account.last_equity), currency: text(account.currency, "USD") },
    positions: list("positions", positionsResult, p => ({ symbol: text(p.symbol), side: text(p.side), quantity: number(p.qty), entry: number(p.avg_entry_price), marketValue: number(p.market_value), unrealizedPl: number(p.unrealized_pl) })),
    orders: list("orders", ordersResult, o => ({ symbol: text(o.symbol), side: text(o.side), type: text(o.type), status: text(o.status), quantity: number(o.qty), filled: number(o.filled_qty), averageFillPrice: number(o.filled_avg_price), limit: number(o.limit_price), stop: number(o.stop_price), submittedAt: time(o.submitted_at) })),
    fills: publicFills?.slice(0, 10) ?? null,
    errors,
    ordersMayBeTruncated: false,
  };
  report.ordersMayBeTruncated = (report.orders?.length ?? 0) >= 500;

  let taggedOrders: PaperBrokerActivity["orders"] = [];
  if (brokerOrdersResult.status === "fulfilled") {
    try {
      const flatten = (root: Record<string, unknown>) => {
        const rootClientOrderId = text(root.client_order_id);
        if (!taggedClientOrderId(rootClientOrderId)) return [];
        const convert = (order: Record<string, unknown>, attributionClientOrderId: string, parentBrokerOrderId: string | null) => ({
          brokerOrderId: text(order.id),
          clientOrderId: text(order.client_order_id),
          attributionClientOrderId,
          parentBrokerOrderId,
          symbol: text(order.symbol),
          assetClass: assetClass(order.asset_class),
          side: text(order.side),
          orderType: text(order.type),
          orderClass: text(order.order_class),
          status: text(order.status, "unknown"),
          quantity: number(order.qty),
          filledQuantity: number(order.filled_qty),
          averageFillPrice: number(order.filled_avg_price),
          submittedAt: time(order.submitted_at),
          filledAt: time(order.filled_at),
          canceledAt: brokerTime(order.canceled_at),
          replacedAt: brokerTime(order.replaced_at),
          updatedAt: brokerTime(order.updated_at),
        });
        const parent = convert(root, rootClientOrderId, null);
        const legs = Array.isArray(root.legs)
          ? root.legs.map(object).map(leg => convert(leg, rootClientOrderId, parent.brokerOrderId))
          : [];
        return [parent, ...legs].filter(order => order.brokerOrderId && order.clientOrderId && order.symbol);
      };
      taggedOrders = rows(brokerOrdersResult.value).flatMap(flatten);
    } catch {
      errors.brokerAttribution = "Tagged broker orders could not be parsed.";
    }
  } else {
    errors.brokerAttribution = brokerOrdersResult.reason instanceof Error ? brokerOrdersResult.reason.message : "Tagged broker orders unavailable.";
  }

  const taggedOrderIds = new Set(taggedOrders.map(order => order.brokerOrderId));
  let taggedFills: PaperBrokerActivity["fills"] = [];
  if (fillsResult.status === "fulfilled") {
    try {
      taggedFills = rows(fillsResult.value).map(f => ({
        fillActivityId: text(f.id),
        brokerOrderId: text(f.order_id),
        symbol: text(f.symbol),
        side: text(f.side),
        quantity: number(f.qty),
        price: number(f.price),
        cumulativeQuantity: number(f.cum_qty),
        leavesQuantity: number(f.leaves_qty),
        transactionTime: brokerTime(f.transaction_time),
      })).filter(f => f.fillActivityId && f.brokerOrderId && taggedOrderIds.has(f.brokerOrderId));
    } catch {
      errors.brokerAttribution = "Tagged broker fills could not be parsed.";
    }
  }

  // The account ID is hashed only to separate history when the connected account changes.
  // Raw account/order/client identifiers never enter the public report. Bot-tagged broker IDs
  // are returned only in brokerActivity for service-role reconciliation.
  const sourceKey = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text(account.id))))).map(b => b.toString(16).padStart(2, "0")).join("");
  const brokerActivity: PaperBrokerActivity = { orders: taggedOrders, fills: taggedFills };
  return { report, sourceKey, brokerActivity };
}
