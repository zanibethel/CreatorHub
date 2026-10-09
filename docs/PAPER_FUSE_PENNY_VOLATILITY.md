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

## Private broker protection auditor (phase 3, read-only)

The private `GET /api/paper-trading/bots/fuse-bracket-audit` requires
`Authorization: Bearer <CRON_SECRET>` and accesses the Alpaca PAPER
venue only. It reads Fuse's own tagged entry records, all virtual-bot
positions, the broker's positions and open orders, the broker-hosted
parent bracket, and independently fetched stop/target children.

If an attributed entry has filled shares, the auditor demands:
- One verifiable Alpaca DAY-limit `bracket` buy matching the Fuse
  client ID, parent broker order ID and symbol
- Exactly one active broker stop and one active take-profit sell
- Broker stop and target no worse than the stored risk plan
- Both remaining exit quantities matching the broker position
- No extra sell orders or another bot claiming the same physical
  broker symbol
- Exact reconciliation between the broker's physical share holding
  and Fuse's separate virtual ledger, including orphan detection

A malformed parent, rejected/canceled/missing bracket leg, unmatched
holding, duplicate physical symbol claim or orphaned tagged broker
order returns a fail-closed result (HTTP 503 for actionable faults).
The endpoint never creates, cancels or adjusts a broker order and
never mutates Supabase. It reports `protectiveManagementImplemented:
false` so it cannot be mistaken for automated exit control.

**Not yet authorized:** broker order submission, active protection
repair, emergency flattening, opening/closing auction handling,
halt recovery, end-of-day cancellation and exit, broker-fills to
ledger lifecycle and activation. Fuse's PAPER execution flag
remains OFF until those components pass actual PAPER venue tests.

---

## Independent emergency exit manager (phase 4, PAPER only)

The private `GET /api/paper-trading/bots/fuse-manage` runs at most
once per minute on weekdays under `CRON_SECRET`. It is independent of
Fuse's BUY switch; even if entries are disabled, any **independently
attributed and reconciled** leftover PAPER exposure still needs exits.

- Requires the live Alpaca PAPER market clock, the New York regular session,
  exactly one tagged Fuse parent per symbol and matching physical/virtual
  whole-share quantities; refuses symbols owned by another bot.
- The broker-hosted bracket exits remain in place until their risk coverage
  is independently verified or the 3:40 p.m. ET flatten window begins.
- A partially filled/open buy is canceled **first**, before any independent
  sell can be considered. Alpaca may cancel linked OCO children when one
  bracket order is canceled; the manager always waits for fresh broker state.
- If a filled position needs emergency closing or time-based flattening,
  cancel the attributable OCO child first. Never sell in the same invocation
  that requests cancellation. A later invocation independently verifies
  **zero open symbol orders** and an unchanged physical/virtual position.
- The separate broker PAPER market DAY sell has a deterministic child
  `client_order_id`, a locally atomically claimed `prepared → submitted`
  transition, a broker client-order lookup and **no retry after ambiguous
  acceptance**. A 4xx rejection remains terminal for operator review.
- Lack of independent attribution, unexpected partially held shares,
  overlapping bot ownership, unconfirmed cancellations or order outcomes
  result in a fail-closed management report, never an optimistic fill.
- No real-money endpoint exists, no simulated fill is invented, and no
  virtual-ledger P/L is changed by the manager. The existing broker fill
  reconciliation pipeline remains responsible for accounting.

**Limitations:** A market DAY sell may fail due to a halt, insufficient
shares, insufficient time before the close, rejected broker order, or
rapid market moves. There is no guarantee of a position being flat by 4 p.m.
The manager cannot safely infer ownership when broker and virtual ledgers
disagree; those cases require manual reconciliation. Full end-to-end
verification of broker lifecycle, partial fills and accounting remains
a prerequisite to changing Fuse's BUY execution switch from OFF.

---

## One-entry guarded PAPER execution pilot (phase 5)

**Built but DISARMED:** The independent five-minute `GET /api/paper-trading/bots/fuse-run`
and private `POST /api/paper-trading/bots/fuse-execute` use the existing
Supabase bot ledger. There are **two separate consent switches**:
`metadata.executionEnabled=true` and `metadata.fusePilotEnabled=true`.
Both are currently **OFF**; their absence/false value does not authorize an entry.

When armed, Fuse selects only a fresh `research-ready` scanner observation
whose live broker-compatible preview passes the original score, momentum,
quote, spread, completed bars, trading-session and cash/risk gates. It
revalidates its $100 virtual account, checks that the Alpaca PAPER asset is
active and tradable, the broker clock is open, and the shared physical
PAPER account has no order/position collision in that symbol. It also
requires a healthy independent `fuse-manage` before placing any risk.

A privileged SQL function `paper_fuse_claim_pilot_entry` obtains a
row lock on the Fuse ledger, validates broker tick size, whole-share
quantity, total notional no more than 20% of Fuse equity, and planned
stop loss no more than 0.5% equity. It atomically stages one tagged
`chb-pny-v1-...` paper order and records the permanently single-use
`fusePilotClientOrderId`. Concurrent/ambiguous invocations cannot
claim a second permit. The function is **service_role-only**.

Only after that reservation does the executor submit one `DAY`
whole-share `limit` buy with Alpaca's hosted `bracket` stop and target
to `https://paper-api.alpaca.markets/v2`. A network timeout,
rejection, mismatched order identity, missing bracket legs, or database
failure consumes the permit and requires manual inspection; there is
**no retry** that might duplicate a broker position. The response
distinguishes accepted, filled, and broker-protected states and never
calls mere order acceptance protective stop verification.

The existing centralized `paper_bot_reconcile_broker_activity` and
`paper_bot_apply_unapplied_fills` functions use the canonical PNY
client order attribution and bracket parent mapping for fill-to-ledger
accounting; this still requires an actual Alpaca PAPER end-to-end fill
test before broader automation. The minute independent Fuse exit
manager is active regardless of the entry switches.

**Release guard:** do not set both flags TRUE or reset
`fusePilotClientOrderId` until the migration, runner, PAPER broker
preflight, protective manager, attribution, and shadow evidence are
verified; the official challenge counter stays stopped.
No live-money execution endpoint exists.

---

## Shared PAPER venue collision hardening

Fuse's one-shot PAPER pilot now checks for competing stock ownership at
**three separate levels**:

1. Before reservation, the entry endpoint reads all known virtual positions
   and live Alpaca PAPER positions/open orders for the candidate symbol.
2. During the privileged Supabase reservation, the database transaction
   refuses other bots' **virtual positions** or outstanding
   prepared/submitted/partially filled buys and sells on the same symbol,
   plus very recent fills awaiting ledger reconciliation. Its own
   per-symbol advisory lock serializes Fuse claims.
3. After Fuse's pilot has been irreversibly reserved but **before** its
   single broker POST, it refreshes live PAPER broker orders and positions.
   Incomplete reads, provider errors or a new competitor mean NO buy:
   the pilot is consumed and must not be automatically retried.

**Scope limitation:** Other bots currently use different reservation
protocols; Fuse's advisory lock does not force those strategies to
participate. A unified *venue-wide* reservation ledger shared by every
bot would close that last cross-bot race. Broker state is independently
checked again immediately before each Fuse submission.

These checks do not enable live-money execution, change risk thresholds,
reset a pilot claim, or advance the official challenge counter.

---

## Release / validation

1. Ensure production build compiles and all `npm run test:paper` tests pass.
2. Verify the dedicated readiness GET returns 200, `researchOnly=true`, `submissionReady=false`, `executionEnabled=false`.
3. Confirm private Supabase evidence table exists, RLS is enabled and unrestricted anonymous grants are absent.
4. Update only Fuse ledger strategy/version, `status=active`, `metadata.executionEnabled=false`, leaving cash/equity and other bots untouched.
5. Confirm weekday scheduled calls produce evidence only when assigned scanner prospects are fresh.
6. After several real sessions, review refusals, missing winners, MFE/MAE, price-source bias, latency, slippage, partial fills, halts, forced close and price-tier profitability. A later order/execution phase needs a new explicitly approved, independently tested switch and full stop/flatten manager.

**Not yet built:** submission lifecycle, halt-safe close management, calibrated historical model influence or validated profitability. Research-only counterfactual price tracking is implemented, but requires full-session validation. Do not describe `research-ready` as `trade-executable`.
