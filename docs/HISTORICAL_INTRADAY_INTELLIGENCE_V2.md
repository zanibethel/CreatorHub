# Historical Pattern Intelligence v2 — Hourly Pre-Move Research

Status: owner-approved October 8, 2026; **shadow research**, not an automated trading signal.

## Implementation
- Universe: \`src/lib/historical-research-universe.ts\` merges \`DEFAULT_PAPER_WATCHLIST\`, additional stock/penny/crypto symbols and the 20 latest \`paper_prospects\` discoveries. All symbols are validated and deduplicated. **This is not a survivorship-bias-free historical universe.** Delisted stocks, venue histories and symbol change evidence are still absent.
- Core: \`src/lib/historical-intraday-intelligence.ts\` evaluates only hourly candles completed before the point-in-time decision. It creates 4/6/10/15/20% hypothetical target outcomes with a 3% hypothetical stop across next **24 clock hours, 72 clock hours, and 14 calendar days**. Stock overnight/weekend gaps are not filled; count actual observed hourly bars.
- Historical anchors: every fourth *observed* hourly close, to limit overlapping samples. A hypothetical entry occurs at the **next observed bar's opening price**. A same-candle hit of both target and stop is \`ambiguous\`, never a proven win. Full requested holding horizon must be observed before labeling any anchor, though stop/target can end early.
- Lead-up: last 1h/6h/24h returns, prior vs preceding-24h observed-hour average volume, 24h volatility/range/high distance, actual observed-hour coverage and overnight gap. The preceding daily context uses **only dates earlier than the hourly observation's UTC date**; conservative by design.
- Minute detail: completed 5-minute candles yield most recent 15m and 60m moves and relative hourly volume with coverage flags, **as research metadata only**. No historical minute-neighbor training in v2. When 5-minute data are insufficient, show incomplete instead of inventing zero.
- Historical datasets per requested asset: ~535 calendar days of daily bars, ~105 calendar days of hourly bars, ~3 calendar days of five-minute bars; SIP split-adjusted stock source with explicit IEX fallback, and Alpaca crypto/us pairs. API pagination must finish or the study fails closed. Actual data entitlements, bar coverage and symbol lifetime can be shorter.
- Shadow match: normalized nearest historical matches by chosen asset/target/horizon; only outcomes that **ended before the decision** can count. Research score 0–100 is a relative rate-vs-baseline index, not a return or a success probability. At least 60 past nonambiguous anchors and 25 matches are needed. No risk/entry/order privileges.
- Persistence: \`paper_intraday_research_runs\`, \`paper_intraday_pattern_scores\` and sampled \`paper_intraday_event_samples\`. These are RLS-enabled and service-role-only (no browser writes).
- API:
  - \`GET /api/paper-trading/historical-patterns/intraday/run\` (CRON_SECRET; optional query \`assetClass=stock&symbol=NVDA\`)
  - \`GET /api/paper-trading/historical-patterns/intraday\` (read-only)
  - \`GET /paper-trading/historical-patterns\` (hourly + daily cards).
- Bounded cron rotation: existing daily long-run study at \`15 */4 * * *\` UTC, new hourly+5-minute study at \`45 */4 * * *\` UTC. At most one symbol per invocation; no full-universe fan-out. Never pass or log Alpaca or Supabase secrets client-side.

## Known limits and next validations
1. Need actual provider smoke tests on **one stock and one crypto pair**, with every dataset pagination and persisted counts verified; fail closed for provider gaps.
2. Native one-minute historical features and real-time minute-by-minute early-signal timelines are *not implemented*. The current 5-minute micro snapshot is separate. The 105-day hourly pilot cannot prove robustness across many market regimes or 1-year intraday events.
3. Historical anchor outcomes overlap, so hundreds of observations are not independent trades. A 3% hypothetical stop omits spread, slippage, fees, simultaneous high/low sequencing, order types and liquidity. Do not interpret any computed hit rate as net trading performance.
4. To compare against Scanner v3's actual **earliness**, retain UTC observation and original scanner first-seen/readiness timestamps and collect future counterfactual outcomes. No retrospective "model alerted early" claims based only on ex-post labels.
5. Build actual model validation with prospective shadow signal snapshots, untouched out-of-sample months, coverage and confidence intervals, delisted asset histories, survivorship controls, stratified penny/large-cap/crypto cohorts and multiple providers. Never silently promote similarity scores into execution signals.
6. Optional local AI can interpret the **completed quantitative research** and draft hypotheses, never fabricate prices/execute orders. No local-node availability prerequisite in v2.

## Controls
Preserve \`docs/AUTOMATED_SIGNAL_PRODUCT_PLAN.md\`, \`docs/PAPER_PROSPECT_SCANNER.md\` and \`docs/BOT_ROSTER.md\`. Zero alteration to current scanner v3 ranking, bot review gates, strategies, budgets, simulated orders, or live money permissions. Promotion requires separately approved versioned strategy rules plus out-of-sample comparison.
