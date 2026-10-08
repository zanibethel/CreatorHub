/**
 * Pulse journal classification matches the existing paper_bot_journal
 * database CHECK constraints. This is evidence classification only:
 * it must never authorize an order or change a strategy gate.
 */
export type PulseJournalPlanState = "ready" | "waiting" | "blocked";

export function classifyPulseJournalPlan(plan: {
  state: PulseJournalPlanState;
  selectedForSubmission: boolean;
}): {
  eventType: "candidate" | "rejected" | "authorized";
  qualification: "unqualified" | "watch" | "qualified" | "trade-ready";
} {
  if (plan.state === "blocked") {
    return { eventType: "rejected", qualification: "unqualified" };
  }
  if (plan.state === "waiting") {
    return { eventType: "candidate", qualification: "watch" };
  }
  if (plan.selectedForSubmission) {
    return { eventType: "authorized", qualification: "trade-ready" };
  }
  return { eventType: "candidate", qualification: "qualified" };
}

/** Diagnostic-only scanner → Pulse handoff evidence; never authorizes execution. */
export type PulseHandoffRow = {
  symbol: string;
  score: number;
  price: number | null;
  status: string;
  botReviewEligible: boolean;
  suggestedBotIds: string[];
  assignedBotIds: string[];
  lastSeenAt: string;
  reasons: string[];
};

export function pulseProspectIntakePath(botId: string) {
  // Restrict assignments BEFORE applying limit=30. A global top-30 scan can
  // otherwise starve Pulse when other bots own the highest-ranked symbols.
  const assigned = encodeURIComponent(`{${botId}}`);
  return `paper_prospects?asset_class=eq.stock&status=eq.review-ready&bot_review_eligible=eq.true&assigned_bot_ids=cs.${assigned}&select=symbol,scanner_version,score,percent_change,score_components,reasons,last_seen_at,assigned_bot_ids&order=score.desc,last_seen_at.desc&limit=30`;
}

export function summarizePulseHandoff(rows: PulseHandoffRow[], now: number, botId: string, minScore: number, minPrice: number, maxAgeMinutes: number) {
  const reasons = {
    belowScannerThreshold: 0,
    scannerRejected: 0,
    pennyLane: 0,
    stale: 0,
    scannerRoutingMismatch: 0,
    assignmentMismatch: 0,
    assigned: 0,
  };
  const examples: {symbol: string; score: number; lastSeenAt: string; reason: keyof typeof reasons; details: string[]}[] = [];
  for (const row of rows) {
    const age = (now - Date.parse(row.lastSeenAt)) / 60_000;
    const reason: keyof typeof reasons =
      row.score < minScore ? "belowScannerThreshold"
        : row.status !== "review-ready" || !row.botReviewEligible ? "scannerRejected"
          : row.price === null || row.price < minPrice ? "pennyLane"
            : !Number.isFinite(age) || age > maxAgeMinutes || age < -1 ? "stale"
              : !row.suggestedBotIds.includes(botId) ? "scannerRoutingMismatch"
                : !row.assignedBotIds.includes(botId) ? "assignmentMismatch"
                  : "assigned";
    reasons[reason]++;
    if (examples.length < 8) examples.push({
      symbol: row.symbol, score: row.score, lastSeenAt: row.lastSeenAt,
      reason, details: row.reasons.filter(value => value.includes("validation") || value.includes("spread")).slice(0, 2),
    });
  }
  return {sampledStocksScore65Plus: rows.length, sampleLimit: 80, counts: reasons, examples, paperOnly: true as const};
}
