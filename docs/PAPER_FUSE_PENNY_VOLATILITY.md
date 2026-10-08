# Fuse — penny volatility intraday v1 (research only)

- Owner: `penny-volatility-day-100`, codename **Fuse**, broker attribution `pny`
- Strategy: `penny-volatility-day-v1`, version 1, isolated $100 virtual ledger
- Endpoint: `GET /api/paper-trading/bots/fuse-readiness`
- Profile: `/paper-trading/bots/penny-volatility-day-100`
- Scheduler: `*/5 * * * 1-5` (the readiness evaluator independently guards NY regular-session entry times)
- Data: scanner-assigned U.S. stock prospects; fresh Tradier consolidated quotes preferred, otherwise Alpaca IEX quotes; completed regular-session Alpaca IEX five-minute candles only.
- No real orders, simulated orders, staging, fills, live brokerage API submission, automated exits or official challenge day counter are activated.

## Independent v1 research gates

| Gate | Initial rule |
|---|---|
| Universe | $0.08 through $5.00, inclusive |
| Source provenance | Scanner v3+ Fuse assignment updated in last 20 min |
| Quote age | 90 s max; two-sided quote required |
| Spread | <=1.5% above $1; <=2.0% below $1 (reference; tighten after evidence) |
| Candle data | >=8 completed five-minute regular-session candles, newest <=12 min lag |
| Observed dollar liquidity | >=$25k summed over most recent six 5m bars |
| Relative 5m volume | latest bar >=1.5x preceding six bars |
| Fast momentum | 0.4%-4.5% over prior three five-minute bars |
| Breakout | live mid at or above previous four completed-bar highs +0.1%; chase <=1.25% above trigger |
| Volatility | recent range proxy 0.3%-6%; ATR-derived stop floor/ceiling 1%-5% |
| Session exhaustion | refuse if session gain >12%; refuse new entries near close |
| Position size | whole shares only, <=20% equity allocated and <=0.5% equity planned loss |
| Risk circuit breaker | >=1.5% daily realized loss, >=1% existing open risk, >0 prior holdings, >=3 daily entries, duplicate orders |

**Limitations:** exchange halts, market holidays, microstructure, NBBO, splits, corporate actions, borrow flags, slippage and true available liquidity are not fully modeled by this free/partial venue data. Those unknowns are blockers to automatic simulated execution, not permission to assume ideal fills. A hard exit at market close cannot be guaranteed during a halt, so there is no submission path yet.

## Score and storage

Score is **Fuse-specific**: 10 scanner provenance, 25 volume ignition, 20 fast momentum, 20 breakout structure, 15 liquidity, 10 volatility. Scanner score is only a capped feature, not Fuse's decision.

Every authenticated scheduled evaluation inserts at most one row per symbol/5-minute UTC bucket into `paper_fuse_observations`, with quote/bar timestamps, score, raw inputs, proposed risk plan, blockers, and waiting reasons. Deduplication uses the composite PK; new rows are copied to `paper_bot_journal` for existing Signal Desk, with refusal recorded explicitly. Public GET queries never journal. Duplicate scheduler invocations do not resubmit the same event. Future historical-pattern/market-mover evidence is shown as **shadow-only**, with no risk-gate bypass.

## Release / validation

1. Ensure production build compiles and all `npm run test:paper` tests pass.
2. Verify the dedicated readiness GET returns 200, `researchOnly=true`, `submissionReady=false`, `executionEnabled=false`.
3. Confirm private Supabase evidence table exists, RLS is enabled and unrestricted anonymous grants are absent.
4. Update only Fuse ledger strategy/version, `status=active`, `metadata.executionEnabled=false`, leaving cash/equity and other bots untouched.
5. Confirm weekday scheduled calls produce evidence only when assigned scanner prospects are fresh.
6. After several real sessions, review refusals, missing winners, MFE/MAE, price-source bias, latency, slippage, partial fills, halts, forced close and price-tier profitability. A later order/execution phase needs a new explicitly approved, independently tested switch and full stop/flatten manager.

**Not yet built:** submission lifecycle, halt-safe close management, counterfactual price tracking, calibrated historical model influence or validated profitability. Do not describe `research-ready` as `trade-executable`.
