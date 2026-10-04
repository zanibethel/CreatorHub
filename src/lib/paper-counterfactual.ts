export type CounterfactualBar = {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
};

export type DailyCryptoCounterfactualCandidate = {
  symbol: string;
  executionEligible: boolean;
  state: "ready" | "waiting" | "blocked";
  selectedForSubmission: boolean;
  score: number;
  bid: number | null;
  ask: number | null;
  spreadPct: number | null;
  trigger: number | null;
  maxEntry: number | null;
  protectiveStop: number | null;
  takeProfit: number | null;
  plannedRiskDollars: number | null;
  waitingOn: string[];
  blockers: string[];
  trackingBars: CounterfactualBar[];
};

export type DailyCryptoCounterfactualSnapshot = {
  collectedAt: string;
  strategyId: string;
  strategyVersion: number;
  executionEnabled: boolean;
  submissionReady: boolean;
  selectedSymbol: string | null;
  broadCryptoSupportive: boolean;
  session: {
    localDate: string;
    entriesOpen: boolean;
    flattenDue: boolean;
  };
  candidates: DailyCryptoCounterfactualCandidate[];
};

export type PaperCounterfactualState = {
  id: number;
  setupKey: string;
  botId: string;
  strategyId: string | null;
  strategyVersion: number | null;
  symbol: string;
  assetClass: string;
  decisionAt: string;
  sessionKey: string | null;
  status: "watching" | "triggered" | "completed" | "expired" | "ambiguous" | "superseded";
  score: number | null;
  triggerPrice: number;
  maxEntryPrice: number;
  protectiveStop: number;
  plannedTakeProfit: number | null;
  assumedEntryPrice: number | null;
  riskPerUnit: number | null;
  oneRPrice: number | null;
  twoRPrice: number | null;
  triggeredAt: string | null;
  stopHitAt: string | null;
  oneRHitAt: string | null;
  twoRHitAt: string | null;
  firstOutcome: string | null;
  peakPrice: number | null;
  troughPrice: number | null;
  lastBarAt: string | null;
  markCount: number;
  mfeR: number;
  maeR: number;
  blockers: string[];
  warnings: string[];
  metadata: Record<string, unknown>;
};

const finitePositive = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

function setupKey(snapshot: DailyCryptoCounterfactualSnapshot, symbol: string) {
  return `daily-crypto:${snapshot.strategyId}:v${snapshot.strategyVersion}:${snapshot.session.localDate}:${symbol}`;
}

export function buildDailyCryptoCounterfactualSeeds(
  botId: string,
  snapshot: DailyCryptoCounterfactualSnapshot,
) {
  if (!snapshot.session.entriesOpen) return [];

  return snapshot.candidates.flatMap(candidate => {
    const actualSubmissionPlanned =
      snapshot.executionEnabled
      && snapshot.submissionReady
      && snapshot.selectedSymbol === candidate.symbol;

    if (
      !candidate.executionEligible
      || candidate.score < 60
      || actualSubmissionPlanned
      || !finitePositive(candidate.trigger)
      || !finitePositive(candidate.maxEntry)
      || !finitePositive(candidate.protectiveStop)
      || candidate.protectiveStop >= candidate.maxEntry
    ) return [];

    return [{
      setup_key: setupKey(snapshot, candidate.symbol),
      bot_id: botId,
      strategy_id: snapshot.strategyId,
      strategy_version: snapshot.strategyVersion,
      symbol: candidate.symbol,
      asset_class: "crypto",
      source_event_type: candidate.state === "blocked" ? "rejected" : "candidate",
      decision_state: candidate.state,
      decision_at: snapshot.collectedAt,
      session_key: snapshot.session.localDate,
      status: "watching",
      score: candidate.score,
      trigger_price: candidate.trigger,
      max_entry_price: candidate.maxEntry,
      protective_stop: candidate.protectiveStop,
      planned_take_profit: candidate.takeProfit,
      last_bar_at: candidate.trackingBars.at(-1)?.t ?? null,
      blockers: candidate.blockers,
      warnings: candidate.waitingOn,
      metadata: {
        source: "daily-crypto-5m-runner",
        paperOnly: true,
        selectedForSubmission: candidate.selectedForSubmission,
        broadCryptoSupportive: snapshot.broadCryptoSupportive,
        initialBid: candidate.bid,
        initialAsk: candidate.ask,
        initialSpreadPct: candidate.spreadPct,
        plannedRiskDollars: candidate.plannedRiskDollars,
        trackingPolicy: "first-watch-or-better-per-symbol-per-session",
      },
    }];
  });
}

function terminal(
  state: PaperCounterfactualState,
  status: "completed" | "expired" | "ambiguous",
  outcome: string,
) {
  state.status = status;
  state.firstOutcome = outcome;
}

function updateExcursions(state: PaperCounterfactualState, high: number, low: number) {
  const entry = state.assumedEntryPrice;
  const risk = state.riskPerUnit;
  if (!finitePositive(entry) || !finitePositive(risk)) return;

  state.peakPrice = Math.max(state.peakPrice ?? entry, high);
  state.troughPrice = Math.min(state.troughPrice ?? entry, low);
  state.mfeR = Math.max(state.mfeR, (state.peakPrice - entry) / risk, 0);
  state.maeR = Math.min(state.maeR, (state.troughPrice - entry) / risk, 0);
}

function markOneR(state: PaperCounterfactualState, at: string) {
  if (!state.oneRHitAt) state.oneRHitAt = at;
}

function markTwoR(state: PaperCounterfactualState, at: string) {
  markOneR(state, at);
  if (!state.twoRHitAt) state.twoRHitAt = at;
}

export function advancePaperCounterfactual(
  original: PaperCounterfactualState,
  bars: CounterfactualBar[],
  options: { expire: boolean },
) {
  const state: PaperCounterfactualState = {
    ...original,
    blockers: [...original.blockers],
    warnings: [...original.warnings],
    metadata: { ...original.metadata },
  };
  let changed = false;

  if (!["watching","triggered"].includes(state.status)) {
    return { changed, state };
  }

  const lastTime = state.lastBarAt ? Date.parse(state.lastBarAt) : Number.NEGATIVE_INFINITY;
  const decisionTime = Date.parse(state.decisionAt);
  const unseen = bars
    .filter(bar => Number.isFinite(Date.parse(bar.t)))
    .filter(bar => Date.parse(bar.t) > lastTime)
    .filter(bar => Date.parse(bar.t) >= decisionTime - 5 * 60_000)
    .sort((a,b) => Date.parse(a.t) - Date.parse(b.t));

  for (const bar of unseen) {
    if (!["watching","triggered"].includes(state.status)) break;
    state.lastBarAt = bar.t;
    state.markCount += 1;
    changed = true;

    if (state.status === "watching") {
      if (bar.h < state.triggerPrice) continue;

      let entry: number | null = null;
      let entryAtOpen = false;

      if (bar.o >= state.triggerPrice && bar.o <= state.maxEntryPrice) {
        entry = bar.o;
        entryAtOpen = true;
      } else if (bar.o > state.maxEntryPrice) {
        if (bar.l > state.maxEntryPrice) {
          state.metadata = {
            ...state.metadata,
            gapAboveMaxEntryObserved: true,
            lastGapAboveMaxEntryAt: bar.t,
          };
          continue;
        }
        entry = state.maxEntryPrice;
      } else {
        entry = state.triggerPrice;
      }

      const risk = entry - state.protectiveStop;
      if (!(risk > 0)) {
        terminal(state, "ambiguous", "invalid-risk-plan");
        state.metadata = { ...state.metadata, invalidRiskDetectedAt: bar.t };
        break;
      }

      state.status = "triggered";
      state.assumedEntryPrice = entry;
      state.riskPerUnit = risk;
      state.oneRPrice = entry + risk;
      state.twoRPrice = entry + 2 * risk;
      state.triggeredAt = bar.t;
      state.peakPrice = Math.max(entry, bar.h);
      state.troughPrice = entry;
      state.mfeR = Math.max(0, (state.peakPrice - entry) / risk);
      state.maeR = 0;

      const oneRHit = bar.h >= state.oneRPrice;
      const twoRHit = bar.h >= state.twoRPrice;
      const stopPossible = bar.l <= state.protectiveStop;

      if (entryAtOpen) {
        state.troughPrice = Math.min(entry, bar.l);
        state.maeR = Math.min(0, (state.troughPrice - entry) / risk);
      } else if (stopPossible) {
        state.metadata = {
          ...state.metadata,
          stopPossibleOnTriggerBar: true,
          triggerBarSequenceUnknown: true,
        };
      }

      if (twoRHit) markTwoR(state, bar.t);
      else if (oneRHit) markOneR(state, bar.t);

      if (stopPossible && oneRHit) {
        state.stopHitAt = bar.t;
        terminal(state, "ambiguous", twoRHit
          ? "stop-or-two-r-same-trigger-bar"
          : "stop-or-one-r-same-trigger-bar");
        break;
      }

      if (entryAtOpen && stopPossible) {
        state.stopHitAt = bar.t;
        terminal(state, "completed", "stop-before-one-r");
        break;
      }

      if (twoRHit) {
        terminal(state, "completed", "two-r-before-stop");
        break;
      }

      continue;
    }

    updateExcursions(state, bar.h, bar.l);
    const hadOneRBefore = state.oneRHitAt !== null;
    const hadTwoRBefore = state.twoRHitAt !== null;
    const oneRHit = finitePositive(state.oneRPrice) && bar.h >= state.oneRPrice;
    const twoRHit = finitePositive(state.twoRPrice) && bar.h >= state.twoRPrice;
    const stopHit = bar.l <= state.protectiveStop;

    if (oneRHit) markOneR(state, bar.t);
    if (twoRHit) markTwoR(state, bar.t);

    const newTwoRThisBar = twoRHit && !hadTwoRBefore;
    const newOneRThisBar = oneRHit && !hadOneRBefore;

    if (stopHit && (newTwoRThisBar || newOneRThisBar)) {
      state.stopHitAt = bar.t;
      terminal(state, "ambiguous", newTwoRThisBar
        ? "stop-or-two-r-same-bar"
        : "stop-or-one-r-same-bar");
      break;
    }

    if (stopHit) {
      state.stopHitAt = bar.t;
      terminal(state, "completed", state.oneRHitAt ? "stop-after-one-r" : "stop-before-one-r");
      break;
    }

    if (twoRHit) {
      terminal(state, "completed", "two-r-before-stop");
      break;
    }
  }

  if (options.expire && ["watching","triggered"].includes(state.status)) {
    changed = true;
    if (state.status === "watching") {
      terminal(state, "expired", "never-triggered");
    } else {
      terminal(state, "expired", state.oneRHitAt ? "one-r-then-session-end" : "session-end-before-one-r");
    }
  }

  return { changed, state };
}

export function counterfactualPatch(state: PaperCounterfactualState) {
  return {
    status: state.status,
    assumed_entry_price: state.assumedEntryPrice,
    risk_per_unit: state.riskPerUnit,
    one_r_price: state.oneRPrice,
    two_r_price: state.twoRPrice,
    triggered_at: state.triggeredAt,
    stop_hit_at: state.stopHitAt,
    one_r_hit_at: state.oneRHitAt,
    two_r_hit_at: state.twoRHitAt,
    first_outcome: state.firstOutcome,
    peak_price: state.peakPrice,
    trough_price: state.troughPrice,
    last_bar_at: state.lastBarAt,
    mark_count: state.markCount,
    mfe_r: state.mfeR,
    mae_r: state.maeR,
    metadata: state.metadata,
    updated_at: new Date().toISOString(),
  };
}
