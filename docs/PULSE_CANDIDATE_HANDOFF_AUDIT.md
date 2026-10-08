# Pulse candidate-handoff audit — 2026-10-08

## Production baseline, before change

- Deployment: `75bdffccda75670a8db21b4577bed63c2fc0cb7e` (`READY`, main).
- Pulse virtual ledger `momentum-breakout-100`: active, equity/cash/buying power $100 each, `executionEnabled=true`, `liveMoneyEnabled=false`, broker tag `pls`.
- Stock prospect snapshot: 1,542 stocks; **1** `review-ready` stock, **0** current Pulse suggestions/assignments. The lone score-80 `PENG` record had last been seen on 2026-10-07 18:50 UTC; therefore stale beyond Pulse's 20-minute maximum and outside an eligible live entry.
- October 8 stock observations through 13:30 UTC: **0** with score >= 80, so there were no evidence-backed current qualifying scanner setups to submit.
- Pulse persisted paper orders, broker orders, broker fills, and counterfactuals: all 0. Five-minute Pulse `system` journal heartbeats were present through 13:25 UTC; production readiness returned HTTP 200, `plans:[]`, `submissionReady:false`, paper-only true.
- This baseline shows a *legitimate lack of fresh qualifying opportunity*, not evidence that a broker fill was missed.

## Confirmed latent handoff bug fixed

Prior readiness requested the **global** top 30 review-ready stocks and only then filtered `assigned_bot_ids` in JS. When many other bots have higher-ranked stocks, an assigned Pulse symbol could be excluded even when fully eligible. Readiness now requests only rows that already contain `momentum-breakout-100` in the Postgres text-array assignment, before its existing score ordering and top-30 limit. An extra in-memory assignment check remains as defense in depth.

The unchanged scanner continues to score and assign prospects; no trading score, risk limit, or execution permission was loosened.

## Audit evidence

Readiness additionally gathers a bounded **80-row sample** of stocks with scanner scores >=65 to classify:
- below scanner/Pulse threshold; scanner disqualification; penny lane;
- stale observation (20-minute limit); scanner-routing mismatch; assignment mismatch; genuinely assigned.

These are **sampled diagnostics**, not entire market universe counts. The regular read-only readiness response returns `handoff`, while CRON-authorized readiness also persists a timestamped `system` journal heartbeat with diagnostic counts for empty queues. No fake candidate decisions, broker orders, or fills are generated. Performance Audit now avoids labeling zero suggestions as a broken handoff, and explicitly distinguishes a suggestion/assignment mismatch.

## Verification checklist

1. CI: Node tests, type check, lint, and Next build.
2. Confirm production deployment references the merged commit; readiness HTTP 200, strategy ID, `paperOnly=true` and a `handoff` object.
3. Verify CRON runs persist actual paper journal heartbeats at their scheduled cadence; inspect handoff reason distribution after the next genuine stock scans.
4. Confirm Pulse remains $100 isolated, no live-money orders, no spurious fills, and no threshold changes.
5. **Do not** force a trade to certify submission. End-to-end actual paper broker submission and protective-order verification remain unproven until a naturally qualifying stock enters the runner; monitor its subsequent order/broker-fill journal evidence.

Production risk controls, separate bots, and scanner scoring are deliberately unchanged.
