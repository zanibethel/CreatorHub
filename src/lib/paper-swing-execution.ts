import { THREE_TRADE_SWING_STRATEGY_V1 as strategy } from "./paper-swing-strategy-config";

export type SwingExecutionPreview = {
  symbol: string;
  quantity: number;
  estimatedNotional: number;
  entryReference: number;
  stopLoss: number;
  takeProfit: number;
  plannedRiskDollars: number;
  plannedRiskPct: number;
  allocationPct: number;
  orderClass: "bracket";
  orderType: "market";
  timeInForce: "day";
  paperOnly: true;
};

export type AlpacaSwingBracketRequest = {
  symbol: string;
  side: "buy";
  qty: string;
  type: "market";
  time_in_force: "day";
  extended_hours: false;
  client_order_id: string;
  order_class: "bracket";
  take_profit_limit_price: string;
  stop_loss_stop_price: string;
};

const finitePositive = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

// Alpaca PAPER rejects fractional multi-leg brackets. Never round up risk.
const floorQuantity = (value: number) => Math.floor(value);

const roundPrice = (value: number) =>
  Number(value.toFixed(value >= 1 ? 2 : 6));

const qtyString = (value: number) =>
  value.toFixed(9).replace(/0+$/, "").replace(/\.$/, "");

export function buildSwingExecutionPreview(input: {
  symbol: string;
  ask: number;
  protectiveStop: number;
  equity: number;
  buyingPower: number;
}): SwingExecutionPreview {
  const { symbol, ask, protectiveStop, equity, buyingPower } = input;
  if (!symbol || !finitePositive(ask) || !finitePositive(protectiveStop) || !finitePositive(equity)) {
    throw new Error("A valid symbol, ask, stop, and virtual equity are required.");
  }
  if (protectiveStop >= ask) throw new Error("Protective stop must be below the entry reference.");

  const riskBudget = equity * strategy.risk.riskPerTradePct / 100;
  const stopDistance = ask - protectiveStop;
  const quantityByRisk = riskBudget / stopDistance;
  const allocationBudget = Math.min(
    equity * strategy.risk.maximumPositionAllocationPct / 100,
    Math.max(0, buyingPower),
  );
  const quantityByAllocation = allocationBudget / ask;
  const quantity = floorQuantity(Math.min(quantityByRisk, quantityByAllocation));

  if (!Number.isSafeInteger(quantity) || quantity < 1)
    throw new Error("Broker PAPER bracket requires at least one whole share within the virtual risk and allocation caps.");

  const estimatedNotional = quantity * ask;
  const plannedRiskDollars = quantity * stopDistance;
  const takeProfit = ask + strategy.risk.firstTakeProfitR * stopDistance;

  return {
    symbol,
    quantity,
    estimatedNotional,
    entryReference: ask,
    stopLoss: roundPrice(protectiveStop),
    takeProfit: roundPrice(takeProfit),
    plannedRiskDollars,
    plannedRiskPct: plannedRiskDollars / equity * 100,
    allocationPct: estimatedNotional / equity * 100,
    orderClass: "bracket",
    orderType: "market",
    timeInForce: "day",
    paperOnly: true,
  };
}

export function assertSwingPaperExecutionAllowed(input: {
  executionEnabled: boolean;
  readinessSelected: boolean;
  marketOpen: boolean;
  quoteFresh: boolean;
  paperOnly?: boolean;
}) {
  if (input.paperOnly === false) throw new Error("Live-money swing execution is not supported.");
  if (!strategy.execution.paperOnly) throw new Error("Strategy is not locked to simulation mode.");
  if (!input.executionEnabled) throw new Error("Swing execution kill switch is disabled.");
  if (!input.readinessSelected) throw new Error("Plan is not selected by same-session revalidation.");
  if (!input.marketOpen) throw new Error("Market is not open.");
  if (!input.quoteFresh) throw new Error("Quote is stale.");
}

export function buildAlpacaSwingBracketRequest(
  preview: SwingExecutionPreview,
  clientOrderId: string,
): AlpacaSwingBracketRequest {
  if (!preview.paperOnly) throw new Error("Only simulated bracket requests are supported.");
  if (!Number.isSafeInteger(preview.quantity) || preview.quantity < 1)
    throw new Error("Fractional PAPER brackets are unsupported; use a separately protected simple-order path.");
  if (!clientOrderId || clientOrderId.length > 128) throw new Error("A valid client order ID is required.");
  if (!(preview.takeProfit > preview.entryReference && preview.stopLoss < preview.entryReference)) {
    throw new Error("Bracket prices do not surround the entry reference.");
  }
  return {
    symbol: preview.symbol,
    side: "buy",
    qty: qtyString(preview.quantity),
    type: "market",
    time_in_force: "day",
    extended_hours: false,
    client_order_id: clientOrderId,
    order_class: "bracket",
    take_profit_limit_price: String(preview.takeProfit),
    stop_loss_stop_price: String(preview.stopLoss),
  };
}

export const SWING_PAPER_BROKER_HOST = "https://paper-api.alpaca.markets";
