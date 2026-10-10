# BigOrders Step 1 — revised multi-challenge PAPER architecture audit (2026-10-09, America/Chicago)

> Evidence boundary: repository main @ `a7740806` plus amended audit PR #128, connected Supabase project `yufptpfiwdbzzrvhkvux`, Vercel production `creatorhub-gray.vercel.app`, and read-only Alpaca PAPER broker GET snapshots. This is **not** an execution authorization. Runtime job successes, risk controls and broker stop orders have different proof levels. All capital and P/L are simulated.

## Reconciliation / preserve-adapt-revert decision

| Existing change | Confirmed state | Action | Why |
| --- | --- | --- | --- |
| PR #123 allocator / `src/lib/paper-shared-capital-manager.ts` | Implemented deterministic preview; policy includes `startingEquityUsd=5000` | KEEP, future ADAPT | Must take challenge policy and challenge equity rather than encode global starting capital |
| PR #124 / `paper_shared_portfolio_scenarios`, `paper_shared_capital_decisions` | Tables and migrations present; `scenario_id` indexes decisions | KEEP, future ADAPT | Existing `scenario_id` can be the backward-compatible `challengeId` |
| PR #125 / `paper_shared_capital_reservations`, preview claim/release RPCs | One released QA reservation; no active holds on main shared scenario | KEEP, future ADAPT | Atomic preview works by `scenario_id`; must include `botInstanceId`, account exposure and expiry reconciliation before broker wiring |
| PR #126 / `paper_shared_shadow_studies` | One `watching` QA study; no main-scenario study confirmed | KEEP | Forward-bar auto advancement not verified |
| PR #127 Upcoming Trades card | On production `a7740806` | KEEP, future ADAPT | Read-only but assumes one shared preview; add selected challenge and scoped bot instance |
| PR #128 eight-bot collector and protected endpoint | Initially 3 added files, CI green on latest pre-amendment commit, PR open | ADAPT same PR | Add explicit challenge assumptions, conservative stop/ledger checks and scenario observation |
| Legacy `paper_bot_*` ledgers/journals | Eight original `starting_cash=100` accounts, historical fill/decision tables remain | KEEP | Legacy reporting; **not** safely writable by multiple instances of the same strategy |
| Legacy `paper_capital_plan` | Fixed `main` program of $1,000 | KEEP | Historical accounting only; future challenge has independent funds |
| `shared-paper-v1` | $5,000 initial/equity/cash, $0 reserved, `state=preview`, `broker_execution_enabled=false` | KEEP and wrap | First challenge candidate, not the single permanent global shared portfolio |
| `shared-paper-concurrency-qa-20261009` | Paused; one released $600 preview reservation | KEEP | QA history must not be reused as live challenge |
| Step 1 database migrations or executor modifications | None added by PR #128 | No rollback required | Never delete historical journal or write risk/execution flags |

## Execution discovery / eight separate lifecycles

Broker order/fill counts come from `paper_bot_performance_audit_v1` and recent broker GET records. `candidate_checks_7d` counts evaluations (including repeated passes), not unique trade ideas. `closed_trades` is historical, not limited to seven days.

| Bot (legacy ID) | Strategy version | Pipeline source modules / scheduled runner | Seven-day evaluations; filled entries; closed trades | Classification and blocker |
| --- | --- | --- | --- | --- |
| Atlas (`default-diverse`) | `paper-medium-high-v1` v1 | `src/lib/paper-strategy-config.ts`, `paper-decision-engine.ts`, `paper-atlas-execution-plan.ts`; `/bots/atlas-run` every minute weekdays, `/bots/atlas-crypto-run` every minute all days | 11,282; 1; 1 | Implemented but unverified current full v4 end-to-end and broker account isolation. Historical SOL exit exists, not proof of future protection |
| Fuse (`penny-volatility-day-100`) | `penny-volatility-day-v1` v1 | `paper-fuse-strategy-config.ts`, `paper-fuse-readiness.ts`, `paper-fuse-bracket.ts`, `paper-fuse-exit-manager.ts`; `/bots/fuse-run` every 5 min weekdays and `/bots/fuse-manage` each weekday minute | 342; 1; 1 | Implemented, one-shot pilot consumed. Historical RXRX stop cancellation before partial exit completed; active RXRX lock remains. Profile incorrectly labels research while DB was pilot-armed |
| Harbor (`three-trade-weekly-swing-100`) | `three-trade-weekly-swing-v1` v1 | `paper-swing-strategy-config.ts`, `paper-swing-revalidation.ts`, `paper-swing-execution.ts`; `/bots/swing-run` 5 min weekdays | 715; 0; 0 | Partially implemented: SNAP authorized then Alpaca rejected fractional bracket (`fractional orders must be simple orders`); active SNAP symbol reservation needs reconciliation |
| Flash (`weekend-crypto-day-100`) | `daily-crypto-day-v5` v5 | `paper-weekend-crypto-strategy-config.ts`, `paper-weekend-crypto-readiness.ts`; `/bots/weekend-crypto-run` every 5 min, every day | 22,749; 0; 0 | Implemented/blocked from readiness certification: no attributable entry/fill/exit proof; crypto scanner evaluation alone not authorization |
| Pulse (`momentum-breakout-100`) | `stock-momentum-breakout-v1` v1 | `paper-momentum-breakout-strategy-config.ts`, `paper-momentum-breakout-readiness.ts`, `paper-pulse-bracket-evidence.ts`; `/bots/momentum-breakout-run` every 5 weekday minutes and `-manage` each minute | 517; 0; 0 | Implemented but no proven broker entry/stop/exit lifecycle |
| Spark (`crypto-ignition-100`) | `crypto-ignition-v1` v1 | `paper-crypto-ignition-strategy-config.ts`, `paper-crypto-ignition-readiness.ts`; `/bots/crypto-ignition-run` every 5 min all days, `-execute` and `-manage` via runner | 679; 4; 3 | Actual PAPER entry/fills and one BTC physical position plus same-sized GTC stop-limit. Stop-limit is not guaranteed to fill; future interrupted-run recovery and challenge-owned risk not proven |
| Orbit (`crypto-swing-100`) | `crypto-swing-v1` v1 | `paper-crypto-swing-strategy-config.ts`, `paper-crypto-swing-readiness.ts`; `/bots/crypto-swing-readiness` every 15 min | 1,430; 0; 0 | Research-only, effective execution disabled; never upgrade without tested execution adapter |
| Coil (`squeeze-breakout-100`) | `squeeze-breakout-v1` v1 | `paper-squeeze-breakout-strategy-config.ts`, `paper-squeeze-breakout-readiness.ts`, `paper-squeeze-scanner.ts`; squeeze scan every 15 weekday min and readiness every 5 weekday min | 673; 0; 0 | Research-only, effective execution disabled; never upgrade without tested execution adapter |

Last run proof: Supabase `paper_bot_cron_health` has successful entries for Atlas, Fuse, Harbor, Flash, Pulse, Spark. Separate cron heartbeats for Orbit and Coil are not in that view. `vercel.json` records their research cron paths, not success. Serverless safety must remain independent from Samsung or Mac LLM availability.

## Capital-hardcoding inventory

Machine-readable list: `CAPITAL_DEPENDENCIES` in `src/lib/paper-challenge-portability-audit.ts`. Each entry is classified by source, specific assumption, research/display/sizing/authorization impact, required challenge parameter, compatibility adapter and modification risk.

Specific high-risk coupling:

1. **Read path**: `src/app/api/paper-trading/bots/route.ts` reads `paper_capital_plan?plan_id=eq.main` and groups all ledgers, orders, positions, fills, equity history by `bot_id`. $100/$1,000 fallbacks are appropriate to legacy labels, **not** portable challenge ownership.
2. **Legacy profiles/UI**: `src/lib/paper-bot-profiles.ts` contains `challengeStartingCash:100` in every bot and `src/components/PaperBotLab.tsx` uses fallback values; those are legacy visual defaults, not strategy risk authorities. Do not rename `-100` identifiers.
3. **Execution**: `fuse-execute/route.ts` uses `ledger.equity*cfg.risk.riskPerTradePct/100` and claims the fixed Fuse pilot. `atlas-crypto-run/route.ts` reads its singleton bot ledger and flags. Spark, Harbor and Pulse similarly authorize via legacy bot identity. Never substitute a challenge equity value at only one call site.
4. **Shared preview**: `PAPER_SHARED_CAPITAL_POLICY_V1.startingEquityUsd=5000` expresses an initial policy example. The algorithm already receives a portfolio snapshot but uses the fixed policy ID and `botId:symbol` uniqueness keys. Future policy **and** physical-account locks must be separately scoped.
5. **SQL**: `paper_shared_preview_claim` already uses `scenario_id`, yet enforces 0.5% trade risk without matching the separate 0.75% proven-evidence allowance and does not independently verify realized daily/weekly circuit breakers, full pending broker exposure or challenge account isolation.
6. **Historical migrations**: `standardize_paper_bot_challenges_100`, `persist_1000_paper_capital_plan`, `paper_shared_portfolio_preview_baseline` contain historical amounts. Do not rewrite them; use forward-only migrations when later introducing challenge instance keys, funding-event ledgers and RLS protections.

## Proposed ownership and portability boundary (NOT implemented execution)

`Challenge` owns `challengeId`, starting virtual capital, cash/equity, dated funding events, participants, virtual ledger, reservations, exposure, policy, lifecycle and return series. `TradingBotInstance` references `challengeId + botInstanceId + canonicalStrategyId + strategyVersion`, plus strategy override and scoped journal/holdings. Canonical strategy IDs above stay independent from the legacy `-100` bot IDs. `ResearchContributor` references Catalog or Midas as `role=research, canSubmitOrders=false` and may attach timestamped, source-provenanced research IDs to proposal evidence. Only the future `ChallengeCapitalManager` may issue a single-use atomic allocator grant.

Expected strategy evaluation input is: `challengeId, botInstanceId, strategyId/version, challengeCapitalSnapshot (equity, settledCash, buyingPower, reservedCapital, holdings, pendingOrders), challengeRiskPolicy, botRiskOverrides, quote/candle provenance, session, lossBreakerState`. Expected proposal includes all trade/stop/target/risk/timing/fee fields from the original Step 1 requirements plus explicit source evidence, decision idempotency key, `challengeId`, `botInstanceId`, canonical physical brokerage account identity and expiration.

`createObservationChallenge` in `src/lib/paper-challenge-portability-audit.ts` is a **pure, shadow-only test and analysis helper**, not a change to production strategies or an authorization service. It checks positive arbitrary balances, unique scoped bot instances and no research order rights. `namespacedAuditKey` illustrates deterministic challenge/instance idempotency. Its `plannedObservationLimits` demonstrates independent virtual position and risk budgets with the unchanged risk *percentages*, not permission to relax strategy-specific broker rules.

Examples to support in Step 2:
- BigOrders All Eight: `shared-paper-v1` ($5,000), eight trading instances, optionally Catalog and Midas.
- Spark Intelligence: independent $5,000, Spark strategy with Catalog+Midas research, new instance ID and virtual ledger, shadow-only until broker isolation certified.
- Fuse vs Pulse: independent $500, two trading instances, separate journal/reservations/limits, shadow-only until certified.

Do not create these examples as extra live DB challenges in Step 1.

## Physical broker isolation (P0 if concurrently enabled)

A shared Alpaca PAPER account holds **one physical net position per symbol**, even when many virtual challenges label it differently. Example: two Spark virtual challenges both buying BTC cannot claim separate independently protected BTC lots using the broker's one net position. Account-level `client_order_id` tagging alone does not partition physical buying power, fee events, netted positions, stop quantities, sell-to-close attribution, broker margin or emergency flatten ownership. Shared stock locks `paper_stock_symbol_reservations` only serialize some entry claims; RXRX and SNAP legacy reservations remain active at audit time. They do not provide challenge accounting isolation. Independent PAPER account credential/account pair per executing challenge is preferred; an explicitly broker-isolated subaccount could be considered if available and independently verified. Otherwise use shadow-only execution with independent virtual books; do not enable competing brokerage orders.

Affected persistence: `paper_bot_ledgers`, `paper_bot_positions`, `paper_bot_orders`, `paper_bot_journal`, `paper_bot_broker_orders`, `paper_bot_broker_fills`, `paper_bot_trade_metrics`, `paper_bot_equity_history`, `paper_stock_symbol_reservations`, cron job keys, public Bot Lab grouping and manager idempotency. No schema changes during this audit. Future migration must be forward-only, dual-read historical bot IDs, preserve existing RLS and identity boundaries, and fully scope writers as well as readers.

## Capital-missed opportunities evidence

Fuse's rolling-seven-day `paper_bot_journal` showed 1,707 rejected evaluation events. 142 events included a whole-share/capital message combined with other blockers; zero events had capital as the sole recorded blocker in the tested query. No hypothetical win/loss should be credited to these blocked entries. Other bots require normalized mutually exclusive rejection/event evidence before capital-only counts are trustworthy. Keep `capitalBlockedCount=null` in the audit collector where this proof is absent.

## Priority list

- **P0 — before any multi-challenge broker access**: physical account and symbol netting, stop/exit ownership and independent ledger attribution across two challenge instances; unverified protected exits; never interpret separate virtual books as separate accounts.
- **P1**: broker stop-limit fill certainty/recovery verification; Harbor fractional bracket rejection; Fuse pilot/stop-gap reconciliation; RXRX and SNAP active locks; challenge-specific risk claims and daily/weekly limits; robust pending-order/position aggregation; cash+fee fill reconciliation; per-challenge idempotency and funding ledger.
- **P2**: complete quote/job evidence, historical v4 Atlas closure certification, Flash/Pulse attributable end-to-end proof, shadow candle advancement and continuous cron tracking.
- **P3**: challenge selector/display labels and portfolio comparison UI after the correct accounting architecture exists.

## Amended Step 2 handoff — proposal normalization, not broker cutover

1. Preserve `src/lib/paper-bot-trade-plan.ts`, `paper-shared-capital-manager.ts`, `paper-upcoming-trades.ts` as starting contracts; add optional legacy `challengeId`/instance adapter, then require fields for all **new** contexts.
2. Establish `challengeId` ↔ historical `scenario_id` compatibility; continue reading original `paper_bot_*` ledgers under a dedicated legacy challenge. Do not migrate them into a single $5,000 balance.
3. Create a strict, versioned, strategy-agnostic proposal schema with `challengeId, botInstanceId, strategyId/version, symbol, assetClass, strategyQualified, evidenceIds, marketDataTimestamp/source, proposedEntry/maximumEntry, stop, partial/terminal targets, quantity/notional, lossUsd, expectedNetR, fee/slippage estimates, concentrationGroup, sessionEligibility, createdAt/expiresAt, decisionKey`.
4. Write **read-only adapters** for Atlas, Fuse, Harbor, Flash, Pulse, Spark, Orbit and Coil from their existing readiness/plan modules; return explicit `not-yet-qualified` and `unavailable` rather than spoofing stop/quote fields. Permit Catalog/Midas evidence attachments only.
5. Test the same strategy's input against independent $500/$5,000 contexts; preserve its own risk and liquidity caps. Scope all hypothetical journal/reservation keys to challenge **and** instance.
6. Do **not** call an order POST, turn on a broker flag, release live locks or spend shared preview capital in Step 2. Broker isolation remains a later, separate audited release gate.
