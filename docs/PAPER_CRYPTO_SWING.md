# PAPER Crypto Swing v1

Strategy ID: `crypto-swing-v1`  
Bot ID: `crypto-swing-100`  
Status: active PAPER research; broker execution disabled.

## Purpose

Crypto Swing is the multi-day counterpart to Daily Crypto. Daily Crypto remains focused on short-horizon momentum and execution. Crypto Swing looks for 1–7 day continuation or breakout opportunities so the experiments can be compared without mixing their evidence.

## Candidate flow

`Market Prospect Scanner → Prospect Score ≥ 80 → Crypto Swing review queue → Crypto Swing score → reference plan`

A prospect assignment does not authorize a trade.

## v1 scoring

The bot uses completed 1-hour bars and scores:

- 12-hour vs 48-hour moving-average trend alignment,
- 12-hour price momentum,
- proximity to a 72-hour high / breakout structure,
- recent 12-hour volume versus the prior 12 hours,
- the upstream Prospect Score as a small discovery-strength input.

Thresholds:

- below 70: developing,
- 70–79: watch,
- 80–84: qualified,
- 85+: ready-quality if the remaining market/risk gates pass.

## Reference trade plan

For each assigned candidate the bot calculates:

- breakout entry trigger above the recent 72-hour high,
- ATR/structure-based stop with a 2% minimum and 8% maximum stop distance,
- risk-sized purchase amount from a 1% planned-loss budget, capped at 30% of the bot ledger,
- adaptive goal exit using recent swing range, ATR expansion and momentum,
- projected dollar and percentage profit from the goal entry to goal exit.

The adaptive target must reach at least 5% to count as a meaningful swing opportunity and is capped at 20% in v1. The cap is a planning bound, not an expected or guaranteed return.

## Risk / cadence

- $100 isolated virtual ledger.
- Maximum 3 new entries per week once execution is enabled.
- Maximum 2 open positions.
- Maximum total open planned risk: 2%.
- Fresh quote required.
- Maximum spread: 0.75%.
- 1R winner protection and 2R de-risking are intended execution-management checkpoints, not the headline swing profit goal.

## Current execution boundary

`executionEnabled=false`.

The bot can score, persist cron evidence, and display reference entry/stop/goal plans. It cannot submit PAPER orders yet. Execution should be added only after the scanner-to-swing pipeline has enough observations to verify that the score and plan behavior are sensible.
