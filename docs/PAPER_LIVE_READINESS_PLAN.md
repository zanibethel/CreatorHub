# Paper-to-Live Trading Readiness Plan

Status: active implementation plan. The automated trading path remains PAPER-only until a separate live-money gate is explicitly approved.

## Objective

Use the $100 isolated bot challenges to prove the full trading lifecycle under realistic broker conditions before creating any live-money execution mode.

The goal is not merely to place successful orders. The system must demonstrate that it can:

- qualify setups consistently,
- size from the bot's own virtual equity,
- submit only authorized orders,
- keep broker-hosted downside protection active,
- manage partial profits without overselling,
- reconcile broker fills/fees back into the correct bot ledger,
- maintain accurate live risk state,
- recover safely from stale data, rejected orders, partial fills, and outages,
- and produce an auditable journal explaining every action.

## Current state — 2026-10-03

### Proven

- Equal $100 isolated virtual ledgers.
- Bot-specific Alpaca client-order attribution.
- Prepared order → Alpaca paper order → broker fill → virtual-ledger reconciliation.
- Fee-aware crypto accounting using an immediate estimate.
- Live mark-to-market for virtual positions.
- Pool usage, open planned risk, daily-loss state, weekly drawdown, equity, cash, and unrealized P/L.
- Default Diverse weekend SOL/USD paper position with broker-hosted stop-limit protection.
- Three-Trade Weekly Swing Bot v1 active for staging.
- QQQ, NVDA, and MSFT Monday plans persisted with trigger, max-chase, stop, risk, take-profit, and expiration values.
- Bot Lab and Paper Trading Orders views expose safe monitoring information without public broker identifiers.

### Still blocked before live money

- Staged-action exit planner is live; broker-action execution/verification still needs promotion and paper validation.
- Same-session swing readiness and the privileged PAPER submission endpoint are implemented; the swing PAPER execution kill switch is now armed, while market/session/readiness gates still control whether submission is allowed.
- Broker-hosted stock bracket construction and bracket-child reconciliation are implemented; the first real market-hours PAPER bracket fill/exit rehearsal remains.
- Official crypto CFEE reconciliation against estimated fees.
- Correlation/sector exposure calculation.
- Longer paper sample with outcome metrics (R, MFE, MAE, expectancy, profit factor).
- A separate live-money credential set, explicit live-mode approval, capital limits, and kill switch.

## Execution sequence

### 1. Exit Manager v1 — current work

The live background component is a **staged-action planner** attached to mark-to-market. It continuously computes the next exit action but does not silently change broker orders. Broker-changing PAPER actions remain explicit until the execution layer is promoted separately.

Build and paper-test deterministic exit management.

For every open bot position:

1. Confirm an active protective order exists.
2. Never widen a protective stop.
3. Around +1R, tighten protection toward fee-adjusted breakeven.
4. At the first take-profit threshold:
   - cancel/resize conflicting protection safely,
   - realize the configured partial amount,
   - immediately restore protection for the remainder,
   - persist the broker and virtual-ledger state transition.
5. Trail the remainder using a deterministic rule that only tightens.
6. Never allow active sell quantities to exceed the bot's actual available position.
7. Persist the planned next action, current R multiple, mark, desired stop/partial fraction, and evaluation time.
8. Log every eventual broker action, rejection, replacement, and recovery.

Crypto v1 uses broker stop-limit protection because Alpaca crypto does not expose the same bracket/OCO path used for equities. Profit-taking is trigger-driven rather than leaving an independent standing take-profit order that could conflict with the full-position stop. The current planner writes `hold`, `repair_stop`, `tighten_stop_breakeven`, `partial_profit`, or `tighten_stop_trail` into the virtual position state on every marked sync.

### 2. Monday Swing Revalidation Executor

Status: deterministic revalidation engine and Bot Lab readiness panel implemented. The privileged PAPER submission endpoint is deployed and the PAPER execution kill switch is armed; submission still requires a fresh same-session readiness selection.

Before any prepared QQQ/NVDA/MSFT PAPER order is submitted:

- require the market to be open and wait at least 5 minutes after the open,
- verify quote age ≤30 seconds and spread ≤0.25%,
- verify the market/session state,
- require price at/above the stored trigger,
- reject if price is above the stored max-chase price,
- recalculate quantity from current $100 bot equity,
- enforce maximum three new entries per calendar week,
- enforce maximum open positions,
- enforce ≤30% initial allocation per swing position and ≤3% total open planned risk,
- enforce ≤2% correlated risk for the current QQQ/NVDA/MSFT mega-cap-tech group,
- enforce daily/weekly kill switches,
- require the broad SPY regime to remain supportive and recheck trend/setup validity,
- expire invalid plans with a journal reason.

A prepared plan is not a broker order. If multiple correlated plans become ready simultaneously, current v1 priority is QQQ → NVDA → MSFT and the correlated-risk ceiling may leave lower-priority plans on standby even when a weekly trade slot remains.

### 3. Broker-Hosted Stock Protection

For accepted stock/ETF swing entries, Alpaca PAPER bracket orders are the required broker-hosted protection path so stop and profit legs remain at the broker if CreatorHub or Supabase is temporarily unavailable.

A closed-market smoke test on 2026-10-03 proved Alpaca accepted a stock bracket with both take-profit and stop child legs. The parent and both children were then canceled before any fill. Broker-generated child legs are now attributed back to the tagged parent bot plan so later child fills can reconcile to the same $100 virtual ledger.

### 4. Exact Fee Reconciliation

Continue reserving estimated crypto fees immediately, then reconcile the official Alpaca CFEE activity when posted. The difference must true-up the appropriate bot ledger and journal entry without double-counting.

### 5. Monday Readiness Panel

Status: implemented as a live read-only Bot Lab panel backed by `/api/paper-trading/bots/swing-readiness`.

Bot Lab exposes:

- Market data: ready / blocked
- Ledger: ready / blocked
- Broker: ready / blocked
- Risk state: ready / blocked
- Protection: ready / blocked
- Weekly trade slots: N remaining
- Prepared plans: N
- Currently eligible: N
- Rejection reason for each blocked plan

## Default Diverse Exit Policy v1

- Initial protective stop: defined before entry.
- Winner-protection threshold: +1R.
- First take profit: +1.75R.
- First partial: 25%.
- Remainder: 75%.
- Remainder is trailed; stops tighten only.
- Crypto fees are included in effective cost/risk calculations.

## Three-Trade Weekly Swing Exit Policy v1

- Maximum three new entries per calendar week.
- Planned risk: up to 1% of the $100 virtual equity per trade.
- Maximum initial allocation: 30% of virtual equity per position.
- Winner-protection threshold: +1R.
- First take profit: +2R.
- First partial: 50%.
- Remainder: 50%, trailed after partial profit.
- Same-session revalidation is mandatory before paper submission.

## Live-Money Gate

No current automated code path is authorized to submit real-money orders.

A future live mode must be separate from paper mode and require, at minimum:

- separate live broker credentials,
- an explicit live-mode configuration/approval,
- a hard account-level capital ceiling,
- per-bot capital ceilings,
- deterministic daily/weekly kill switches,
- broker-hosted protection wherever supported,
- no silent fallback from paper to live,
- a visible emergency stop,
- and successful paper validation of the exact strategy/execution version being promoted.

Changes to these requirements must be versioned and documented.
