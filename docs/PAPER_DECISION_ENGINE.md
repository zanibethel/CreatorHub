# Paper trading decision engine

Status: approved design specification for the CreatorHub paper-trading bot. This document defines the intended decision and risk architecture before automated order execution is enabled.

## Objective

The engine should pursue consistent portfolio growth with medium-to-high opportunity aggressiveness while tightly controlling downside. Aggressiveness comes from acting quickly on strong setups and allowing winners to run, not from oversized positions or removing protection.

There is no guarantee of low losses. Stops, position sizing, exposure limits, and kill switches are loss-control mechanisms; gaps, slippage, correlated moves, feed failures, and adverse market conditions can still produce losses larger than planned.

The engine remains paper-trading only unless a separate, explicit future decision changes that boundary.

## Core flow

```text
19-symbol shared watchlist
        ↓
market-data freshness + liquidity checks
        ↓
market-regime filter
        ↓
setup qualification score (0–100)
        ↓
portfolio/risk veto
        ↓
risk-based position sizing
        ↓
protected paper entry
        ↓
active stop + profit management
        ↓
trade journal + outcome analytics
        ↓
adaptive recommendations (never autonomous risk-rule rewrites)
```

The qualification score finds opportunity. The risk engine always has veto authority.

## Decision layers

### 1. Market regime

Determine whether the broad environment supports the proposed direction before considering an entry.

Initial intent:
- Prefer long entries when the broader market trend is supportive.
- Reduce or disable new long exposure during strongly bearish conditions.
- Treat regime as a gate/modifier, not as a standalone trade signal.
- Re-evaluate regime before each new order.

The implementation should use deterministic market inputs. Exact indicators and thresholds must be backtested in paper operation before being promoted from candidate parameters.

### 2. Liquidity and execution quality

Reject candidates that cannot be entered and exited cleanly.

Required checks:
- Fresh market data.
- Positive, non-crossed bid/ask quotes.
- Maximum acceptable spread.
- Minimum recent liquidity/dollar volume.
- No entry when required quote/market data is stale or unavailable.
- Crypto execution pricing must be verified against the execution venue rather than assuming the public Kraken watchlist price is executable through Alpaca.

### 3. Trend

Trend contributes 25% of the initial qualification score.

Candidate evidence may include:
- Price relative to selected moving averages.
- Moving-average slope.
- Higher-high / higher-low structure.
- Multi-timeframe agreement when sufficient data is available.

### 4. Momentum

Momentum contributes 25%.

Candidate evidence may include:
- Recent return strength.
- Price acceleration.
- Breakout/breakdown momentum appropriate to the allowed direction.
- Confirmation rather than a single isolated price spike.

### 5. Relative strength

Relative strength contributes 15%.

Compare the candidate against an appropriate broad benchmark and, when available, its sector/peer group. The purpose is to favor assets outperforming their environment rather than assets merely rising with the market.

### 6. Setup quality

Setup quality contributes 15%.

Examples:
- Breakout from a valid consolidation.
- Pullback within an established trend.
- Reclaim of a meaningful level.
- Clear invalidation level that produces acceptable reward-to-risk.

A high score does not authorize a trade if the structure does not provide a defensible stop.

### 7. Volume confirmation

Volume contributes 10%.

Prefer setups with supportive participation, including relative-volume expansion when appropriate. A single abnormal print should not by itself qualify a trade.

### 8. Volatility quality

Volatility contributes 10%.

Use ATR and recent realized volatility to distinguish healthy movement from excessive noise. Volatility is also used for stop placement and risk-based sizing.

## Qualification score

Initial weighting:

| Component | Weight |
| --- | ---: |
| Trend | 25% |
| Momentum | 25% |
| Relative strength | 15% |
| Setup quality | 15% |
| Volume confirmation | 10% |
| Volatility quality | 10% |

Initial states:
- 0–59: unqualified.
- 60–74: Watch.
- 75–84: Qualified.
- 85–100: Trade-ready candidate.

A score of 85+ is necessary but not sufficient for an automated paper entry. It must also pass regime, freshness, liquidity, stop-quality, portfolio-heat, correlation, and loss-limit checks.

The thresholds and weights are starting paper parameters. They should be versioned and adjusted only from accumulated evidence, never silently mutated in production.

## Stop-loss architecture

Every proposed position must have its protective exit defined before the entry order is submitted.

Calculate at least two stop candidates:

1. **Structure stop** — beyond a recent support/swing invalidation level.
2. **ATR stop** — initially around 1.5–2.0 ATR from entry, subject to asset behavior and tested parameters.

The engine should choose a defensible stop that gives normal price movement room while preserving acceptable portfolio risk. A trade must be rejected when the required stop is too wide, expected reward-to-risk is insufficient, data is stale, or valid structure is unavailable.

Do not use the same fixed percentage stop for every asset.

Where supported by the broker, use broker-hosted bracket/OCO-style protection so a protective exit does not depend on the CreatorHub page remaining open.

Stops may only tighten after entry; they must never be widened merely to avoid realizing a loss.

## Risk-based position sizing

Position size is derived from dollars at risk rather than a fixed percentage of the portfolio.

```text
risk dollars = account equity × risk-per-trade
position value ≈ risk dollars / stop distance %
```

Example for a $100 challenge:
- Virtual bot equity: $100
- Risk per trade: 0.75% = $0.75
- Required stop distance: 3%
- Approximate position value: $0.75 / 0.03 = $25

This means wider-stop trades automatically receive smaller positions.

Initial paper defaults:
- Standard trade risk: 0.75% of current account equity.
- Highest-quality trade-ready setup: up to 1.00%.
- Position size must also respect the bot's available buying power, 20/40/40 pool allocation ceilings, asset constraints, and broker minimums.

No score may bypass the maximum risk-per-trade limit.

## Portfolio risk governor

The portfolio risk governor has veto power over all new entries.

Initial paper defaults:
- Maximum standard risk per trade: 0.75%.
- Maximum high-conviction risk per trade: 1.00%.
- Maximum total open planned risk: 4.00%.
- Maximum correlated sector/theme planned risk: approximately 2.00%.
- Daily realized-loss ceiling: approximately 2.50%.
- Weekly drawdown ceiling: approximately 5–6%.

When a daily/weekly kill switch is triggered:
- Do not open new risk.
- Do not increase existing risk.
- Continue managing protective exits.
- Record the event for later review.
- Resume only under an explicit deterministic reset rule.

The bot must never increase risk simply because prior trades lost. There is no martingale, loss chasing, or "win it back" behavior.

## Correlation and duplicate exposure

Before entry, measure whether existing positions already express substantially the same risk.

Examples:
- Multiple mega-cap technology stocks.
- An ETF plus several large constituents.
- Highly correlated crypto positions.

A trade can be rejected or reduced even with an excellent individual score if it would exceed correlated-exposure limits.

SH and PSQ remain monitor-only unless their policy is explicitly changed elsewhere; they do not currently receive funded allocation.

## Profit management

The goal is asymmetric payoff: cap planned losers near 1R while allowing strong winners to exceed 1R.

Initial paper framework:
- Around +1R: consider tightening the stop toward breakeven/technical protection; do not mechanically choke normal movement.
- Around +1.5R to +2R: optionally realize approximately 20–35% of the position.
- Remaining quantity: trail using ATR and/or rising market structure.
- Strong trends should be allowed to produce +3R, +4R, or larger outcomes when the trailing logic remains valid.

A profit target must not cause the engine to widen a stop or add risk to a losing position.

## Order authorization

An automated paper order may be submitted only when all required checks pass:

1. Candidate exists in the persisted shared watchlist.
2. Symbol/pair is permitted for funded trading.
3. Required market data is available and fresh.
4. Market regime permits the intended direction.
5. Liquidity/spread requirements pass.
6. Qualification score meets the trade-ready threshold.
7. Entry structure is valid.
8. Stop is defined before entry.
9. Reward-to-risk requirement passes.
10. Position size is calculated from allowed risk.
11. Asset/pool/sector/correlation limits pass.
12. Daily and weekly kill switches are clear.
13. Total portfolio heat remains within limits.
14. Broker/order validation passes.
15. The resulting order is explicitly routed to the Alpaca paper environment.

Failure of any mandatory check means no new order.

## Trade journal

Persist enough evidence for every proposed and executed paper trade to reproduce why the engine acted.

Record at minimum:
- Symbol/pair.
- Asset class.
- Candidate/pool attribution.
- Decision-engine version.
- Timestamp and data timestamps.
- Market regime.
- Total qualification score.
- Each component score and evidence.
- Bid, ask, spread, reference price.
- ATR and volatility metrics.
- Entry type and intended price.
- Structure stop.
- ATR stop.
- Final chosen stop.
- Planned risk dollars and percent.
- Position size.
- Correlated exposure at authorization.
- Planned target/trailing method.
- Order identifiers stored privately.
- Fill data.
- Exit reason.
- Realized P/L.
- R multiple.
- Maximum favorable excursion (MFE).
- Maximum adverse excursion (MAE).
- Slippage/fees when available.

Rejected candidate decisions should also be logged when practical, especially the rejection reason. This allows later analysis of false positives and missed opportunities.

## Adaptive confidence layer

Completed paper trades should be analyzed by context rather than only win/loss.

Examples:
- Performance of 85+ breakout setups in bullish regimes.
- Average R for pullbacks versus breakouts.
- Outcomes by ATR/volatility range.
- Outcomes by score band.
- Outcomes by asset class and sector.
- MFE/MAE behavior relative to the chosen stop.
- Effect of spread and slippage on results.

The adaptive layer may:
- Produce evidence-backed parameter recommendations.
- Adjust descriptive confidence estimates when a separately approved implementation allows it.
- Surface degrading or improving setup families.

The adaptive layer may not:
- Autonomously raise maximum risk limits.
- Disable hard stops.
- Widen stops on losing trades.
- bypass kill switches.
- switch from paper trading to live trading.
- rewrite core safety rules without an explicit approved configuration/version change.

AI may analyze results and propose changes; deterministic code owns order permission, risk sizing, exposure limits, stops, and kill switches.

## Versioning and promotion

Treat decision-engine parameters as versioned strategy configuration.

Any change to:
- score weights,
- score thresholds,
- regime rules,
- stop formula,
- risk-per-trade,
- portfolio heat,
- daily/weekly kill switches,
- correlation limits,
- target/trailing behavior,

must create a new strategy version and retain the previous version for comparison.

Before promoting a material strategy change:
1. Evaluate historical/replay behavior when data supports it.
2. Run it in paper mode.
3. Compare sufficient paper results using return, drawdown, expectancy, average R, loss streaks, and execution quality.
4. Document the reason for the change.

## Implementation sequence

1. Add versioned strategy configuration.
2. Build deterministic market-regime calculation.
3. Build score components with explainable evidence.
4. Add risk/portfolio governor and correlation checks.
5. Add stop/target calculation.
6. Add risk-based position sizing.
7. Add decision journal/rejection logging.
8. Add dry-run decision endpoint that cannot place orders.
9. Validate dry-run outputs against live market snapshots.
10. Add Alpaca paper-only order adapter.
11. Require broker-hosted protection where supported.
12. Add active position/exit manager.
13. Add daily/weekly kill switches.
14. Add outcome/R/MFE/MAE analytics.
15. Add adaptive recommendation layer.
16. Tune only from documented paper evidence.

Each bot ledger starts at $100 and is authoritative for strategy buying power and risk calculations. The larger Alpaca paper-account balance is only an execution sandbox and audit trail. Bot-attributed orders/fills must be reconciled to the matching virtual ledger; untagged broker activity must never silently change a bot's performance. The read-only public report remains separate from privileged order execution. Public endpoints must never expose broker credentials, private order identifiers, or internal authorization state.
