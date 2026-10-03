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

const roundPrice = (value: number) => {
  const decimals = value >= 100 ? 2 : value >= 1 ? 4 : 6;
  return Number(value.toFixed(decimals));
};

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

function activeProtection(position: ExitPosition, orders: ExitOrder[]) {
  return orders.some(order =>
    order.bot_id === position.bot_id
    && order.symbol === position.symbol
    && order.side === "sell"
    && OPEN_ORDER_STATES.has(order.status)
    && Boolean(order.broker_order_id)
    && order.metadata?.purpose === "protective-stop"
  );
}

function samePlan(previous: Record<string, unknown>, next: Record<string, unknown>) {
  return previous.plannedAction === next.plannedAction
    && previous.desiredStop === next.desiredStop
    && previous.partialFraction === next.partialFraction
    && previous.rMultiple === next.rMultiple;
}

export async function managePaperCryptoExits(args: {
  db: ExitDb;
  positions: ExitPosition[];
  orders: ExitOrder[];
  ledgers: ExitLedger[];
  marks: ExitMark[];
}) {
  const marks = new Map(args.marks.map(mark => [mark.symbol, mark.price]));
  const activeBots = new Set(args.ledgers.filter(ledger => ledger.broker_tag).map(ledger => ledger.bot_id));
  const results: Array<{ botId: string; symbol: string; action: string; detail?: string }> = [];

  for (const position of args.positions) {
    if (position.asset_class !== "crypto" || !activeBots.has(position.bot_id)) continue;
    const mark = marks.get(position.symbol);
    if (!finitePositive(mark)) continue;

    const plan = planCryptoExit(position, mark, args.orders, activeProtection(position, args.orders));
    const nextState: Record<string, unknown> = {
      ...position.exit_manager_state,
      version: "paper-exit-v1",
      mode: "staged-action",
      plannedAction: plan.kind,
      rMultiple: Number(plan.rMultiple.toFixed(4)),
      markPrice: mark,
      evaluatedAt: new Date().toISOString(),
      reason: plan.reason,
      ...(plan.kind === "repair_stop" || plan.kind === "tighten_stop" ? { desiredStop: plan.stop } : {}),
      ...(plan.kind === "partial_profit" ? { partialFraction: plan.fraction } : {}),
    };

    if (!samePlan(position.exit_manager_state ?? {}, nextState)) {
      await args.db(
        `paper_bot_positions?bot_id=eq.${encodeURIComponent(position.bot_id)}&symbol=eq.${encodeURIComponent(position.symbol)}`,
        {
          exit_manager_state: nextState,
          last_exit_manager_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        "PATCH",
        "return=minimal",
      );
    }

    results.push({
      botId: position.bot_id,
      symbol: position.symbol,
      action: plan.kind,
      detail: plan.reason,
    });
  }

  return results;
}
