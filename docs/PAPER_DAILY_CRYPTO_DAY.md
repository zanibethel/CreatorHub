# Daily Crypto Day Bot — PAPER Proof of Concept

Status: live scanner + automated PAPER execution armed; live money disabled.

## Purpose

Test whether a tightly constrained, short-horizon crypto strategy can produce usable PAPER evidence across all seven days after Alpaca crypto fees and execution drag.

This is a separate $100 challenge. It does not share capital, positions, P/L, or risk budget with Default Diverse, the swing bot, or the penny-stock experiment.

## Identity

- Stable bot ID: `weekend-crypto-day-100`
- Stable broker tag: `wkd`
- Current strategy: `daily-crypto-day-v5`
- Starting virtual equity: $100
- Execution venue: Alpaca Paper
- Live-money execution: disabled
- PAPER execution: armed under deterministic scanner/risk/cron gates

The legacy bot ID and `wkd` tag are intentionally retained so v1 and v2 history remain attributable to one challenge instead of being split across artificial identities.

## Universe

v3 uses two explicit tiers.

Execution-eligible:
- BTC/USD
- ETH/USD
- SOL/USD
- LINK/USD
- DOT/USD

Monitor-only:
- XRP/USD
- LTC/USD
- AVAX/USD
- DOGE/USD
- ADA/USD
- BCH/USD
- AAVE/USD
- HYPE/USD
- RENDER/USD

Monitor-only symbols run through the same quote freshness, spread, trend, momentum, breakout, ATR, fee-coverage, and score logic so we can collect comparable evidence. They may display READY, but they are never eligible for selection or broker submission in v3.

Promoting a monitor-only symbol into execution requires a new versioned strategy revision. Because all bots share the same Alpaca PAPER account, v3 also blocks a new Daily Crypto Day entry in a symbol already held by another bot.

## Session

Timezone: America/Chicago.

- Entries are eligible continuously, 24 hours a day, seven days a week.
- There is no routine nightly entry cutoff.
- There is no routine nightly forced flatten.
- Maximum three new entries per America/Chicago accounting day.
- Maximum one open Daily Crypto Day position at a time.
- A protected position may remain open across the local midnight boundary until normal stop/target/trailing management or a risk-driven forced flatten closes it.
- The five-minute Vercel runner executes every day.

America/Chicago remains the accounting timezone for daily entry count and daily realized-loss controls. Midnight resets the daily accounting bucket; it is not treated as a crypto market close.

## Market data

Execution qualification uses Alpaca crypto data because Alpaca is the execution venue.

- Latest Alpaca crypto quote.
- Completed 5-minute bars for short-horizon momentum, breakout, ATR, and stop structure.
- Completed 15-minute bars for trend confirmation.
- BTC/USD 15-minute trend acts as the broad crypto long-regime gate.

The public Kraken monitor may still be useful for research/display, but it is not execution authorization.

## Entry qualification

A candidate remains Waiting or Blocked unless all mandatory checks pass.

Core v3 setup:

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

If more than one execution-eligible candidate is Ready, v3 selects only one, prioritizing highest score and then tighter spread.

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
- Minimum executable notional: $12, providing a buffer above Alpaca's observed $10 crypto minimum.
- Maximum open planned risk: 0.75%.
- Daily realized-loss kill switch: 1.50%.
- Minimum stop distance: 0.80%.
- Maximum stop distance: 2.50%.
- ATR stop multiplier: 1.50.
- One open position maximum.

Position size is the smaller of the risk-based size, 30% allocation cap, and available virtual buying power.

## Profit / exit plan

Daily v5 separates the **opportunity goal** from the **risk-management checkpoint**.

- Protective stop is defined before entry and may tighten only.
- +1R remains a winner-protection checkpoint.
- +2R is a de-risk checkpoint, not the headline profit goal.
- At +2R, the manager may trim 25% and protect the remainder.
- The scanner estimates a fresh goal exit on every reevaluation from current range expansion, ATR, momentum, and the current entry/stop structure.
- Execution requires a projected opportunity of at least 5%; the displayed goal is capped at 20% for this strategy version.
- The dashboard's projected profit is entry-to-goal profit, not the +2R trim.
- When an order executes, the latest goal exit is persisted to the position plan.
- If the adaptive goal is reached, the remaining position is exited; before then, the remainder can trail as the trade develops.
- These are strategy targets, not guaranteed returns. If current conditions do not support the minimum opportunity, the bot waits rather than inventing upside.

## Fee hurdle

Initial estimated taker fee: 25 bps per side.

The scanner estimates round-trip entry + exit fees before a setup may qualify.

The planned gross first-target profit must cover estimated round-trip fees by at least 2.50x.

Entry-side fee reconciliation prefers a broker-observed value: after a fill, the executor compares gross filled quantity with Alpaca's actual post-fee sellable quantity, derives the effective entry fee bps/USD, and records that source before ledger application. The ledger waits up to 30 seconds for that observation and then falls back to the configured estimate rather than remaining stuck.

Sell-side fee accounting still uses the configured estimate until Alpaca exposes a usable CFEE record. A direct CFEE activity check on the PAPER account returned no entries as of 2026-10-03, so the system does not pretend those records exist.

## Current implementation

Implemented:

- Separate active $100 virtual ledger.
- Stable `wkd` broker attribution tag.
- Strategy promoted through seven-day v2 and expanded-universe v3 to continuous `daily-crypto-day-v4`.
- Execution pool: BTC/ETH/SOL/LINK/DOT.
- Monitor-only pool: XRP/LTC/AVAX/DOGE/ADA/BCH/AAVE/HYPE/RENDER.
- Continuous 24/7 session controls with America/Chicago used only for daily accounting.
- Alpaca quote + completed 5m/15m execution-data path.
- Deterministic fee-aware readiness engine.
- Cross-bot same-symbol occupancy block.
- Live Bot Lab readiness panel.
- Live trade telemetry for open-position R, MFE, MAE, peak/trough marks, mark count, and durable closed-trade outcome records.
- Durable five-minute scanner journaling from the authenticated runner into the private `paper_bot_journal`, capturing every v3 execution and monitor-only candidate's score, tier, spread, quote age, momentum, ATR, fee coverage, planned risk/targets, blockers, and waiting reasons. This evidence path is passive and does not change order authorization.
- Broker-observed crypto entry fee reconciliation using gross fill quantity versus actual sellable quantity, with a bounded estimate fallback.
- Closed-trade journal records include realized P/L, R multiple, MFE/MAE, estimated fees, and exit reason.
- Service-only atomic entry claim with duplicate/risk guards.
- Guarded PAPER crypto entry route using a max-chase limit price.
- Immediate broker protective stop-limit after a confirmed fill.
- Fail-closed emergency flatten if protection cannot be attached.
- Broker-action exit manager for repair/tighten/+2R partial/trailing protection.
- No routine nightly flatten; the flatten route remains available only for deterministic risk/emergency exits.
- Entry, active management, and forced-flatten routes all derive executable symbols from the v4 `executionUniverse`, so LINK/DOT and future versioned pool additions share one validation source.
- Broker-confirmed cancel/reject/expire/replace states are captured centrally; broker-unconfirmed entry/protection/partial/flatten failures are saved as explicit `execution_error` evidence.
- Vercel runner scheduled every five minutes every day.
- Server-only Cron and crypto-execution secrets configured in Vercel Production.
- PAPER execution armed; live money remains disabled.

## Evidence retention

Daily Crypto Day follows the cross-bot evidence standard in `docs/PAPER_EVIDENCE_AND_STRATEGY_REVIEW.md`. Its five-minute scan journal is part of that larger system: execution candidates and monitor-only candidates are retained for later false-positive, missed-opportunity, spread/liquidity, score-band, and promotion analysis. Any serious non-executed proposal added later must remain separate from actual virtual-ledger P/L and be labeled counterfactual.

## Next implementation sequence

1. Let the armed 24/7 scanner wait for a genuine execution-pool setup instead of forcing a trade.
2. Validate the first complete tagged `wkd` v4 PAPER round trip through entry, protection, mark-to-market, exit management, ledger reconciliation, and MFE/MAE/R telemetry.
3. Verify +1R protection, +2R 50% partial, trailing remainder, and cross-midnight continuity under actual broker state.
4. Continue reconciling broker-observed fees and monitor whether sell-side CFEE activity becomes available.
5. Compare execution-pool and monitor-only score/liquidity behavior before promoting any additional symbol.
6. Compare weekday versus weekend outcomes before considering any separate session-specific tuning.
7. Tune only from documented evidence; do not loosen thresholds merely to create activity.

## Promotion rule

No real-money execution is authorized.

Any future live mode requires a separate explicit approval and must promote the exact paper-validated strategy version.

## Controlled broker smoke — 2026-10-03

A deliberately untagged Alpaca PAPER BTC smoke test was used so isolated $100 bot ledgers would ignore the activity.

Observed broker behavior:

- Alpaca rejected an approximately $5 BTC order because crypto cost basis must be at least $10.
- A roughly $12 BTC marketable-limit buy was accepted and filled.
- Gross buy quantity: 0.00014155 BTC.
- Fee-adjusted broker sellable quantity: 0.000141196 BTC.
- A stop-limit sell using that exact broker sellable quantity was accepted.
- The stop was canceled cleanly.
- The full sellable BTC quantity was then flattened with a PAPER market sell.
- The BTC position was confirmed gone afterward; only the pre-existing Default Diverse SOL position remained.
- All smoke client-order IDs were intentionally untagged, so none of this test activity changed the Daily Crypto Day virtual ledger.

Implications retained in v3:

- Planned trades must remain above Alpaca's observed $10 crypto minimum; the strategy enforces a $12 floor.
- Protective orders use Alpaca's actual post-fee `qty_available`, not gross fill quantity.
- The guarded executor follows broker quantity rather than estimating sellable units locally.


## Live v3 expansion verification — 2026-10-03

Verified against current `main`, Vercel Production, Supabase, and the connected Alpaca PAPER account after the two-tier universe expansion.

- Production strategy: `daily-crypto-day-v3`, stable bot ID `weekend-crypto-day-100`, stable broker tag `wkd`.
- Execution-eligible pool is BTC/USD, ETH/USD, SOL/USD, LINK/USD, and DOT/USD.
- Monitor-only pool is XRP/USD, LTC/USD, AVAX/USD, DOGE/USD, ADA/USD, BCH/USD, AAVE/USD, HYPE/USD, and RENDER/USD.
- The live scanner evaluates all 14 symbols through the same trend, momentum, spread, volatility, fee-coverage, breakout, regime, and score logic.
- Selection is fail-closed: readiness filters to `executionEligible` candidates, the runner only accepts an execution-pool `selectedSymbol`, the executor request schema only accepts the five execution symbols, and the Supabase claim RPC independently whitelists the same five symbols.
- Unit coverage explicitly verifies that every monitor-only symbol remains `selectedForSubmission=false` even when its synthetic readiness state reaches READY.
- Live Production integration verification also showed all nine monitor-only candidates with `selectedForSubmission=false`.
- BTC/USD remains the 15-minute broad crypto regime gate. No score, spread, or risk threshold was loosened for the larger universe.
- Supabase ledger metadata records the execution and monitor-only universes with PAPER execution enabled and `liveMoneyEnabled=false`.
- A v3 migration defect was found during reconciliation: the claim function identified orders as `daily-crypto-day-v3` but inserted prepared orders with `strategy_version=2`. The repository migration and live Supabase function were corrected to persist strategy version 3.
- The live claim RPC remains restricted to `service_role`/database administration roles; monitor-only XRP/USD is rejected by the database whitelist while LINK/USD and DOT/USD are accepted.
- No Daily Crypto Day `wkd` virtual position or recent bot order was present during verification. The shared Alpaca PAPER account still contained the existing Default Diverse SOL/USD position and its protective order, so SOL/USD remained cross-bot blocked for Daily Crypto Day.
- Vercel Production was healthy with no recent runtime-error clusters, and the five-minute crypto runner was returning successful scheduled responses.

Live scanner snapshot around 21:56 America/Chicago:

- Broad BTC regime: not supportive.
- Selected symbol: none; submission ready: false.
- SOL/USD had the highest execution-pool score at 65/100, but it was below the 80-point threshold and independently blocked because Default Diverse already holds SOL/USD.
- LINK/USD was 10/100 with a live spread around 0.16%, slightly wider than the 0.15% limit.
- DOT/USD was 10/100 with a live spread around 0.25%, wider than the limit.
- BTC/USD and ETH/USD had tight spreads but weak/negative setup conditions and scores of 5/100.
- The highest monitor-only scores were HYPE/USD at 45/100 and LTC/USD / AVAX/USD at 40/100; they remained research-only and unselectable.

Conclusion: the expanded scanner is live and PAPER-only. It should continue waiting for a genuine qualifying execution-pool setup rather than relaxing the 80/100 score, 0.15% spread, BTC-regime, or risk gates.


## Counterfactual near-miss tracking

The five-minute runner now records observation-only counterfactual studies for execution-tier setups scoring 60 or higher that are considered during the entry window but are not the setup currently being sent to the PAPER executor.

Each study:
- freezes the decision-time trigger, max-entry, stop, target, score, blockers and warnings;
- begins tracking only from future completed 5-minute bars;
- records whether the trigger would have occurred without exceeding max entry;
- calculates an assumed entry and +1R/+2R levels from the frozen protective stop;
- records +1R, +2R, stop, MFE, MAE and completed-bar count;
- an untriggered study expires at the next local accounting-date rollover; a study that already triggered may continue across midnight until stop or +2R resolves it;
- labels same-bar stop/target sequencing as ambiguous.

Monitor-only symbols are excluded from missed-trade counts even if they score highly. The tracker is evidence-only and cannot submit an Alpaca order.


## v4 continuous-session revision — 2026-10-04

`daily-crypto-day-v4` removes the artificial 22:30 America/Chicago entry cutoff and 23:45 routine flatten. This is a strategy-version change because it changes when the bot is allowed to enter and how long a protected position may remain open.

Unchanged safeguards:
- PAPER-only execution.
- Execution universe remains BTC/USD, ETH/USD, SOL/USD, LINK/USD, DOT/USD.
- Monitor-only universe remains unchanged.
- Maximum three new entries per America/Chicago accounting day.
- Maximum one open Daily Crypto position.
- 0.50% risk per trade.
- 30% allocation cap.
- 0.75% open-risk cap.
- 1.50% daily realized-loss kill switch.
- Same quote freshness, spread, trend, momentum, breakout, ATR, score, fee-hurdle, cross-bot occupancy, stop, +1R, +2R, and trailing rules.
- Live money remains disabled.

The forced-flatten endpoint is retained for protection failures and other deterministic risk exits, but the five-minute runner no longer calls it because of the clock.


## v5 adaptive-opportunity revision — 2026-10-04

`daily-crypto-day-v5` changes the meaning of the displayed target. The prior v4 first-target calculation often produced a 1.6% projected gain because the minimum 0.8% stop multiplied by the +2R checkpoint. In v5, +2R remains a partial-profit/risk checkpoint, while the watchlist's goal exit is recalculated from the current market opportunity.

The v5 opportunity estimator compares the 2R floor with recent 5-minute range expansion, recent 15-minute range expansion, ATR expansion, and positive short/slow momentum. A candidate cannot become execution-ready unless the resulting opportunity estimate reaches at least 5%. Goal estimates are capped at 20% in this version. This keeps the bot focused on larger asymmetric opportunities without assuming that 5-20% returns will occur regularly.

The plan is reevaluated before execution. Entry, stop, position size, goal exit, and projected profit can all change while a candidate remains on the watchlist. At execution, the current plan is snapshotted; +2R trims 25%, +1R can protect the winner, trailing can protect the remainder, and reaching the stored adaptive goal exits the remaining position.
