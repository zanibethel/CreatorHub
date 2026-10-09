> **Later status update (October 8, 2026, evening CT):** This original snapshot is historic. Pulse has a guarded fractional PAPER pilot but a rejected fractional bracket attempt; Fuse now has a dual-enabled one-shot PAPER bracket pilot, broker protection auditor and exit manager deployed, with no Fuse broker fills yet. For current actionable work, see [BigOrders bot execution readiness plan](PAPER_BOT_EXECUTION_READINESS_PLAN_2026-10-08.md). Do not interpret the older “Fuse research only” row below as live status.

# Trading bot pre-start execution coverage — 2026-10-08

## Operating requirement

All eight bots retain isolated $100 **virtual** ledgers. Any eligible actual broker submission must use the Alpaca **paper** endpoint, full broker attribution, guard-railed revalidation, idempotency and a protective exit manager. Automated simulated orders are permitted before the official challenge start; that start must remain unrecorded until the owner separately requests it. Eligibility does not guarantee an order on any given scan.

The `tests/paper-bot-execution-coverage.test.mjs` contract verifies the routes and schedules, and prevents silent loss of the scanners during other bot work. It **does not** prove order execution or fill behavior; these require live-session smoke tests.

| Bot | Profile ID | Scanner | Current autonomous order execution |
|---|---|---|---|
| Flash | weekend-crypto-day-100 | 5 min, 24/7 | Enabled; paper executor and manager |
| Spark | crypto-ignition-100 | 5 min, 24/7 | Enabled; paper executor and manager |
| Pulse | momentum-breakout-100 | 5 min weekdays | Enabled; paper bracket executor |
| Harbor | three-trade-weekly-swing-100 | 5 min weekdays | Enabled; paper bracket executor |
| Fuse | penny-volatility-day-100 | 5 min weekdays | **Research only**; no penny-stock executor/flatten/halts |
| Orbit | crypto-swing-100 | 15 min, 24/7 | **Research only**; no crypto swing executor/manager |
| Coil | squeeze-breakout-100 | 5 min weekdays | **Research only**; no stock breakout executor/manager |
| Atlas | default-diverse | No verified autonomous schedule | Historic paper orders; no verified autonomous runner |

As of this audit, production seven-specialist readiness GETs all returned HTTP 200. Four enabled specialists reported `submissionReady=false`. Paper ledgers for all eight were active, with no open positions. Fuse had seven historical scanner assignments but zero fresh candidates; no completed Fuse research observations have been stored yet.

## Release gates before changing execution permissions

1. Preserve `vercel.json` cron entries, market-mover scans, Midas two-scan quality confirmation, historical scanners, and unrelated UX.
2. Implement an actual dedicated runner, paper-only executor and protective exit manager for the specific research bot. Merely flipping `metadata.executionEnabled` cannot create purchases.
3. For stocks: confirm market clock, holidays, halts, liquidity, spread, quote timestamp, whole/fractional share availability, broker bracket compatibility and time-to-close. Fuse needs fail-closed liquidation/overnight behavior.
4. For crypto: validate buying power, fee impact, broker size/precision rules, existing exposure and trailing/partial-profit protection.
5. Before any submission: revalidate the exact selected setup in the same market session, claim a unique order ID, limit maximum exposure by the individual bot's **virtual** equity, refuse duplicates, then validate broker protection and reconcile fills back to only that bot's ledger.
6. Exercise full paper tests, risk/rejection tests, live-session journal proof and a protective simulated fill. Do **not** assert automation is fully operational solely because cron HTTP200.
7. Keep official challenge start/date, original funding, balances and previous history untouched.

Tracking: [Pre-start all-bot execution issue #49](https://github.com/zanibethel/CreatorHub/issues/49); [Fuse execution follow-up #35](https://github.com/zanibethel/CreatorHub/issues/35).
