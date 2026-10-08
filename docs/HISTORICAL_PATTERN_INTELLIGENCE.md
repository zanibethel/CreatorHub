# Historical Pattern Intelligence v1 — CreatorHub

Status: **v1 release candidate: research-only, pending CI and Supabase schema verification.**
Owner approval: 2026-10-08. Supports the shared automated signal product; never changes current strategy/execution gates.
Implementation: src/lib/historical-pattern-intelligence.ts; /api/paper-trading/historical-patterns/run (CRON_SECRET); /api/paper-trading/historical-patterns; /paper-trading/historical-patterns.

## Research hypothesis
Study stocks and USD crypto pairs for historically observed upward moves of +4, +6, +10, +15, and +20% over:
- **same-day:** next completed stock session or UTC crypto day, from next bar open;
- **3-day:** three stock sessions or three crypto calendar days;
- **2-week:** ten stock sessions or fourteen crypto calendar days.

Research must consider both winners and nonwinners, conditions present *before* the proposed entry, and 3/6/12-month baseline behavior.

## v1 implementation and honest limitations
- Source: up to 1240 calendar days of completed Alpaca daily OHLCV bars, SIP split-adjusted stocks (IEX fallback explicitly tagged), daily crypto USD. Capped pagination: fail closed if incomplete.
- Decision point is completed daily bar close. Hypothetical entry is **next completed bar open**, not the prior day's close or the eventual winning price. Data features end on the decision bar.
- Features: prior 1-day, 5-day, 20-day, ~3-month, ~6-month, ~1-year changes; relative volume; 20-session price range, distance from high, and volatility.
- The user-requested **last 24 hours** are represented only as preceding completed daily-bar behavior in this initial pilot. True hour/minute, premarket and first-ignition comparison is a subsequent phase. Do not describe this pilot as minute-level breakout detection.
- Each start-point is labeled against 4–20% target with a **hypothetical 3% stop**; target vs stop within one OHLC candle is **ambiguous, not a win**. These labels are not executable order simulations: no bid/ask, market-hours nuance, fees, intrabar event order, slippage, news timing or fills modeled.
- Walk-forward holdout reserves the final 25% of events for prospective comparison; nearest neighbors exclude events whose outcomes were not already completed at the decision time. Ambiguous samples are excluded from success-rate matching but counted in evidence.
- Historical similarity score is an **independent advisory research index**; not a probability, projected return or entry authorization. Minimum evidence (70 historical eligible examples, 25 matches) is required or the score is null.
- One selected asset per authenticated runner invocation. A bounded daily Vercel cron at 08:15 UTC rotates among AAPL, MSFT, NVDA, QQQ, BTC/USD, ETH/USD, SOL/USD, ADA/USD. Other valid symbols can be requested explicitly. Run remains CRON_SECRET gated.
- Persist each symbol/run summary and 15 horizon×target shadow scores, plus up to 12 recent examples per horizon/target/outcome class. This is a **bounded evidence sample**, not an exhaustive event archive. The full cohort sizes/successes/stops/timeouts/ambiguous counts are stored in summary.
- Database tables are server-only RLS-enabled, with no anon/authenticated access. The public read-only endpoint/page shows aggregated non-sensitive research scores.
- No live money, strategy rules, scoring weights, risk limits, bot routing or simulated order submission is changed by this feature.

## Why study failures
Selecting only historical gainers can produce a large survivorship / selection bias. Every historical decision anchor is labeled, including eventual losers and timeouts. Historical coverage can still be biased to current tickers; delistings, symbol mapping, acquisition gaps, and fees are not yet covered. Do not call validation complete until tested against a point-in-time universe with delisted assets, provider coverage checks, stock split/dividend scenarios, multiple regimes, and strict out-of-sample evidence.

## Data contracts
Tables:
- paper_historical_research_runs: as-of research and cohort summaries, versioned.
- paper_historical_pattern_scores: most recent *shadow-only* horizon/target score and evidence per asset.
- paper_historical_event_samples: bounded labeled historical examples including feature snapshots and outcomes.

### Manual authenticated invocation
GET /api/paper-trading/historical-patterns/run?assetClass=stock&symbol=AAPL
Authorization: Bearer <CRON_SECRET>
For crypto: assetClass=crypto&symbol=BTC%2FUSD.

### Read-only results
GET /api/paper-trading/historical-patterns?assetClass=stock&symbol=AAPL
Dashboard: /paper-trading/historical-patterns

## Release checklist
1. GitHub CI: npm run test:paper, TypeScript, lint and build on the PR. Fix all failures.
2. Compare migration against current Supabase schema and apply once. Verify all three tables, constraints, RLS and service-role grants.
3. Trigger one authenticated run on a liquid stock, then one crypto pair; verify provider paging, sufficient complete history, persisted run/scores/examples and API/dashboard render. Compare counts against local output. Avoid exposing CRON_SECRET.
4. One daily Vercel cron is configured as a bounded research pilot (08:15 UTC), not execution. Verify its first completed run, provider rate allowance and storage.
5. Monitor failures, data age and costs. Do not increase the one-symbol/day limit until several runs are reviewed.
6. Review threshold/score value only after cross-symbol holdout and counterfactual comparisons. Approval required before routing shadow scores into automated bot entry gates.

## Phase 2
- 1-minute/5-minute/1-hour windows, including market session-aware lookbacks, premarket and overnight gaps, and actual **24-hour leading pattern** features.
- Point-in-time universe with delisted stocks and historical corporate actions; crypto pairs with known listing dates/venue quality.
- Full bulk-backed, versioned event evidence (not the bounded samples in v1) and balanced stratified training groups across symbols/sectors/regimes.
- Realistic execution model: spread, slippage, fees, ambiguous high-low sequencing, liquidity, funding constraints, simulated bracket outcomes and R-multiples.
- Walk-forward, nested model selection, holdout months, stable sample sizes and confidence intervals; benchmark against Scanner v3 without historical features.
- Add selected validated shadow features to prospect *display* first, then propose dedicated strategy-specific weighting with explicit version bump and approval.

## Relevant safeguards
See BOT_ROSTER.md, PAPER_PROSPECT_SCANNER.md and AUTOMATED_SIGNAL_PRODUCT_PLAN.md. No scanner discovery is an order; bot revalidation remains authoritative. Never rewrite original decisions or label an ex post high as an entry that was actually available.
