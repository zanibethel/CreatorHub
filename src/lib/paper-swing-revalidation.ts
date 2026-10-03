import { THREE_TRADE_SWING_STRATEGY_V1 as strategy } from "./paper-swing-strategy-config";

export type SwingPreparedPlan = {
  symbol: string;
  requestedNotional: number;
  entryTrigger: number;
  maxEntryPrice: number;
  protectiveStop: number;
  plannedRiskDollars: number;
  expiresAt: string;
};

export type SwingQuote = {
  bid: number | null;
  ask: number | null;
  timestamp: string | null;
};

export type SwingLedgerState = {
  active: boolean;
  equity: number;
  buyingPower: number;
  openRiskPct: number;
  dailyRealizedLossPct: number;
  weeklyDrawdownPct: number;
  openPositions: number;
  weeklyNewEntries: number;
};

export type SwingOpenRisk = {
  symbol: string;
  plannedRiskDollars: number;
};

export type SwingRevalidationInput = {
  now: number;
  marketOpen: boolean;
  minutesSinceOpen: number | null;
  broadMarketSupportive: boolean;
  trendValid: Record<string, boolean>;
  ledger: SwingLedgerState;
  currentRisk: SwingOpenRisk[];
  plans: SwingPreparedPlan[];
  quotes: Record<string, SwingQuote | undefined>;
};

export type SwingPlanReadiness = {
  symbol: string;
  state: "ready" | "waiting" | "blocked";
  selectedForSubmission: boolean;
  bid: number | null;
  ask: number | null;
  spreadPct: number | null;
  quoteAgeSeconds: number | null;
  plannedRiskPct: number;
  allocationPct: number;
  correlationGroup: string | null;
  blockers: string[];
  waitingOn: string[];
};

function finitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function correlationGroup(symbol: string) {
  return (strategy.correlation.groups as Record<string, string>)[symbol] ?? null;
}

function spreadPct(quote: SwingQuote | undefined) {
  if (!finitePositive(quote?.bid) || !finitePositive(quote?.ask) || quote.ask < quote.bid) return null;
  const mid = (quote.bid + quote.ask) / 2;
  return mid > 0 ? ((quote.ask - quote.bid) / mid) * 100 : null;
}

function quoteAgeSeconds(quote: SwingQuote | undefined, now: number) {
  const stamp = quote?.timestamp ? Date.parse(quote.timestamp) : NaN;
  return Number.isFinite(stamp) ? Math.max(0, (now - stamp) / 1000) : null;
}

function currentCorrelatedRiskPct(input: SwingRevalidationInput, group: string | null) {
  if (!group || input.ledger.equity <= 0) return 0;
  const dollars = input.currentRisk
    .filter(position => correlationGroup(position.symbol) === group)
    .reduce((sum, position) => sum + Math.max(0, position.plannedRiskDollars), 0);
  return dollars / input.ledger.equity * 100;
}

export function evaluateSwingReadiness(input: SwingRevalidationInput) {
  const base: SwingPlanReadiness[] = input.plans.map(plan => {
    const quote = input.quotes[plan.symbol];
    const spread = spreadPct(quote);
    const age = quoteAgeSeconds(quote, input.now);
    const ask = finitePositive(quote?.ask) ? quote.ask : null;
    const bid = finitePositive(quote?.bid) ? quote.bid : null;
    const blockers: string[] = [];
    const waitingOn: string[] = [];
    const equity = input.ledger.equity;
    const plannedRiskPct = equity > 0 ? plan.plannedRiskDollars / equity * 100 : Number.POSITIVE_INFINITY;
    const allocationPct = equity > 0 ? plan.requestedNotional / equity * 100 : Number.POSITIVE_INFINITY;
    const group = correlationGroup(plan.symbol);

    if (!input.ledger.active) blockers.push("Swing bot ledger is not active.");
    if (!(equity > 0)) blockers.push("Virtual equity is unavailable.");
    if (input.ledger.buyingPower + 1e-9 < plan.requestedNotional) blockers.push("Insufficient virtual buying power.");
    if (allocationPct > strategy.risk.maximumPositionAllocationPct + 1e-9) blockers.push("Position allocation exceeds the strategy cap.");
    if (input.ledger.openRiskPct + plannedRiskPct > strategy.risk.maximumOpenRiskPct + 1e-9) blockers.push("Portfolio open-risk ceiling would be exceeded.");
    if (input.ledger.dailyRealizedLossPct >= strategy.risk.dailyRealizedLossLimitPct) blockers.push("Daily loss kill switch is active.");
    if (input.ledger.weeklyDrawdownPct >= strategy.risk.weeklyDrawdownLimitPct) blockers.push("Weekly drawdown kill switch is active.");
    if (input.ledger.weeklyNewEntries >= strategy.cadence.maximumNewEntriesPerWeek) blockers.push("Weekly entry limit has been reached.");
    if (input.ledger.openPositions >= strategy.cadence.maximumOpenPositions) blockers.push("Maximum open positions has been reached.");
    if (Date.parse(plan.expiresAt) <= input.now) blockers.push("Prepared plan has expired.");
    if (!input.broadMarketSupportive && strategy.execution.requireSupportiveBroadMarket) blockers.push("Broad-market regime is not supportive for a new long swing.");
    if (input.trendValid[plan.symbol] === false) blockers.push("Trend/setup revalidation failed.");

    if (!input.marketOpen) waitingOn.push("Market is closed.");
    if (input.marketOpen && input.minutesSinceOpen !== null && input.minutesSinceOpen < strategy.execution.minimumMinutesAfterOpen) waitingOn.push("Waiting for the opening buffer.");
    if (input.marketOpen && input.minutesSinceOpen !== null && input.minutesSinceOpen > strategy.execution.maximumMinutesAfterOpen) blockers.push("Entry window has closed for this session.");
    const freshQuote = age !== null && age <= strategy.execution.maximumQuoteAgeSeconds;
    const acceptableSpread = spread !== null && spread <= strategy.execution.maximumSpreadPct;

    if (!freshQuote) waitingOn.push("Waiting for a fresh quote.");
    if (spread === null) waitingOn.push("Waiting for a valid non-crossed quote.");
    else if (!acceptableSpread) waitingOn.push("Spread is wider than the entry limit.");

    if (ask === null) waitingOn.push("Ask price is unavailable.");
    else if (input.marketOpen && freshQuote && acceptableSpread) {
      if (ask < plan.entryTrigger) waitingOn.push("Entry trigger has not been reached.");
      if (ask > plan.maxEntryPrice) blockers.push("Price exceeded the maximum chase level.");
    }

    const existingGroupRisk = currentCorrelatedRiskPct(input, group);
    if (existingGroupRisk + plannedRiskPct > strategy.risk.maximumCorrelatedRiskPct + 1e-9) {
      blockers.push("Existing correlated exposure leaves insufficient risk capacity.");
    }

    return {
      symbol: plan.symbol,
      state: blockers.length ? "blocked" as const : waitingOn.length ? "waiting" as const : "ready" as const,
      selectedForSubmission: false,
      bid,
      ask,
      spreadPct: spread,
      quoteAgeSeconds: age,
      plannedRiskPct,
      allocationPct,
      correlationGroup: group,
      blockers,
      waitingOn,
    };
  });

  const weeklySlots = Math.max(0, strategy.cadence.maximumNewEntriesPerWeek - input.ledger.weeklyNewEntries);
  const positionSlots = Math.max(0, strategy.cadence.maximumOpenPositions - input.ledger.openPositions);
  const maximumSelections = Math.min(weeklySlots, positionSlots);
  const priority = new Map<string, number>(strategy.selection.simultaneousTriggerPriority.map((symbol, index) => [symbol, index] as [string, number]));
  const groupRisk = new Map<string, number>();

  for (const position of input.currentRisk) {
    const group = correlationGroup(position.symbol);
    if (!group || input.ledger.equity <= 0) continue;
    groupRisk.set(group, (groupRisk.get(group) ?? 0) + position.plannedRiskDollars / input.ledger.equity * 100);
  }

  let selected = 0;
  for (const item of [...base].sort((a, b) => (priority.get(a.symbol) ?? 999) - (priority.get(b.symbol) ?? 999))) {
    if (item.state !== "ready") continue;
    if (selected >= maximumSelections) {
      item.state = "blocked";
      item.blockers.push("No weekly/open-position slot remains after higher-priority ready setups.");
      continue;
    }
    if (item.correlationGroup) {
      const used = groupRisk.get(item.correlationGroup) ?? 0;
      if (used + item.plannedRiskPct > strategy.risk.maximumCorrelatedRiskPct + 1e-9) {
        item.state = "blocked";
        item.blockers.push("Simultaneous correlated-risk cap would be exceeded.");
        continue;
      }
      groupRisk.set(item.correlationGroup, used + item.plannedRiskPct);
    }
    item.selectedForSubmission = true;
    selected += 1;
  }

  return {
    strategyId: strategy.id,
    strategyVersion: strategy.version,
    paperOnly: strategy.execution.paperOnly,
    weeklySlotsRemaining: weeklySlots,
    openPositionSlotsRemaining: positionSlots,
    readyCount: base.filter(item => item.selectedForSubmission).length,
    plans: base,
  };
}
