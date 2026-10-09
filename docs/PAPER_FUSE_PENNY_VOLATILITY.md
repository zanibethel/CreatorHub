# Fuse — penny volatility intraday v1 (research only)

- Owner: `penny-volatility-day-100`, codename **Fuse**, broker attribution `pny`
- Strategy: `penny-volatility-day-v1`, version 1, isolated $100 virtual ledger
- Endpoint: `GET /api/paper-trading/bots/fuse-readiness`
- Profile: `/paper-trading/bots/penny-volatility-day-100`
- Scheduler: `*/5 * * * 1-5` (the readiness evaluator independently guards NY regular-session entry times)
- Data: scanner-assigned U.S. stock prospects; fresh Tradier consolidated quotes preferred, otherwise Alpaca IEX quotes; completed regular-session Alpaca IEX five-minute candles only.
- No broker-submitted orders, simulated execution fills, staging, automated exits or official challenge day counter are activated. Counterfactual price-path research is enabled but is not an executed trade.

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

## Research-only counterfactual outcomes (phase 1)

The authenticated five-minute Fuse readiness scheduler now seeds day-scoped, unique
`paper_bot_counterfactuals` studies for genuinely `research-ready` candidates.
It advances those studies on later completed regular-session five-minute bars,
including when a candidate disappears from the scanner's current assignments.
The existing counterfactual engine records ambiguous trigger/stop ordering rather
than assuming a winning intrabar sequence and expires unresolved studies at the
end of the New York session (or on the next cron if one is missed).

Each seeded scenario has `researchOnly=true`, `brokerOrderPlaced=false`, and
`executedTrade=false`. No order submission, broker fill, automated exit, or
virtual-ledger P/L is recorded. Public readiness reads do not create/update
counterfactuals. The first qualifying signal per symbol and New York date is
studied; these studies are hypothetical and must not be mixed into executed P/L.

## Archived research signal catch-up (October 8, 2026)

The five-minute authenticated research job recovers missing counterfactual studies
from **actual stored** `paper_fuse_observations` where the original strategy
decision was `research-ready`, its recorded score/risk gates passed, and the
observation belongs to the current New York trading date. This closes the gap
when a live research signal predates tracker deployment or when a tracking
write failed and the original observation survived.

Replay selects the **first** eligible observation per symbol and NY session,
retains the **original decision time/entry/stop/target** (no current-price
recalibration) and uses the same unique setup key as live shadow tracking.
It loads all current-session regular-hours five-minute bars from early enough
to cover the market open. To avoid artificial hindsight with OHLC candles,
the entire five-minute **decision candle is excluded**, and the original last
observed bar is saved in metadata for provenance. A late-day replay can
understate opportunities that happened in the skipped candle; it must not
be presented as an executed trade or a precise intrabar backtest.

The research-only cron is still distinct from broker execution. It will not
place a PAPER order, change Fuse's disabled execution switch, change its
independent $100 virtual ledger, or start the official challenge counter.
Archived replay is intentionally same-NY-session only; earlier dates require
a separately audited date-scoped backtest pipeline with validated historical
market data, not casual late-day backfilling.

---

## Broker-compatible PAPER bracket preflight (phase 2, read-only)

New read-only preview: `GET /api/paper-trading/bots/fuse-execution-preview`.

It consumes **fresh existing Fuse readiness** and its own virtual ledger, then
checks whole-share `DAY` **limit + broker-hosted bracket** compatibility.
Every projected order is independently resized at the actual broker-tick
limit reference, under both the 0.5%-of-equity planned stop loss and
20%-of-equity cash allocation. Both sizes remain capped by Fuse's original
research signal's planned whole-share quantity.

Preflight refuses stale quotes, non-ready research plans, risk blockers,
chased entry prices, zero whole-share capacity, and unrepresentable
stop/target prices. Alpaca's tick rule is 2 decimals at $1 or above,
4 decimals below $1. A sell stop must be at least $0.01 below both
the entry limit and contemporaneous bid reference, or the projected
bracket is rejected. These are broker constraints, **not relaxed strategy
criteria**. The broker may still reject a plan for account/asset/venue
restrictions that the read-only preview cannot verify.

The endpoint never stages a trade, sends a broker order, changes execution
flags, or alters accounting. `executionEnabled` and `submissionReady`
remain false. The necessary next phase is to build and verify the private
broker asset/market preflight, attributable atomic entry claim, bracket leg
verification, independent protective manager, partial fill/cancel response,
near-close exit, and fill-to-ledger reconciliation. Until then Fuse
remains **research-only**.

---

## Release / validation

1. Ensure production build compiles and all `npm run test:paper` tests pass.
2. Verify the dedicated readiness GET returns 200, `researchOnly=true`, `submissionReady=false`, `executionEnabled=false`.
3. Confirm private Supabase evidence table exists, RLS is enabled and unrestricted anonymous grants are absent.
4. Update only Fuse ledger strategy/version, `status=active`, `metadata.executionEnabled=false`, leaving cash/equity and other bots untouched.
5. Confirm weekday scheduled calls produce evidence only when assigned scanner prospects are fresh.
6. After several real sessions, review refusals, missing winners, MFE/MAE, price-source bias, latency, slippage, partial fills, halts, forced close and price-tier profitability. A later order/execution phase needs a new explicitly approved, independently tested switch and full stop/flatten manager.

**Not yet built:** submission lifecycle, halt-safe close management, calibrated historical model influence or validated profitability. Research-only counterfactual price tracking is implemented, but requires full-session validation. Do not describe `research-ready` as `trade-executable`.
