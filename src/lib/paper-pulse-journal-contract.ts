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
