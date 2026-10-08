"use client";

import { useEffect, useState } from "react";
import styles from "./PaperTradingLab.module.css";

type PulseHandoff = {
  sampledStocksScore65Plus: number;
  sampleLimit: number;
  counts: {
    belowScannerThreshold: number;
    scannerRejected: number;
    pennyLane: number;
    stale: number;
    scannerRoutingMismatch: number;
    assignmentMismatch: number;
    assigned: number;
  };
};
type PulsePlan = {
  symbol: string;
  scannerScore: number;
  state: "ready" | "waiting" | "blocked";
  blockers: string[];
  waitingOn: string[];
};
type PulseReadiness = {
  collectedAt: string;
  paperOnly: true;
  submissionReady: boolean;
  handoff: PulseHandoff;
  plans: PulsePlan[];
};

export default function PulseHandoffPanel() {
  const [report, setReport] = useState<PulseReadiness | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    let busy = false;
    const refresh = async () => {
      if (busy || controller.signal.aborted || document.hidden) return;
      busy = true;
      try {
        const response = await fetch("/api/paper-trading/bots/momentum-breakout-readiness", {
          cache: "no-store",
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]),
        });
        if (!response.ok) throw new Error("Pulse readiness is unavailable.");
        const body = await response.json() as PulseReadiness;
        if (body.paperOnly !== true || !body.handoff?.counts || !Array.isArray(body.plans)) {
          throw new Error("Pulse handoff evidence is incomplete.");
        }
        if (!controller.signal.aborted) { setReport(body); setError(""); }
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Pulse handoff unavailable.");
      } finally { busy = false; }
    };
    const onVisible = () => { if (!document.hidden) void refresh(); };
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 60_000);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return <section className={styles.botProfileList} aria-label="Pulse scanner handoff evidence">
    <h3>Scanner to Pulse · Live evidence</h3>
    {report ? <>
      <ul>
        <li>Scanner sample: {report.handoff.sampledStocksScore65Plus} stock records with score 65+, capped at {report.handoff.sampleLimit}; this is not a total market count.</li>
        <li>Currently assigned in sample: {report.handoff.counts.assigned}; scanner routing mismatches: {report.handoff.counts.scannerRoutingMismatch}; assignment mismatches: {report.handoff.counts.assignmentMismatch}.</li>
        <li>Below Pulse score: {report.handoff.counts.belowScannerThreshold}; scanner-rejected: {report.handoff.counts.scannerRejected}; penny lane: {report.handoff.counts.pennyLane}; stale: {report.handoff.counts.stale}.</li>
        {report.plans.length ? report.plans.slice(0,5).map(plan=><li key={plan.symbol}>
          <strong>{plan.symbol}</strong> · score {plan.scannerScore} · {plan.state} — {plan.blockers.concat(plan.waitingOn).slice(0,4).join("; ") || "All readiness gates satisfied; no fill implied."}
        </li>) : <li>No Pulse assigned plans in this readiness snapshot. This alone does not prove a routing failure.</li>}
        <li>Submission ready: {report.submissionReady ? "yes (simulated only)" : "no"} · updated {new Intl.DateTimeFormat("en-US", {timeZone:"America/Chicago",dateStyle:"medium",timeStyle:"short"}).format(new Date(report.collectedAt))} Central.</li>
      </ul>
    </> : <ul><li>{error || "Loading the latest paper-only Pulse readiness evidence…"}</li></ul>}
    {error && report ? <div className={styles.portfolioWarnings}>Last refresh failed: {error}. Showing the most recent successful snapshot.</div> : null}
  </section>;
}
