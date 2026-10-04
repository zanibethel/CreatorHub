export type PaperExecutionFailureInput = {
  botId: string;
  strategyId: string;
  strategyVersion: number;
  symbol: string;
  assetClass: "stock" | "etf" | "crypto" | "unknown";
  clientOrderId: string;
  occurredAt?: string;
  phase: string;
  reason: string;
  side?: "buy" | "sell";
  purpose?: string | null;
  brokerLookupPending?: boolean;
  critical?: boolean;
  metadata?: Record<string, unknown>;
};

export function buildPaperExecutionFailureJournalRow(input: PaperExecutionFailureInput) {
  return {
    bot_id: input.botId,
    strategy_id: input.strategyId,
    strategy_version: input.strategyVersion,
    event_type: "execution_error",
    symbol: input.symbol,
    asset_class: input.assetClass,
    occurred_at: input.occurredAt ?? new Date().toISOString(),
    client_order_id: input.clientOrderId,
    blockers: [input.reason],
    warnings: [],
    component_scores: {},
    market_snapshot: {},
    risk_plan: {},
    metadata: {
      source: "paper-execution-route",
      paperOnly: true,
      phase: input.phase,
      reason: input.reason,
      side: input.side ?? null,
      purpose: input.purpose ?? null,
      brokerLookupPending: input.brokerLookupPending === true,
      critical: input.critical === true,
      ...(input.metadata ?? {}),
    },
  };
}
