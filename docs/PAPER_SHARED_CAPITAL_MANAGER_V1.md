# BigOrders — Shared PAPER Capital Manager v1
**Proposed baseline:** October 9, 2026. **Status:** Preview-only; NOT execution-integrated.

## Intent and preservation
- The approved *proposed* consolidated simulation starts with **$5,000 virtual cash**, with separate $1,000 and $10,000 scenarios planned for sensitivity testing.
- Do **not** modify existing eight $100 PAPER bot ledgers or the stored $1,000 reserved-pool plan. Preserve their past orders, fills, P/L and strategy versions, including the unfinished official challenge clock.
- Do **not** take the Alpaca shared PAPER broker's roughly $100k balance as authority to spend more in this simulation.
- No live-money trading, leverage, margin assumption, shorting, or automatic trade submission.
- No automatic reopening, resetting, or release of the existing Fuse/Pulse/Atlas/Harbor physical-symbol reservations. Existing stop/exit safety gates continue to govern those pilots.

## Capital allocation policy (provisional)
`src/lib/paper-shared-capital-manager.ts` is a pure, deterministic policy preview; `src/app/api/paper-trading/bots/shared-capital/preview/route.ts` is an authenticated internal GET/POST evaluation API requiring the existing CRON_SECRET. The endpoint **cannot place an order**, reserve funds or change database state.

| Control | Preview setting |
|---|---:|
| Starting virtual equity | $5,000 |
| Reserved cash | 20% of equity |
| Maximum gross invested | 80% |
| Standard per-trade loss allowance | 0.50% equity |
| Evidence-qualified risk allowance | 0.75% equity, only with >=200 strategy-specific settled historical outcomes and conservative positive EV |
| Total planned open loss | 2% of equity |
| Single ordinary position | 12% of equity |
| Speculative/penny-stock position | 5% of equity |
| Group / correlated theme | 25% of equity |
| Stocks sleeve | 45% of equity |
| Swing sleeve | 20% of equity |
| Crypto sleeve | 15% of equity |
| Maximum active plus pending entries | 8 |
| Daily / weekly suspension threshold | 2% / 4% of period-start equity |
| Minimum *net* reward / loss | 2:1 after estimated round-trip costs |

Sleeves are **ceilings**, not minimum investment requirements. No bot gets automatic preferential capital, and unused capacity stays as cash. Sector/concentration groups must be supplied by an independently validated classification source; missing or invalid data fail closed. Crypto is grouped together by default by the eventual orchestration layer (never invented by this pure module). Cross-bot same-symbol collisions are blocked from broker allocation.

For this version, settled cash (not leveraged buying power) constrains spending; 20% cash reserve and pending-order reservations are deducted. Each exposure includes estimated stop loss to prevent risk overbooking. Stocks/ETFs use whole shares; crypto is calculated at 9-decimal precision. Native fractional stock orders require a separately certified protective-stop execution path before being considered. Stop slippage/gaps remain possible.

## Merit does not equal a high source score
Inputs must be **strategy-qualified**, with executable fresh market data, an eligible session, independently supported exit protection, and a declared nonzero round-trip cost estimate. A nominal return target or high scanner score cannot replace these gates. Commission/fees, spread and slippage assumptions should come from provider-specific observed data; the preview requires them explicitly rather than silently assuming zero.

Only independently observed, settled, strategy-specific historical results may generate calibrated expected value. For >=30 results the preview uses a conservative Wilson win-rate bound; for smaller samples EV remains unknown, with no probability fabricated. The 0.75% proven tier requires >=200 outcomes and expected net R >=0.75. Actual paid spreads, stop outcomes and slippage must be captured and reviewed, not overwritten by backtest results.

## Three outcomes
- `allocatable`: under the *hypothetical* portfolio policy, a properly qualified candidate fits the current snapshot. `brokerOrderAuthorized` remains `false`.
- `shadow-only`: quality gate passed but portfolio exposure, cash, buying power, symbol conflict, position count or loss circuit breaker prevents a real-sized trade. Future shadow tracking must remain isolated from actual broker fills and P/L.
- `rejected`: strategy, quote/session, protection, minimum net reward-risk or sufficiently strong negative historical evidence fails. These should be retained for audit, not promoted by extra cash.

Single-candidate requests are independent and MUST NOT be combined as if cash were reserved. Batch requests rank proposals by conservative strategy-specific expected value (where established), then by net reward/risk, and update a copied snapshot with provisional **in-memory only** cash and risk reservations. Batch output is still advisory: it is not an atomic reservation or an execution grant. Broker writes require a future validated transactional allocator.

## Acceptance work before switching bot executors
1. Create separate durable shared-portfolio ledger, cash-reservation, position-ownership, and decision tables with service-role-only access, RLS and an immutable event trail. The $5,000 allocation must have an explicit baseline and effective timestamp; don't revalue historical $100 trades.
2. Include **all** bot entry pathways (Atlas, Flash, Fuse, Pulse, Spark, Harbor, Orbit, Coil and future bots) in one fail-closed atomic reservation/claim RPC. Establish ownership across broker physical netted stock/crypto symbols; no double funding or double exits.
3. Reconcile current broker fills, open/pending orders, reserved notional, protected quantities and actual cash before each reservation; never rely on a stale read-only preview to execute.
4. Persist qualified-but-unfunded candidates as independently tracked, deduplicated shadow trades. Use later completed market bars and explicitly distinguish assumed fills, partial fills, unfilled limits, price-path ambiguity, real fees and actual broker trades.
5. Provide a per-bot attributable portfolio performance UI and shadow-versus-funded comparison. Run parallel $1k/$5k/$10k simulated portfolios using identical time-stamped signals, including correct settlement/market-hours rules.
6. Test concurrent claims, reservation rollback, partial fills, stale quotes, stop gaps, pending cancels, crypto precision, market closures, cash exhaustion, fractional protection, reboots and out-of-order broker events. Re-run the existing Fuse/Pulse protection regressions unchanged.
7. Independently verify PAPER broker entry, protected exit, fill/journal/ledger reconciliation and zero unowned exposure for every integration; then explicitly approve staged PAPER cutover per bot. No real-money cutover without a separate approval.

**Operational caveat:** The new sizing module is useful for what-if studies today. It is not a live-capital control or an execution permission. Keep the old execution gates in force until the above acceptance evidence exists. Explicitly prevent comparing $100 challenge P/L with $5,000 performance as though they shared one capital base.
