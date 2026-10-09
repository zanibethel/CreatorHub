## Pulse fractional fill/cancel race and shared broker order guard — October 9, 2026

The independently scheduled fractional stop manager now treats an Alpaca
`pending_cancel` or `pending_replace` entry as **still live / unconfirmed**.
It will not size a stop or submit another sell until the parent's final broker
quantity has been verified. When a partially filled entry is canceled, the
manager retrieves the *post-cancellation parent filled quantity* and a fresh
Alpaca physical position, rather than trusting the original pre-cancel
snapshot. This covers extra shares filling during the cancellation window.

Before managing an attributed Pulse stock, and again immediately before
a new protective/flatten sell, the manager checks open Alpaca PAPER orders
for that symbol. Unknown buy/sell orders—even ones belonging to another
bot—block new Pulse actions and require manual reconciliation. Truncated
broker ownership scans also fail closed. If shares are partly reserved and
the complete existing position cannot be protected, the manager declines
to claim a partial stop as sufficient coverage.

Regression cases: extra fills during partial-buy cancel, a foreign PAPER
order on the same physical symbol, reduced `qty_available`, and parent
`pending_cancel` / `pending_replace`. No strategy scoring thresholds,
PAPER balances, pilot claim, official challenge counter or real-money
trading authorization are changed.

**Proof still required:** verify live authenticated cron invocation and one
naturally qualified actual Alpaca PAPER fractional buy, then the venue's
actual independent stop, fill-to-virtual-ledger accounting and subsequent
exit. Tests/mock broker responses alone are not a completed trade.

---

## One-entry Alpaca PAPER fractional pilot

Pulse's fractional route requires three independent conditions *before* a broker buy:
1. Its normal quantitative scanner/readiness checks and unchanged allocation/risk limits must pass.
2. Its separate authenticated manager must return a healthy, open-market PAPER broker status.
3. Supabase RPC `paper_pulse_claim_fractional_pilot` must atomically reserve the one-and-only pilot slot on the Pulse virtual ledger. Only service-role credentials can call this RPC.

The first accepted fractional attempt leaves
`paper_bot_ledgers.metadata.fractionalPilotClientOrderId` persisted, intentionally
blocking all subsequent fractional pilot orders until a manual review and
explicit reset after actual broker reconciliation. A timed-out or rejected
broker attempt may also leave the slot reserved; this is fail-closed by design.
No code path infers that a test passing means a broker fill or stop occurred.

**Pilot activation** requires separately setting
`paper_bot_ledgers.metadata.fractionalExecutionEnabled=true`. The PR does
not do so. Once activated, Pulse's regular live scanner can issue **at most
one** qualifying broker PAPER fractional entry with a max 25% virtual equity
allocation and 0.5% planned loss. It never forces an entry merely to test.

Do not start the official challenge counter as part of this pilot.

---

## Fractional PAPER protective-manager hardening

The five broker-response integration scenarios now explicitly verify:

- One and only one deterministic stop order after a filled fractional entry
- A matching broker-side stop identity, type, loss-limit price and covered share quantity
- A safe failure when the broker reports an incorrect stop (no misleading "protected" claim)
- Cancellation of Pulse's own stop, refetching broker `qty_available`, then one attributed end-of-session flatten
- Emergency flatten after an explicit rejected stop, including retry idempotency
- Ambiguous network-order outcomes never trigger duplicate stop or market sell submissions

For a rejected stop, the local `paper_bot_orders` row is consulted on subsequent cron runs even when Alpaca has no matching stop to retrieve. For pending/ambiguous broker outcomes, the manager surfaces a reconciliation-required state instead of guessing that there is no live sell order.

**Live verification remains open:** integration tests simulate broker responses but do not establish an actual Alpaca PAPER entry/fill/protection record. `paper_bot_ledgers.metadata.fractionalExecutionEnabled` remains OFF until an expressly controlled PAPER trial can verify the venue's real stop behavior and reconciliation. No changes to protected whole-share bracket executions or other bots.

---

## Protected fractional PAPER entry prototype — October 8, 2026

Pulse's existing whole-share broker-hosted bracket behavior remains unchanged.
When the $100 virtual ledger cannot afford a whole share under the original
25% allocation cap and 0.5% risk budget, readiness now records a nine-decimal
`fractionalReferenceQuantity`. That reference is **not** permission to trade.

A separate fractional execution mode has been implemented behind the per-bot
`paper_bot_ledgers.metadata.fractionalExecutionEnabled=true` switch, which
is **OFF by default in production**. It uses a quote-limited DAY order,
revalidates the broker asset's `fractionable` flag, refuses collision with
any existing PAPER broker symbol order or position, and sizes conservatively
against the worst permitted entry tick. A CRON-authenticated independent
minute-level manager handles partial-entry cancellation, deterministic
client-order-ID stop/flatten legs, broker-side stop checks, and flatten-at-close
recovery. It refuses ambiguous broker outcomes instead of submitting doubles.
A fractional DAY stop is separate from the entry and is never described
as bracket/OCO protection. During an order-to-stop gap, its risk is real even
in PAPER testing. The manager must demonstrate protected fills, explicit
failure recovery, close-session behavior and independent virtual-ledger
reconciliation on genuine qualifying setups before the production switch is
enabled. Do not use synthetic or forced fills to make this appear verified.

**Status:** implementation staged with hard fail-closed switch. No historical
Pulse fills or authorizations were invented. No change to price/score/acceleration
rules or portfolio risk caps.

---

# Pulse candidate-handoff audit — 2026-10-08

## Production baseline, before change

- Deployment: `75bdffccda75670a8db21b4577bed63c2fc0cb7e` (`READY`, main).
- Pulse virtual ledger `momentum-breakout-100`: active, equity/cash/buying power $100 each, `executionEnabled=true`, `liveMoneyEnabled=false`, broker tag `pls`.
- Stock prospect snapshot: 1,542 stocks; **1** `review-ready` stock, **0** current Pulse suggestions/assignments. The lone score-80 `PENG` record had last been seen on 2026-10-07 18:50 UTC; therefore stale beyond Pulse's 20-minute maximum and outside an eligible live entry.
- October 8 stock observations through 13:30 UTC: **0** with score >= 80, so there were no evidence-backed current qualifying scanner setups to submit.
- Pulse persisted paper orders, broker orders, broker fills, and counterfactuals: all 0. Five-minute Pulse `system` journal heartbeats were present through 13:25 UTC; production readiness returned HTTP 200, `plans:[]`, `submissionReady:false`, paper-only true.
- This baseline shows a *legitimate lack of fresh qualifying opportunity*, not evidence that a broker fill was missed.

## Confirmed latent handoff bug fixed

Prior readiness requested the **global** top 30 review-ready stocks and only then filtered `assigned_bot_ids` in JS. When many other bots have higher-ranked stocks, an assigned Pulse symbol could be excluded even when fully eligible. Readiness now requests only rows that already contain `momentum-breakout-100` in the Postgres text-array assignment, before its existing score ordering and top-30 limit. An extra in-memory assignment check remains as defense in depth.

The unchanged scanner continues to score and assign prospects; no trading score, risk limit, or execution permission was loosened.

## Audit evidence

Readiness additionally gathers a bounded **80-row sample** of stocks with scanner scores >=65 to classify:
- below scanner/Pulse threshold; scanner disqualification; penny lane;
- stale observation (20-minute limit); scanner-routing mismatch; assignment mismatch; genuinely assigned.

These are **sampled diagnostics**, not entire market universe counts. The regular read-only readiness response returns `handoff`, while CRON-authorized readiness also persists a timestamped `system` journal heartbeat with diagnostic counts for empty queues. No fake candidate decisions, broker orders, or fills are generated. Performance Audit now avoids labeling zero suggestions as a broken handoff, and explicitly distinguishes a suggestion/assignment mismatch.

## Verification checklist

1. CI: Node tests, type check, lint, and Next build.
2. Confirm production deployment references the merged commit; readiness HTTP 200, strategy ID, `paperOnly=true` and a `handoff` object.
3. Verify CRON runs persist actual paper journal heartbeats at their scheduled cadence; inspect handoff reason distribution after the next genuine stock scans.
4. Confirm Pulse remains $100 isolated, no live-money orders, no spurious fills, and no threshold changes.
5. **Do not** force a trade to certify submission. End-to-end actual paper broker submission and protective-order verification remain unproven until a naturally qualifying stock enters the runner; monitor its subsequent order/broker-fill journal evidence.

Production risk controls, separate bots, and scanner scoring are deliberately unchanged.
