# Weekend Crypto Day Bot — PAPER Proof of Concept

Status: live scanner + automated PAPER execution armed; live money disabled.

## Purpose

Test whether a tightly constrained, short-horizon weekend crypto strategy can produce usable PAPER evidence after Alpaca crypto fees and execution drag.

This is a separate $100 challenge. It does not share capital, positions, P/L, or risk budget with Default Diverse, the swing bot, or the penny-stock experiment.

## Identity

- Bot ID: `weekend-crypto-day-100`
- Broker tag: `wkd`
- Strategy: `weekend-crypto-day-v1`
- Starting virtual equity: $100
- Execution venue: Alpaca Paper
- Live-money execution: disabled
- PAPER execution: armed under deterministic scanner/risk/cron gates

## Universe

Initial universe only:

- BTC/USD
- ETH/USD
- SOL/USD

No other crypto pair is eligible in v1.

Because all bots share the same Alpaca PAPER account, v1 blocks a new weekend-bot entry in a symbol already held by another bot. This prevents broker-level net-position/reserved-quantity behavior from confusing isolated bot accounting during the proof of concept.

## Session

Timezone: America/Chicago.

- Entries allowed Saturday and Sunday only.
- New entries stop at 22:30 local time.
- Intraday intent is to be flat by 23:45 local time.
- Maximum three new entries per local session day.
- Maximum one open weekend-bot position at a time.

The future executor must enforce the flat-by rule; the current scanner only reports the session state.

## Market data

Execution qualification uses Alpaca crypto data because Alpaca is the execution venue.

- Latest Alpaca crypto quote.
- Completed 5-minute bars for short-horizon momentum, breakout, ATR, and stop structure.
- Completed 15-minute bars for trend confirmation.
- BTC/USD 15-minute trend acts as the broad crypto long-regime gate.

The public Kraken monitor may still be useful for research/display, but it is not execution authorization.

## Entry qualification

A candidate remains Waiting or Blocked unless all mandatory checks pass.

Core v1 setup:

- Quote age <= 60 seconds.
- Midpoint spread <= 0.15%.
- At least 24 completed 5-minute bars.
- At least 16 completed 15-minute bars.
- BTC 15-minute regime supportive.
- Candidate 15-minute short average above slow average and price above slow average.
- Candidate 5-minute close above its fast average.
- Positive 5-minute and 15-minute momentum.
- Price reaches a short-horizon breakout trigger based on the prior six completed 5-minute bars.
- Entry cannot chase more than 0.50 ATR beyond the breakout trigger.
- 5-minute ATR must remain within 0.08% to 1.50%.
- Minimum deterministic setup score: 80/100.

If more than one candidate is Ready, v1 selects only one, prioritizing highest score and then tighter spread.

## Scoring

Current 100-point composition:

- 15-minute trend: 25
- 5-minute trend: 15
- 5-minute momentum: 15
- 15-minute momentum: 10
- Breakout: 20
- Volatility quality: 10
- Spread quality: 5

The score never overrides a mandatory risk/session/liquidity blocker.

## Risk

- Risk budget per trade: 0.50% of current virtual equity.
- Maximum initial allocation: 30% of current virtual equity.
- Maximum open planned risk: 0.75%.
- Daily realized-loss kill switch: 1.50%.
- Minimum stop distance: 0.80%.
- Maximum stop distance: 2.50%.
- ATR stop multiplier: 1.50.
- One open position maximum.

Position size is the smaller of the risk-based size, 30% allocation cap, and available virtual buying power.

## Profit / exit plan

Initial v1 profit framework:

- Protective stop defined before entry.
- Winner protection around +1R.
- First target: +2R.
- First partial: 50%.
- Remaining 50% trails.
- Stop may tighten only; never widen to avoid realizing a loss.

The existing crypto exit planner can be extended to this bot because the position schema already carries stop, target, partial, and trailing metadata.

## Fee hurdle

Initial estimated taker fee: 25 bps per side.

The scanner estimates round-trip entry + exit fees before a setup may qualify.

The planned gross first-target profit must cover estimated round-trip fees by at least 2.50x. This is intended to prevent tiny scalps whose apparent edge disappears after crypto fees.

Official Alpaca CFEE activity still needs exact fee true-up against the current estimate.

## Current implementation

Implemented:

- Separate active $100 virtual ledger.
- Unique `wkd` broker attribution tag.
- Versioned weekend strategy configuration.
- BTC/ETH/SOL-only universe.
- Weekend/session controls.
- Alpaca quote + completed 5m/15m execution-data path.
- Deterministic fee-aware readiness engine.
- Cross-bot same-symbol occupancy block.
- Live Bot Lab readiness panel.
- Service-only atomic entry claim with duplicate/risk guards.
- Guarded PAPER crypto entry route using a max-chase limit price.
- Immediate broker protective stop-limit after a confirmed fill.
- Fail-closed emergency flatten if protection cannot be attached.
- Broker-action exit manager for repair/tighten/+2R partial/trailing protection.
- Deterministic 23:45 America/Chicago session flatten.
- Vercel runner scheduled every five minutes on weekend-relevant UTC days; the route itself enforces the America/Chicago weekend window.
- Server-only Cron and weekend-execution secrets configured in Vercel Production.
- PAPER execution is armed after a controlled broker smoke verified marketable-limit entry, fee-adjusted sellable quantity, protective stop-limit acceptance, cancellation, and immediate flatten with no residual BTC position.

## Next implementation sequence

1. Let the armed scanner wait for a genuine BTC/ETH/SOL setup instead of forcing a trade.
2. Validate the first complete tagged `wkd` PAPER round trip through entry, protection, mark-to-market, exit management, and ledger reconciliation.
3. Verify +1R protection, +2R 50% partial, trailing remainder, and 23:45 flatten under actual broker state.
4. Reconcile official Alpaca CFEE activity against the immediate fee estimate.
5. Tune only from documented evidence; do not loosen thresholds merely to create activity.

## Promotion rule

No real-money execution is authorized.

PAPER execution should be armed only after the live scanner is verified and the privileged submission/protection path passes a controlled smoke test.
