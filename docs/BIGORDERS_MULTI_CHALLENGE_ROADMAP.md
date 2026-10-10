# BigOrders / CreatorHub — Configurable Multi-Challenge PAPER Trading Roadmap

**Decision recorded:** 2026-10-09  
**Status:** Approved architecture and implementation plan; **not** an authorization to turn on PAPER orders or real-money trading.  
**Canonical step prompts:** [BIGORDERS_MULTI_CHALLENGE_STEP_PROMPTS.md](./BIGORDERS_MULTI_CHALLENGE_STEP_PROMPTS.md)  
**Existing shared capital preview:** [PAPER_SHARED_CAPITAL_MANAGER_V1.md](./PAPER_SHARED_CAPITAL_MANAGER_V1.md) (historical v1 baseline; subordinate to this architecture for future development)

## Intent

BigOrders must be a reusable PAPER trading **challenge platform**, not eight permanently $100-funded bots and not one forever-fixed $5,000 account. A challenge can have a configurable opening capital amount, a changeable set of trading bot participants, optional research contributors, independently managed accounting and performance, and a separately authorized PAPER execution venue. A bot's strategy should work without code changes in a $500, $5,000, $50,000, or other valid-size challenge. Small balances and broker minimum order sizes can legitimately prevent particular trades; that is not a reason to bypass risk rules.

**Ownership boundaries:**
- **Challenge owns capital and lifecycle:** `challengeId`, opening funding, immutable funding journal, cash/equity, policy, participants, state, execution mode, start and end times.
- **Trading bot owns strategy:** canonical `strategyId`/`strategyVersion`, optional challenge-specific parameter overrides, deterministic evaluations. It does **not** own a fixed cash allocation or spend the account by itself.
- **Bot instance belongs to a challenge:** `botInstanceId` isolates state, schedules, proposals, journals and performance. Existing `-100` bot IDs are legacy identifiers and MUST NOT be renamed destructively.
- **Research contributor supplies evidence:** Catalog and Midas (and future contributors) are optional challenge participants; they cannot initiate or authorize broker orders.
- **Challenge-scoped allocator owns spending permission:** validates strategy qualification, available funds, reserves, risk/exposure/loss controls, physical brokerage isolation and protective exit readiness.
- **Execution/reconciliation owns broker truth:** distinguish virtual challenge ledgers from actual PAPER account buying power, netted symbol positions, pending orders, fills, exits and fee data. Multiple virtual challenges on one physical Alpaca account are **not** automatically broker-isolated.

## First challenge configurations

| Challenge | Starting capital | Trading bots | Research | Execution |
|---|---:|---|---|---|
| A — BigOrders All Eight | $5,000 | Atlas, Fuse, Harbor, Flash, Pulse, Spark, Orbit, Coil | Catalog and Midas optional | Existing `shared-paper-v1` remains observation-only until explicitly authorized after safety gates |
| B — Spark Intelligence | $5,000 | Spark | Catalog + Midas | Independent ledger; shadow until dedicated isolation and authorization |
| C — Fuse vs Pulse | $500 | Fuse + Pulse | None by default | Independent ledger; shadow until dedicated isolation and authorization |

Other combinations and funding amounts must be supported without code changes. Research-only challenges are also valid. Launch-time funding is immutable; subsequent injections/withdrawals require dated auditable ledger entries. Cross-challenge and cross-bot performance comparisons must identify unequal market periods, strategies, risks, and execution assumptions.

## Trading bots

| Codename | Legacy bot ID | Strategy |
|---|---|---|
| Atlas | `default-diverse` | Diversified stocks/ETFs/crypto |
| Fuse | `penny-volatility-day-100` | Penny-stock day volatility |
| Harbor | `three-trade-weekly-swing-100` | Weekly swing |
| Flash | `weekend-crypto-day-100` | Daily 24/7 crypto |
| Pulse | `momentum-breakout-100` | Stock momentum breakout |
| Spark | `crypto-ignition-100` | Crypto ignition |
| Orbit | `crypto-swing-100` | Multi-day crypto swing |
| Coil | `squeeze-breakout-100` | Squeeze breakout |

Bot profile modes are not proof of effective execution permission. Audit source, runtime flags, cron, broker calls, and protective orders separately.

## Existing baseline — verify live before relying on it

- PR #123: pure shared-capital allocator / preview; source: `src/lib/paper-shared-capital-manager.ts`.
- PR #124: shared portfolio persistence; `paper_shared_portfolio_scenarios`, `paper_shared_capital_decisions`.
- PR #125: preview-only atomic claims and releases; `paper_shared_capital_reservations`, `paper_shared_preview_claim`, `paper_shared_preview_release`.
- PR #126: shadow-study persistence / forward-bar research evaluator; `paper_shared_shadow_studies`, `src/lib/paper-shared-shadow-research.ts`.
- PR #127: read-only Upcoming Trades dashboard; `src/components/UpcomingTradesCard.tsx`, `src/lib/paper-upcoming-trades.ts`, and API.
- Eight legacy $100 bot ledgers and prior $1,000 virtual fund must retain their original historical data.
- `shared-paper-v1` is an existing proposed $5,000 **observation-only** shared scenario. Broker submission is disabled. Do not consume or reset it merely to run tests.
- On 2026-10-09, Step 1 execution audit was already underway via **PR #128** (`audit/eight-bot-paper-readiness-20261009`). The Step 1 amendment requires checking its actual PR/merge/migration state, **keep/adapt/revert** of incompatible work, and safely applying *forward-only* corrective migrations when necessary; no blind revert.

## Shared risk-policy starting point (provisional, not an execution certification)

Starting $5,000 example: 20% cash reserve, max 80% gross invested, 0.5% risk per trade, optional evidence-proven 0.75% tier subject to independent verification, 2% aggregate planned stop loss, 12% ordinary / 5% speculative single position, 25% correlated concentration cap, up to eight open + pending entries, sleeves stocks 45% / swing 20% / crypto 15%, 2% daily / 4% weekly stop thresholds, minimum 2R **net** reward/risk after fees/spread/slippage. These are **caps**, not allocations or guarantees. Investigate SQL-vs-TypeScript rule drift, reconciliation and real loss-window enforcement before any execution. A challenge's policy may be more restrictive, not silently less protective than its bots' safety requirements.

## Twelve implementation steps

| Step | Goal | Required completion evidence |
|---|---|---|
| **1. Audit and reconcile** | Verify eight bot execution paths; inspect and reconcile in-flight PR #128; inventory hard-coded capital, legacy IDs and singleton state; broker/challenge isolation gaps | Read-only audited eight-bot matrix; keep/adapt/revert ledger; P0–P3 blockers; merged/deployed audit instrumentation if needed |
| **2. Standard contracts** | `ChallengeContext`, `TradeProposal`, challenge-scoped bot instances; remove fixed-money strategy assumptions via compatible adapters | All eight produce typed auditable proposals for multiple hypothetical capital contexts |
| **3. Challenge manager/ledger** | Configurable funding, participants, roles, immutable accounting, states, and independently scoped journals | Separate $500/$5,000 drafts with no state/cash crossover; preserve legacy history |
| **4. Opportunity ranking** | Cross-strategy ranking, qualified-only, source-aware Catalog/Midas contributions | Deterministic per-challenge queue and evidence; no unauthorized research order permissions |
| **5. Risk allocator** | Portfolio-dependent sizing, cash reserve, exposure, concentration and loss breakers | Dynamic $500/$5,000/$50,000 size outcomes; consistent SQL/TypeScript gates; no double spend |
| **6. Atomic reservations** | Challenge/instance/broker-account idempotent claims, expiry, no conflicting positions | Concurrency, repeated requests, crash/network and safe-release tests |
| **7. PAPER execution router** | Centralize challenge-scoped PAPER order interface and pre-submission checks; initially disabled | Fully mocked broker submission lifecycle; no new enabled routes or real/test orders |
| **8. Protective exits** | Single protected exit owner per filled position; partials/trails/gaps; independent recovery | Fault-injection and broker-native protection simulations; risk-reducing exits survive entry pauses |
| **9. Broker reconciliation** | Broker account/order/fill/position versus challenge cash, risk and journals; fail closed | No orphan/unattributed broker exposure; idempotent replay and reconciliation status |
| **10. Shadow + research evaluation** | Advance studies via completed forward-only candles; compare unfunded and contributor-assisted research | Timestamp-safe, fee-aware outcome study with explicit unknowns and no hypothetical fills portrayed as real |
| **11. Challenge Builder & dashboards** | Select bots/research/capital/policy; Upcoming Trades and cross-challenge comparisons | Authorized UI configurations and honest displayed execution status; mobile + desktop coverage |
| **12. Staged qualification** | Full eight-bot $5K shadow proof, variant-challenge isolation, faults, restricted PAPER canary **only after explicit user approval** | All gates pass, independent broker/account evidence and staged release decision |

**Work sequentially** and carry forward the previous step's verified handoff rather than just repeating historical assertions. Step 1's expanded audit is a correction to work already underway, not a separate simultaneous migration. An audit can be marked complete with documented blockers; completing the entire shared execution rollout requires later gates.

## Global acceptance/safety invariants

1. **PAPER ONLY.** No real-money trading. No actual PAPER test orders, cancellations, replacements or execution enablement unless separately and explicitly approved at the appropriate Step 12 canary gate.
2. Audit, preview, and UI work must never grant broker authority. `allocatable` is not `brokerOrderAuthorized`; a strategy's READY is not authorization to spend.
3. Protect original $100 historical ledgers, prior $1,000 virtual fund and the $5,000 observation scenario. No balance resets or false migration of historical P/L to a new cash base.
4. Use challenge IDs and bot instance IDs on **all** relevant state; a centralized allocator alone authorizes new entries. Research contributors cannot buy/sell.
5. A single PAPER brokerage account can physically net two challenges' positions. Do not claim independence from separate virtual ledgers. Require dedicated paper accounts or proven per-account physical isolation; otherwise shadow-only.
6. Never let one challenge's quote/decision, reservations, risk, holdings, orders, fills or exits contaminate another. Reconcile all physical broker orders and stop ownership, including manual/unattributed orders.
7. Stop protection, slippage, fees, quote freshness, market-session correctness, strategy qualification, position concentration, daily/weekly loss windows and idempotent recovery are mandatory; unknown data fail closed.
8. Distinguish capital-blocked, strategy-blocked, safety-blocked, researched-only and *actual executed* outcomes. Never invent trade readiness, hypothetical fills, or realized P/L.
9. All privileged audit/config paths must be protected; no secrets or broker IDs in unauthenticated dashboard outputs. Supabase schemas require correct RLS and access gates.
10. GitHub branch → tests (TypeScript, lint, PAPER suite, build) → PR → passing CI → merge → Vercel production READY → independent database/broker read verification, as relevant. Do not confuse merged code with verified runtime behavior.

## Operational references

- GitHub: `zanibethel/CreatorHub`, main branch `main`
- Production: https://creatorhub-gray.vercel.app
- Bot Lab: `/paper-trading/bots`
- Performance audit: `/paper-trading/bots/performance`
- Trading dashboard: `/paper-trading`
- Supabase project: `yufptpfiwdbzzrvhkvux`
- Vercel project: `prj_zf7GQgNvUBXmVWRcijS8aIVxzLsw`
- Vercel team: `team_AH72aX1BaaPucIOvrSgvpEhw`
- Alpaca **PAPER** only; reporting in `America/Chicago`

**Source of truth:** This roadmap and its companion step prompts govern the *new configurable multi-challenge development*. Existing `PAPER_LIVE_READINESS_PLAN.md` remains a separate record of legacy PAPER-to-live safety gates; it is **not** approval for any live-money cutover.
