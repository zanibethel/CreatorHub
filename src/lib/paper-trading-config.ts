// Preview settings only. No live brokerage or order-routing configuration.
export const PAPER_STARTING_CASH = 100;
// Legacy research constant only; position sizing is controlled by the strategy risk engine.\nexport const PAPER_TRADE_CAP = 0.09;
export const PAPER_POOLS = [
  { id: "day", name: "Day trades", allocation: 20 },
  { id: "multi-day", name: "Multi-day swings", allocation: 40 },
  { id: "multi-week", name: "Multi-week swings", allocation: 40 },
  { id: "inverse", name: "Inverse ETF sleeve", allocation: 0 },
] as const;

export const formatPaperMoney = (amount: number) => new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD",
}).format(amount);
