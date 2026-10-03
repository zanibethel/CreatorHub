# Paper Trading Lab

## Purpose

CreatorHub's Paper Trading Lab is a public, interactive paper portfolio report. Opening `/paper-trading` shows the report directly without sign-in or guest setup. Its market-data endpoint serves public quotes only and does not read an account, private holdings, or a trade ledger. Alpaca keys remain server-only. It must never send orders to a live brokerage account. Future account-linked data and simulator controls require separate authenticated, user-scoped storage and must never be committed to GitHub.

## Agreed initial model

- Start the challenge with **$1,000 virtual cash**; report no performance until data and simulated fills exist.
- The initial challenge counter begins only after the user selects Start day counter. In this preview the date is stored in that browser's local storage; it does not claim the simulator was running. Move the start date to private user-scoped persistence before treating this as a cross-device account setting.
- Initial holding-period allocations: **20% day trades, 40% multi-day swings, and 40% multi-week swings**.
- Maintain a separate inverse ETF sleeve that is monitored daily. Its allocation has not been chosen, so it is currently shown as unallocated. Any final configuration must sum to 100% of the virtual account.
- Crypto assets are eligible within the same pools. They do not receive a separate capital allocation.
- One trade may use no more than **9% of its assigned pool's budget**. With a $1,000 challenge, that means example position caps of $18, $36, and $36 for the 20%, 40%, and 40% pools. This is a position-size ceiling, not a loss limit; a separate loss budget is required.
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

- The near-live monitor is read-only: Alpaca IEX latest stock quotes and Kraken public Level 2 order books for selected USD crypto pairs.
- The dashboard accepts editable symbols; the initial SPY/QQQ and BTC-USD/ETH-USD values are test examples, not a recommended or approved strategy watchlist.
- Alpaca keys are read from server-only `ALPACA_API_KEY_ID` and `ALPACA_API_SECRET_KEY` environment variables. Use market-data credentials only; never add keys to source control or expose them to browser code.
- The public refresh endpoint requires no sign-in, has no order placement methods, and returns a no-cache snapshot. The page monitors quotes while visible. It does not yet persist data, generate signals, simulate fills, or run hourly.
- The free Alpaca stock feed is IEX only. Treat it as an integration test, not consolidated-market evidence. Upgrade only after we decide to test against full-market real-time data.
- Kraken order-book depth describes Kraken's venue. Historical depth must be captured by our worker if we want to analyze book conditions later.

## Rotating dashboard behavior

- Three report screens: **Portfolio & watchlist**, **Trades & rules**, and **Upcoming orders**, advancing every 12 seconds. Manual selection, report interaction, and settings pause both report and sponsor rotation. Reduced-motion preference starts paused.
- A persistent top bar shows the challenge day, virtual starting cash, and daily P/L. The current $1,000 is the initial virtual amount; P/L stays unrecorded until a private ledger exists.
- Desktop/livestream layouts fill the viewport with all report cards visible. The watchlist pages through four symbols at a time. Very short screens (under 561px high) allow vertical scrolling to keep content readable.
- Portfolio screen reserves the top card for saved account value since day one, with the watchlist grid below. Watchlist prices show fetched bid/ask snapshots with venue/timeframe labels, source quote ages, and real provider price-history charts.
- Trades screen reserves space for the 10 most recent completed trades and their purchase/fill/cost/rationale reports, alongside the pool and entry/exit rules. Until private persistence exists, no fictional records appear.
- Upcoming screen distinguishes pending/partial entries from filled positions and linked target/stop sell orders.
- One sponsor/QR card occupies the same position on every screen. Its destination rotates every 24 seconds independently of screen changes, so a code remains visible through two screen transitions.
- Stream settings accept exact HTTPS destinations for creator donations, ad booking, RaiseHub, and CoOperative. Blank destinations are excluded; CoOperative is added only when ready. Codes are generated locally with a four-module quiet zone and link to the displayed destination. No external QR service receives the links.
- These links and symbols are browser-local settings, not a persisted ad inventory or payment system. Donation and ad checkout pages must already exist. Donations do not modify the virtual bankroll. Public report access is implemented; livestream broadcasting is not.
- Growth uses saved paper-account snapshots only. Market price charts are not account performance. Until snapshots exist, display the virtual starting amount without a fabricated curve.

## Report views

- Show **open orders and positions** as current state at the latest simulator update, including pending and partial limit entries, filled positions, fill quantity, assigned pool, timestamps, and linked stop/target levels where available.
- Keep **previous trades** as a separate closed-trade history with entry and exit times/prices, costs, realized net result, and recorded signal/exit rationale.
- Never label a pending or partially filled order as a completed trade. Until private persistence and a market-data simulator are connected, show truthful empty states rather than sample or fabricated records.

## Scheduling and data handling

- The future hourly job updates snapshots and paper-trade state; it does **not** rewrite or commit website source code every hour.
- The future report page will read the latest stored account snapshot on refresh and shows separate timestamps for equity and crypto data.
- Crypto is monitored around the clock. Equity checks follow the equity market session and clearly show when quotes are stale.
- Real portfolio data requires an authorized data connection. The preview can automatically fetch market quotes and crypto depth while open, but it has no brokerage connection, persisted portfolio history, or trading worker and generates no trades.
- Do not connect real order routing in this project. Start with paper simulation and an explicit data-source adapter.

## Open before live-data paper runs

- Select a stock/ETF and crypto feed, including whether it provides historical data and order-book depth under terms that permit this use.
- Choose the inverse ETF sleeve's percentage so pool allocations total 100%.
- Define the initial watchlist, paper fill methodology, score threshold, maximum portfolio loss, and risk per trade through backtesting.
- Implement private persistence with row-level user ownership and verify access controls before storing account-linked holdings.

## Preview verification

- Run `npm run test:paper` for public access, watchlist-validation, partial-provider-failure, order-book sorting, and stock-history pagination checks with mocked provider responses.
- Provider requests time out after 10 seconds. Missing stock credentials and unsupported crypto pairs are reported individually so other sources can still load. A refresh with no usable quotes fails explicitly.
- Stock charts request 60 calendar days of split-adjusted daily bars, follow pagination, and display the latest 30 bars. Crypto charts omit the current incomplete hourly candle.
- Source timestamps include the date so older quotes are not mistaken for current quotes. Quote snapshots are not evidence of order-book persistence or trade execution.

## Near-live quote monitor

- Enabled by default after browser settings load. Refreshes stock quotes and crypto order books every 15 seconds after the preceding refresh completes, while the tab is visible. It stops fetching when hidden, resumes when visible, and stops entirely when the page is closed.
- Pause quotes controls the feed independently from Pause report, which controls screen and sponsor rotation. Refresh now forces a quote and chart update.
- Historical charts load on the first successful refresh, then every five minutes. Quote-only refreshes skip historical requests and retain the previous chart values. Quote and chart-history failures are isolated; a failed chart request does not suppress available crypto quotes.
- Quotes older than 60 seconds, missing timestamps, and timestamps more than 60 seconds ahead of the browser clock are marked stale. A current fetch time is distinct from the age of the provider quote. This display rule is not a trading eligibility or market-session rule.
- Requests cannot overlap. Unavailable feeds retry after 30, 60, then at most 120 seconds; a successful refresh restores the 15-second cadence. Invalid watchlists and denied feed access stop automatic retries until settings/access are corrected and the user refreshes.
- Partial sources are reported individually. Total failure preserves the previous displayed snapshot with an error and growing quote age. Browser requests time out after 20 seconds; provider calls retain their 10-second bound.
- Stocks still need server-side Alpaca keys and use only IEX. Kraken crypto monitoring uses public venue data. This is polling, not a streaming tick feed, Level II equity service, or an order execution engine.
- The hourly background worker and private ledger remain separate pending work. This page monitor records no trades and does not claim continuous monitoring while the user is away.
