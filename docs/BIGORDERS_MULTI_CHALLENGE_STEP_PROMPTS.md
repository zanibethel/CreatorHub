# BigOrders — Multi-Challenge PAPER Implementation Prompts (Steps 1–12)

**Recorded 2026-10-09.** Each section is a standalone copyable prompt for its own ChatGPT project thread. Start Step 1's amendment in the **existing Step 1 thread**; do not replace already completed work blindly.

**Source of truth:** [Multi-challenge roadmap](./BIGORDERS_MULTI_CHALLENGE_ROADMAP.md). At the time the plan was recorded, Step 1 PR #128 was open, so inspect its current state before acting.

**Important:** A prompt is an implementation request, not permission to activate brokers. No PAPER test orders until expressly approved during the Step 12 canary; no real-money orders.

## Step 1 — AMEND ACTIVE EIGHT-BOT AUDIT — reconcile already-started Step 1 work

~~~text
BigOrders / CreatorHub — STEP 1: AMEND ACTIVE EIGHT-BOT AUDIT — reconcile already-started Step 1 work

PROJECT: BigOrders / CreatorHub reusable multi-challenge PAPER trading.
GitHub: zanibethel/CreatorHub (main). Production: https://creatorhub-gray.vercel.app. Bot Lab: /paper-trading/bots. Performance: /paper-trading/bots/performance. Trading dashboard: /paper-trading.
Supabase project: yufptpfiwdbzzrvhkvux. Vercel project: prj_zf7GQgNvUBXmVWRcijS8aIVxzLsw. Vercel team: team_AH72aX1BaaPucIOvrSgvpEhw. Reporting timezone: America/Chicago.
Use @GitHub, @Supabase, @Vercel, and @Alpaca Paper Trading DIRECTLY. Inspect actual main branch, database, PAPER broker orders/positions, cron jobs, deployment, PRs and tests as appropriate. Do not provide instructions where you can perform the work.
Reference docs/BIGORDERS_MULTI_CHALLENGE_ROADMAP.md and this prompt file on main. Respect the verified handoff and implemented changes from preceding steps, not assumptions from an earlier chat.
Core architecture: challenge owns money and lifecycle; bot owns reusable strategy; bot instance is independently scoped to challenge; optional Catalog/Midas are research-only; allocator authorizes spending; broker/account identity and reconciliation own physical exposure.
Existing: PRs #123 allocator, #124 DB baseline, #125 preview reservations, #126 shadow research, #127 Upcoming Trades. Preserve eight historic $100 bot ledgers, legacy $1,000 fund, and observation-only shared-paper-v1 $5,000 scenario.
SAFETY: PAPER ONLY, never real money. Do NOT activate shared execution, submit or modify PAPER orders, or bypass protective exits unless Step 12 receives fresh explicit user approval for a narrowly defined canary. Keep existing legacy execution controls unchanged. No secrets in public endpoints. Never assume distinct virtual challenges are isolated in one physically netting Alpaca PAPER account.
Delivery standard: implement relevant safe changes, deterministic regression tests, npx tsc --noEmit, lint, PAPER suite, Next build; branch, PR, passing CI, merge, independently verify Vercel production deployment and read-only database/broker invariants. If nothing should change, provide evidence rather than a meaningless PR. Report actual verification limits.

STEP-SPECIFIC IMPLEMENTATION:
1. CRITICAL: Step 1 was already underway when this architecture was approved. On 2026-10-09 the existing audit PR was #128, branch audit/eight-bot-paper-readiness-20261009. Check whether it is still open or already merged, plus any new commits, migrations, deployments and audit artifacts. Do NOT create a competing audit; reconcile the existing one first.
2. Make an explicit KEEP / ADAPT / REVERT ledger for changes already made. KEEP read-only execution auditing and broker reconciliation evidence. ADAPT any one-portfolio or fixed-$5,000 assumptions. REVERT/REPLACE only incompatible Step 1 work after assessing downstream dependencies. Amend the existing unmerged audit PR when feasible; for merged incompatibilities use separate corrective PR. For already-applied migrations use safe forward-only migrations; no destructive rollback or loss of history.
3. Audit exactly eight bots: Atlas default-diverse; Fuse penny-volatility-day-100; Harbor three-trade-weekly-swing-100; Flash weekend-crypto-day-100; Pulse momentum-breakout-100; Spark crypto-ignition-100; Orbit crypto-swing-100; Coil squeeze-breakout-100. Keep legacy ID suffixes for historical attribution.
4. Trace each bot scanner -> evaluation -> qualification -> proposal -> risk check -> virtual funding -> broker submission -> fill -> stop/target/trailing -> exit -> ledger/journal. Distinguish configured profile mode, effective runtime permission, working cron, actual brokerage order history and protective stop coverage. Classify operational, implemented-but-blocked, partial, research-only, or broken, citing source/records.
5. Inspect the live Supabase bot ledgers, orders, positions, strategy journals, shared portfolio/reservations/shadow studies, the execution audit, Alpaca PAPER account orders and positions, plus unmatched/manual orders. Read-only. Treat unknown evidence as unknown; no invented zero counts, trades or P/L.
6. Inventory EVERY strategy or DB assumption of $100, $1,000, $5,000; constant position sizes; global cash; bot -100 names; permanent one-instance-per-bot design; singleton scenarios; shared cron/journal keys; physically netted symbol positions; unsafe research-order authorization. Classify historical/test-only versus active sizing/risk/execution bugs.
7. Assess each bot's portability to ChallengeContext(challengeId,botInstanceId,capital snapshot,risk policy,brokerAccountId,positions,reservations,loss window,quote/session) and standardized TradeProposal. Test conceptually/through pure calculations that $500 and $5,000 portfolios change size, never the qualifying safety rules.
8. Assess optional research-only Catalog/Midas and multiple simultaneous challenges. Explicitly fail challenge-level broker isolation if one netted PAPER account cannot prove symbol/order/exit ownership. Preserve current shared-paper-v1 observation-only and all prior ledgers.

ACCEPTANCE AND REGRESSION TESTS:
1. All eight traced; current PR #128 reconciled and changes documented KEEP/ADAPT/REVERT.
2. Read-only audit proves effective permission, quote and protection blockers, cron recency, strategy qualification, broker attribution, account-level isolation, mismatch states and capital-only blockers.
3. Hard-coded-money matrix names file/function, impact and adapter needed; legacy -100 IDs and $100 history preserved.
4. Unknowns and missing stops fail closed; no trades or broker writes; no scenario reservations consumed.
5. Check existing audit tests plus TypeScript/lint/PAPER tests/build; deployment READY only if new code merged.

FINAL DELIVERABLES:
Deliver eight-bot execution matrix, capital-dependency and challenge-portability matrix, P0–P3 blockers, broker/ledger reconciliation, keep/adapt/revert log, PR/merge/deploy evidence and exact technical Step 2 handoff.

EXECUTION DIRECTIVE: Begin with connected tool inspection of actual source and state. Complete safe in-scope changes and independent verification now. Clearly distinguish verified from unknown. Preserve legacy trading behavior and PAPER safety gates.
~~~

---

## Step 2 — STANDARDIZE CAPITAL-INDEPENDENT STRATEGY CONTEXT AND PROPOSALS

~~~text
BigOrders / CreatorHub — STEP 2: STANDARDIZE CAPITAL-INDEPENDENT STRATEGY CONTEXT AND PROPOSALS

PROJECT: BigOrders / CreatorHub reusable multi-challenge PAPER trading.
GitHub: zanibethel/CreatorHub (main). Production: https://creatorhub-gray.vercel.app. Bot Lab: /paper-trading/bots. Performance: /paper-trading/bots/performance. Trading dashboard: /paper-trading.
Supabase project: yufptpfiwdbzzrvhkvux. Vercel project: prj_zf7GQgNvUBXmVWRcijS8aIVxzLsw. Vercel team: team_AH72aX1BaaPucIOvrSgvpEhw. Reporting timezone: America/Chicago.
Use @GitHub, @Supabase, @Vercel, and @Alpaca Paper Trading DIRECTLY. Inspect actual main branch, database, PAPER broker orders/positions, cron jobs, deployment, PRs and tests as appropriate. Do not provide instructions where you can perform the work.
Reference docs/BIGORDERS_MULTI_CHALLENGE_ROADMAP.md and this prompt file on main. Respect the verified handoff and implemented changes from preceding steps, not assumptions from an earlier chat.
Core architecture: challenge owns money and lifecycle; bot owns reusable strategy; bot instance is independently scoped to challenge; optional Catalog/Midas are research-only; allocator authorizes spending; broker/account identity and reconciliation own physical exposure.
Existing: PRs #123 allocator, #124 DB baseline, #125 preview reservations, #126 shadow research, #127 Upcoming Trades. Preserve eight historic $100 bot ledgers, legacy $1,000 fund, and observation-only shared-paper-v1 $5,000 scenario.
SAFETY: PAPER ONLY, never real money. Do NOT activate shared execution, submit or modify PAPER orders, or bypass protective exits unless Step 12 receives fresh explicit user approval for a narrowly defined canary. Keep existing legacy execution controls unchanged. No secrets in public endpoints. Never assume distinct virtual challenges are isolated in one physically netting Alpaca PAPER account.
Delivery standard: implement relevant safe changes, deterministic regression tests, npx tsc --noEmit, lint, PAPER suite, Next build; branch, PR, passing CI, merge, independently verify Vercel production deployment and read-only database/broker invariants. If nothing should change, provide evidence rather than a meaningless PR. Report actual verification limits.

STEP-SPECIFIC IMPLEMENTATION:
1. Introduce versioned ChallengeContext with challengeId, botInstanceId, canonical strategy/version, capital baseline, current equity, settled cash, buying power, reserves, holdings, pending orders, exposure, loss windows, challenge risk policy, broker context, quote/session observation.
2. Introduce versioned TradeProposal with canonical bot/instance identifiers, symbol/class, evidence and qualification, quote source/time, entry trigger/range/max chase, stop, targets/partials/trailing, reference quantity, costs/slippage, planned loss and net reward:risk, expiry and scoped idempotency key.
3. Refactor all eight evaluation strategies through compatibility adapters, preserving independent indicators and safety gates. Neither strategy evaluation nor research contributor directly reserves/spends capital. Keep old database bot IDs and historical results intact.
4. Allow a canonical strategy to have multiple separate configured instances in different challenges with independent decision state and journal identity. Design strategy overrides without accidental shared mutable state.
5. Optional Catalog/Midas input is time-stamped provenance only, not broker authorization.

ACCEPTANCE AND REGRESSION TESTS:
1. All eight bots can produce valid typed proposals; stale/unsafe/incomplete proposals explicitly blocked.
2. Run $500/$5,000/$50,000 context tests; sizing changes appropriately and no zero-protection/over-budget orders.
3. Two Spark instances never share decision keys or journals; historical adapters still pass original tests.
4. Do not activate or submit shared trades.

FINAL DELIVERABLES:
Deliver canonical contracts, adapter coverage/status for all bots, compatibility mapping, focused tests, deployed code and Step 3 handoff.

EXECUTION DIRECTIVE: Begin with connected tool inspection of actual source and state. Complete safe in-scope changes and independent verification now. Clearly distinguish verified from unknown. Preserve legacy trading behavior and PAPER safety gates.
~~~

---

## Step 3 — CONFIGURABLE CHALLENGE MANAGER AND ISOLATED LEDGERS

~~~text
BigOrders / CreatorHub — STEP 3: CONFIGURABLE CHALLENGE MANAGER AND ISOLATED LEDGERS

PROJECT: BigOrders / CreatorHub reusable multi-challenge PAPER trading.
GitHub: zanibethel/CreatorHub (main). Production: https://creatorhub-gray.vercel.app. Bot Lab: /paper-trading/bots. Performance: /paper-trading/bots/performance. Trading dashboard: /paper-trading.
Supabase project: yufptpfiwdbzzrvhkvux. Vercel project: prj_zf7GQgNvUBXmVWRcijS8aIVxzLsw. Vercel team: team_AH72aX1BaaPucIOvrSgvpEhw. Reporting timezone: America/Chicago.
Use @GitHub, @Supabase, @Vercel, and @Alpaca Paper Trading DIRECTLY. Inspect actual main branch, database, PAPER broker orders/positions, cron jobs, deployment, PRs and tests as appropriate. Do not provide instructions where you can perform the work.
Reference docs/BIGORDERS_MULTI_CHALLENGE_ROADMAP.md and this prompt file on main. Respect the verified handoff and implemented changes from preceding steps, not assumptions from an earlier chat.
Core architecture: challenge owns money and lifecycle; bot owns reusable strategy; bot instance is independently scoped to challenge; optional Catalog/Midas are research-only; allocator authorizes spending; broker/account identity and reconciliation own physical exposure.
Existing: PRs #123 allocator, #124 DB baseline, #125 preview reservations, #126 shadow research, #127 Upcoming Trades. Preserve eight historic $100 bot ledgers, legacy $1,000 fund, and observation-only shared-paper-v1 $5,000 scenario.
SAFETY: PAPER ONLY, never real money. Do NOT activate shared execution, submit or modify PAPER orders, or bypass protective exits unless Step 12 receives fresh explicit user approval for a narrowly defined canary. Keep existing legacy execution controls unchanged. No secrets in public endpoints. Never assume distinct virtual challenges are isolated in one physically netting Alpaca PAPER account.
Delivery standard: implement relevant safe changes, deterministic regression tests, npx tsc --noEmit, lint, PAPER suite, Next build; branch, PR, passing CI, merge, independently verify Vercel production deployment and read-only database/broker invariants. If nothing should change, provide evidence rather than a meaningless PR. Report actual verification limits.

STEP-SPECIFIC IMPLEMENTATION:
1. Create secure challenge records (ID,name,currency,configurable immutable starting amount, dated lifecycle, policy, execution mode, selected instances, research contributors). Define draft/preview/running/paused/completed/archived guarded transitions.
2. Persist canonical strategies, challenge-scoped bot instances and roles (trader, researcher, observer); permit any supported participant combinations.
3. Build challenge-scoped financial journals for opening funds, dated deposits/withdrawals/adjustments, fills, fees, realized P/L, virtual cash/equity, reserved cash, pending orders and position accounting. Funding changes after launch cannot rewrite original capital.
4. Map shared-paper-v1 safely as first future $5K challenge; preserve its current observation-only mode, $0 reservation status if that is still true, and historic eight $100 ledgers/$1K baseline.
5. Protect sensitive configuration with RLS/authorized API. Define explicit broker account assignment/isolation and shadow-only fallback. Never equate virtual starting equity with physical account buying power.

ACCEPTANCE AND REGRESSION TESTS:
1. Independently create $500 Fuse+Pulse and $5,000 Spark+Catalog+Midas drafts, with the $5K all-eight existing scenario preserved.
2. Two instances of one strategy have independent ledgers/state; cross-challenge key/cash leakage impossible.
3. Negative/nonfinite funding and illegal transitions fail; funded adjustments have audit history.
4. Security/RLS checks pass; no creation flow submits orders.

FINAL DELIVERABLES:
Deliver schema/migrations, read APIs, lifecycle and ledger proofs, merge/deployment verification and Step 4 handoff.

EXECUTION DIRECTIVE: Begin with connected tool inspection of actual source and state. Complete safe in-scope changes and independent verification now. Clearly distinguish verified from unknown. Preserve legacy trading behavior and PAPER safety gates.
~~~

---

## Step 4 — CROSS-STRATEGY RANKING AND OPTIONAL RESEARCH ATTRIBUTION

~~~text
BigOrders / CreatorHub — STEP 4: CROSS-STRATEGY RANKING AND OPTIONAL RESEARCH ATTRIBUTION

PROJECT: BigOrders / CreatorHub reusable multi-challenge PAPER trading.
GitHub: zanibethel/CreatorHub (main). Production: https://creatorhub-gray.vercel.app. Bot Lab: /paper-trading/bots. Performance: /paper-trading/bots/performance. Trading dashboard: /paper-trading.
Supabase project: yufptpfiwdbzzrvhkvux. Vercel project: prj_zf7GQgNvUBXmVWRcijS8aIVxzLsw. Vercel team: team_AH72aX1BaaPucIOvrSgvpEhw. Reporting timezone: America/Chicago.
Use @GitHub, @Supabase, @Vercel, and @Alpaca Paper Trading DIRECTLY. Inspect actual main branch, database, PAPER broker orders/positions, cron jobs, deployment, PRs and tests as appropriate. Do not provide instructions where you can perform the work.
Reference docs/BIGORDERS_MULTI_CHALLENGE_ROADMAP.md and this prompt file on main. Respect the verified handoff and implemented changes from preceding steps, not assumptions from an earlier chat.
Core architecture: challenge owns money and lifecycle; bot owns reusable strategy; bot instance is independently scoped to challenge; optional Catalog/Midas are research-only; allocator authorizes spending; broker/account identity and reconciliation own physical exposure.
Existing: PRs #123 allocator, #124 DB baseline, #125 preview reservations, #126 shadow research, #127 Upcoming Trades. Preserve eight historic $100 bot ledgers, legacy $1,000 fund, and observation-only shared-paper-v1 $5,000 scenario.
SAFETY: PAPER ONLY, never real money. Do NOT activate shared execution, submit or modify PAPER orders, or bypass protective exits unless Step 12 receives fresh explicit user approval for a narrowly defined canary. Keep existing legacy execution controls unchanged. No secrets in public endpoints. Never assume distinct virtual challenges are isolated in one physically netting Alpaca PAPER account.
Delivery standard: implement relevant safe changes, deterministic regression tests, npx tsc --noEmit, lint, PAPER suite, Next build; branch, PR, passing CI, merge, independently verify Vercel production deployment and read-only database/broker invariants. If nothing should change, provide evidence rather than a meaningless PR. Report actual verification limits.

STEP-SPECIFIC IMPLEMENTATION:
1. Build challenge-scoped qualified-only opportunity queue accepting standardized TradeProposal from enabled instances.
2. Normalize net expected reward/risk, evidence quality, quote age, costs, spread, liquidity, time horizon, proposed downside and portfolio fit. Raw bot-specific scores must not be treated as interchangeable calibrated probabilities.
3. Filter stale, strategy-disqualified, duplicate/conflicting symbol and unsafe/invalid proposals. Keep detailed rejection/waiting provenance.
4. Enable or disable Catalog/Midas per challenge, time-stamp and journal research contributions, quantify uncertainty and reject post-decision lookahead.
5. Produce deterministic read-only rankings for Upcoming Trades. Ranking alone never reserves funds or authorizes broker orders.

ACCEPTANCE AND REGRESSION TESTS:
1. All-eight queue versus Spark-only and Fuse+Pulse produce only their selected bot instances.
2. Unverified confidence is not fabricated. No researcher can authorize execution. Two different challenges have distinct rankings.
3. Identical snapshot/proposals produce identical ordering with explicit ties and disqualifications.

FINAL DELIVERABLES:
Deliver ranking contracts, API/journal, calibration caveats, tests and Step 5 handoff.

EXECUTION DIRECTIVE: Begin with connected tool inspection of actual source and state. Complete safe in-scope changes and independent verification now. Clearly distinguish verified from unknown. Preserve legacy trading behavior and PAPER safety gates.
~~~

---

## Step 5 — DYNAMIC CHALLENGE CAPITAL ALLOCATION AND RISK POLICY

~~~text
BigOrders / CreatorHub — STEP 5: DYNAMIC CHALLENGE CAPITAL ALLOCATION AND RISK POLICY

PROJECT: BigOrders / CreatorHub reusable multi-challenge PAPER trading.
GitHub: zanibethel/CreatorHub (main). Production: https://creatorhub-gray.vercel.app. Bot Lab: /paper-trading/bots. Performance: /paper-trading/bots/performance. Trading dashboard: /paper-trading.
Supabase project: yufptpfiwdbzzrvhkvux. Vercel project: prj_zf7GQgNvUBXmVWRcijS8aIVxzLsw. Vercel team: team_AH72aX1BaaPucIOvrSgvpEhw. Reporting timezone: America/Chicago.
Use @GitHub, @Supabase, @Vercel, and @Alpaca Paper Trading DIRECTLY. Inspect actual main branch, database, PAPER broker orders/positions, cron jobs, deployment, PRs and tests as appropriate. Do not provide instructions where you can perform the work.
Reference docs/BIGORDERS_MULTI_CHALLENGE_ROADMAP.md and this prompt file on main. Respect the verified handoff and implemented changes from preceding steps, not assumptions from an earlier chat.
Core architecture: challenge owns money and lifecycle; bot owns reusable strategy; bot instance is independently scoped to challenge; optional Catalog/Midas are research-only; allocator authorizes spending; broker/account identity and reconciliation own physical exposure.
Existing: PRs #123 allocator, #124 DB baseline, #125 preview reservations, #126 shadow research, #127 Upcoming Trades. Preserve eight historic $100 bot ledgers, legacy $1,000 fund, and observation-only shared-paper-v1 $5,000 scenario.
SAFETY: PAPER ONLY, never real money. Do NOT activate shared execution, submit or modify PAPER orders, or bypass protective exits unless Step 12 receives fresh explicit user approval for a narrowly defined canary. Keep existing legacy execution controls unchanged. No secrets in public endpoints. Never assume distinct virtual challenges are isolated in one physically netting Alpaca PAPER account.
Delivery standard: implement relevant safe changes, deterministic regression tests, npx tsc --noEmit, lint, PAPER suite, Next build; branch, PR, passing CI, merge, independently verify Vercel production deployment and read-only database/broker invariants. If nothing should change, provide evidence rather than a meaningless PR. Report actual verification limits.

STEP-SPECIFIC IMPLEMENTATION:
1. Generalize PR #123 portfolio snapshot/allocator and PR #125 preview policy to challenge-specific available settled cash, reserves, held positions, pending orders, loss windows and exposure.
2. Preserve provisional baseline: 20% reserve, 80% gross cap, 0.5% trade risk (0.75% only with independently proven rule), 2% aggregate risk, 12% normal/5% speculative position, 25% correlated group, max 8 holdings+pending, 2% daily/4% weekly risk breakers, net 2R after costs; sleeves stocks 45%, swing 20%, crypto 15%. Verify actual configured values.
3. Ensure unknown loss windows, unverified protection, stale market data, insufficient settled cash, correlation or physical-broker ownership conflicts fail closed.
4. Allow safe challenge-specific tightening and strategy-specific stricter rules. No fixed funding assigned to every bot; central allocator determines what can be financed.
5. Synchronize SQL and TS policy enforcement, including optional 0.75% tier. Record allocated/rejected/shadow-only rationale and actual unavailable capital.

ACCEPTANCE AND REGRESSION TESTS:
1. Same qualified setup produces risk-respecting amounts under $500/$5,000/$50,000; below broker min it may be zero.
2. Competing bots cannot commit more cash/risk than the common challenge allows; no duplicate symbol/overexposure.
3. No fabricated shadow win, no broker order, no preview reservation touching the existing baseline.

FINAL DELIVERABLES:
Deliver audited allocator changes, invariant tests, conservative outcome categories and Step 6 handoff.

EXECUTION DIRECTIVE: Begin with connected tool inspection of actual source and state. Complete safe in-scope changes and independent verification now. Clearly distinguish verified from unknown. Preserve legacy trading behavior and PAPER safety gates.
~~~

---

## Step 6 — ATOMIC, ISOLATED RESERVATIONS AND IDEMPOTENCY

~~~text
BigOrders / CreatorHub — STEP 6: ATOMIC, ISOLATED RESERVATIONS AND IDEMPOTENCY

PROJECT: BigOrders / CreatorHub reusable multi-challenge PAPER trading.
GitHub: zanibethel/CreatorHub (main). Production: https://creatorhub-gray.vercel.app. Bot Lab: /paper-trading/bots. Performance: /paper-trading/bots/performance. Trading dashboard: /paper-trading.
Supabase project: yufptpfiwdbzzrvhkvux. Vercel project: prj_zf7GQgNvUBXmVWRcijS8aIVxzLsw. Vercel team: team_AH72aX1BaaPucIOvrSgvpEhw. Reporting timezone: America/Chicago.
Use @GitHub, @Supabase, @Vercel, and @Alpaca Paper Trading DIRECTLY. Inspect actual main branch, database, PAPER broker orders/positions, cron jobs, deployment, PRs and tests as appropriate. Do not provide instructions where you can perform the work.
Reference docs/BIGORDERS_MULTI_CHALLENGE_ROADMAP.md and this prompt file on main. Respect the verified handoff and implemented changes from preceding steps, not assumptions from an earlier chat.
Core architecture: challenge owns money and lifecycle; bot owns reusable strategy; bot instance is independently scoped to challenge; optional Catalog/Midas are research-only; allocator authorizes spending; broker/account identity and reconciliation own physical exposure.
Existing: PRs #123 allocator, #124 DB baseline, #125 preview reservations, #126 shadow research, #127 Upcoming Trades. Preserve eight historic $100 bot ledgers, legacy $1,000 fund, and observation-only shared-paper-v1 $5,000 scenario.
SAFETY: PAPER ONLY, never real money. Do NOT activate shared execution, submit or modify PAPER orders, or bypass protective exits unless Step 12 receives fresh explicit user approval for a narrowly defined canary. Keep existing legacy execution controls unchanged. No secrets in public endpoints. Never assume distinct virtual challenges are isolated in one physically netting Alpaca PAPER account.
Delivery standard: implement relevant safe changes, deterministic regression tests, npx tsc --noEmit, lint, PAPER suite, Next build; branch, PR, passing CI, merge, independently verify Vercel production deployment and read-only database/broker invariants. If nothing should change, provide evidence rather than a meaningless PR. Report actual verification limits.

STEP-SPECIFIC IMPLEMENTATION:
1. Extend existing preview claim/release safely with scoped challengeId, botInstanceId, accountId, symbol and immutable decision identity.
2. Ensure DB-atomic serialized claims, no negative available cash and true concurrent conflict blocking. Define planned/held/submitting/committed/released/expired/unknown states.
3. Prevent same physical broker symbol from being double-owned or double-exited; prevent one challenge's money being used by another.
4. Reconcile pending orders and broker ownership before release; never release on uncertain network status without confirmed no-order/no-fill evidence.
5. Provide safe expiry, crash replay and idempotency protections while preserving existing preview and research behaviors.

ACCEPTANCE AND REGRESSION TESTS:
1. Parallel claims for identical symbol and aggregate over-budget request are serialized safely.
2. Exact retries are idempotent; changed payloads under reused keys reject; abandoned or broker-uncertain reservations fail closed.
3. Identical key/symbol in different challenge namespaces does not collide in database, but sharing a physically netted broker account still blocks new execution.
4. No real/test PAPER broker submissions.

FINAL DELIVERABLES:
Deliver DB transaction/RLS checks, concurrency evidence, lifecycle, safe-release rules and Step 7 handoff.

EXECUTION DIRECTIVE: Begin with connected tool inspection of actual source and state. Complete safe in-scope changes and independent verification now. Clearly distinguish verified from unknown. Preserve legacy trading behavior and PAPER safety gates.
~~~

---

## Step 7 — CENTRAL CHALLENGE-AWARE PAPER BROKER EXECUTION ROUTER

~~~text
BigOrders / CreatorHub — STEP 7: CENTRAL CHALLENGE-AWARE PAPER BROKER EXECUTION ROUTER

PROJECT: BigOrders / CreatorHub reusable multi-challenge PAPER trading.
GitHub: zanibethel/CreatorHub (main). Production: https://creatorhub-gray.vercel.app. Bot Lab: /paper-trading/bots. Performance: /paper-trading/bots/performance. Trading dashboard: /paper-trading.
Supabase project: yufptpfiwdbzzrvhkvux. Vercel project: prj_zf7GQgNvUBXmVWRcijS8aIVxzLsw. Vercel team: team_AH72aX1BaaPucIOvrSgvpEhw. Reporting timezone: America/Chicago.
Use @GitHub, @Supabase, @Vercel, and @Alpaca Paper Trading DIRECTLY. Inspect actual main branch, database, PAPER broker orders/positions, cron jobs, deployment, PRs and tests as appropriate. Do not provide instructions where you can perform the work.
Reference docs/BIGORDERS_MULTI_CHALLENGE_ROADMAP.md and this prompt file on main. Respect the verified handoff and implemented changes from preceding steps, not assumptions from an earlier chat.
Core architecture: challenge owns money and lifecycle; bot owns reusable strategy; bot instance is independently scoped to challenge; optional Catalog/Midas are research-only; allocator authorizes spending; broker/account identity and reconciliation own physical exposure.
Existing: PRs #123 allocator, #124 DB baseline, #125 preview reservations, #126 shadow research, #127 Upcoming Trades. Preserve eight historic $100 bot ledgers, legacy $1,000 fund, and observation-only shared-paper-v1 $5,000 scenario.
SAFETY: PAPER ONLY, never real money. Do NOT activate shared execution, submit or modify PAPER orders, or bypass protective exits unless Step 12 receives fresh explicit user approval for a narrowly defined canary. Keep existing legacy execution controls unchanged. No secrets in public endpoints. Never assume distinct virtual challenges are isolated in one physically netting Alpaca PAPER account.
Delivery standard: implement relevant safe changes, deterministic regression tests, npx tsc --noEmit, lint, PAPER suite, Next build; branch, PR, passing CI, merge, independently verify Vercel production deployment and read-only database/broker invariants. If nothing should change, provide evidence rather than a meaningless PR. Report actual verification limits.

STEP-SPECIFIC IMPLEMENTATION:
1. Create a central PAPER-only entry gateway that accepts an authenticated authorized allocation/reservation and binds challenge, instance, strategy, broker account, symbol and unique client order identity.
2. Revalidate settled cash, quote freshness, stop protection, session/asset rules, quantity precision, broker account isolation, aggregate and period risk immediately before the call.
3. Journal submission intent before broker action, reconcile network ambiguity before retries and never duplicate a physical order.
4. Apply strict PAPER endpoint/credentials validation and independent ownership proof; reject shared account collisions. Keep existing bot executors' effective permissions unchanged.
5. Add entry kill switch and broker error diagnostics; separate protective risk-reduction actions from new entry permissions.
6. Implement with **mocked calls/dry runs only**. Deploying a new router is not permission to activate it.

ACCEPTANCE AND REGRESSION TESTS:
1. Wrong broker environment/account, missing reservation/stop, stale quote, no isolation, duplicate key and loss breaker all reject.
2. Simulate ambiguous timeout, partial response, broker reject and replay with at most one intended order.
3. Check live broker order list before/after deployment to confirm no orders created.

FINAL DELIVERABLES:
Deliver controlled router contract, mock coverage, deployment, disabled-state verification and Step 8 handoff.

EXECUTION DIRECTIVE: Begin with connected tool inspection of actual source and state. Complete safe in-scope changes and independent verification now. Clearly distinguish verified from unknown. Preserve legacy trading behavior and PAPER safety gates.
~~~

---

## Step 8 — PROTECTIVE EXIT OWNERSHIP AND OUTAGE RECOVERY

~~~text
BigOrders / CreatorHub — STEP 8: PROTECTIVE EXIT OWNERSHIP AND OUTAGE RECOVERY

PROJECT: BigOrders / CreatorHub reusable multi-challenge PAPER trading.
GitHub: zanibethel/CreatorHub (main). Production: https://creatorhub-gray.vercel.app. Bot Lab: /paper-trading/bots. Performance: /paper-trading/bots/performance. Trading dashboard: /paper-trading.
Supabase project: yufptpfiwdbzzrvhkvux. Vercel project: prj_zf7GQgNvUBXmVWRcijS8aIVxzLsw. Vercel team: team_AH72aX1BaaPucIOvrSgvpEhw. Reporting timezone: America/Chicago.
Use @GitHub, @Supabase, @Vercel, and @Alpaca Paper Trading DIRECTLY. Inspect actual main branch, database, PAPER broker orders/positions, cron jobs, deployment, PRs and tests as appropriate. Do not provide instructions where you can perform the work.
Reference docs/BIGORDERS_MULTI_CHALLENGE_ROADMAP.md and this prompt file on main. Respect the verified handoff and implemented changes from preceding steps, not assumptions from an earlier chat.
Core architecture: challenge owns money and lifecycle; bot owns reusable strategy; bot instance is independently scoped to challenge; optional Catalog/Midas are research-only; allocator authorizes spending; broker/account identity and reconciliation own physical exposure.
Existing: PRs #123 allocator, #124 DB baseline, #125 preview reservations, #126 shadow research, #127 Upcoming Trades. Preserve eight historic $100 bot ledgers, legacy $1,000 fund, and observation-only shared-paper-v1 $5,000 scenario.
SAFETY: PAPER ONLY, never real money. Do NOT activate shared execution, submit or modify PAPER orders, or bypass protective exits unless Step 12 receives fresh explicit user approval for a narrowly defined canary. Keep existing legacy execution controls unchanged. No secrets in public endpoints. Never assume distinct virtual challenges are isolated in one physically netting Alpaca PAPER account.
Delivery standard: implement relevant safe changes, deterministic regression tests, npx tsc --noEmit, lint, PAPER suite, Next build; branch, PR, passing CI, merge, independently verify Vercel production deployment and read-only database/broker invariants. If nothing should change, provide evidence rather than a meaningless PR. Report actual verification limits.

STEP-SPECIFIC IMPLEMENTATION:
1. Scope filled position ownership by challenge, bot instance, broker account, physical symbol and fill set; exactly one exit manager must own each position.
2. Use validated broker-native stop/target where possible and reject unsupported fractional/bracket or crypto stop combinations safely.
3. Manage partial fills, first targets, remaining trailing quantities, gap risk, stop-target same-bar ambiguity, short market sessions/halts and 24/7 crypto.
4. Recalculate remaining protection after each event, prevent overselling and unrelated challenge stop changes, persist protective lifecycle.
5. Ensure risk-reducing exits can run during entry kill switches; recovery/monitoring cannot depend solely on the Samsung node or Mac being on.

ACCEPTANCE AND REGRESSION TESTS:
1. Dry-run broker fill/stop lifecycle, partial fills/targets, overfill/oversell prevention, rejected stop, stale data, outage and restart.
2. Check unrelated challenge positions can't be adopted or protective orders modified.
3. No new live PAPER entries/test orders in this step.

FINAL DELIVERABLES:
Deliver exit ownership/certification matrix, fault tests, fail-closed monitor plan and Step 9 handoff.

EXECUTION DIRECTIVE: Begin with connected tool inspection of actual source and state. Complete safe in-scope changes and independent verification now. Clearly distinguish verified from unknown. Preserve legacy trading behavior and PAPER safety gates.
~~~

---

## Step 9 — BROKER/LEDGER RECONCILIATION AND INTEGRITY

~~~text
BigOrders / CreatorHub — STEP 9: BROKER/LEDGER RECONCILIATION AND INTEGRITY

PROJECT: BigOrders / CreatorHub reusable multi-challenge PAPER trading.
GitHub: zanibethel/CreatorHub (main). Production: https://creatorhub-gray.vercel.app. Bot Lab: /paper-trading/bots. Performance: /paper-trading/bots/performance. Trading dashboard: /paper-trading.
Supabase project: yufptpfiwdbzzrvhkvux. Vercel project: prj_zf7GQgNvUBXmVWRcijS8aIVxzLsw. Vercel team: team_AH72aX1BaaPucIOvrSgvpEhw. Reporting timezone: America/Chicago.
Use @GitHub, @Supabase, @Vercel, and @Alpaca Paper Trading DIRECTLY. Inspect actual main branch, database, PAPER broker orders/positions, cron jobs, deployment, PRs and tests as appropriate. Do not provide instructions where you can perform the work.
Reference docs/BIGORDERS_MULTI_CHALLENGE_ROADMAP.md and this prompt file on main. Respect the verified handoff and implemented changes from preceding steps, not assumptions from an earlier chat.
Core architecture: challenge owns money and lifecycle; bot owns reusable strategy; bot instance is independently scoped to challenge; optional Catalog/Midas are research-only; allocator authorizes spending; broker/account identity and reconciliation own physical exposure.
Existing: PRs #123 allocator, #124 DB baseline, #125 preview reservations, #126 shadow research, #127 Upcoming Trades. Preserve eight historic $100 bot ledgers, legacy $1,000 fund, and observation-only shared-paper-v1 $5,000 scenario.
SAFETY: PAPER ONLY, never real money. Do NOT activate shared execution, submit or modify PAPER orders, or bypass protective exits unless Step 12 receives fresh explicit user approval for a narrowly defined canary. Keep existing legacy execution controls unchanged. No secrets in public endpoints. Never assume distinct virtual challenges are isolated in one physically netting Alpaca PAPER account.
Delivery standard: implement relevant safe changes, deterministic regression tests, npx tsc --noEmit, lint, PAPER suite, Next build; branch, PR, passing CI, merge, independently verify Vercel production deployment and read-only database/broker invariants. If nothing should change, provide evidence rather than a meaningless PR. Report actual verification limits.

STEP-SPECIFIC IMPLEMENTATION:
1. Implement idempotent challenge-scoped reconciliation of Alpaca PAPER account positions, orders, partial fills, canceled/rejected/expired entries, buying power, fees, journals, reservations and virtual challenge ledger.
2. Separate simulated challenge equity from physical broker account equity and buying power. Handle known manual/unattributed PAPER orders explicitly.
3. Flag orphan reservations, missing protection, unknown submission outcome, duplicate fills, ownership conflicts, accounting mismatches and impossible cash balances.
4. Allow safe release/commit only on evidenced order state. Record immutable adjustments and reconciliation status: reconciled/warning/blocked/unknown.
5. Block new challenge entries on material unknowns, while preserving protective exits and existing legacy controls.

ACCEPTANCE AND REGRESSION TESTS:
1. Replayed broker fill/cancel events do not double count, partial fills reconcile, stale/unknown broker orders do not trigger blind retry.
2. Physical ownership conflict across challenges is detected. No drift from historical $100 ledgers.
3. Independent read-only Alpaca verification shows no new audit-generated orders.

FINAL DELIVERABLES:
Deliver reconciliation report, broker-account and challenge ownership proof, failure tests and Step 10 handoff.

EXECUTION DIRECTIVE: Begin with connected tool inspection of actual source and state. Complete safe in-scope changes and independent verification now. Clearly distinguish verified from unknown. Preserve legacy trading behavior and PAPER safety gates.
~~~

---

## Step 10 — FORWARD-BAR SHADOW TRADING AND RESEARCH CONTRIBUTION

~~~text
BigOrders / CreatorHub — STEP 10: FORWARD-BAR SHADOW TRADING AND RESEARCH CONTRIBUTION

PROJECT: BigOrders / CreatorHub reusable multi-challenge PAPER trading.
GitHub: zanibethel/CreatorHub (main). Production: https://creatorhub-gray.vercel.app. Bot Lab: /paper-trading/bots. Performance: /paper-trading/bots/performance. Trading dashboard: /paper-trading.
Supabase project: yufptpfiwdbzzrvhkvux. Vercel project: prj_zf7GQgNvUBXmVWRcijS8aIVxzLsw. Vercel team: team_AH72aX1BaaPucIOvrSgvpEhw. Reporting timezone: America/Chicago.
Use @GitHub, @Supabase, @Vercel, and @Alpaca Paper Trading DIRECTLY. Inspect actual main branch, database, PAPER broker orders/positions, cron jobs, deployment, PRs and tests as appropriate. Do not provide instructions where you can perform the work.
Reference docs/BIGORDERS_MULTI_CHALLENGE_ROADMAP.md and this prompt file on main. Respect the verified handoff and implemented changes from preceding steps, not assumptions from an earlier chat.
Core architecture: challenge owns money and lifecycle; bot owns reusable strategy; bot instance is independently scoped to challenge; optional Catalog/Midas are research-only; allocator authorizes spending; broker/account identity and reconciliation own physical exposure.
Existing: PRs #123 allocator, #124 DB baseline, #125 preview reservations, #126 shadow research, #127 Upcoming Trades. Preserve eight historic $100 bot ledgers, legacy $1,000 fund, and observation-only shared-paper-v1 $5,000 scenario.
SAFETY: PAPER ONLY, never real money. Do NOT activate shared execution, submit or modify PAPER orders, or bypass protective exits unless Step 12 receives fresh explicit user approval for a narrowly defined canary. Keep existing legacy execution controls unchanged. No secrets in public endpoints. Never assume distinct virtual challenges are isolated in one physically netting Alpaca PAPER account.
Delivery standard: implement relevant safe changes, deterministic regression tests, npx tsc --noEmit, lint, PAPER suite, Next build; branch, PR, passing CI, merge, independently verify Vercel production deployment and read-only database/broker invariants. If nothing should change, provide evidence rather than a meaningless PR. Report actual verification limits.

STEP-SPECIFIC IMPLEMENTATION:
1. Complete PR #126 study advancement from verified completed 5-minute and strategy-appropriate market bars with timestamp order, data coverage and no lookahead.
2. Differentiate strategy-ineligible, risk-blocked, capital-blocked, research-only and actual funded/executed opportunities.
3. Account for limit nonfills, price gaps, slippage, spread, fees, partial targets/trails and ambiguous same-bar stop/target paths conservatively.
4. Scope studies by challenge, instance, proposal and strategy version; do not spend broker cash or invent P/L.
5. Support Spark-alone versus Spark+Catalog+Midas controlled comparison with precisely time-stamped contributor evidence and appropriate matched-period caveats.

ACCEPTANCE AND REGRESSION TESTS:
1. Outcome engine never uses future decisions/old candles as forward proof; ambiguous bars are not definite wins.
2. Idempotent bar processing and cross-challenge isolation.
3. No simulated fills labeled broker fills, no PAPER execution or funding changes.

FINAL DELIVERABLES:
Deliver forward-study scheduler/evidence, contributor attribution, shadow outcome reporting and Step 11 handoff.

EXECUTION DIRECTIVE: Begin with connected tool inspection of actual source and state. Complete safe in-scope changes and independent verification now. Clearly distinguish verified from unknown. Preserve legacy trading behavior and PAPER safety gates.
~~~

---

## Step 11 — CHALLENGE BUILDER, UPCOMING TRADES AND COMPARISON UI

~~~text
BigOrders / CreatorHub — STEP 11: CHALLENGE BUILDER, UPCOMING TRADES AND COMPARISON UI

PROJECT: BigOrders / CreatorHub reusable multi-challenge PAPER trading.
GitHub: zanibethel/CreatorHub (main). Production: https://creatorhub-gray.vercel.app. Bot Lab: /paper-trading/bots. Performance: /paper-trading/bots/performance. Trading dashboard: /paper-trading.
Supabase project: yufptpfiwdbzzrvhkvux. Vercel project: prj_zf7GQgNvUBXmVWRcijS8aIVxzLsw. Vercel team: team_AH72aX1BaaPucIOvrSgvpEhw. Reporting timezone: America/Chicago.
Use @GitHub, @Supabase, @Vercel, and @Alpaca Paper Trading DIRECTLY. Inspect actual main branch, database, PAPER broker orders/positions, cron jobs, deployment, PRs and tests as appropriate. Do not provide instructions where you can perform the work.
Reference docs/BIGORDERS_MULTI_CHALLENGE_ROADMAP.md and this prompt file on main. Respect the verified handoff and implemented changes from preceding steps, not assumptions from an earlier chat.
Core architecture: challenge owns money and lifecycle; bot owns reusable strategy; bot instance is independently scoped to challenge; optional Catalog/Midas are research-only; allocator authorizes spending; broker/account identity and reconciliation own physical exposure.
Existing: PRs #123 allocator, #124 DB baseline, #125 preview reservations, #126 shadow research, #127 Upcoming Trades. Preserve eight historic $100 bot ledgers, legacy $1,000 fund, and observation-only shared-paper-v1 $5,000 scenario.
SAFETY: PAPER ONLY, never real money. Do NOT activate shared execution, submit or modify PAPER orders, or bypass protective exits unless Step 12 receives fresh explicit user approval for a narrowly defined canary. Keep existing legacy execution controls unchanged. No secrets in public endpoints. Never assume distinct virtual challenges are isolated in one physically netting Alpaca PAPER account.
Delivery standard: implement relevant safe changes, deterministic regression tests, npx tsc --noEmit, lint, PAPER suite, Next build; branch, PR, passing CI, merge, independently verify Vercel production deployment and read-only database/broker invariants. If nothing should change, provide evidence rather than a meaningless PR. Report actual verification limits.

STEP-SPECIFIC IMPLEMENTATION:
1. Build authorized challenge builder for name, valid starting cash, trading bot instances, optional Catalog/Midas, risk preset, duration, execution/observation mode, broker account and lifecycle actions.
2. Create/select/compare challenge dashboards with independent cash, equity, reserve, exposure, positions, P/L, drawdowns, broker sync status, per-bot performance and research attribution.
3. Extend existing Upcoming Trades card to show challenge, assigned bot instance, entry range, stop, target/partials, ranking, proposed size, risk/reward, allocation status, stale blockers and exactly why not executable.
4. Show shadow-only versus broker-funded outcomes honestly and compare different challenge configurations without claiming causal advantage.
5. Enforce permissions server-side. Challenge UI must not grant an unsafe broker execution mode and must not mix public/private account details.

ACCEPTANCE AND REGRESSION TESTS:
1. Draft $5K all-eight, $5K Spark+Catalog+Midas, $500 Fuse+Pulse from UI without modifying strategies.
2. Prevent unauthorized edits, invalid funding, historical rewrite, wrong-account execution and cross-challenge data leaks.
3. Mobile/desktop rendering and honest missing/unknown state assertions.

FINAL DELIVERABLES:
Deliver UI/API tests, production verification and Step 12 release-gate handoff.

EXECUTION DIRECTIVE: Begin with connected tool inspection of actual source and state. Complete safe in-scope changes and independent verification now. Clearly distinguish verified from unknown. Preserve legacy trading behavior and PAPER safety gates.
~~~

---

## Step 12 — STAGED MULTI-CHALLENGE PAPER QUALIFICATION AND EXPLICIT CANARY GATE

~~~text
BigOrders / CreatorHub — STEP 12: STAGED MULTI-CHALLENGE PAPER QUALIFICATION AND EXPLICIT CANARY GATE

PROJECT: BigOrders / CreatorHub reusable multi-challenge PAPER trading.
GitHub: zanibethel/CreatorHub (main). Production: https://creatorhub-gray.vercel.app. Bot Lab: /paper-trading/bots. Performance: /paper-trading/bots/performance. Trading dashboard: /paper-trading.
Supabase project: yufptpfiwdbzzrvhkvux. Vercel project: prj_zf7GQgNvUBXmVWRcijS8aIVxzLsw. Vercel team: team_AH72aX1BaaPucIOvrSgvpEhw. Reporting timezone: America/Chicago.
Use @GitHub, @Supabase, @Vercel, and @Alpaca Paper Trading DIRECTLY. Inspect actual main branch, database, PAPER broker orders/positions, cron jobs, deployment, PRs and tests as appropriate. Do not provide instructions where you can perform the work.
Reference docs/BIGORDERS_MULTI_CHALLENGE_ROADMAP.md and this prompt file on main. Respect the verified handoff and implemented changes from preceding steps, not assumptions from an earlier chat.
Core architecture: challenge owns money and lifecycle; bot owns reusable strategy; bot instance is independently scoped to challenge; optional Catalog/Midas are research-only; allocator authorizes spending; broker/account identity and reconciliation own physical exposure.
Existing: PRs #123 allocator, #124 DB baseline, #125 preview reservations, #126 shadow research, #127 Upcoming Trades. Preserve eight historic $100 bot ledgers, legacy $1,000 fund, and observation-only shared-paper-v1 $5,000 scenario.
SAFETY: PAPER ONLY, never real money. Do NOT activate shared execution, submit or modify PAPER orders, or bypass protective exits unless Step 12 receives fresh explicit user approval for a narrowly defined canary. Keep existing legacy execution controls unchanged. No secrets in public endpoints. Never assume distinct virtual challenges are isolated in one physically netting Alpaca PAPER account.
Delivery standard: implement relevant safe changes, deterministic regression tests, npx tsc --noEmit, lint, PAPER suite, Next build; branch, PR, passing CI, merge, independently verify Vercel production deployment and read-only database/broker invariants. If nothing should change, provide evidence rather than a meaningless PR. Report actual verification limits.

STEP-SPECIFIC IMPLEMENTATION:
1. Validate complete system against (A) all eight + optional Catalog/Midas $5,000, (B) Spark+Catalog+Midas $5,000, (C) Fuse+Pulse $500. These are illustrative configured virtual portfolios, NOT automatic permission to run all three via one broker account.
2. Perform deterministic contract and accounting tests, historical replay, shadow-only trials, stress/fault injections for concurrency, stale quotes, repeated fills, network ambiguity, rejected stops, partial exits, outages and physical-account conflicts.
3. Prove effective entry permissions, full exit protection, broker/account isolation, reservation/cash accuracy, completed-bar research attribution and reconciliation gates before proposing any PAPER execution.
4. Prepare a narrowly controlled one-bot PAPER canary plan only if all protections independently pass. **STOP and seek explicit user authorization** before turning on any PAPER execution or submitting even a test PAPER order.
5. After explicit authorization only, execute the precise approved PAPER canary scope; observe protected exit and complete accounting; expand to two bots then eight only with fresh evidence and further user approvals when scope changes.
6. Keep additional concurrent challenges shadow-only until physical broker isolation is proven; never submit real-money orders.

ACCEPTANCE AND REGRESSION TESTS:
1. All eight evaluate arbitrary portfolio contexts safely; cross-bot funding cannot overspend; shadow scenarios isolated.
2. Stress failures trigger fail-closed entries without losing risk-reducing exit capacity.
3. PR, tests, production and Supabase/broker state independently verified; report PASS/BLOCKED/UNKNOWN per gate.
4. No live-money trading or silent PAPER cutover.

FINAL DELIVERABLES:
Deliver complete readiness report, all unresolved blockers, approved-vs-unapproved canary scope, broker/account proof and staged go/no-go recommendations.

EXECUTION DIRECTIVE: Begin with connected tool inspection of actual source and state. Complete safe in-scope changes and independent verification now. Clearly distinguish verified from unknown. Preserve legacy trading behavior and PAPER safety gates.
~~~

---
