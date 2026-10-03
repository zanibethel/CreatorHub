# Interactive trading report

## Current scope

`/paper-trading` opens a public interactive report directly, without account setup or sign-in. The user requested a report, not a built-in paper-trade simulator. Do not add simulator controls or a simulator engine to this report. The page is read-only and never routes orders.

Every bot challenge starts with a $100 virtual ledger. The Default Diverse strategy must size risk from its virtual ledger, not from the larger Alpaca paper-account balance. The Alpaca account remains visible as the execution sandbox and independent audit trail. Bot-attributed fills will be reconciled into the appropriate virtual ledger; untagged broker activity must never silently change challenge performance. The public report deliberately excludes credentials, account identifiers, client order identifiers and personal details.

## Five report views

1. **Portfolio**: Alpaca paper-account equity/cash and broker history for audit; the header separately shows the Default Diverse $100 virtual challenge equity.
2. **Watchlist**: provider quotes and market history only.
3. **Trades**: the latest 10 fill executions, including partial fills. These are not completed round trips or calculated realized returns.
4. **Orders**: open buy and sell orders with actual quantities, fills, limits and stops.
5. **Positions**: actual open positions, entry prices, market values and unrealized P/L. No planned exits are invented.

Each view has one main report card. Simulator status and strategy-rule panels are removed. Empty trade sections do not show unused table headers.

The report rotates every 12 seconds. Manual view selection, report interaction, settings, and reduced-motion preferences pause rotation. Quote monitoring is controlled separately. Page counts derive from the view list.

## Responsive display

- Desktop uses a large report card and a persistent sponsor column. Report content can scroll when it exceeds the available space; short windows use natural document height.
- Mobile uses natural page/card height, stacked header metrics, a horizontally scrollable five-view navigation, and a single column for report and sponsor cards. No fixed report or sponsor row may squeeze or overlap card contents.
- Mobile watchlists show two symbols per page in full-width cards. Desktop shows up to four in a two-column grid. Chart and timestamp areas have room to remain readable.
- Pause/resume and Next remain visible. Report settings, quote pause/resume, and Refresh now live under Controls.
- A sponsor without configured destinations uses a compact setup card. Configured QR cards keep their real destinations and independent 24-second rotation. Donation and ad checkout pages must already exist. Donation proceeds do not modify the starting amount.
- Display/QR settings and the report day counter are browser-local. Symbol selection is centrally persisted and shared across devices. Starting the counter sets the displayed report day only.

## Near-live market monitor

The public quote endpoint accepts up to 20 stock symbols and 10 USD crypto pairs. It serves public market data only; it does not read a brokerage account or private ledger. Alpaca credentials remain in server-only `ALPACA_API_KEY_ID` and `ALPACA_API_SECRET_KEY` variables.

- Stocks use Alpaca IEX latest quotes and split-adjusted daily charts, requesting 60 calendar days, following pagination, and displaying the latest 30 bars. IEX is a single-exchange feed.
- Crypto uses Kraken public order books and hourly charts, excluding the last incomplete candle. Depth describes Kraken's venue only.
- Quotes refresh every 15 seconds after the preceding request completes while visible. Monitoring pauses while hidden and stops when closed. History loads initially and every five minutes; manual refresh updates both.
- Requests cannot overlap. Total failure preserves previous displayed data and retries after 30, 60, then at most 120 seconds. Invalid symbols and denied feed access stop automatic retries until corrected and manually retried.
- Quote ages and full provider timestamps remain visible. Quotes older than 60 seconds, missing timestamps, or timestamps more than 60 seconds ahead are marked stale. Collection time is separate from quote time.
- Provider calls time out after 10 seconds; browser refreshes after 20 seconds. Partial failures are isolated, including historical-chart failures. Quote-only updates preserve old charts, not missing current quotes.

The reviewed shared list watches all 16 stock/ETF candidates and all three crypto candidates. DIA, MSFT, AMZN, GOOGL, META, PSQ and SOL join as monitored reserves. Initial/reserve labels indicate research priority, not a permanent exclusion from funded pools. Entry/holding-horizon/liquidity/cost/risk criteria must qualify before an order, and filled trades retain their entry-pool attribution. SH and PSQ remain monitor-only with zero inverse allocation. See `PAPER_WATCHLIST_REVIEW.md` and `/paper-trading/research` for data, methodology and selection rationale. The page does not generate trade signals or fabricate fills.

`paper_report_watchlist` has RLS and service-only grants. `/api/paper-trading/watchlist` exposes a schema-validated read-only projection. Every report view shows a compact shared-symbol strip; fresh browsers derive their symbols from the same saved selection. Legacy browser-local symbol overrides are ignored. Global edits are managed centrally, never accepted from anonymous report viewers. Stored changes are checked every minute while visible; failures preserve the last known/published selection with a status message.

## Hosted paper account collection

The Supabase `paper-report-sync` Edge Function polls the fixed Alpaca paper host for account, positions, open/all bot-attributed orders, fills, and market marks. It also owns the privileged PAPER-only reconciliation/exit-management path; the public report itself remains read-only. An authenticated pg_cron heartbeat runs every 30 seconds; an atomic lease prevents overlapping collection and a 20-second cooldown leaves time for provider latency before the next heartbeat. Updates are near-live polling, not a continuous streaming connection. It continues with the Mac and report page closed. Failed collection retains the previous snapshot and retries at the next heartbeat after a one-minute backoff. Partial section failures remain unavailable rather than being reported as empty.

Setup in [CreatorHub Edge Function Secrets](https://supabase.com/dashboard/project/yufptpfiwdbzzrvhkvux/functions/secrets):

| Secret | Value |
| --- | --- |
| `ALPACA_PAPER_API_KEY_ID` | The key ID from the working Mac paper-account test |
| `ALPACA_PAPER_API_SECRET_KEY` | The matching paper secret key |

Save both. The next eligible heartbeat checks them; initial data should appear within about a minute, including report refresh/cache time. Secret changes do not require an Edge Function redeploy. Vercel Preview must also have the server-only `SUPABASE_SECRET_KEY` to read saved report data. Its existing market quote credentials are separate.

State and history tables have RLS enabled and no ordinary-user grants or policies. Only the service role can read/write them. The public `/api/paper-trading/account-report` endpoint validates and projects the fixed report, omitting private state and identifiers. It polls every 15 seconds while visible and caches the projection for five seconds, with five seconds of stale-while-revalidate. Refresh now reads the saved snapshot and refreshes market data; it does not trigger an Alpaca account collection.

The scheduler token is generated within Vault, stored as a hash in private state, and checked before collection. Never expose the `net` or `vault` schemas through the Data API, or print queued HTTP headers or decrypted secrets. Extension-owned pg_net tables can retain default grants despite a best-effort revoke by `postgres`; the live Data API rejects the `net` schema. The collector endpoint returns status only, never account data.

Broker history contains one Alpaca account-equity checkpoint per collected minute, updating that minute’s point on the second collection. This broker history is an audit trail, not a bot equity curve. Separate `paper_bot_ledgers`, `paper_bot_equity_history`, `paper_bot_positions`, and `paper_bot_journal` tables hold isolated challenge accounting. All are RLS-protected and service-role only; `/api/paper-trading/bots` exposes a validated read-only projection. Open orders are capped at the provider’s 500-record response; the UI displays up to 50 orders/positions and indicates additional records. Missing keys produce an explicit setup state.

## Validation

`npm run test:paper` covers public endpoint access, watchlist validation, provider isolation, order-book sorting, pagination, monitoring cadence, visibility changes, retry behavior, quote freshness, fixed paper-host GET-only collection, credential gating, partial failures, empty RPC responses, and public/private projection boundaries. Run a production build and lint changed components. Confirm the report opens without cookies. Visual verification must inspect card spacing on mobile and desktop; deployment build success alone does not verify layout.

## Candidate qualification cards

Each paginated watchlist card has expandable qualification details. All non-inverse candidates, including reserves, show the three possible funded pools as 20% / 40% / 40% allocation ceilings. On a $100 challenge those ceilings are $20 / $40 / $40 of portfolio exposure, not fixed position sizes. Individual positions are sized by planned loss risk. SH and PSQ show no allocation.

Cards distinguish descriptive evidence from trade qualification: quote freshness (existing 60-second display policy), positive/non-crossed quotes, midpoint spread, chart-window close change, and dated historical volatility/drawdown. These checks never authorize orders. Stale stock quotes may reflect a closed market; no market-open inference is made. Invalid, nonfinite and future chart observations are excluded. Recent crypto charts are hourly and stock charts daily; they do not establish intraday entries. Kraken prices need verification against Alpaca at execution.

Entry/stop/target, scoring, risk sizing, portfolio heat, kill-switch, correlation, profit-management, journaling, and adaptive-analysis requirements are specified in `PAPER_DECISION_ENGINE.md`; ordered execution-readiness work is persisted in `PAPER_LIVE_READINESS_PLAN.md`. Versioned scoring, stop/risk drafts, the virtual-ledger schema, journal schema, and read-only bot ledger projection are implemented; order routing remains disabled until attribution, pool-capacity checks, and the remaining execution safeguards are wired and validated. The public report remains read-only; qualification cards do not authorize orders, and no public report control may bypass the privileged paper-only execution path. Opening details pauses report rotation through the existing interaction handler.

Sources: https://docs.alpaca.markets/us/docs/market-data-faq ; https://www.proshares.com/our-etfs/leveraged-and-inverse/sh ; https://www.proshares.com/our-etfs/leveraged-and-inverse/psq
