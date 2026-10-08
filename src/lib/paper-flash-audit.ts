/** Read-only Flash forensic assessment. Never authorizes trades or credits shadow P/L. */
export type FlashDecisionEvidence = {
  decision_state: string | null;
  score: number | string | null;
  warnings: unknown;
  blockers: unknown;
  metadata: Record<string, unknown> | null;
};
export type FlashShadowEvidence = {
  decision_state: string | null;
  score: number | string | null;
  warnings: unknown;
  blockers: unknown;
  first_outcome: string | null;
  metadata: Record<string, unknown> | null;
};
export function flashDecisionClassification(
  shadow: FlashShadowEvidence,
  decision: FlashDecisionEvidence | null,
): { label: "Valid rejection at decision time" | "Unresolved: decision evidence missing" | "Unresolved: authorization requires investigation"; verifiedMissedTrade: false; reason: string } {
  // Shadow outcomes are derived from future candles and cannot establish executable entries.
  if (!decision || !decision.metadata || !["waiting", "blocked", "ready"].includes(String(decision.metadata.state))) {
    return { label: "Unresolved: decision evidence missing", verifiedMissedTrade: false, reason: "No matching contemporaneous journal decision can establish the entry gate." };
  }
  const selected = decision.metadata.selectedForSubmission === true;
  const submissionReady = decision.metadata.submissionReady === true;
  const enabled = decision.metadata.executionEnabled === true;
  const evidenceWarnings = Array.isArray(decision.warnings) ? decision.warnings : [];
  const evidenceBlockers = Array.isArray(decision.blockers) ? decision.blockers : [];
  if (!selected && (decision.metadata.state === "waiting" || decision.metadata.state === "blocked") &&
      (evidenceWarnings.length > 0 || evidenceBlockers.length > 0)) {
    return {
      label: "Valid rejection at decision time", verifiedMissedTrade: false,
      reason: "Recorded entry checks were unsatisfied and this symbol was not selected for submission. Subsequent candle movement does not remove those historical blockers.",
    };
  }
  if (selected || (submissionReady && enabled)) {
    return {
      label: "Unresolved: authorization requires investigation", verifiedMissedTrade: false,
      reason: "A possible submission must be reconciled against the order claim, broker acknowledgements, and venue fills before calling this an implementation failure.",
    };
  }
  return {
    label: "Unresolved: authorization requires investigation", verifiedMissedTrade: false,
    reason: "The decision snapshot does not show a proven executable entry; investigate selection, readiness and market conditions.",
  };
}
export function flashEvidenceCounts(rows: Array<{first_outcome: string | null; status: string; setup_key: string}>) {
  const settled = rows.filter(row => row.status === "completed");
  return {
    trackedSetupKeys: new Set(rows.map(row => row.setup_key)).size,
    settled: settled.length,
    twoR: settled.filter(row => row.first_outcome === "two-r-before-stop").length,
    stopBeforeOneR: settled.filter(row => row.first_outcome === "stop-before-one-r").length,
    stopAfterOneR: settled.filter(row => row.first_outcome === "stop-after-one-r").length,
  };
}
