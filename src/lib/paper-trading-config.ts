// Virtual PAPER capital model. External execution-venue balances are not strategy capital.
export const PAPER_PROGRAM_CAPITAL = 1000;
export const PAPER_BOT_POOL_CAPITAL = 100;
export const PAPER_RESERVED_BOT_POOLS = 6;
export const PAPER_ALLOCATED_CAPITAL = PAPER_BOT_POOL_CAPITAL * PAPER_RESERVED_BOT_POOLS;
export const PAPER_UNALLOCATED_RESERVE = PAPER_PROGRAM_CAPITAL - PAPER_ALLOCATED_CAPITAL;

// Backward-compatible per-bot challenge baseline.
export const PAPER_STARTING_CASH = PAPER_BOT_POOL_CAPITAL;

// Legacy research constant only; position sizing is controlled by the strategy risk engine.
export const PAPER_TRADE_CAP = 0.09;

export const PAPER_POOLS = [
  { id: "day", name: "Day trades", allocation: 20 },
  { id: "multi-day", name: "Multi-day swings", allocation: 40 },
  { id: "multi-week", name: "Multi-week swings", allocation: 40 },
  { id: "inverse", name: "Inverse ETF sleeve", allocation: 0 },
] as const;

export const formatPaperMoney = (amount: number) => new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD",
}).format(amount);
