export type ExitMark = { symbol: string; price: number; timestamp: string; source: string };

export type ExitPosition = {
  bot_id: string;
  symbol: string;
  asset_class: "stock" | "etf" | "crypto" | "unknown";
  quantity: number;
  average_entry: number | null;
  protective_stop: number | null;
  initial_protective_stop: number | null;
  take_profit_price: number | null;
  take_profit_fraction: number | null;
  take_profit_r: number | null;
  protect_winner_at_r: number | null;
  trail_remainder: boolean;
  strategy_id: string | null;
  strategy_version: number | null;
  metadata: Record<string, unknown>;
  exit_manager_state: Record<string, unknown>;
};

export type ExitOrder = {
  client_order_id: string;
  bot_id: string;
  symbol: string;
  side: "buy" | "sell";
  status: string;
  broker_order_id: string | null;
  requested_quantity: number | null;
  protective_stop: number | null;
  metadata: Record<string, unknown>;
};

export type ExitLedger = { bot_id: string; broker_tag: string | null };

export type ExitDb = (
  path: string,
  body?: unknown,
  method?: "GET" | "POST" | "PATCH" | "DELETE",
  prefer?: string,
) => Promise<unknown>;

export type CryptoExitPlan =
  | { kind: "hold"; rMultiple: number; reason: string }
  | { kind: "repair_stop"; stop: number; rMultiple: number; reason: string }
  | { kind: "tighten_stop"; stop: number; rMultiple: number; reason: "breakeven" | "trail" }
  | { kind: "partial_profit"; rMultiple: number; fraction: number; reason: string };

const OPEN_ORDER_STATES = new Set(["prepared", "submitted", "partially_filled"]);
const FINAL_ORDER_STATES = new Set(["filled", "canceled", "rejected", "expired", "replaced", "closed", "error"]);
const ALPACA_PAPER = "https://paper-api.alpaca.markets/v2";

const finitePositive = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

const numberFrom = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const textFrom = (value: unknown) => typeof value === "string" ? value : "";

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const roundPrice = (value: number) => {
  const decimals = value >= 100 ? 2 : value >= 1 ? 4 : 6;
  return Number(value.toFixed(decimals));
};

const floorQty = (value: number, decimals = 9) => {
  const factor = 10 ** decimals;
  return Math.floor((value + Number.EPSILON) * factor) / factor;
};

const stopLimitFloor = (stop: number) => roundPrice(stop * 0.997);

function feeBps(position: ExitPosition) {
  const direct = numberFrom(position.metadata?.estimatedFeeBps);
  return position.asset_class === "crypto" ? Math.max(0, direct ?? 0) : 0;
}

function feeAdjustedBreakEven(position: ExitPosition) {
  if (!finitePositive(position.average_entry)) return null;
  const bps = feeBps(position);
  const sellNet = 1 - bps / 10_000;
  return sellNet > 0 ? position.average_entry / sellNet : position.average_entry;
}

function initialRiskDistance(position: ExitPosition) {
  if (!finitePositive(position.average_entry)) return null;
  const initial = finitePositive(position.initial_protective_stop)
    ? position.initial_protective_stop
    : position.protective_stop;
  if (!finitePositive(initial) || initial >= position.average_entry) return null;
  return position.average_entry - initial;
}

function partialCompleted(position: ExitPosition, orders: ExitOrder[]) {
  const state = textFrom(position.exit_manager_state?.partialProfitState);
  if (state === "completed") return true;
  return orders.some(order =>
    order.bot_id === position.bot_id
    && order.symbol === position.symbol
    && order.side === "sell"
    && order.status === "filled"
    && order.metadata?.purpose === "take-profit-partial"
  );
}

export function planCryptoExit(
  position: ExitPosition,
  mark: number,
  orders: ExitOrder[],
  hasActiveStop: boolean,
): CryptoExitPlan {
  if (position.asset_class !== "crypto" || !finitePositive(position.quantity) || !finitePositive(mark)) {
    return { kind: "hold", rMultiple: 0, reason: "Crypto exit manager has no valid position/mark." };
  }
  if (!finitePositive(position.average_entry)) {
    return { kind: "hold", rMultiple: 0, reason: "Average entry is unavailable." };
  }

  const riskDistance = initialRiskDistance(position);
  if (!finitePositive(riskDistance)) {
    return { kind: "hold", rMultiple: 0, reason: "Initial risk distance is unavailable." };
  }

  const rMultiple = (mark - position.average_entry) / riskDistance;
  const currentStop = position.protective_stop;
  if (!hasActiveStop && finitePositive(currentStop)) {
    return { kind: "repair_stop", stop: currentStop, rMultiple, reason: "Broker protection is missing." };
  }

  const done = partialCompleted(position, orders);
  if (
    !done
    && finitePositive(position.take_profit_price)
    && finitePositive(position.take_profit_fraction)
    && mark >= position.take_profit_price
  ) {
    return {
      kind: "partial_profit",
      rMultiple,
      fraction: Math.min(1, position.take_profit_fraction),
      reason: "First take-profit threshold reached.",
    };
  }

  const breakEven = feeAdjustedBreakEven(position);
  const minimumStep = Math.max(riskDistance * 0.10, mark * 0.0015);

  if (done && position.trail_remainder && finitePositive(breakEven)) {
    const desired = Math.max(currentStop ?? 0, breakEven, mark - riskDistance);
    if (!finitePositive(currentStop) || desired >= currentStop + minimumStep) {
      return { kind: "tighten_stop", stop: roundPrice(desired), rMultiple, reason: "trail" };
    }
  }

  if (
    !done
    && finitePositive(breakEven)
    && finitePositive(position.protect_winner_at_r)
    && rMultiple >= position.protect_winner_at_r
    && (!finitePositive(currentStop) || breakEven >= currentStop + minimumStep)
  ) {
    return { kind: "tighten_stop", stop: roundPrice(breakEven), rMultiple, reason: "breakeven" };
  }

  return { kind: "hold", rMultiple, reason: "No exit-management threshold is active." };
}

function makeClientOrderId(tag: string, strategyVersion: number, purpose: string) {
  const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 12).toLowerCase();
  const stamp = Date.now().toString(36);
  return `chb-${tag}-v${strategyVersion}-${purpose}-${stamp.slice(-6)}${suffix.slice(0, 6)}`;
}

async function alpaca(
  key: string,
  secret: string,
  path: string,
  init: RequestInit,
  fetcher: typeof fetch,
) {
  const response = await fetcher(`${ALPACA_PAPER}/${path}`, {
    ...init,
    headers: {
      "APCA-API-KEY-ID": key,
      "APCA-API-SECRET-KEY": secret,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(10_000),
  });
  const bodyText = await response.text();
  const body = bodyText ? JSON.parse(bodyText) : null;
  if (!response.ok) {
    const message = typeof body?.message === "string" ? body.message : `HTTP ${response.status}`;
    throw new Error(`Alpaca paper exit request failed: ${message}`);
  }
  return body as Record<string, unknown> | null;
}

async function registerOrder(
  db: ExitDb,
  order: Record<string, unknown>,
) {
  await db(
    "paper_bot_orders?on_conflict=client_order_id",
    order,
    "POST",
    "resolution=merge-duplicates,return=minimal",
  );
}

async function patchPreparedOrder(
  db: ExitDb,
  clientOrderId: string,
  values: Record<string, unknown>,
) {
  await db(
    `paper_bot_orders?client_order_id=eq.${encodeURIComponent(clientOrderId)}`,
    { ...values, updated_at: new Date().toISOString() },
    "PATCH",
    "return=minimal",
  );
}

async function patchPosition(
  db: ExitDb,
  position: ExitPosition,
  values: Record<string, unknown>,
) {
  await db(
    `paper_bot_positions?bot_id=eq.${encodeURIComponent(position.bot_id)}&symbol=eq.${encodeURIComponent(position.symbol)}`,
    { ...values, last_exit_manager_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    "PATCH",
    "return=minimal",
  );
}

function activeProtection(position: ExitPosition, orders: ExitOrder[]) {
  return orders
    .filter(order =>
      order.bot_id === position.bot_id
      && order.symbol === position.symbol
      && order.side === "sell"
      && OPEN_ORDER_STATES.has(order.status)
      && order.metadata?.purpose === "protective-stop"
    )
    .sort((a, b) => Number(Boolean(b.broker_order_id)) - Number(Boolean(a.broker_order_id)))[0] ?? null;
}

async function createProtectiveStop(args: {
  key: string;
  secret: string;
  db: ExitDb;
  fetcher: typeof fetch;
  position: ExitPosition;
  brokerTag: string;
  quantity: number;
  stop: number;
  purposeReason: string;
}) {
  const { key, secret, db, fetcher, position, brokerTag, stop, purposeReason } = args;
  const quantity = floorQty(args.quantity);
  if (!(quantity > 0) || !position.strategy_version || !position.strategy_id) return null;

  const clientOrderId = makeClientOrderId(brokerTag, position.strategy_version, "stop");
  const limit = stopLimitFloor(stop);
  const estimatedFeeBps = feeBps(position);

  await registerOrder(db, {
    client_order_id: clientOrderId,
    bot_id: position.bot_id,
    strategy_id: position.strategy_id,
    strategy_version: position.strategy_version,
    symbol: position.symbol,
    asset_class: position.asset_class,
    side: "sell",
    status: "prepared",
    requested_quantity: quantity,
    pool_id: null,
    entry_trigger: stop,
    max_entry_price: limit,
    protective_stop: stop,
    planned_risk_dollars: 0,
    stage_reason: purposeReason,
    metadata: {
      purpose: "protective-stop",
      exitManager: true,
      paperOnly: true,
      estimatedFeeBps,
      exitManagerVersion: "paper-exit-v1",
    },
  });

  try {
    const created = await alpaca(key, secret, "orders", {
      method: "POST",
      body: JSON.stringify({
        symbol: position.symbol,
        qty: quantity.toFixed(9).replace(/0+$/, "").replace(/\.$/, ""),
        side: "sell",
        type: "stop_limit",
        time_in_force: "gtc",
        stop_price: String(roundPrice(stop)),
        limit_price: String(limit),
        client_order_id: clientOrderId,
      }),
    }, fetcher);
    await patchPreparedOrder(db, clientOrderId, {
      status: "submitted",
      broker_order_id: textFrom(created?.id) || null,
      submitted_at: textFrom(created?.submitted_at) || new Date().toISOString(),
    });
    return { clientOrderId, brokerOrderId: textFrom(created?.id) || null };
  } catch (error) {
    await patchPreparedOrder(db, clientOrderId, {
      status: "error",
      metadata: {
        purpose: "protective-stop",
        exitManager: true,
        paperOnly: true,
        exitManagerError: error instanceof Error ? error.message.slice(0, 180) : "Protective stop submission failed.",
      },
    });
    throw error;
  }
}

async function replaceProtectiveStop(args: {
  key: string;
  secret: string;
  db: ExitDb;
  fetcher: typeof fetch;
  position: ExitPosition;
  current: ExitOrder;
  brokerTag: string;
  stop: number;
  reason: string;
}) {
  const { key, secret, db, fetcher, position, current, brokerTag, stop, reason } = args;
  if (!current.broker_order_id || !position.strategy_version || !position.strategy_id) {
    throw new Error("Cannot replace a protective order before it has a broker order ID.");
  }

  const clientOrderId = makeClientOrderId(brokerTag, position.strategy_version, "stop");
  const limit = stopLimitFloor(stop);
  await registerOrder(db, {
    client_order_id: clientOrderId,
    bot_id: position.bot_id,
    strategy_id: position.strategy_id,
    strategy_version: position.strategy_version,
    symbol: position.symbol,
    asset_class: position.asset_class,
    side: "sell",
    status: "prepared",
    requested_quantity: floorQty(position.quantity),
    entry_trigger: stop,
    max_entry_price: limit,
    protective_stop: stop,
    planned_risk_dollars: 0,
    stage_reason: `Exit manager stop replacement: ${reason}.`,
    metadata: {
      purpose: "protective-stop",
      exitManager: true,
      paperOnly: true,
      replacesClientOrderId: current.client_order_id,
      exitManagerVersion: "paper-exit-v1",
    },
  });

  try {
    const replaced = await alpaca(key, secret, `orders/${encodeURIComponent(current.broker_order_id)}`, {
      method: "PATCH",
      body: JSON.stringify({
        client_order_id: clientOrderId,
        stop_price: String(roundPrice(stop)),
        limit_price: String(limit),
      }),
    }, fetcher);
    await patchPreparedOrder(db, current.client_order_id, { status: "replaced" });
    await patchPreparedOrder(db, clientOrderId, {
      status: "submitted",
      broker_order_id: textFrom(replaced?.id) || null,
      submitted_at: textFrom(replaced?.submitted_at) || new Date().toISOString(),
    });
    await patchPosition(db, position, {
      protective_stop: stop,
      exit_manager_state: {
        ...position.exit_manager_state,
        version: "paper-exit-v1",
        lastAction: reason,
        activeStopClientOrderId: clientOrderId,
      },
    });
  } catch (error) {
    await patchPreparedOrder(db, clientOrderId, { status: "error" });
    throw error;
  }
}

async function cancelBrokerOrder(
  key: string,
  secret: string,
  brokerOrderId: string,
  fetcher: typeof fetch,
) {
  await alpaca(key, secret, `orders/${encodeURIComponent(brokerOrderId)}`, { method: "DELETE" }, fetcher);
  for (let index = 0; index < 6; index++) {
    await sleep(250);
    try {
      const order = await alpaca(key, secret, `orders/${encodeURIComponent(brokerOrderId)}`, { method: "GET" }, fetcher);
      const status = textFrom(order?.status);
      if (["canceled", "filled", "replaced", "expired", "rejected"].includes(status)) return status;
    } catch {
      return "canceled";
    }
  }
  return "cancel_requested";
}

async function executePartialProfit(args: {
  key: string;
  secret: string;
  db: ExitDb;
  fetcher: typeof fetch;
  position: ExitPosition;
  currentStop: ExitOrder;
  brokerTag: string;
  fraction: number;
  mark: number;
}) {
  const { key, secret, db, fetcher, position, currentStop, brokerTag, fraction, mark } = args;
  if (!currentStop.broker_order_id || !position.strategy_id || !position.strategy_version) {
    throw new Error("Partial profit requires an active broker protective order.");
  }

  const requestedQty = floorQty(position.quantity * fraction);
  if (!(requestedQty > 0) || requestedQty >= position.quantity) {
    throw new Error("Partial profit quantity is invalid.");
  }

  await cancelBrokerOrder(key, secret, currentStop.broker_order_id, fetcher);
  await patchPreparedOrder(db, currentStop.client_order_id, { status: "canceled" });

  const clientOrderId = makeClientOrderId(brokerTag, position.strategy_version, "tp");
  const estimatedFeeBps = feeBps(position);
  await registerOrder(db, {
    client_order_id: clientOrderId,
    bot_id: position.bot_id,
    strategy_id: position.strategy_id,
    strategy_version: position.strategy_version,
    symbol: position.symbol,
    asset_class: position.asset_class,
    side: "sell",
    status: "prepared",
    requested_quantity: requestedQty,
    take_profit_price: position.take_profit_price,
    take_profit_fraction: position.take_profit_fraction,
    take_profit_r: position.take_profit_r,
    protect_winner_at_r: position.protect_winner_at_r,
    trail_remainder: position.trail_remainder,
    planned_risk_dollars: 0,
    stage_reason: "Exit manager first partial profit.",
    metadata: {
      purpose: "take-profit-partial",
      exitManager: true,
      paperOnly: true,
      estimatedFeeBps,
      exitManagerVersion: "paper-exit-v1",
    },
  });

  let order: Record<string, unknown> | null = null;
  try {
    order = await alpaca(key, secret, "orders", {
      method: "POST",
      body: JSON.stringify({
        symbol: position.symbol,
        qty: requestedQty.toFixed(9).replace(/0+$/, "").replace(/\.$/, ""),
        side: "sell",
        type: "market",
        time_in_force: "gtc",
        client_order_id: clientOrderId,
      }),
    }, fetcher);
    await patchPreparedOrder(db, clientOrderId, {
      status: "submitted",
      broker_order_id: textFrom(order?.id) || null,
      submitted_at: textFrom(order?.submitted_at) || new Date().toISOString(),
    });
  } catch (error) {
    await patchPreparedOrder(db, clientOrderId, { status: "error" });
    await createProtectiveStop({
      key, secret, db, fetcher, position, brokerTag,
      quantity: position.quantity, stop: position.protective_stop!,
      purposeReason: "Protection restored after partial-profit submission failure",
    });
    throw error;
  }

  const brokerOrderId = textFrom(order?.id);
  let filledQty = 0;
  let finalStatus = textFrom(order?.status);
  if (brokerOrderId) {
    for (let index = 0; index < 8; index++) {
      const checked = await alpaca(key, secret, `orders/${encodeURIComponent(brokerOrderId)}`, { method: "GET" }, fetcher);
      finalStatus = textFrom(checked?.status);
      filledQty = numberFrom(checked?.filled_qty) ?? 0;
      if (["filled", "canceled", "rejected", "expired"].includes(finalStatus)) break;
      await sleep(250);
    }
  }

  if (!["filled", "canceled", "rejected", "expired"].includes(finalStatus) && brokerOrderId) {
    await cancelBrokerOrder(key, secret, brokerOrderId, fetcher);
    finalStatus = "canceled";
  }

  await patchPreparedOrder(db, clientOrderId, { status: finalStatus === "filled" ? "filled" : finalStatus || "canceled" });
  const remainder = floorQty(Math.max(0, position.quantity - filledQty));
  if (!(remainder > 0)) {
    await patchPosition(db, position, {
      exit_manager_state: {
        ...position.exit_manager_state,
        version: "paper-exit-v1",
        partialProfitState: "completed",
        partialProfitCompletedAt: new Date().toISOString(),
        lastAction: "partial-profit-completed-full-exit",
      },
    });
    return;
  }

  const breakEven = feeAdjustedBreakEven(position) ?? position.average_entry!;
  const nextStop = roundPrice(Math.max(position.protective_stop ?? 0, breakEven));
  await createProtectiveStop({
    key, secret, db, fetcher, position, brokerTag,
    quantity: remainder, stop: nextStop,
    purposeReason: "Protection restored after first partial profit",
  });

  await patchPosition(db, position, {
    protective_stop: nextStop,
    exit_manager_state: {
      ...position.exit_manager_state,
      version: "paper-exit-v1",
      partialProfitState: filledQty > 0 ? "completed" : "armed",
      ...(filledQty > 0 ? { partialProfitCompletedAt: new Date().toISOString() } : {}),
      lastAction: filledQty > 0 ? "partial-profit-completed" : "partial-profit-no-fill",
      lastPartialFillQuantity: filledQty,
      lastPartialTriggerMark: mark,
    },
  });
}

export async function managePaperCryptoExits(args: {
  key: string;
  secret: string;
  db: ExitDb;
  fetcher?: typeof fetch;
  positions: ExitPosition[];
  orders: ExitOrder[];
  ledgers: ExitLedger[];
  marks: ExitMark[];
}) {
  const fetcher = args.fetcher ?? fetch;
  const marks = new Map(args.marks.map(mark => [mark.symbol, mark.price]));
  const tags = new Map(args.ledgers.map(ledger => [ledger.bot_id, ledger.broker_tag]));
  const results: Array<{ botId: string; symbol: string; action: string; detail?: string }> = [];

  for (const position of args.positions) {
    if (position.asset_class !== "crypto") continue;
    const mark = marks.get(position.symbol);
    if (!finitePositive(mark)) continue;
    const brokerTag = tags.get(position.bot_id);
    if (!brokerTag || !position.strategy_version) continue;

    const currentStop = activeProtection(position, args.orders);
    const plan = planCryptoExit(position, mark, args.orders, Boolean(currentStop?.broker_order_id));

    try {
      if (plan.kind === "repair_stop") {
        await createProtectiveStop({
          key: args.key, secret: args.secret, db: args.db, fetcher,
          position, brokerTag, quantity: position.quantity, stop: plan.stop,
          purposeReason: "Exit manager restored missing broker protection",
        });
        results.push({ botId: position.bot_id, symbol: position.symbol, action: "repair_stop" });
      } else if (plan.kind === "tighten_stop" && currentStop) {
        await replaceProtectiveStop({
          key: args.key, secret: args.secret, db: args.db, fetcher,
          position, current: currentStop, brokerTag, stop: plan.stop, reason: plan.reason,
        });
        results.push({ botId: position.bot_id, symbol: position.symbol, action: `tighten_stop_${plan.reason}` });
      } else if (plan.kind === "partial_profit" && currentStop) {
        await executePartialProfit({
          key: args.key, secret: args.secret, db: args.db, fetcher,
          position, currentStop, brokerTag, fraction: plan.fraction, mark,
        });
        results.push({ botId: position.bot_id, symbol: position.symbol, action: "partial_profit" });
      } else {
        results.push({ botId: position.bot_id, symbol: position.symbol, action: "hold", detail: plan.reason });
      }
    } catch (error) {
      results.push({
        botId: position.bot_id,
        symbol: position.symbol,
        action: "error",
        detail: error instanceof Error ? error.message.slice(0, 180) : "Exit manager action failed.",
      });
    }
  }

  return results;
}
