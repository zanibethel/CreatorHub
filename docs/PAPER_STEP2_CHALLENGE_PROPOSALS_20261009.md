# BigOrders Step 2 — Challenge-scoped trade proposal normalization (PAPER, shadow only)

**Date:** 2026-10-09 America/Chicago. **Status:** Implemented pure proposal adapters; no live challenge executor integration, no grant issuance, no order route changes. No new challenges were created and `shared-paper-v1` remains preview-only.

## Reused infrastructure

- `paper-bot-trade-plan.ts`: legacy reference/ready strategy plan, preserved unchanged.
- `paper-challenge-portability-audit.ts`: stable strategy registry and independent, shadow-only challenge identities.
- `paper-shared-capital-manager.ts`: existing policy percentages and physical exposure constraints; remains preview-only.
- Existing strategy evaluation outputs: Atlas/Fuse/Orbit/Coil `PaperBotTradePlan`, Harbor `SwingPreparedPlan + SwingPlanReadiness`, Flash `WeekendCryptoCandidate`, Pulse `evaluateMomentumBreakoutCandidate`, Spark `evaluateCryptoIgnitionCandidate`. No reimplementation of scanner, bars or strategy scoring.
- New `paper-challenge-proposals.ts`: read-only, version 2 proposal normalizer using these evaluator output shapes and current strategy config limits.

## Input/response contracts

`normalizeChallengeTradeProposal({challenge,botInstanceId,source,evidence,observedAt,currentSymbols,pendingSymbols,riskBreakersClear,...})` outputs `ChallengeProposal` including:
- `challengeId`, unique `botInstanceId`, canonical `strategyId/strategyVersion`, legacy `botId`, source adapter, namespace-scoped idempotency `decisionKey`.
- `symbol`, `assetClass` (including explicit unknown), source-qualified state, observed/created/expiry timestamps.
- `entryPrice`, `maximumEntryPrice`, `protectiveStop`, final target, partial targets if provided, observation-only quantity/notional, planned dollar loss and estimated round-trip cost and net R.
- `quoteTimestamp`, `quoteSource`, `completedCandleTimestamp`, source and optional Catalog/Midas provenance, market session and concentration classification.
- `blockers`, `warnings`, `quoteFresh`, `brokerIsolationVerified:false`, `sharedCapitalCompatible:false`, `brokerOrderAuthorized:false`.

Actual quote provenance, completed candles, session eligibility, strategy approval, loss-breaker state, and full challenge positions/pending orders must be supplied by trusted callers. Missing evidence fails closed. There is no fallback from scanner score to strategy authorization, and missing stops are not guessed. A historical $100 source approval proves nothing about a future challenge's safety.

## Adapter matrix

| Bot | Existing source | Normalized action |
| --- | --- | --- |
| Atlas | `PaperBotTradePlan` plus explicit max-entry evidence | Preserve strategy entry/stop/target; null when maximum entry absent |
| Fuse | `FuseReadiness` (`PaperBotTradePlan` descendant) | Preserve one-shot/research nature; never claim brokerage permission |
| Harbor | `SwingPreparedPlan` + `SwingPlanReadiness` + separately evidenced target | Reject plan without stop/target; fractional broker order incompatibility remains a Step 1 blocker |
| Flash | `WeekendCryptoCandidate` v5 | Preserve execution vs monitor tier and the first partial-profit target; only explicit selected state counts |
| Pulse | `evaluateMomentumBreakoutCandidate` result | Preserve selected strategy state, entry chase, stop and target; do not assume stock fractionability |
| Spark | `evaluateCryptoIgnitionCandidate` result | Preserve Spark-specific 0.35% risk cap; source evaluator alone does not select submission |
| Orbit | `PaperBotTradePlan` | Reference/research only, regardless of source score |
| Coil | `PaperBotTradePlan` | Reference/research only, regardless of source score |

## Challenge capital

All hypothetical position sizes derive from the **provided challenge virtual equity/cash/buying power and reserve**, not `$100`, `$1,000` or `$5,000` constants. The default policy protects a 20% cash reserve, standard maximum 0.5% stop risk, 12% position limit (5% speculative) and minimum net 2R. Each strategy's compiled config further tightens risk and allocation (e.g., Spark 0.35%). Explicit per-instance overrides may tighten, never loosen a bot's ceiling. Crypto uses nine-decimal observation quantity, stocks whole shares by default unless caller explicitly supplies verified fractional eligibility; that flag does **not** certify a broker protection path. Estimated fees/slippage/spread must be supplied and factor into loss and net reward/risk.

The normalizer does not assess all advanced risk constraints (portfolio aggregate risk, correlation, broker physical ownership, atomic reservations, recovery and live protection). Hence all proposals have `brokerOrderAuthorized:false`. They must not be wired into broker executor routes.

## Research agents

A challenge may opt into Catalog and Midas as `role:"research"`, `canSubmitOrders:false`. Their evidence IDs/timestamps may accompany proposals but cannot authorize, size or submit a trade. A contributor missing from the challenge is rejected.

## Still required before challenge activation

**Step 3** will introduce challenge-specific capital/participant persistence and ledger adapters with forward-only schema/RLS migrations and preservation of historical `paper_bot_*` data. Subsequent steps must implement instance-scoped order/fill journals, atomic allocator grants, safe physical broker account isolation, risk-breaker SQL parity, robust stop management, loss/fee reconciliations, and recovery verification. Even a full Step 2 output is observation-only until all subsequent safety gates pass.

## Verification

Run `npx tsc --noEmit`, lint, `npm run test:paper`, and `npm run build`. Verify Vercel production is READY for the exact merged commit. Read-only Supabase/Alpaca comparisons must confirm no changes to positions, orders, $100 ledgers, or the `shared-paper-v1` preview scenario.
