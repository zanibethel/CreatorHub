# Interactive trading report

## Current scope

`/paper-trading` opens a public interactive report directly, without account setup or sign-in. The user requested a report, not a built-in paper-trade simulator. Do not add simulator controls or a simulator engine to this report. The page is read-only and never routes orders.

The $1,000 starting amount is the challenge baseline. Until account snapshots and a ledger are connected, returns, trades, orders, and positions remain truthful empty states. Market charts are market history, not portfolio performance. Future account-linked data needs private storage and an explicitly selected public report projection; never expose private holdings simply by removing authentication.

## Five report views

1. **Portfolio**: starting amount and space for recorded portfolio history.
2. **Watchlist**: provider quotes and market history only.
3. **Trades**: the latest 10 completed trade reports, when recorded.
4. **Orders**: pending and partially filled entries, when recorded.
5. **Positions**: open positions and recorded planned exits, when recorded.

Each view has one main report card. Simulator status and strategy-rule panels are removed. Empty trade sections do not show unused table headers.

The report rotates every 12 seconds. Manual view selection, report interaction, settings, and reduced-motion preferences pause rotation. Quote monitoring is controlled separately. Page counts derive from the view list.

## Responsive display

- Desktop uses a large report card and a persistent sponsor column. Report content can scroll when it exceeds the available space; short windows use natural document height.
- Mobile uses natural page/card height, stacked header metrics, a horizontally scrollable five-view navigation, and a single column for report and sponsor cards. No fixed report or sponsor row may squeeze or overlap card contents.
- Mobile watchlists show two symbols per page in full-width cards. Desktop shows up to four in a two-column grid. Chart and timestamp areas have room to remain readable.
- Pause/resume and Next remain visible. Report settings, quote pause/resume, and Refresh now live under Controls.
- A sponsor without configured destinations uses a compact setup card. Configured QR cards keep their real destinations and independent 24-second rotation. Donation and ad checkout pages must already exist. Donation proceeds do not modify the starting amount.
- Settings and the report day counter are browser-local. Starting the counter sets the displayed report day only.

## Near-live market monitor

The public quote endpoint accepts up to 10 stock symbols and 10 USD crypto pairs. It serves public market data only; it does not read a brokerage account or private ledger. Alpaca credentials remain in server-only `ALPACA_API_KEY_ID` and `ALPACA_API_SECRET_KEY` variables.

- Stocks use Alpaca IEX latest quotes and split-adjusted daily charts, requesting 60 calendar days, following pagination, and displaying the latest 30 bars. IEX is a single-exchange feed.
- Crypto uses Kraken public order books and hourly charts, excluding the last incomplete candle. Depth describes Kraken's venue only.
- Quotes refresh every 15 seconds after the preceding request completes while visible. Monitoring pauses while hidden and stops when closed. History loads initially and every five minutes; manual refresh updates both.
- Requests cannot overlap. Total failure preserves previous displayed data and retries after 30, 60, then at most 120 seconds. Invalid symbols and denied feed access stop automatic retries until corrected and manually retried.
- Quote ages and full provider timestamps remain visible. Quotes older than 60 seconds, missing timestamps, or timestamps more than 60 seconds ahead are marked stale. Collection time is separate from quote time.
- Provider calls time out after 10 seconds; browser refreshes after 20 seconds. Partial failures are isolated, including historical-chart failures. Quote-only updates preserve old charts, not missing current quotes.

The initial SPY/QQQ and BTC-USD/ETH-USD watchlists are integration examples. The page does not generate trade signals, fabricate fills, or record returns. Background collection and account-ledger reporting are separate future integrations.

## Validation

`npm run test:paper` covers public endpoint access, watchlist validation, provider isolation, order-book sorting, pagination, monitoring cadence, visibility changes, retry behavior, and quote freshness. Run a production build and lint changed components. Confirm the report opens without cookies. Visual verification must inspect card spacing on mobile and desktop; deployment build success alone does not verify layout.
