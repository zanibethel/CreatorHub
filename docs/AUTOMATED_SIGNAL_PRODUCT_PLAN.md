# Automated Signal Product Plan

Status: Active product direction
Last updated: 2026-10-06

## Product principle

The user-facing visual experience must observe and explain the same automated trading engine that would ultimately power the end product.

Do not build a separate manual-demo path that behaves differently from the automated bot.

For the current proof of concept, execution remains simulated. The system should nevertheless make decisions, prepare orders, revalidate, execute, manage, and exit automatically using the same architecture intended for a future connected-brokerage product.

## Core flow

`scanner -> prospect -> bot review -> prepared order -> automatic revalidation -> automatic simulated execution -> position management -> exit -> outcome history`

The visual layer is an observability and trust layer over that flow.

## Required visual states

### Prospects / Coming Up
Show what the system is watching before qualification, including:
- first detected timestamp and discovery price
- current price
- scanner score and score history
- acceleration / momentum / volume
- catalyst and news evidence
- strategy assignment
- blockers preventing action
- chase risk
- whether the prospect remains early or has become stale

### Prepared / Upcoming Orders
Show what the bot intends to do if its conditions are met:
- proposed entry trigger
- current price
- maximum chase price
- protective stop
- take-profit target(s)
- intended position size / notional
- maximum planned loss
- expected reward/risk
- expiration
- conditions still outstanding
- exact reason the order is prepared but not yet submitted

### Executed Positions
Show what the automated system actually did:
- exact execution time and price
- size / notional
- entry rationale and originating scanner evidence
- stop and target
- current P/L
- position-management decisions
- eventual exit, realized P/L, and exit reason

### Passed / Rejected / Expired
These are first-class outcomes, not hidden failures.
Persist and display:
- why the system declined or canceled the setup
- price at decision time
- what happened afterward
- maximum favorable/adverse movement after the decision
- whether a blocker prevented a loss or missed a winner

## Automation rule

The proof-of-concept bots should automatically execute simulated trades when all strategy, risk, market, freshness, and execution gates pass.

The visual UI must not require approval for the owner's automated proof-of-concept bots.

Future customer modes may include:
- Fully automatic
- Approval required
- Alerts only

These are execution-permission modes over the same underlying strategy engine. They must not fork the strategy logic into separate implementations.

## Near-term product goal

Build a signed-in Signal / Trade Desk that gives users access to the same visual pipeline:
- Opportunities
- Coming Up
- Prepared Orders
- Executed Positions
- Passed / Rejected
- Results / Track Record

Initially, customer access may be observational or simulated.

A later brokerage connection should replace only the execution destination:

`automatic decision -> simulated execution`

becomes

`automatic decision -> authorized connected brokerage execution`

without changing scanner, strategy, revalidation, risk, evidence, or UI semantics.

## Evidence and trust requirements

Every material decision must be timestamped before the outcome is known.

Historical decisions must also remain pinned to the exact scanner, strategy, risk-policy, and execution-policy versions that produced them. Future model or strategy improvements must not retroactively rewrite the original score, qualification, proposed trade, or decision. Re-analysis may be stored separately as a later comparison.

Persist:
- scanner observations
- score components
- catalyst/news evidence
- prospect state changes
- prepared plans
- blockers and warnings
- submissions
- canceled/rejected/expired plans
- fills
- stops/targets
- management actions
- exits
- counterfactual outcomes for passed/rejected prospects where practical

The product should make it possible to reconstruct exactly what the system knew and decided at a particular time.

Do not present only winners. False positives, missed opportunities, rejected trades, and losses are required for credible performance analysis.

## Product metrics we should eventually calculate

At minimum:
- first-detection lead time before meaningful moves
- price at first detection vs peak after detection
- percentage of remaining move captured
- qualification rate by scanner score band
- win/loss rate by strategy
- expectancy after simulated fees/slippage
- maximum favorable excursion (MFE)
- maximum adverse excursion (MAE)
- stop / target hit rates
- false-positive rate
- rejected-trade counterfactual performance
- performance by catalyst type
- performance by acceleration / volume / spread / chase-risk bands
- time from prospect -> prepared -> executed
- difference between proposed and actual simulated execution price

## Architecture guardrails

Future work should be evaluated against these questions.

### Strengthens this plan
Prefer changes that:
- improve earlier discovery
- improve strategy-specific qualification
- improve execution realism
- improve risk controls
- improve outcome measurement
- improve explainability / observability
- improve user isolation and permissions
- allow the same engine to support simulated and connected-broker execution
- preserve one source of truth for strategy logic

### Neutral / compatible
Changes are acceptable when they add new views, strategies, data sources, or user controls without changing the core decision path.

### Conflicts with this plan
Flag before implementing changes that:
- create a separate manual demo strategy
- require the visual UI to approve the owner's automated proof-of-concept trades
- bypass bot-specific revalidation because a scanner score is high
- hide rejected / failed / losing outcomes
- allow UI logic to differ materially from backend strategy logic
- use a different strategy for live execution than simulation without an explicit reason
- allow merged display data to directly authorize orders
- remove auditability or overwrite historical decision evidence
- make a customer-facing shortcut that weakens risk / permission boundaries

## Decision rule for future suggestions

When a new idea is proposed, classify it explicitly when useful as:

- **Supports plan** — improves the shared automated engine or its observability.
- **Compatible** — does not materially affect the architecture.
- **Needs adjustment** — useful idea, but implementation should be changed to preserve the shared automated path.
- **Conflicts with plan** — would create a divergent manual/demo path, weaken evidence/risk controls, or undermine the eventual product architecture.

If a future suggestion changes or supersedes this direction, update this document deliberately rather than allowing architecture drift.

## Current implementation alignment

The current Weekly Swing proof of concept already follows this direction:
- Prospect Scanner v3 discovers and scores candidates.
- Review-ready candidates pass through bot-specific Swing intake rather than directly authorizing orders.
- Eligible candidates become prepared simulated plans.
- Swing readiness performs fresh market/risk/quote revalidation.
- Swing Run can automatically submit simulated bracket orders.
- Only one new Swing submission is attempted per five-minute cycle.
- Candidate intake decisions are journaled, including rejections.
- The Swing ledger remains isolated at $100 virtual equity.
- Live-money execution remains disabled.

The first observability UI is now implemented:
- Per-bot Live Trade Pipeline in Bot Lab.
- Cross-bot Signal Desk at `/paper-trading/signals`.
- The same shared pipeline component renders both views.
- Signal Desk is read-only and does not authorize trades.
- Customer-facing labels avoid legacy internal simulation terminology where practical.

Next UI work should deepen timestamps, immutable signal-version provenance, outcome history, and drill-down detail without inventing a parallel workflow.
