# Paper Trading Lab

## Purpose

CreatorHub's Paper Trading Lab is a private, paper-only portfolio report and strategy simulator. It must never send orders to a live brokerage account. The dashboard and its future API routes require an authenticated, non-anonymous user. Portfolio holdings, pool settings, snapshots, signals, and simulated trades belong in user-scoped storage and must never be committed to GitHub.

## Agreed initial model

- Start with **$1,000 virtual cash**; report no performance until data and simulated fills exist.
- Initial holding-period allocations: **20% day trades, 40% multi-day swings, and 40% multi-week swings**.
- Maintain a separate inverse ETF sleeve that is monitored daily. Its allocation has not been chosen, so it is currently shown as unallocated. Any final configuration must sum to 100% of the virtual account.
- Crypto assets are eligible within the same pools. They do not receive a separate capital allocation.
- One trade may use no more than **9% of its assigned pool's budget**. This is a position-size ceiling, not a loss limit; a separate loss budget is required.
- An unfilled candidate may move to another pool before entry. A filled trade remains attributed to the pool that owns it until closed.

## Entry and exit lifecycle

1. Timestamped price, volume, volatility, event, and related-asset alerts update a setup score. Negative evidence can lower the score or invalidate the candidate.
2. Scores must be calibrated on historical outcomes and evaluated out of sample. The dashboard must show score evidence and data freshness; it must not imply certainty.
3. When supported by the feed, spread, depth, persistence, and executed-trade data may confirm or reject an entry. A Level II snapshot alone is not a guarantee of executable liquidity or direction.
4. A qualifying setup creates an expiring **simulated limit order**. No fill is assumed unless the simulator's fill rules say it would have executed. Partial fills are tracked explicitly.
5. Only after a fill, create linked simulated exits for the selected stop and target. Include spread, fees, slippage, and gap assumptions in fill calculations.
6. Record every signal, rejection, order, fill, cancellation, exit, data timestamp, and strategy version so the report can explain what it would have done.

The earlier +9% target / -2.3% stop idea remains a candidate for testing, not a validated default.

## Initial market-data wiring

- The first manual check is read-only: Alpaca IEX latest stock quotes and Kraken public Level 2 order books for selected USD crypto pairs.
- The dashboard accepts editable symbols; the initial SPY/QQQ and BTC-USD/ETH-USD values are test examples, not a recommended or approved strategy watchlist.
- Alpaca keys are read from server-only `ALPACA_API_KEY_ID` and `ALPACA_API_SECRET_KEY` environment variables. Use market-data credentials only; never add keys to source control or expose them to browser code.
- The refresh endpoint requires a signed-in, non-anonymous user, has no order placement methods, and returns a no-cache snapshot. It does not yet persist data, generate signals, simulate fills, or run hourly.
- The free Alpaca stock feed is IEX only. Treat it as an integration test, not consolidated-market evidence. Upgrade only after we decide to test against full-market real-time data.
- Kraken order-book depth describes Kraken's venue. Historical depth must be captured by our worker if we want to analyze book conditions later.

## Report views

- Show **open orders and positions** as current state at the latest simulator update, including pending and partial limit entries, filled positions, fill quantity, assigned pool, timestamps, and linked stop/target levels where available.
- Keep **previous trades** as a separate closed-trade history with entry and exit times/prices, costs, realized net result, and recorded signal/exit rationale.
- Never label a pending or partially filled order as a completed trade. Until private persistence and a market-data simulator are connected, show truthful empty states rather than sample or fabricated records.

## Scheduling and data handling

- The future hourly job updates snapshots and paper-trade state; it does **not** rewrite or commit website source code every hour.
- The report page reads the latest stored snapshot on refresh and shows separate timestamps for equity and crypto data.
- Crypto is monitored around the clock. Equity checks follow the equity market session and clearly show when quotes are stale.
- Real portfolio data requires an authorized data connection. The current preview has no live quote, broker, or Level II feed and generates no trades.
- Do not connect real order routing in this project. Start with paper simulation and an explicit data-source adapter.

## Open before live-data paper runs

- Select a stock/ETF and crypto feed, including whether it provides historical data and order-book depth under terms that permit this use.
- Choose the inverse ETF sleeve's percentage so pool allocations total 100%.
- Define the initial watchlist, paper fill methodology, score threshold, maximum portfolio loss, and risk per trade through backtesting.
- Implement private persistence with row-level user ownership and verify access controls before storing account-linked holdings.
