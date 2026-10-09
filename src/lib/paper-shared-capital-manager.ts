/**
 * BigOrders shared-capital allocator — deterministic, PAPER-ONLY PREVIEW.
 *
 * This module never authorizes broker orders or moves bot capital.
 * The $5,000 model is a new independent simulation, not a reset of existing
 * $100 challenge ledgers. The execution adapters must separately implement
 * atomic reservation, reconciliation and broker-protection checks.
 */
export const PAPER_SHARED_CAPITAL_POLICY_V1 = Object.freeze({
  id: "shared-paper-capital-v1",
  paperOnly: true,
  status: "preview-only",
  startingEquityUsd: 5000,
  cashReservePct: 20,
  maximumGrossExposurePct: 80,
  standardTradeRiskPct: 0.5,
  provenTradeRiskPct: 0.75,
  maximumOpenRiskPct: 2,
  maximumPositionPct: 12,
  speculativePositionPct: 5,
  maximumConcentrationPct: 25,
  maximumOpenPositions: 8,
  dailyLossHaltPct: 2,
  weeklyLossHaltPct: 4,
  minimumNetRewardRisk: 2,
  minimumCryptoNotionalUsd: 10,
  sleeves: { stocks: 45, swing: 20, crypto: 15 },
} as const);

export type CapitalSleeve = keyof typeof PAPER_SHARED_CAPITAL_POLICY_V1.sleeves;
export type CapitalAssetClass = "stock" | "etf" | "crypto";
export type PortfolioExposure = {
  symbol: string;
  sleeve: CapitalSleeve;
  concentrationGroup: string;
  marketValueUsd: number;
  plannedLossUsd: number;
};
export type SharedPortfolioSnapshot = {
  equityUsd: number;
  settledCashUsd: number;
  buyingPowerUsd: number;
  reservedCashUsd: number;
  dayStartEquityUsd: number;
  weekStartEquityUsd: number;
  dayProfitLossUsd: number;
  weekProfitLossUsd: number;
  holdings: PortfolioExposure[];
  pendingEntries: PortfolioExposure[];
};
export type TradeMeritEvidence = {
  /** Only strategy-specific, settled, out-of-sample results; NOT scanner scores. */
  sampleSize: number;
  winners: number;
  averageWinR: number;
  averageLossR: number;
};
export type SharedCapitalCandidate = {
  botId: string;
  symbol: string;
  sleeve: CapitalSleeve;
  assetClass: CapitalAssetClass;
  concentrationGroup: string;
  entryPrice: number;
  stopPrice: number;
  targetPrice: number;
  /** Estimated round trip spread, commissions/fees and slippage as % notional. */
  roundTripCostPct: number;
  strategyQualified: boolean;
  freshQuote: boolean;
  marketSessionEligible: boolean;
  brokerProtectionSupported: boolean;
  speculative: boolean;
  meritEvidence?: TradeMeritEvidence | null;
};
export type SharedCapitalPreview = {
  policyId: string;
  paperOnly: true;
  brokerOrderAuthorized: false;
  state: "allocatable" | "shadow-only" | "rejected";
  reasons: string[];
  botId: string;
  symbol: string;
  quantity: number;
  plannedNotionalUsd: number;
  plannedLossUsd: number;
  plannedNetTargetRewardUsd: number;
  netRewardRisk: number;
  riskBudgetUsd: number;
  expectedNetR: number | null;
  evidenceSampleSize: number;
  cashAvailableForDeploymentUsd: number;
  capitalLimitUsd: number;
  limitingFactors: string[];
};

const positive = (n: number) => Number.isFinite(n) && n > 0;
const nonnegative = (n: number) => Number.isFinite(n) && n >= 0;
const floorTo = (number: number, decimals: number) =>
  Math.floor(number * 10 ** decimals + 1e-9) / 10 ** decimals;
const round = (number: number) => Math.round(number * 1e8) / 1e8;
const canonicalSymbol = (s: string) => s.replace(/[\\/\s-]/g, "").toUpperCase();

/** Conservative Wilson 95% lower bound, not a probability forecast. */
export function wilsonWinRateLowerBound(wins: number, sampleSize: number): number {
  if (!Number.isSafeInteger(wins) || !Number.isSafeInteger(sampleSize) ||
      sampleSize < 1 || wins < 0 || wins > sampleSize) throw new Error("Invalid outcomes.");
  const z = 1.96;
  const p = wins / sampleSize;
  const denominator = 1 + z * z / sampleSize;
  const adjusted = p + z * z / (2 * sampleSize);
  const radius = z * Math.sqrt(p * (1-p) / sampleSize + z*z/(4*sampleSize*sampleSize));
  return Math.max(0, (adjusted-radius)/denominator);
}

function validateSnapshot(s: SharedPortfolioSnapshot): void {
  if (![s.equityUsd,s.settledCashUsd,s.buyingPowerUsd,s.reservedCashUsd,
    s.dayStartEquityUsd,s.weekStartEquityUsd].every(nonnegative) ||
    !positive(s.equityUsd) || !positive(s.dayStartEquityUsd) ||
    !positive(s.weekStartEquityUsd) ||
    !Number.isFinite(s.dayProfitLossUsd) || !Number.isFinite(s.weekProfitLossUsd) ||
    !Array.isArray(s.holdings) || !Array.isArray(s.pendingEntries)) {
    throw new Error("Invalid portfolio snapshot: refuse allocation.");
  }
  for (const h of [...s.holdings,...s.pendingEntries]) {
    if (!h.symbol?.trim() || !h.concentrationGroup?.trim() ||
      !(h.sleeve in PAPER_SHARED_CAPITAL_POLICY_V1.sleeves) ||
      !nonnegative(h.marketValueUsd) || !nonnegative(h.plannedLossUsd)) {
      throw new Error("Invalid portfolio exposure: refuse allocation.");
    }
  }
}

/** Pure advisory calculation. Never reuse its state as broker execution permission. */
export function previewSharedPaperAllocation(
  candidate: SharedCapitalCandidate,
  portfolio: SharedPortfolioSnapshot,
): SharedCapitalPreview {
  validateSnapshot(portfolio);
  if (!candidate.botId?.trim() || !candidate.symbol?.trim() ||
    !candidate.concentrationGroup?.trim() ||
    !(candidate.sleeve in PAPER_SHARED_CAPITAL_POLICY_V1.sleeves) ||
    !["stock","etf","crypto"].includes(candidate.assetClass) ||
    !positive(candidate.entryPrice) || !positive(candidate.stopPrice) ||
    !positive(candidate.targetPrice) || candidate.stopPrice >= candidate.entryPrice ||
    candidate.targetPrice <= candidate.entryPrice ||
    !positive(candidate.roundTripCostPct) || candidate.roundTripCostPct > 10 ||
    (candidate.assetClass === "crypto" && candidate.sleeve !== "crypto") ||
    (candidate.assetClass !== "crypto" && candidate.sleeve === "crypto")) {
    throw new Error("Invalid candidate or cost model: refuse allocation.");
  }
  const policy = PAPER_SHARED_CAPITAL_POLICY_V1;
  const reasons: string[] = [];
  if (!candidate.strategyQualified) reasons.push("Strategy has not qualified this setup.");
  if (!candidate.freshQuote) reasons.push("A fresh executable quote is required.");
  if (!candidate.marketSessionEligible) reasons.push("Entry session is not eligible.");
  if (!candidate.brokerProtectionSupported) reasons.push("Protective order path is not verified.");

  const tradingCostPerUnit = candidate.entryPrice * candidate.roundTripCostPct / 100;
  const lossPerUnit = candidate.entryPrice - candidate.stopPrice + tradingCostPerUnit;
  const gainPerUnit = candidate.targetPrice - candidate.entryPrice - tradingCostPerUnit;
  const netRewardRisk = gainPerUnit / lossPerUnit;
  if (!Number.isFinite(netRewardRisk) || netRewardRisk < policy.minimumNetRewardRisk)
    reasons.push("Net reward-to-risk is below the portfolio minimum.");

  let expectedNetR: number | null = null;
  let evidenceSampleSize = 0;
  const evidence = candidate.meritEvidence;
  if (evidence != null) {
    if (!Number.isSafeInteger(evidence.sampleSize) || evidence.sampleSize < 0 ||
      !Number.isSafeInteger(evidence.winners) || evidence.winners < 0 ||
      evidence.winners > evidence.sampleSize ||
      !positive(evidence.averageWinR) || !positive(evidence.averageLossR))
      throw new Error("Invalid historical merit evidence.");
    evidenceSampleSize = evidence.sampleSize;
    if (evidence.sampleSize >= 30) {
      const conservativeP = wilsonWinRateLowerBound(evidence.winners, evidence.sampleSize);
      expectedNetR = conservativeP * evidence.averageWinR -
        (1-conservativeP) * evidence.averageLossR -
        candidate.roundTripCostPct / 100 * candidate.entryPrice / lossPerUnit;
      if (expectedNetR <= 0) reasons.push("Conservative history-adjusted expected value is nonpositive.");
    }
  }
  const strongEvidence = evidenceSampleSize >= 200 && expectedNetR !== null && expectedNetR >= 0.75;
  const riskPct = strongEvidence ? policy.provenTradeRiskPct : policy.standardTradeRiskPct;
  const riskBudgetUsd = round(portfolio.equityUsd * riskPct / 100);
  const allPositions = [...portfolio.holdings,...portfolio.pendingEntries];
  const sum = (items: PortfolioExposure[]) => items.reduce((total, h) => total+h.marketValueUsd, 0);
  const totalGross = sum(allPositions);
  const sleeveGross = sum(allPositions.filter(h => h.sleeve === candidate.sleeve));
  const concentrationGross = sum(allPositions.filter(h =>
    h.concentrationGroup.toUpperCase() === candidate.concentrationGroup.toUpperCase()));
  const openRisk = allPositions.reduce((total, h) => total+h.plannedLossUsd, 0);
  const policyReserve = portfolio.equityUsd * policy.cashReservePct / 100;
  const availableCash = Math.max(0, Math.min(portfolio.settledCashUsd,portfolio.buyingPowerUsd) -
    portfolio.reservedCashUsd - policyReserve);
  const positionCap = portfolio.equityUsd *
    (candidate.speculative ? policy.speculativePositionPct : policy.maximumPositionPct) / 100;
  const limits: Record<string,number> = {
    "position cap": positionCap,
    "strategy sleeve": portfolio.equityUsd*policy.sleeves[candidate.sleeve]/100-sleeveGross,
    "concentration cap": portfolio.equityUsd*policy.maximumConcentrationPct/100-concentrationGross,
    "gross exposure": portfolio.equityUsd*policy.maximumGrossExposurePct/100-totalGross,
    "available settled cash after reserve": availableCash,
    "risk per trade": riskBudgetUsd/lossPerUnit*candidate.entryPrice,
    "aggregate open risk": (portfolio.equityUsd*policy.maximumOpenRiskPct/100-openRisk)/
      lossPerUnit*candidate.entryPrice,
  };
  const capitalLimitUsd = Math.max(0, Math.min(...Object.values(limits)));
  const limitingFactors = Object.entries(limits)
    .filter(([,v]) => v <= capitalLimitUsd + 0.00001)
    .map(([key]) => key);
  const rawQty = capitalLimitUsd / candidate.entryPrice;
  // Whole shares for stocks/ETFs: fractional stock protection requires a separate
  // independently validated execution adapter. Crypto permits 9 decimal places.
  const quantity = Math.max(0,candidate.assetClass === "crypto" ?
    floorTo(rawQty,9) : Math.floor(rawQty+1e-9));
  const minNotional = candidate.assetClass === "crypto" ? policy.minimumCryptoNotionalUsd : candidate.entryPrice;
  const notional = quantity*candidate.entryPrice;
  const capitalReasons: string[] = [];
  if (allPositions.some(h => canonicalSymbol(h.symbol) === canonicalSymbol(candidate.symbol)))
    capitalReasons.push("Physical symbol already occupied or reserved.");
  if (allPositions.length >= policy.maximumOpenPositions)
    capitalReasons.push("Open-position limit is reached.");
  if (-portfolio.dayProfitLossUsd >= portfolio.dayStartEquityUsd*policy.dailyLossHaltPct/100)
    capitalReasons.push("Daily loss circuit breaker active.");
  if (-portfolio.weekProfitLossUsd >= portfolio.weekStartEquityUsd*policy.weeklyLossHaltPct/100)
    capitalReasons.push("Weekly loss circuit breaker active.");
  if (notional + 1e-6 < minNotional)
    capitalReasons.push("Available allocation cannot accommodate a protected position.");
  const state: SharedCapitalPreview["state"] = reasons.length ? "rejected" :
    capitalReasons.length ? "shadow-only" : "allocatable";
  return {
    policyId:policy.id,paperOnly:true,brokerOrderAuthorized:false,state,
    reasons:[...reasons,...capitalReasons],botId:candidate.botId,symbol:candidate.symbol,
    quantity:state === "allocatable" ? quantity : 0,
    plannedNotionalUsd:state === "allocatable" ? round(notional) : 0,
    plannedLossUsd:state === "allocatable" ? round(quantity*lossPerUnit) : 0,
    plannedNetTargetRewardUsd:state === "allocatable" ? round(quantity*gainPerUnit) : 0,
    netRewardRisk:round(netRewardRisk),riskBudgetUsd,expectedNetR:expectedNetR===null?null:round(expectedNetR),
    evidenceSampleSize,cashAvailableForDeploymentUsd:round(availableCash),
    capitalLimitUsd:round(capitalLimitUsd),limitingFactors,
  };
}
