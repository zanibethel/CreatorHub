# Paper bot profiles and challenge comparisons

The paper-trading project supports multiple isolated strategy bots so different trading styles can be measured without mixing their capital, positions, or risk budgets.

## Default profile

### Default Diverse Bot

- Profile ID: `default-diverse`
- Status: active
- Starting challenge capital: $100
- Strategy: `paper-medium-high-v1`
- Universe: diversified stocks, ETFs, and crypto from the persisted shared watchlist
- Style: medium-to-high opportunity aggressiveness with deterministic downside controls
- Horizon: day, multi-day, and multi-week opportunities
- Risk model: the approved decision-engine specification in `PAPER_DECISION_ENGINE.md`

This is the current default bot. The existing scoring, regime, stop-loss, risk-sizing, portfolio-heat, correlation, and kill-switch architecture belongs to this profile.

## Planned experimental profiles

### $100 Penny Volatility Day Bot

Purpose: test whether a deliberately higher-volatility, intraday-only strategy can produce useful risk-adjusted growth when compared with the Default Diverse Bot.

Persisted challenge intent:
- Starting capital: $100.
- Stock-only.
- Penny/low-priced universe, initially represented by a maximum candidate price of $5.
- Intraday-only; no intentional overnight holdings.
- Dedicated liquidity, spread, volatility, sizing, stop, and daily-loss rules are required before activation.
- Higher volatility never bypasses protective stops or kill switches.
- Status: planned/disabled.

The exact entry frequency and risk parameters are intentionally not fixed yet. They should be designed from market-data availability and replay/paper tests rather than copied from the diversified bot.

### $100 Daily Crypto Day Bot

Purpose: test a fee-aware, short-horizon daily crypto strategy against the other $100 challenges.

Persisted challenge intent:
- Starting capital: $100.
- Execution pool in v4: BTC/USD, ETH/USD, SOL/USD, LINK/USD, DOT/USD.
- Monitor-only pool in v4: XRP/USD, LTC/USD, AVAX/USD, DOGE/USD, ADA/USD, BCH/USD, AAVE/USD, HYPE/USD, RENDER/USD.
- Continuous 24/7 crypto entry eligibility; America/Chicago is retained only as the daily accounting boundary.
- Maximum three new entries per America/Chicago accounting day.
- Maximum one open position at a time.
- Alpaca execution-venue quotes plus completed 5-minute / 15-minute bars.
- 0.50% risk budget per trade, 30% maximum initial allocation, and 1.50% daily realized-loss kill switch.
- Gross target must cover estimated round-trip taker fees by at least 2.50x.
- Same-symbol entries are blocked when another bot already holds that crypto in the shared Alpaca PAPER account.
- Status: active scanner + automated PAPER execution armed; live money disabled.

The source-of-truth strategy and rollout plan is `PAPER_DAILY_CRYPTO_DAY.md`.

### $100 Three-Trade Weekly Swing Bot

Purpose: test a low-frequency, highly selective swing style against the other profiles.

Persisted challenge intent:
- Starting capital: $100.
- Liquid stocks and ETFs.
- Swing setups only.
- Maximum of three new entries per calendar week.
- Protective exits and other risk-reducing actions do not count against the three-entry limit.
- Unused trade slots never force a trade.
- Status: planned/disabled.

Exact holding-period, score, sizing, and exit parameters remain to be designed and versioned separately.

## Isolation rules

Every bot must have its own $100 virtual ledger. The Alpaca paper account is a shared execution venue and independent audit source, not a shared strategy bankroll.

Bots do not:
- Share positions.
- Share realized P/L.
- Share available buying power.
- Share risk budgets.
- Transfer virtual capital to rescue another strategy.
- Count another bot's activity toward their trade-frequency limits.

Market data, the Alpaca paper venue, and common analytical infrastructure may be shared, but every decision/order must retain the bot/profile ID and strategy version that produced it. Only bot-attributed fills may change that bot's virtual ledger.

Broker attribution uses stable short profile tags in Alpaca `client_order_id` values: `div` for Default Diverse, `pny` for the Penny Volatility challenge, `sw3` for the Three-Trade Weekly Swing challenge, and `wkd` for the Daily Crypto Day challenge. The formatter/parser lives in `src/lib/paper-order-attribution.ts`. A private service-role-only `paper_bot_orders` table maps those client order IDs to the bot, strategy version, broker order ID, symbol, requested size, and reconciliation status. Raw order identifiers remain private.

This avoids contaminating the experiment. A strong result from one bot must not hide losses from another.

## Common comparison scorecard

All profiles should publish the same core measurements so different styles can be evaluated on comparable evidence:

| Metric | Purpose |
| --- | --- |
| Starting / ending equity | Absolute challenge growth |
| Total return | Growth relative to starting capital |
| Maximum drawdown | Largest peak-to-trough loss |
| Realized P/L | Closed-trade result |
| Unrealized P/L | Current open exposure |
| Win rate | Context only; not sufficient by itself |
| Average winner / loser | Payoff asymmetry |
| Expectancy per trade | Average expected result from observed trades |
| Average R | Result normalized to planned trade risk |
| Profit factor | Gross winners relative to gross losers |
| Largest loss in R | Tail-risk monitoring |
| Consecutive loss streak | Strategy stress behavior |
| MFE / MAE | How far trades move for/against the entry |
| Trade count | Sample-size and activity context |
| Turnover | Trading intensity |
| Slippage / fees | Execution drag when available |
| Capital utilization | How much of the challenge capital is actually deployed |
| Time in market | Exposure duration |
| Kill-switch events | Frequency of risk-limit activation |

Comparison views should show both raw return and risk-adjusted behavior. A strategy with higher total return but severe drawdown should remain visibly different from a steadier strategy.

## Strategy independence

Each profile gets its own versioned strategy configuration. Changes to one bot must not silently alter another.

For example:
- Tuning the Penny Volatility Bot's spread tolerance must not modify the Default Diverse Bot.
- Changing the Swing Bot's maximum entries per week must not change other profiles.
- A successful parameter discovered by one profile may be proposed for another, but adoption requires a new version for the receiving strategy.

## Learning layer

The multi-bot experiment is intended to answer questions with evidence, such as:
- Which styles generate the best expectancy?
- Which produce the smallest drawdowns?
- Which work better in bullish, neutral, or volatile regimes?
- Does higher activity improve returns after execution drag?
- Does a three-trade weekly limit improve selectivity?
- Which setups repeatedly fail despite high qualification scores?

The adaptive analysis layer may compare profiles and recommend changes, but it may not autonomously merge strategies, move virtual capital between bots, raise risk limits, disable stops, or activate a planned bot.

## Bot Lab UI

The comparison dashboard is available at `/paper-trading/bots`.

Current behavior:
- Shows all registered paper bot profiles as separate challenge cards.
- Displays Active vs Planned status and each challenge's isolated starting capital.
- Reads each bot's equity, cash, risk state, position count, and history from its isolated virtual ledger.
- Every challenge starts at the same $100 baseline.
- Displays the Alpaca paper-account balance separately as the execution sandbox/audit trail; broker equity is never substituted for bot equity.
- Includes a common comparison board for return, drawdown, expectancy/average R, profit factor, MFE/MAE, and kill-switch events.
- Metrics that do not yet have authoritative persisted data are explicitly shown as awaiting journal/risk data.
- Planned bots remain disabled and cannot submit orders.

The main Paper Trading Lab and CreatorHub dashboard both link to Bot Lab.

## Registry

The code registry lives in `src/lib/paper-bot-profiles.ts`.

Current registry:
1. `default-diverse` — active.
2. `penny-volatility-day-100` — planned.
3. `three-trade-weekly-swing-100` — active under `three-trade-weekly-swing-v1`; PAPER bracket execution is armed but still gated by same-session readiness.
4. `weekend-crypto-day-100` — stable challenge ID retained for history; active under `daily-crypto-day-v4` with continuous 24/7 PAPER execution armed and live money disabled.

New bots should be added to this registry with a unique ID, unique short broker tag, $100 challenge capital, isolated ledger, strategy version, universe, cadence constraints, and explicit activation status.


### Current swing staging

As of 2026-10-03, the Three-Trade Weekly Swing Bot is active for PAPER staging with a $100 isolated virtual ledger. It has three prepared Monday plans (QQQ, NVDA and MSFT). Prepared plans are visible in Bot Lab but are not broker orders. Each plan stores its breakout trigger, maximum chase price, protective stop, planned risk and expiry, and must be freshly revalidated before any paper submission.

Default Diverse also completed a controlled weekend SOL/USD paper smoke test through the bot-attribution and virtual-ledger reconciliation path. The crypto position uses fee-aware virtual accounting and a separate broker-hosted stop-limit protection order.


## Execution-readiness source of truth

See `docs/PAPER_LIVE_READINESS_PLAN.md` for the ordered paper-to-live readiness sequence. Current priority is crypto Exit Manager v1, followed by Monday swing revalidation and broker-hosted stock bracket/OCO protection. No current bot has real-money execution permission.
