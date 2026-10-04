# Paper Trading Evidence & Strategy Review Loop

Status: approved design requirement. Applies to all CreatorHub PAPER trading bots and research paths.

## Purpose

CreatorHub must preserve enough evidence to learn from both trades that happen and trades that do not happen.

The evidence set must include:
- research inputs and analysis artifacts,
- every materially considered candidate,
- proposed/staged/prepared trades,
- blocked/rejected candidates,
- candidates that lose priority to another setup,
- prepared plans that expire,
- prepared or submitted orders that are canceled or replaced,
- broker rejections and execution failures,
- executed trades and all fills,
- protection changes and exit-manager actions,
- completed trade outcomes,
- and defined counterfactual follow-up for serious candidates that were not executed.

The goal is to avoid survivorship bias. Strategy review must not learn only from the trades that happened.

This system remains PAPER-only. Evidence collection may inform recommendations, but it must never silently loosen risk limits, modify execution permissions, or enable live-money trading.

## Evidence lifecycle

### 1. Research evidence

Persist source data, assumptions, analysis code, derived metrics, rankings, and selection rationale used to build or revise a strategy.

Research artifacts should remain reproducible and versioned. When practical, retain the exact data snapshot or durable source reference used for the decision.

### 2. Considered candidate

When the decision engine materially evaluates a symbol or pair, persist enough context to reproduce the decision:

- bot ID,
- strategy ID/version,
- symbol and asset class,
- candidate/pool/tier,
- evaluation timestamp and market-data timestamps,
- market regime,
- score and component evidence,
- bid/ask/reference price,
- spread and quote freshness,
- trend/momentum/breakout/volume/volatility inputs,
- fee coverage when applicable,
- portfolio/risk context,
- blockers,
- warnings/waiting reasons,
- and whether the candidate was eligible for submission.

Routine raw scans may be sampled or aggregated only when the underlying evidence remains sufficient for later review. Any candidate that approaches qualification, becomes READY, is blocked by risk/session/correlation, or is explicitly promoted into a proposal must be retained durably.

### 3. Proposed / staged / prepared trade

A serious proposal must be preserved even if no broker order is ever submitted.

Record:
- proposed entry/trigger/max-chase price,
- proposed stop/invalidation,
- target/trailing plan,
- quantity/notional,
- planned risk dollars and percent,
- fee/slippage assumptions,
- score/regime/setup context,
- competing candidates and priority decision when relevant,
- prepared-plan creation time,
- expiration time,
- and the exact strategy version that produced it.

A prepared plan is evidence, not a broker order.

### 4. Revalidation history

Every subsequent revalidation of a staged plan should retain the reason the plan:

- stayed eligible,
- became READY,
- remained on standby,
- lost priority to a stronger candidate,
- became blocked,
- became stale,
- exceeded max chase,
- failed regime/liquidity/risk checks,
- expired,
- was canceled,
- or was replaced by a newer version.

The terminal disposition must be explicit. Do not silently delete old proposals.

### 5. Counterfactual follow-up for non-executed proposals

For serious candidates that reached a defined proposal threshold but were not executed, record a clearly labeled counterfactual outcome window.

Counterfactual records must never be mixed with real P/L or virtual-ledger returns.

They should answer questions such as:
- Did price subsequently reach the proposed entry?
- Would the proposed stop have been hit first?
- Would +1R, first target, or trailing thresholds have been reached?
- What were MFE and MAE relative to the proposed entry/stop?
- Did spread/liquidity improve or degrade?
- Was the reason for rejection protective or unnecessarily restrictive?

Counterfactual windows must use deterministic rules and be versioned. They exist for strategy research, not to rewrite historical trading performance.

### 6. Submitted / broker lifecycle

For actual PAPER submissions, preserve privately:

- canonical bot attribution,
- broker order identifiers,
- submission request,
- broker acknowledgements,
- status transitions,
- replacements,
- cancellations,
- rejections,
- expirations,
- partial fills,
- fills,
- observed slippage,
- fees where available,
- and reconciliation state.

Raw broker IDs remain server-side/private.

### 7. Open-position management

Persist each meaningful management decision:

- protective-order creation/repair,
- stop tightening,
- +1R protection,
- partial take profit,
- trailing-stop updates,
- forced/session flatten,
- emergency flatten,
- manager errors/recoveries,
- and any broker-vs-virtual-ledger reconciliation correction.

Stops may not be widened merely to avoid a loss.

### 8. Closed-trade outcome

For every completed PAPER trade, retain:

- realized P/L,
- R multiple,
- entry/exit price,
- fees and fee source,
- MFE/MAE,
- peak/trough marks,
- mark count,
- exit reason,
- duration,
- slippage/execution quality,
- strategy version,
- and relevant regime/setup classifications.

### 9. Strategy review dataset

Periodic strategy review must combine:

- executed trades,
- rejected candidates,
- staged but unexecuted proposals,
- expired/canceled/replaced plans,
- monitor-only observations,
- broker rejection/execution-quality data,
- and counterfactual outcomes.

Review questions should include:
- expectancy and average R by setup family,
- return/drawdown/loss streaks by strategy version,
- MFE/MAE versus stop design,
- outcome by score band,
- outcome by regime,
- outcome by spread/quote freshness/volatility band,
- fee and slippage impact,
- false-positive and false-negative patterns,
- missed-opportunity analysis,
- candidate-priority effectiveness,
- monitor-only promotion evidence,
- weekday/weekend/session effects,
- and whether gates are protecting capital or excluding favorable setups too often.

## Recommendation and promotion rules

The review layer may:
- generate evidence-backed recommendations,
- identify degrading or improving setup families,
- propose score/threshold/stop/session/universe changes,
- and compare candidate strategy versions.

It may not:
- silently rewrite production strategy parameters,
- raise risk limits autonomously,
- disable stops or kill switches,
- widen stops on losing positions,
- promote monitor-only assets automatically,
- or enable live-money trading.

Material changes require:
1. documented evidence,
2. a new versioned strategy configuration,
3. replay/historical comparison when possible,
4. PAPER validation,
5. comparison against the prior strategy using return, drawdown, expectancy, average R, execution quality, and counterfactual evidence,
6. and explicit approval before promotion.

## Current implementation status — 2026-10-03

Implemented or partially implemented:
- persisted research artifacts under `research/paper-watchlist/`,
- virtual bot orders/positions/equity history,
- private broker order/fill audit tables,
- trade metrics with live R/MFE/MAE fields,
- durable Daily Crypto Day five-minute evidence for all execution and monitor-only candidates,
- prepared swing plans retained as virtual orders,
- authenticated weekday five-minute swing revalidation journaling for QQQ/NVDA/MSFT, including market state, quote/spread freshness, blockers/waiting reasons, risk plan, selection priority, and explicit expiry terminalization,
- executed Default Diverse broker/fill/ledger attribution,
- central broker reconciliation now journals tagged terminal order states (`canceled`, broker `rejected`, `expired`, and `replaced`) across all PAPER bots, with broker-confirmed lifecycle events distinguished by `metadata.lifecycleSource=broker-reconciliation`,
- route-side `execution_error` evidence for broker outcomes that cannot be confirmed, including swing submission ambiguity and Daily Crypto entry/protection/partial/flatten failures,
- fail-closed Daily Crypto protective-order cancellation: replacement/partial/session-flatten work does not proceed when the existing broker protection cannot be confirmed canceled,
- and versioned strategy configuration.

Still required for complete coverage:
- finish uniform considered-candidate/decision journaling for remaining evaluators that do not yet emit the same detail as Daily Crypto and swing revalidation,
- add counterfactual tracking for serious non-executed proposals,
- aggregate closed-trade and non-trade evidence into a repeatable strategy-review dataset,
- and build the adaptive recommendation/report layer.

Broker `rejected` order events and strategy-level rejected/blocked candidate events share the journal event name `rejected`; broker lifecycle records are explicitly identified with `metadata.lifecycleSource=broker-reconciliation` and `metadata.brokerStatus` so later analysis can separate execution rejection from strategy rejection.

Nothing materially considered by the algorithm should be discarded merely because no trade occurred.


## Counterfactual evidence

Counterfactual studies are observation-only records for serious setups that were considered but not submitted. They never authorize or submit an order.

Daily Crypto v3 is the first live counterfactual source:
- Only execution-tier symbols can seed a missed-trade study. Monitor-only symbols never count as missed trades.
- The existing evidence qualification is reused: score >= 60 (Watch or better).
- Seeding only occurs while the local entry window is open.
- A setup that is already selected for an enabled live PAPER submission is not duplicated as a missed trade.
- One initial study is kept per execution symbol per local crypto session so five-minute rescans do not create dozens of copies of the same idea.
- The study is frozen from the information available at the recorded decision time: trigger, maximum entry, protective stop, planned target, score, blockers, warnings, quote/spread context, and regime.
- Tracking starts only with completed five-minute bars after the decision baseline. Earlier bars are never used to improve a historical result.
- A move entirely above max entry does not invent a fill.
- After an assumed trigger, +1R, +2R, stop, MFE, MAE, mark count, and session expiry are recorded.
- If a stop and a newly reached +1R/+2R threshold occur inside the same completed candle and sequence cannot be proven, the result is `ambiguous`, not guessed.
- Remaining watching/triggered studies expire at the deterministic session flatten boundary.

The storage table is `paper_bot_counterfactuals`. It is private service-role PAPER evidence with RLS enabled and no public/client access. Daily Crypto and the Three-Trade Weekly Swing Bot now both produce records through the same strategy-agnostic outcome model.


Swing counterfactual rules:
- A prepared QQQ/NVDA/MSFT plan is itself a serious setup; no synthetic score is invented.
- Seeding only occurs while Alpaca reports the market open and the strategy's 5-to-120-minute entry window is active.
- If an enabled PAPER executor is actually going to submit the selected plan, that plan is not duplicated as a missed trade.
- Future completed 5-minute IEX bars drive the hypothetical trigger/stop/+1R/+2R/MFE/MAE record.
- A watching plan that never triggers expires when the 120-minute entry window closes.
- A hypothetical trade that triggered inside the entry window remains active after that window and can continue across later market sessions until stop or +2R resolves it.


## Strategy Review layer

Bot Lab now has a derived Strategy Review API and panel that combines safe aggregates from:
- decision/rejection journal evidence,
- executed trade metrics,
- counterfactual studies,
- terminal order lifecycle events,
- score bands,
- per-symbol evidence,
- and recurring blockers/waiting reasons.

The review layer is deliberately advisory-only:
- automatic strategy mutation is disabled,
- automatic risk increases are disabled,
- live-money changes are disabled,
- counterfactual paths are never counted as P/L,
- monitor-only observations remain visible for research but are excluded from execution-gate score bands and recommendation-driving blocker counts,
- same-bar ambiguous counterfactuals are excluded from directional conclusions,
- and material recommendations require a new strategy version plus PAPER validation.

Evidence maturity is operationally labeled:
- fewer than 20 resolved outcome samples: `collecting`,
- 20-49: `early`,
- 50-99: `developing`,
- 100+: `established`.

Parameter-change recommendations remain locked until at least 20 resolved outcome samples exist for that bot. This threshold is a review-governance guardrail, not a trading-entry rule and not proof of statistical significance.

Current deterministic recommendations can:
- withhold changes when the sample is too small,
- flag a possible restrictive-gate review when mature non-executed evidence repeatedly reaches +2R before the original stop,
- note when rejection gates appear protective,
- and flag weak realized-R capture versus MFE after enough completed trades.

Any such recommendation is a hypothesis for a new version. It cannot edit the running strategy.
