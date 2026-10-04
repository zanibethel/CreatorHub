export const PAPER_BOT_TRADE_PLAN_CONTRACT_VERSION = 1 as const;

export type PaperBotStrategyHorizon = "day" | "swing" | "long";
export type PaperBotPlanPhase = "awaiting-data" | "reference" | "prepared" | "ready";
export type PaperBotLifecycleStage = "WATCHING" | "PREPARED" | "READY" | "ORDERED" | "HOLDING" | "EXITED";

export type PaperBotTradePlan = {
  contractVersion: typeof PAPER_BOT_TRADE_PLAN_CONTRACT_VERSION;
  botId: string;
  strategyId: string | null;
  strategyVersion: number | null;
  symbol: string;
  label: string;
  assetClass: "stock" | "etf" | "crypto" | "unknown";
  currentPrice: number | null;
  score: number | null;
  state: string;
  detail: string;
  horizons: PaperBotStrategyHorizon[];
  executionEligible: boolean;
  selectedForSubmission: boolean;
  blockers: string[];
  warnings: string[];
  plan: {
    phase: PaperBotPlanPhase;
    entryPrice: number | null;
    purchaseAmount: number | null;
    stopPrice: number | null;
    maxLossDollars: number | null;
    exitPrice: number | null;
    projectedProfitDollars: number | null;
    projectedProfitPct: number | null;
  };
};

export type PaperBotLifecycleContext = {
  activeOrder?: {
    side: "buy" | "sell";
    status: string;
  } | null;
  openPosition?: boolean;
  latestClosedTrade?: {
    realizedPl: number | null;
  } | null;
};

export function paperBotPlanLabel(phase: PaperBotPlanPhase) {
  if (phase === "ready") return "READY PLAN" as const;
  if (phase === "prepared") return "PREPARED PLAN" as const;
  if (phase === "reference") return "REFERENCE PLAN" as const;
  return "AWAITING DATA" as const;
}

export function derivePaperBotLifecycle(
  tradePlan: PaperBotTradePlan,
  context: PaperBotLifecycleContext,
): { stage: PaperBotLifecycleStage; detail: string } {
  if (context.openPosition) {
    return {
      stage: "HOLDING",
      detail: context.activeOrder?.side === "sell"
        ? `Position open · ${context.activeOrder.status.replaceAll("_", " ")} exit order active.`
        : "Entry filled · position is currently open.",
    };
  }

  if (context.activeOrder) {
    return {
      stage: "ORDERED",
      detail: `${context.activeOrder.side.toUpperCase()} order ${context.activeOrder.status.replaceAll("_", " ")}.`,
    };
  }

  if (tradePlan.plan.phase === "ready" || tradePlan.selectedForSubmission) {
    return {
      stage: "READY",
      detail: "Execution gates currently pass; waiting for submission/fill.",
    };
  }

  if (tradePlan.plan.phase === "prepared") {
    return {
      stage: "PREPARED",
      detail: "Concrete entry, size, stop, and target are prepared.",
    };
  }

  if (tradePlan.plan.phase === "awaiting-data" && context.latestClosedTrade) {
    const realized = context.latestClosedTrade.realizedPl;
    return {
      stage: "EXITED",
      detail: realized == null
        ? "Last trade exited."
        : `Last trade exited at ${realized >= 0 ? "+" : ""}$${Math.abs(realized).toFixed(2)}.`,
    };
  }

  return {
    stage: "WATCHING",
    detail: tradePlan.plan.phase === "reference"
      ? "Reference plan only — no order authorization yet."
      : tradePlan.detail,
  };
}

export function isPaperBotTradePlan(value: unknown): value is PaperBotTradePlan {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PaperBotTradePlan>;
  return candidate.contractVersion === PAPER_BOT_TRADE_PLAN_CONTRACT_VERSION
    && typeof candidate.botId === "string"
    && typeof candidate.symbol === "string"
    && Array.isArray(candidate.horizons)
    && Boolean(candidate.plan && typeof candidate.plan === "object");
}
