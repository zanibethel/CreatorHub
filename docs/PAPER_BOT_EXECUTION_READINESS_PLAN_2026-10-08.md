# BigOrders — PAPER bot execution readiness and verification plan

**Reviewed:** October 8, 2026 (Central time; some database timestamps are October 9 UTC)
**Status:** Persistent working checklist for the pre-start PAPER test period.
**Source of truth:** Live PAPER broker evidence + Supabase ledgers/orders/fills/journal + deployment/scheduler results. This document supersedes earlier October 8 status snapshots when they differ. Screenshot observations are historical, not fresh verification.

## Ground rules

- **PAPER ONLY** using Alpaca's paper endpoint. Never introduce live-money credentials or live order execution without a separate, explicit future approval.
- Keep each bot's independent $100 **virtual** accounting separate; physical broker buying power is **not** the bot's spending allowance.
- Allow only strategy-qualified PAPER trades subject to validated risk, data, market hours and protection. Never force an entry, loosen thresholds to obtain a fill, fabricate a fill, or count counterfactuals as real P/L.
- Keep the official challenge start/day counter **unstarted** until explicitly requested. Research and pre-start PAPER tests do not start the challenge.
- Preserve all scanner history, rejection reasons, model versions, submitted/canceled orders and position outcomes for later strategy evaluation.
- **Implemented ≠ live-verified.** A route, passing tests or HTTP 200 cannot prove that the real broker protection/fill/accounting lifecycle succeeded.

## Current five-bot picture

| Bot | Observed state | Work remaining | Acceptance evidence |
|---|---|---|---|
| **Pulse** (`momentum-breakout-100`) | $100 isolated ledger; execution and fractional pilot flags enabled; no pilot client order claim. One SQQQ fractional bracket attempt was rejected before any broker order (`fractional orders must be simple orders`); no confirmed fill. | **P0**: run fractional DAY-limit entry as a **simple** Alpaca order; ensure the independent stop manager can react to **partial/full fills**, verify active stop quantity/price at the broker, halt new entry if any unprotected shares remain, handle canceled/rejected stops and closing/reconciliation. Never treat a rejected bracket as a fill. | One naturally qualified fractional PAPER entry, confirmed broker fill and protective stop, then attributable safe exit and exact virtual-ledger reconciliation; no duplicated or unprotected holdings. |
| **Fuse** (`penny-volatility-day-100`) | $100 isolated ledger; dual-flagged **one-shot PAPER pilot armed**; no Fuse order, position or pilot claim. Research-only shadow studies recorded for MSTZ/HTZ/NVD. Readiness and runner every 5 minutes weekdays; exit manager every minute weekdays. One-entry SQL reservation and shared-symbol collision checks deployed through PRs #74–#80. | **P0**: verify authenticated real production cron invocations; test partial fills, pending parent cancel, broker-hosted child stop/target activation, lost/canceled protection, rejected order, halt/unavailable market, close-window exit, uncertain broker responses, and fill-to-ledger attribution. Do **not** authorize a second entry until first complete pilot passes. | A naturally selected full PAPER trade whose entry, broker order, partial/full fill state, stop/target, exit, closing journal and $100 virtual P/L all reconcile; evidence that protection failures fail closed. |
| **Atlas** (`default-diverse`) | Scanner observation and candidate journals actively recording; earlier completed SOL/USD PAPER trade/ledger P/L exists. | **P1**: improve **fresh usable quote coverage** without spoofing prices or weakening risk filters; confirm current scanner-to-strategy selection and a **fully authorized v4** order/fill/protection/exit, not just a scanner signal or older strategy trade. | Trace `scanner observation → candidate evaluation → v4 authorization → tagged PAPER order → actual fill → protection → journal/ledger close`, with timestamps and rejection evidence when not eligible. |
| **Flash** (`weekend-crypto-day-100`) | Active 24/7 candidate/rejection evidence and 26 completed counterfactual studies; no confirmed bot order/fill. | **P1**: continue labeled missed-opportunity analysis: compare rejected setups to later +R/-R outcomes, transaction costs and strategy regime. Audit whether quote/freshness, ownership and risk gates are operating as intended. **Do not optimize by silently relaxing rules**. | Repeatable dated cohort report that separates hypothetical opportunities, justified rejects, false negatives and **actual PAPER** trades; version and approve any proposed strategy revisions separately. |
| **Spark** (`crypto-ignition-100`) | PAPER order/fill and closed-trade evidence present; existing protected SOL exposure observed during the preceding production check. | **P2 / monitor**: maintain stop/order-to-position coverage, shared-venue ownership checks, fee reconciliation and exit manager. Verify the existing position eventually closes without stray protection or misattributed accounting; investigate any broker/ledger divergence. | Broker-attributed protective order/position quantity and price confirmed, followed by closed-trade fee and P/L reconciliation against Spark alone. |

**Other existing bots:** Harbor (three-trade weekly swing), Orbit (crypto swing) and Coil (squeeze breakout) remain in the separate eight-bot coverage audit. Do not mistake this five-bot priority queue for approval to disable or regress their schedules. Recheck their execution status independently before broader pre-start certification.

### Pulse implementation update — October 9, 2026

The independent fractional-stop manager has now been hardened for additional
fills during partial-entry cancellation, `pending_cancel` /
`pending_replace` broker parent states, foreign PAPER orders on the same
physical symbol and undercovered available share quantities. Tests require
refreshing the final broker fill count and position before sizing a stop;
unresolved cancellation reports an actionable failure rather than healthy
protection. **This fixes code-level failure cases, not the still-outstanding
real Alpaca PAPER fill/stop/exit proof.** Do not mark G2, G3 or G7 as fully
complete until that live broker evidence has been archived.

---

## Phase 1 — Shared stock-symbol reservation (October 9, 2026)

The shared Alpaca PAPER venue nets physical shares by symbol, even when
CreatorHub bots keep separate virtual $100 ledgers. The first common
reservation protocol is **limited to Pulse and Fuse**, the two armed
one-entry stock PAPER pilots:

- A service-role-only `paper_stock_symbol_claim` function atomically takes
  the same transaction-scoped PostgreSQL advisory lock for a candidate
  symbol, checks for existing PAPER virtual positions and unresolved stock
  orders, and creates one **durable, uniquely keyed active reservation**
  recording bot, client order ID and physical stock symbol.
- Both existing Pulse and Fuse pilot RPCs acquire this reservation **in
  their existing atomic ledger-locked transaction** before giving approval
  to submit a PAPER buy. Failure consumes **neither** permit and sends
  **no** broker order.
- This reservation does **not expire automatically** and there is no
  public or automatic release RPC. A broker timeout, stop, canceled entry
  or unknown fill cannot silently make the stock available to another
  bot. A documented manual broker/virtual-ledger reconciliation is
  required before implementing explicit release.
- This is additive to current Alpaca open-order/position checks and all
  current bot-specific risk, stop, score and quote requirements. It changes
  no execution switch, stop/target price, bot cash allocation or official
  challenge counter.

**Important scope limitation:** Atlas, Harbor, Coil and any other bots
must join this exact venue-wide protocol before G1 can be checked off.
They can still trade outside this table at present; the reservation
provides mutual exclusion **between Pulse and Fuse only**. Until all
stock bots participate, broker live collision checks and manual
monitoring remain necessary. Do not describe this as a fully completed
cross-bot venue lock.

**Acceptance follow-up:** Confirm production SQL migration and restricted
permissions, demonstrate that two valid Pilot claim transactions for the
same symbol cannot both succeed (in a rolled-back test), then integrate
other stock executors carefully without loosening existing risk gates.
An actual PAPER trade and eventual documented release are independent
open gates.

---

## Phase 2 — Atlas and Harbor join the shared STOCK symbol lock (October 9, 2026)

The common Supabase `paper_stock_symbol_claim` service-role-only function
now admits **Pulse, Fuse, Atlas and Harbor** as participants. All four
use one durable uniqueness constraint on the active physical PAPER stock
symbol, and stock entries reserve that symbol before their broker POST.

- **Atlas:** the existing `paper_atlas_bind_order` RPC reserves a stock
  symbol in the same transaction as binding the funded Atlas order.
  Its **crypto** binding remains separately supported and unaffected.
  The Atlas stock runner additionally verifies its active reservation
  and checks current broker positions/open orders before both an initial
  and a resumed PAPER stock buy.
- **Harbor:** newly prepared prospect buys use canonical `chb-sw3`
  attribution IDs. Its executor now uses service-role-only
  `paper_swing_claim_prepared_with_symbol` to atomically claim the
  prepared order and physical symbol. It rechecks Alpaca PAPER open
  orders and positions after the claim, before any bracket entry POST.
  Historical staged IDs and past orders are not rewritten.
- **Pulse/Fuse:** current atomic one-shot pilot claims are unchanged;
  they participate in the same unique active-stock-symbol reservation.

**Conservative behavior:** a broker timeout or ambiguous submission
leaves the physical symbol reserved even if the bot-specific order/pool
record is released. There is **no automated reservation release** yet.
This avoids accidental re-use of potentially unprotected shares, but
manual review is needed before later stock entries in the same symbol.

**Remaining for G1:** integrate Coil and any additional independent stock
entry routes; implement a strictly evidenced release workflow after broker
and separate virtual bot ledger agree on zero remaining exposure; then
complete a real PAPER multi-bot collision and reconciliation audit.
Passing mock tests and a database uniqueness constraint do not prove
every execution route is covered or all cron jobs have run successfully.

This phase changes no trading thresholds, $100 virtual allocations,
execution flag or challenge start counter; it never enables live-money
trading.

---

## Phase 3 — Coil readiness and broker-evidenced stock reservation release (Oct 9, 2026)

- **Coil** (`squeeze-breakout-100`, tag `sqz`) has a research/readiness
  endpoint and a **disabled** PAPER execution switch. There is **no stock
  purchase executor** to integrate yet. The shared stock symbol admission
  function recognizes Coil's bot/tag, but explicitly rejects Coil claims
  while its execution flag is OFF. Any future Coil executor MUST claim the
  shared stock lock atomically as part of its strategy-authorized entry and
  include independent Alpaca broker checks before a buy.
- **Read-only release audit:** private
  `GET /api/paper-trading/bots/stock-reservation-release?reservation_id=...`
  requires `CRON_SECRET`. It compares the particular reservation to the
  original local order, other bot orders/positions and independent Alpaca
  PAPER parent/open orders/physical positions. It is not a scheduled job.
- **Manual release only:** a matching POST to that private endpoint requires
  **both** `CRON_SECRET` and a separate `PAPER_STOCK_RELEASE_TOKEN` of at
  least 32 characters, plus the exact reservation ID, client order ID and
  explicit confirmation. **This separate token is intentionally NOT
  configured in production**, so no release can be performed yet.
- A privileged `paper_stock_symbol_release_verified` transaction rechecks
  reservation ownership, exact symbol identity, local terminal-order state,
  zero stock positions across ALL virtual bots, absence of pending orders
  across all bots, NO unapplied PAPER broker fills and a successful report
  sync within two minutes. It requires fresh broker-evidence parameters,
  takes the same shared per-symbol lock as entry, and writes an immutable
  audit row in the same transaction as the release.
- A release is refused while Alpaca is OPEN, when broker share/order
  enumeration is truncated/uncertain, when the original order is unresolved,
  or when its local/accounting evidence is stale. The release tool does not
  cancel or submit any order. It is deliberately NOT called by the cron.
- **Remaining limitation:** live broker state and Supabase cannot be made
  one global atomic transaction. The endpoint is therefore strictly
  operator-gated, and a verified review is still needed for first release;
  no automatic recycling or strategy-threshold changes are permitted.

**Release signoff still missing:** a realistic end-to-end PAPER trade,
operator token provisioning only after explicit approval, first supervised
release with broker/fill proof, and future Coil execution integration
(without altering its current disabled switch). Do not count a passing mock
test or code deployment as a completed broker release.

---

## Phase 4 — Persistent runner and protection-manager health (October 9, 2026)

The application now writes sanitized, non-trading operational heartbeats to
`paper_bot_cron_health` for six existing CRON_SECRET-protected stock jobs:

| Bot | Runner | Cadence | Risk/stop manager | Cadence |
|---|---|---|---|---|
| Pulse | `pulse-run` | every 5 minutes weekdays | `pulse-manage` | every minute weekdays |
| Fuse | `fuse-run` | every 5 minutes weekdays | `fuse-manage` | every minute weekdays |
| Atlas | `atlas-run` | every minute weekdays | Existing strategy protection | Separate audit |
| Harbor | `harbor-run` | every 5 minutes weekdays | Broker bracket protection | Separate audit |

Each completion records the job identity, bot, observed response status,
safe action code, execution time, latest success/failure and consecutive
failures. A `vercel-cron/` user agent is recorded as *informational source
evidence* alongside the protected token; the user agent alone is not proof
of Vercel identity. Unauthorized requests do not write records.

The heartbeat is deliberately additive: a failed telemetry write **never
retries an execution** or changes the broker result, risk policy, order,
virtual balance or trading permissions. The recorder function and table
are service-role-only. Failure details are reduced to HTTP code so broker
errors/secrets are not persisted.

**G0 remains pending** until live post-deployment heartbeats show each
scheduled route actually completed using Vercel cron, with acceptable
durations and no uninvestigated failure state. Fresh candidate journals
alone are not evidence that the protective manager ran. There is no
new trade task, no forced purchase and no challenge counter start.

---

## Scheduler evidence and targeted repair — October 9, 2026

Production heartbeat monitoring captured six distinct Vercel cron jobs.
Atlas, Pulse runner, Pulse stop manager, and Fuse exit manager returned
HTTP 200. Fuse's entry runner repeatedly returned HTTP 503; Harbor's
runner repeatedly returned HTTP 502 at intake, **without broker buys**.
This proves scheduler invocation but **does not** complete all G0 checks.

Patch: Fuse now calls its read-only execution preview and guarded
executor through the stable `creatorhub-gray.vercel.app` public alias,
not the incoming deployment-specific request URL. Harbor's prospect
intake emits an allowlisted dependency stage on failure
(`prerequisites`, `quotes`, `daily-bars`,
`evaluation-and-staging`, `journaling`). The Harbor scheduler
records that stage as an operational health action without putting
raw broker errors or secrets in the telemetry table.

**Still open:** observe the next deployed Fuse/Harbor cron cycles
and confirm genuine HTTP 200 before checking G0. Do not force a buy,
weaken selection rules or reset either one-entry pilot merely to make
the scheduler test green.

---

## Harbor actual PAPER intake journal repair — October 9, 2026

Production authenticated Vercel cron evidence exposed an invalid journal
insert **after** Harbor completed prospect evaluation. Harbor had used
`event_type='prospect-intake'` and qualification values such as
`staged`, `eligible`, `deferred`, and `rejected` that conflict with
`paper_bot_journal` CHECK constraints.

New intake journal normalization stores `candidate`/`rejected` events,
and `qualified`/`watch`/`unqualified` qualifications. The complete
original intake disposition remains available as
`metadata.intakeDisposition` so research can distinguish staged,
deferred, eligible and rejected signals. **No orders are manufactured or
risk gates weakened**; submission remains controlled by Harbor's existing
broker-checked guarded executor.

G0 for Harbor can be signed off only when a **post-deployment** authenticated
cron heartbeat records HTTP 200. A passing test or successful deployment
alone does not prove its live journal write.

---

## Observed stock-bot scheduler signoff — October 9, 2026, 13:50 UTC

**PROVEN for the six instrumented stock jobs:** actual Supabase
`paper_bot_cron_health` records from the `vercel-cron-agent` source
confirmed fresh HTTP 200 responses and **zero consecutive failures** from:

| Job | Last observed UTC | Status | Action |
|---|---|---|---|
| Atlas runner | 13:49:39 | 200 | none |
| Fuse runner | 13:50:03 | 200 | none |
| Fuse independent exit manager | 13:50:00 | 200 | completed |
| Harbor runner | 13:50:06 | 200 | none |
| Pulse runner | 13:45:45 | 200 | none |
| Pulse independent stop manager | 13:50:02 | 200 | completed |

The first monitoring deployment exposed two **real** cron failures:
Fuse 503 due to deployment-host-dependent internal requests and Harbor
502 due to incompatible prospect journal classifications. PRs
[#89](https://github.com/zanibethel/CreatorHub/pull/89) and
[#90](https://github.com/zanibethel/CreatorHub/pull/90) fixed those
problems. Post-deployment Harbor intake successfully persisted
`rejected/unqualified` records with the original
`metadata.intakeDisposition='rejected'`.

**Scope of this signoff:** authenticated job invocation/completion for
the six monitored stock jobs, not proof that any strategy successfully
placed and protected a position. **Global G0 is not fully complete**:
separately verify Flash/Spark and other crypto/stock jobs not yet
instrumented. Older historical job failures remain in total counters but
all six latest consecutive-failure counters were zero at this check.

**No forced buy, no stock reservation, no change to PAPER permissions
or official challenge counter.** Complete G2-G7 with one genuine PAPER
entry/fill/verified stop/exit/virtual-ledger reconciliation before
increasing pilot order frequency.

---

## Independent PAPER broker reconciliation — October 9, 2026, 14:02 UTC

**Evidence scope:** directly inspected Alpaca PAPER order, position and fill-activity
responses, then independently queried production Supabase ledger, journal,
broker-order, broker-fill, virtual-position and stock-reservation tables. This
snapshot is not a future-state guarantee and is **not** a live-money check.

- **Broker / virtual exposure:** Alpaca reported **zero open orders and zero
  open positions**; Supabase `paper_bot_positions` contained **zero virtual
  positions**. The shared `paper_stock_symbol_reservations` table was empty.
  There was no reason to invoke or enable the manual release path.
- **Broker fill ingestion:** all eight entries in
  `paper_bot_broker_fills` had non-NULL `ledger_applied_at` (zero unapplied
  fills). This table records the attributed strategy trades and does not
  substitute for Alpaca's complete account-wide fill/activity enumeration.
- **Spark `spk` SOL/USD — actual PAPER protective-stop close:** Alpaca confirmed
  original limit **buy** order
  `474d458c-c15d-43bf-aeaa-963fa7bd32a0` filled
  `0.159903793` at `$109.55` on 2026-10-09 00:55:21 UTC.
  A separate protective sell order was placed and later canceled as the
  protection was updated. Its replacement, stop-limit **sell** order
  `c26be0ec-83fc-4db4-b12a-d3dd396f46a6`, filled
  `0.159504033` at `$109.785` on 2026-10-09 13:32:56 UTC.
  Supabase independently matched the broker order ID and full fill, recorded
  `closed` / `protective-stop` in the strategy journal and applied
  `-$0.050088` of net realized P/L at 13:33:13 UTC. This was a real
  **PAPER fill**, not merely an accepted stop or counterfactual.
  The broker currently reports no remaining SOL/USD exposure or open
  protective orders. The buy/sell quantities differ because crypto execution
  quantity and fees must be accounted for; do **not** compare price changes
  alone to determine net profit.
- **Spark overall:** `crypto-ignition-100` broker-tag `spk` virtual ledger:
  starting cash `$100`, current equity `$99.668301`, realized P/L
  `-$0.331669`, unrealized P/L `$0`; last ledger sync 14:02:17 UTC.
  Its observed broker-linked BTC/USD and two SOL/USD lifecycles were closed.
- **Atlas `div`:** `default-diverse` virtual equity `$99.755227`,
  realized P/L `-$0.244772`, no active virtual/broker exposure.
  Separate 2026-10-08 F/SPY orders with `atlas-probe-` client IDs are
  controlled broker probes, **not evidence of an automatically qualified
  Atlas stock-strategy trade**.
- **Pulse `pls` and Fuse `pny`:** no newly confirmed broker fills,
  zero virtual exposure, independent ledgers each remain `$100`.
  Pulse's existing SQQQ rejected local order has no broker order ID and
  must not be counted as a broker submission or actual trade.
- **Harbor `sw3`:** one `TSLL` order was
  `prepared` (created at 13:40:05 UTC, expiry 20:00 UTC),
  `broker_order_id=NULL`, `requiresRevalidation=true`. It was **not**
  submitted to Alpaca and no fill should be inferred. Later rejected
  intake journal entries must not be reclassified as approved trades.
- **Flash `wkd` and Spark `spk` research:** fresh production candidate
  journal events at roughly 14:00 UTC indicate ongoing research activity
  but **not** authenticated scheduler health proof. Flash remains without
  a confirmed actual fill; its counterfactuals are separate.
- **Coil `sqz`:** execution remains deliberately disabled; do not arm it
  or add a stock broker executor under this audit.

**Safety signoff status:** the six instrumented stock crons have post-deploy
HTTP 200 and zero consecutive failures (PR #91), and the observed current
broker/virtual open positions, order status and applied attributed fills
reconcile. **Global G0** remains incomplete for Flash/Spark and other
uninstrumented routes. **Pulse/Fuse and Atlas stock G2-G7** remain open
until one naturally qualified PAPER entry is authorized, broker-filled,
independently protected, safely exited and reconciled end to end.
No trade was forced, no permission or strategy threshold changed, no
pilot claim reset, no reservation released and the official challenge
counter remains UNSTARTED.

---

## Pulse whole-share stock ownership bypass repair — October 9, 2026

**PR [#93](https://github.com/zanibethel/CreatorHub/pull/93)** merged as
`fefbf8fd03d024e7184f333dc682832ba1d6c6a9`. Production deployment
`dpl_A3XcQHZiMYoxL1Ejs7rGo1vJxrTm` was confirmed **READY**
and assigned to `creatorhub-gray.vercel.app` at **14:26:34 UTC**.
GitHub CI passed TypeScript, lint, PAPER tests and the production build.

**Defect discovered:** Pulse's fractional-simple buy path used the atomic
one-entry `paper_pulse_claim_fractional_pilot` database RPC and its shared
stock-symbol reservation, but a potential whole-share bracket buy bypassed
that claim. Its fractional-only broker venue scan also did not cover whole
share entries. A qualifying whole-share entry could therefore have reached
Alpaca PAPER without the required durable venue symbol reservation.

**Fix implemented and deployed:** Both integer-share bracket and fractional
simple-order modes now require that **same existing one-entry atomic
pilot/shared-stock-symbol RPC**, preceded by a PAPER broker scan for exact
stock asset identity, open regular session, all positions and open orders.
The scan fails closed on errors, malformed results and the 500-row
pagination boundary. After the database pilot/order claims, a second fresh
broker venue scan must pass immediately before the broker buy POST.
Protected internal readiness and stop-manager requests use the stable
production origin instead of the incoming deployment-specific request URL.
The pre-existing service-role SQL function was **read-only verified**
in production to contain the shared symbol claim and one-shot ledger guard;
no schema change or separate token was necessary.

**Operator caveat:** The existing RPC field is named
`fractionalPilotClientOrderId` even though it now gates **all** Pulse stock
entry modes. `fractionalExecutionEnabled=true` is therefore also a
prerequisite for whole-share entries in this guarded, one-entry trial.
If the second broker scan becomes uncertain after claiming the pilot,
the pilot and physical reservation intentionally remain claimed: **never
reset the slot or release the reservation automatically.**

**Observed live at 14:27 UTC:** Pulse's `pulse-manage` completed
after the new deployment at **14:27:03 UTC**, HTTP 200, action
`completed`, zero consecutive failures, source `vercel-cron-agent`.
The previous `pulse-run` was 14:25:46 UTC, *before* this deployment,
and did not by itself prove the new runner cycle. Both Pulse and Fuse
pilot claim IDs were still unset and no active stock symbol reservations
existed when inspected. Pulse had no actual stock broker fill; its latest
signals were research `watch` candidates, not selected submissions.
Separately, Spark had opened a new BTC/USD PAPER position with a broker
stop-limit sell; the prior 14:02 UTC flat-account snapshot above is
historical and **must not** be interpreted as the current broker state.

**Not yet proven:** Full Pulse broker-verified fractional or whole-share
lifecycle (G2–G7), a naturally qualifying entry under the new shared pilot,
or fully current G0 confirmation for uninstrumented crypto jobs. This PR
did not submit orders, adjust scoring thresholds, alter $100 ledgers,
enable Coil, change PAPER/live settings, release reservations or start
the official challenge counter.

---

## Fuse entry-path hardening and Harbor fractional-bracket rejection — October 9, 2026

**Scope:** independently observed production Supabase cron and ledger records,
Alpaca PAPER open/closed orders and physical positions, GitHub code, CI and
Vercel deployments. These are point-in-time facts, **not** a claim that the
first natural stock trade lifecycle is complete.

### Fuse — PR [#95](https://github.com/zanibethel/CreatorHub/pull/95)

- Merged commit `bb078fa6860db415cf02b246d900fa2ead57464c`.
  Vercel production deployment `dpl_ABTeDtPBA8Mqw7vCZUVi7ezHywpm`
  verified **READY**, serving `creatorhub-gray.vercel.app`.
- The scheduler's stable-origin fix in #89 was incomplete:
  `fuse-execute` still used the inbound deployment host for the
  read-only preview and protected manager; the preview used that host for
  readiness. Changed all remaining internal callbacks to the stable public
  origin. Assert exact Alpaca U.S.-equity asset class and requested ticker
  before the preexisting single-use SQL pilot claim or broker POST.
- GitHub CI passed type check, lint, **330/330 PAPER tests** and build.
  Tests now include protected-origin routing, incorrect broker asset identity,
  and no-reservation/no-buy on a broker asset mismatch.
- Observed authentic `fuse-run` at 2026-10-09 **14:50:04 UTC**:
  **HTTP 200, action `none`, zero consecutive failures**; `fuse-manage`
  at **14:50:02 UTC**: **HTTP 200, action `completed`**, from
  `vercel-cron-agent`, after #95 was READY. Fuse had no confirmed broker
  stock order/fill or virtual stock position, retained independent
  `$100.000000` ledger equity and unclaimed `fusePilotClientOrderId`.
- **Gate remains OPEN:** no first naturally selected Fuse PAPER order,
  independent broker fill and live stop/target inspection, safe close,
  share/fee reconciliation, or post-close ledger P/L for G2-G7.

### Harbor — PR [#96](https://github.com/zanibethel/CreatorHub/pull/96)

- At **14:50:07 UTC**, the real Harbor runner returned **HTTP 502**
  (`execution-error`). This was a *new* failure unrelated to the #90
  intake-journal repair. Production journal recorded a selected/authorized
  **SNAP** candidate followed by `execution_error` with broker reason
  `fractional orders must be simple orders`. The attempted bracket
  quantity was **2.252886510** shares; Alpaca does not accept fractional
  bracket entries.
- Broker check: no SNAP stock position, no accepted SNAP order in the
  relevant Alpaca PAPER order search; lookup by exact client order ID
  `chb-sw3-v1-mv130t9e-25d165730b8542df935bc2f9` returned
  **404 not found**. Harbor virtual ledger remained **$100.000000**.
  That is **not a filled trade**.
- The local SNAP order remains `submitted`, `broker_order_id=NULL`,
  `brokerLookupPending=true`; the active shared stock reservation ID
  `dcb06551-b901-45e3-be72-b8a1243884d2` is intentionally
  **HELD**. Never release, reset pilot, or retry that client order
  without separately approved broker/ledger reconciliation and operator
  token approval.
- Merged PR #96 commit `61554a6391a65e8822fae6b74bfec1ea225401a9`.
  Production deployment `dpl_7TNSFytxmexijaWixCbGno4QTPdh` verified
  **READY** on the production alias at **14:56:23 UTC**.
- The repair floors bracket quantities to whole shares **without
  increasing any allocation or risk budget**. A setup too expensive for a
  single whole share remains research-only, with execution selection and
  `submissionReady` blocked. Bracket serialization and the executor both
  reject fractional sizes before any one-shot SQL/broker claim. This is
  *not* a fractional execution feature and does not lower strategy scoring.
  PR #96 passed type check, lint, PAPER regression tests and build.
- Harbor's **14:55:07 UTC** cron returned HTTP 200/action `none`
  before #96 became READY; it was not post-deployment proof. The next
  *real scheduled* invocation at **15:00:07 UTC**, after the corrected
  deployment, returned **HTTP 200/action `none`**, zero consecutive
  failures, source `vercel-cron-agent`. This independently verifies
  the production scheduler recovered from the 14:50 502, **not** an
  actual completed stock fill.

**Cross-bot evidence:** Coil remains disabled; no shared stock reservation
was released and no PAPER stock buy was forced. Spark's BTC/USD was the
only broker physical position at this stage, with a matching open
protective stop-limit sell. Do not conflate the physical Alpaca account
balance with either bot's independent virtual equity.

**Updated 15:00 UTC scheduler proof:** Fuse `fuse-run` at 15:00:03
was **HTTP 200/action `none`**; `fuse-manage` at 15:00:04 was
**HTTP 200/action `completed`**; Harbor `harbor-run` at 15:00:07
was **HTTP 200/action `none`**. All were authenticated Vercel cron
sources with zero consecutive failures. Broker lifecycle gates remain open.

**Next gates:** observe naturally qualifying stock broker fills before
signing G2/G3/G5/G6/G7; reconcile SNAP independently before any
operator-authorized release. Global crypto scheduler G0 remains open.
Official challenge/day counter **UNSTARTED**.

---

## Flash + Spark durable 24/7 scheduler telemetry — October 9, 2026

**PR [#98](https://github.com/zanibethel/CreatorHub/pull/98)** merged
as `e74c568d18dd163b935de70963a4edbba250a20a`.
Vercel production deployment `dpl_7XUyLkpHu4JmrWDkiMeQcqZ86Lvq`
was confirmed **READY** on the `creatorhub-gray.vercel.app` alias at
**15:15:12 UTC**, alias error null. GitHub CI passed TypeScript, lint,
PAPER monitoring tests and build; the Vercel preview check passed.

- Existing 24/7 five-minute Vercel jobs, unchanged:
  `/api/paper-trading/bots/weekend-crypto-run` (**Flash**)
  and `/api/paper-trading/bots/crypto-ignition-run` (**Spark**).
- Both existing `CRON_SECRET`-gated runners now use the same
  `withPaperCronHeartbeat` wrapper as the six stock jobs. The wrapper
  records only sanitized HTTP status, machine action, duration and
  informational caller classification. It does not rerun or modify strategy
  selection, execute trades, or adjust broker protection.
- Supabase migration `paper_crypto_cron_health`
  (applied version **20261009151408**) expanded the existing
  `paper_bot_cron_health_job_key_check` and strict service-role RPC
  job/bot/cadence allowlist with
  `('flash-run','weekend-crypto-day-100',5)` and
  `('spark-run','crypto-ignition-100',5)`. Verified the CHECK constraint
  contains both new keys. Verified the writer RPC remains executable by
  `service_role`, **not** `anon` or `authenticated`.
  The six stock rows were not reset.
- **Post-deployment Flash and Spark runner heartbeat G0 VERIFIED:** Spark's genuine
  Vercel cron at **2026-10-09 15:20:20.517185 UTC** recorded HTTP 200,
  action `none`, zero consecutive failures and source `vercel-cron-agent`
  (first recorded `spark-run`). Flash's genuine Vercel cron at
  **15:20:39.091949 UTC** recorded the same HTTP 200, `none`,
  zero failures and `vercel-cron-agent` source (first recorded
  `flash-run`). Both occurred after the **15:15:12 UTC** production
  READY timestamp and have exact authenticated scheduler attribution.
  This signs off **the two scheduled crypto runner heartbeat subgates**;
  it does NOT certify independent protection-manager supervision,
  successful brokerage trade lifecycles or repeated long-term reliability.
- A full crypto **G0** must still distinguish health of these five-minute
  runners from their underlying broker protection managers and fill
  reconciliation. A successful health heartbeat is **not** an executed
  trade or broker-verified protective stop.
- Harbor's unresolved SNAP single-use order claim and physical stock
  reservation remain held pending separately approved release, even after
  Alpaca returned no matching broker order. Coil remains execution-disabled,
  and the official challenge counter is **UNSTARTED**.

---

## Pulse remaining-stop-quantity protection correction — October 9, 2026

**PR [#101](https://github.com/zanibethel/CreatorHub/pull/101)** merged
as `a5aae41edb831817d24fbe507061052558f7583c`. GitHub
CI passed TypeScript, lint, PAPER monitoring tests and production build,
plus the Vercel preview check. Deployment
`dpl_ABiYMpnrzma7Pd27cZ1dNgtD5JRv` was independently confirmed
**READY** at the `creatorhub-gray.vercel.app` production alias
on **2026-10-09 15:35:23 UTC** (no alias error).

**Exact safety defects repaired:**

- The one-minute Pulse fractional stop manager previously compared
  the *original* broker sell stop order quantity with the current broker
  position, without subtracting the already executed `filled_qty`.
  A partially filled stop could therefore be mislabeled
  `broker-stop-verified` despite the unfilled remainder being insufficient
  to cover current holdings. It now verifies
  `remaining = stop.qty - stop.filled_qty`, rejects missing/malformed,
  negative or overfilled quantities, and requires remaining sell shares
  to cover current attributed PAPER shares. Uncertain evidence produces
  `manual-reconciliation`, **not** a new duplicate protective sell.
- The whole-share Pulse bracket executor previously stamped
  `protectionValidatedAt` whenever broker nested order leg IDs existed,
  regardless of leg state, remaining quantity or stop/target prices.
  A new read-only bracket evidence audit verifies the broker parent
  ID/client ID, exact symbol/side/order class, stop and target active
  statuses, both legs' remaining unfilled quantities and authorized
  prices before assigning that timestamp or returning protection success.
  A leg merely existing is not enough evidence.
- New regression tests cover valid and undercovered partially filled
  stops, missing/malformed filled quantities, canceled/pending-cancel
  broker exits, unfilled quantity shortages, price downgrades and
  inconsistent parent identities.

**Observed after deployment:** real Vercel cron heartbeat for
`pulse-manage` on **2026-10-09 15:36:02 UTC** recorded
**HTTP 200**, action `completed`, zero consecutive failures and source
`vercel-cron-agent`. Real `pulse-run` at **15:35:46 UTC** recorded
**HTTP 200**, action `none`, zero consecutive failures. This verifies
the patched routes execute in production, **not** that the new evidence
branches have encountered a natural broker fill.

**Open first-trade gates:** Pulse and Fuse need their first naturally
qualified PAPER stock entry with independently observed actual broker
fill, active protective stop/target, partial-fill handling, safe exit,
exact ledger fee/P&L attribution and follow-on checks. A broker stop
snapshot alone is not ongoing protection. Harbor's earlier unresolved
SNAP reservation remains held pending separately approved release.

No PAPER order was created or canceled for this verification, no live
trading was enabled, no one-shot pilot was reset, no scoring threshold,
risk limit or $100 virtual capital allocation changed. Official
challenge counter remains **UNSTARTED**.

---

## Pulse orphan stock ownership preflight — October 9, 2026

**PR [#103](https://github.com/zanibethel/CreatorHub/pull/103)** merged
as `a51313037329ee7efe5d3e81958319d9bba44573`.
GitHub passed TypeScript, lint, PAPER monitoring tests and the
production build; Vercel preview check passed.
Production deployment `dpl_AUxrTNd8tnJ2rrLqNAMW4KDneQ7z`
was independently confirmed **READY**, with production alias
`creatorhub-gray.vercel.app`, on **2026-10-09 16:03:53 UTC**
with no reported alias error.

**Safety gap addressed:** Pulse's one-minute protection manager previously
loaded local buys only after filtering them to fractional-simple entries and
loaded virtual positions for *other* bots but not its own holdings.
It could return a healthy report without noticing either (a) an existing
Pulse virtual stock position that lost its active buy-parent link, or
(b) an active Pulse-tagged broker BUY not attributable to any active local
Pulse buy order. The patch performs read-only ownership preflight
over all active Pulse buys, including valid whole-share brackets, plus
Pulse's own virtual holdings and open Alpaca broker buy orders.

- Any virtual stock position without an attributable local active buy parent
  fails closed with HTTP 503, not a trade or silent successful check.
- Any open `chb-pls-v...` PAPER BUY without an active local parent
  fails closed with HTTP 503, not a cancellation, retry, or new submission.
- Whole-share bracket buys are recognized as legitimate owning parents
  without letting this fractional manager alter their OCO protection.
  Existing bounded queries and fail-closed pagination checks remain.
- Integration tests exercise both orphan conditions and legitimate bracket
  ownership. They verify zero buy, stop, sell, or cancel side effects.

**Independent live evidence:** The authenticated Vercel one-minute
`pulse-manage` job recorded **HTTP 200**, action `completed`,
zero consecutive failures and source `vercel-cron-agent` at
**2026-10-09 16:04:02 UTC**, after the updated deployment was READY.
This proves the patched route is executing, **not** that its orphan
branches have been triggered by a real position. The trading report
collector was also seen refreshing attributed broker orders at
**15:58:11 UTC**; nine attributed PAPER fills had been applied to their
ledgers with zero unapplied fills, but none established a complete
Pulse or Fuse stock lifecycle.

**Remaining first-stock-trade gates:** A naturally qualified and selected
stock entry, independent Alpaca PAPER acceptance and actual fill,
broker-verified protective coverage through partial fills and exits,
fee-aware virtual ledger P/L, and post-close ownership reconciliation
are still mandatory before first-trade signoff. Historical filled
broker orders no longer listed as open require independent full
reconciliation beyond this newly bounded open-order guard.

**Controls preserved:** No PAPER buy/sell/cancel was caused by this
verification, no scoring threshold or $100 virtual capital changed,
no one-entry pilot was reset, no coil execution arm, no protected stock
reservation released; Harbor's SNAP reservation remains held, and
the official challenge counter remains **UNSTARTED**.

---

## Pulse continuous whole-share broker bracket watchdog — October 9, 2026

**PR [#105](https://github.com/zanibethel/CreatorHub/pull/105)** merged as
`c5480c6c4367636a5dac0637cc4fe8cc244c2668`.
GitHub TypeScript, lint, **all PAPER monitor tests**, and production build
passed, along with the Vercel preview check.
Production deployment `dpl_DMVcxkwMrwd9g1gRR2xyjdH7mSAM` was
confirmed **READY** and assigned to `creatorhub-gray.vercel.app`
at **2026-10-09 16:22:53 UTC**, no reported alias error.

**Defect repaired:** After the Pulse ownership preflight in PR #103,
`momentum-breakout-manage` only *recognized* broker-hosted
`paper-bracket` whole-share parent orders for ownership. It then
filtered them out of active stop monitoring and checked only
`paper-fractional-simple-v1` stops. Initial broker protection evidence
at buy submission could therefore grow stale after a canceled,
undercovered or mispriced bracket child, while subsequent one-minute
manager runs remained HTTP 200.

**New read-only independent check on every one-minute manager run:**

- Recognizes and validates each active Pulse whole-share bracket's
  exact parent client order ID and broker ID, symbol ownership, one
  associated virtual holding, and broker-vs-virtual whole-share quantity.
- Independently fetches the **nested parent and both child sells** from
  Alpaca PAPER, reuses the tested bracket evidence helper to verify
  active status, positive stop/target prices at least as protective
  as the authorized plan, and each leg's unfilled remaining coverage.
- Reconciles those child IDs to the current open Alpaca orders and blocks
  **any foreign or unrecognized active buy/sell order** for that stock
  symbol; existing shared symbol reservations remain authoritative.
- Fails closed HTTP 503 with an attribution/protection error on stale
  or ambiguous broker evidence; **does not** submit a replacement
  stop, flatten, cancel an OCO, retry an entry, or release reservations.
  The existing fractional manager remains responsible only for its
  previously authorized fractional-protection actions.
- Regression tests cover valid live protection, canceled/missing exit
  legs, insufficient stop coverage, downgraded target, broker/ledger
  share mismatch, and foreign live stock buys. No trades were forced
  to produce this evidence.

**Observed after production deploy:** the real authenticated
`pulse-manage` Vercel cron at **16:23:02 UTC** returned **HTTP 200**,
action `completed`, zero consecutive failures, source
`vercel-cron-agent` on the new production version.
All eight monitored stock/crypto jobs remained HTTP 200 with zero
consecutive failures. Pulse and Fuse virtual equity remained **$100**
each with unused one-shot entry pilot claims; Supabase recorded zero
unapplied attributed broker fills. Harbor's active SNAP stock symbol
reservation remains **held** pending separate operator authorization.

**Limits of signoff:** This verifies the code, deploy, and regular
manager execution, **not** a genuinely filled Pulse whole-share bracket.
No actual Pulse/Fuse stock fill has yet been broker-verified end to end.
The first naturally selected broker fill, protective stop/target live
confirmation over time, partial-fill behavior, safe close, and
fee-aware ledger P/L remain open release gates.
Coil stays disabled. Challenge/day counter remains **UNSTARTED**.

---

## Fuse's first naturally triggered and Alpaca-filled PAPER stock entry — October 9, 2026

**Major first-fill milestone (not full strategy exit signoff).** The actual
Vercel scheduled `fuse-run` at **2026-10-09 16:25:04.803 UTC**
(11:25:04 AM Central) returned **HTTP 200**, action
`entry-requested`, `consecutive_failures=0`, source
`vercel-cron-agent`. The pilot was naturally claimed; no operator
manually invoked the runner or changed scoring, execution permissions
or budgets.

**Exact broker-confirmed entry:**

- Bot `penny-volatility-day-100` (Fuse, `pny`), independent virtual
  starting equity `$100`; symbol **RXRX**, decision/pilot metadata
  `fuseScore=87`, existing strategy
  `fuse-whole-share-bracket-pilot-v1`.
- Local client order
  `chb-pny-v1-mv16eyp2-7adcc5298f604ea69b70342e`;
  Alpaca PAPER parent
  `e8287aed-2227-4aed-aa5c-6f420617ffb2`.
- Broker `buy`, `limit`, `bracket`, `day`, **filled 4/4
  whole RXRX shares at $4.33** on
  **2026-10-09 16:25:05.486 UTC**, total entry cost **$17.32**.
  Independently retrieved by exact Alpaca order ID with the parent
  and both child exit legs.
- Protective stop child
  `dc76e4e6-d27e-433d-b82a-88a1e72f1375`,
  exact 4-share `sell` `stop` at **$4.25**,
  broker status **`held`**, filled 0.
  Profit target child
  `20aa439e-bd0f-4cb9-9ded-f2a3ec14fdba`,
  exact 4-share `sell` `limit` at **$4.37**,
  broker status **`new`**, filled 0.
  All three independently queried order identities and the broker
  4-share open position agree.
- Supabase inserted the **real** broker FILL activity ID
  `20261009122505486::b0abdcce-10ca-42bf-95af-ddf96fdef949`
  under Fuse, with `ledger_applied_at=16:25:18.219 UTC`.
  The virtual position is 4 RXRX shares, basis **$4.33**,
  stop **$4.25**, target **$4.37**. Ledger cash **$82.68**,
  virtual equity about **$99.96** on the observed mark, realized
  P/L **$0** while the position is open.
- The shared `RXRX` reservation
  `d7c8e027-7655-4e95-9fda-bc378e018e06`
  is actively and correctly attributed to Fuse's broker parent.
  The one-entry `fusePilotClientOrderId` is legitimately claimed.
  **Never reset that pilot or release the reservation** during
  this trade.
- Authenticated real `fuse-manage` cron at
  **16:28:00.743 UTC** returned **HTTP 200**, action
  `completed`, zero consecutive failures. This is
  scheduled execution evidence, not by itself proof of specific
  per-position outcomes.

**Important unresolved broker/protection distinction:**

- Both Alpaca broker bracket child orders are present at the correct
  quantities/prices, but the stop is broker-`held` and the original
  local entry metadata still reports
  `bracketProtectionVerified=false`. Do **not** silently flip that
  metadata based only on an observed stop order or healthy manager.
  Continue independent verification of broker OCO protection and
  the manager's risk actions.
- **Entry selection, broker fill, attribution and fill-to-ledger
  application are verified.** Exit, partial-fill handling,
  protective stop/target activation over time, session-close
  management, net realized P/L and broker/ledger flat reconciliation
  are **not** yet verified.
- Later `fuse-penny-research-v1` research-only rejected RXRX
  journal rows at 16:25:14 UTC do not erase or override the separate
  genuine broker entry fill; preserve both provenance records for
  subsequent decision consistency review.
- No trades were forced for the audit, no live funds involved,
  no broker exits replaced/canceled, no foreign reservation released,
  no Coil execution enabled. Harbor's unresolved SNAP reservation
  remains separately held. The official challenge/day counter
  remains **UNSTARTED**.

**Next gate:** Continue observing this real 4-share RXRX PAPER
position through naturally triggered stop, target, or authorized
session-close exit. Confirm exact broker sell fill activity,
OCO sibling disposition, position flatness, completed tagged
journal and cash/equity/fees/realized P/L reconciliation.
Do not send an artificial exit merely to mark a gate green.

---

## Fuse RXRX first PAPER stock trade — broker-verified close and ledger signoff (October 9, 2026)

**Update to preceding 16:25 UTC entry evidence:** The first naturally
selected Fuse stock pilot trade later **closed** using the original
Alpaca PAPER bracket target; its broker/virtual accounting is
independently reconciled. This supersedes that earlier entry snapshot's
then-open exit gate, but does NOT authorize another one-shot pilot or
claim full repeat-trade risk-readiness.

**Order and fill chain**

- **Entry** `chb-pny-v1-mv16eyp2-7adcc5298f604ea69b70342e`,
  parent broker ID `e8287aed-2227-4aed-aa5c-6f420617ffb2`:
  4 RXRX whole shares **BUY filled** at **$4.33**, total **$17.32**,
  at **2026-10-09 16:25:05.486 UTC**.
- **Profit target**, same bracket parent:
  broker ID `20aa439e-bd0f-4cb9-9ded-f2a3ec14fdba`.
  Independent Alpaca status **`filled`**, total **4/4
  sell shares at $4.37**, final fill time
  **2026-10-09 16:31:42.508 UTC**.
- **Actual partial sell fills**, each reflected in
  `paper_bot_broker_fills` and applied to the virtual ledger:
  **2 shares** at 16:31:40.893 UTC (**+$0.08**),
  **1 share** at 16:31:41.816 (**+$0.04**),
  **1 share** at 16:31:42.508 (**+$0.04**).
  All were at **$4.37**; no fill remained unapplied.
- **OCO stop sibling**, broker
  `dc76e4e6-d27e-433d-b82a-88a1e72f1375`:
  independent Alpaca status **`canceled`**, canceled at
  **16:31:40.895 UTC**, stop **$4.25**, 0 stop shares filled.
  No dangling RXRX sell order remained.
- **Physical flatness**: independent Alpaca PAPER positions contained
  no RXRX after exit; Alpaca open orders contained no RXRX.
  Remaining unrelated Spark BTC/USD broker exposure is not Fuse's.
- **Virtual flatness and P/L**: production Supabase had **zero**
  `paper_bot_positions` for Fuse, ledger cash/equity
  **$100.160000**, realized P/L **+$0.160000**,
  unrealized P/L **$0**, buying power **$100.160000**
  (checked **16:33:29 UTC**). The original independent
  $100 ledger was not reset or confused with shared Alpaca equity.
  The stock fill/ledger policy recorded no stock fee; treat this as
  net *recorded* PAPER P/L and do not extrapolate unmodeled live fees.
- **Ledger + decision evidence**: a real `closed` journal event at
  **16:31:42.508 UTC** recorded **+$0.16 realized P/L**,
  and three tagged sell-fill journal events tie back to the
  original parent client order. Vercel `fuse-manage` continued
  **HTTP 200** at **16:33:00 UTC** with zero consecutive failures.

**Verified specific first-trade milestones:** naturally qualifying
selected entry, one-shot broker submission/acceptance and physical fill,
broker OCO stop/target presence, three *actual* partial target fills,
broker stop cancellation, physical/virtual flatness, independently
attributed FILL ingestion and exact $100.16 closed-ledger outcome.
No synthetic trade, forced close, scoring threshold reduction, or
pilot reset was used.

**NEW remaining safety-critical gate — possible partial-OCO exposure
window:** The stop was canceled at **16:31:40.895 UTC**, immediately
after the first target partial fill, while **two RXRX shares remained
held** until the final target fill at **16:31:42.508 UTC**
(about **1.6 seconds**). The position ultimately exited safely, but
we **cannot claim continuous downside stop protection** for the residual
shares in that interval. Investigate broker/OCO partial-fill behavior
and whether the exit manager can fail closed or mitigate
that specific race before approving repeat/rearmed stock entries.
A one-minute cron heartbeat cannot by itself prove subsecond
partial-fill safety.

**Still held:** The `fusePilotClientOrderId` is one-shot and
claimed by this real trade; the shared RXRX reservation must not be
automatically released merely because Fuse is now flat.
Harbor's separate SNAP claim remains held, Coil stays disabled,
the `PAPER_STOCK_RELEASE_TOKEN` remains deliberately unconfigured,
and the official challenge/day counter remains **UNSTARTED**.
No new entry is authorized by this documented success.

---

## Fuse partial target/OCO race: fail-closed prevention and evidence — October 9, 2026

**Production safety hardening PR
[#109](https://github.com/zanibethel/CreatorHub/pull/109)** merged
as `fdc6c98a1d3c0d33e59afc7ba58d9d458248b98d`.
Repository TypeScript, lint, PAPER monitor integration tests and production
build all succeeded; Vercel preview check passed. Production deployment
`dpl_FPtBoFEZt8oNNZ4brPgSUoeqhU7N` reached **READY**
at `creatorhub-gray.vercel.app`, no alias error, on
**2026-10-09 17:04:17.323 UTC**.

**Triggering real PAPER observation:** Fuse's first RXRX
4-share target exit was split into **2+1+1** broker fills
at 16:31:40.893, 16:31:41.816 and 16:31:42.508 UTC.
The sibling $4.25 stop was canceled at 16:31:40.895 UTC
after the first partial fill and before the remaining two shares
finished exiting (approximately **1.61 seconds**).
Official Alpaca order documentation states that bracket stops
should adjust to remaining quantity after a partial take-profit fill.
This historical trace therefore merits further investigation;
**continuous stop cover in that interval is NOT independently proven**.
The actual trade still finished safely flat with $100.16
Fuse virtual equity and **+$0.16** recorded realized P/L.

**Exact non-trading safety corrections:**

- In `fuse-manage`, the independent audit no longer receives
  `[...sellOpen,...children]`. It receives **only the genuine
  current Alpaca open sell-order listing** as its independent venue
  evidence. Otherwise a separately GET-fetched bracket child could
  incorrectly count as proof that the same child remains live.
- The bracket audit requires independently matching active child
  status in that open-order listing. `pending_cancel`,
  `pending_replace`, canceled or missing children cannot be
  counted as confirmed open risk protection, even when child IDs
  are still available.
- Missing/malformed `filled_qty` on any child is **unknown,
  not assumed zero**. Exact remaining stop and target quantities
  still must cover the independently observed PAPER position.
- The Fuse decision engine now recognizes
  `takeProfitHasFills`. If some target shares have executed
  while attributed shares remain, and protection is uncertain,
  it **refuses destructive broker operations** with
  `manual-reconciliation`/HTTP 503. At the 15:40 ET flatten
  cutoff it also defers automatic cancellation/flatten if
  such partial target execution is in flight, even when current
  child snapshot seems protected. No second/duplicate sell
  is authorized on ambiguous partial exit state.
- A child reported active by independent broker GET but missing
  or in a pending-cancel/replace state in the current open-order
  snapshot triggers **manual reconciliation** before any
  cancel/flatten. Legitimate not-yet-filled entry parents are
  still allowed to await broker exit activation.
- Regression tests specifically model a partly filled target,
  missing or canceled stop, malformed child fills, pending
  cancellation, contradictory venue listing and an unfilled
  bracket whose legs are not yet active. These scenarios assert
  **zero** additional broker POST/DELETE side effects when
  protection evidence is ambiguous.

**Observed live after change:** The authenticated Vercel
`fuse-manage` cron at **2026-10-09 17:05:00.984892 UTC**,
after deployment READY, returned **HTTP 200**, action
`completed`, zero consecutive failures and source
`vercel-cron-agent`. This verifies deployment/scheduler health,
**not** live exercise of the new partial-fill branch, as Fuse
is already broker/ledger flat.

**Outstanding operator gate:** The observed ~1.6-second
stop-cancellation timing remains unexplained by an independent
subsecond stream or exchange venue trace. A one-minute cron
cannot guarantee continuous stop protection in that window.
Before rearming Fuse for repeated stock buys, investigate
Alpaca's partial-bracket fill/stop-resize behavior, collect
streaming trade-update or broker lifecycle evidence where
available, and determine a strategy for safe partial exits.
This patch contains our own manager's unsafe follow-on actions
but **does not repair Alpaca's broker-side race** or authorize
automated pilot reset.

**Permanent safety state:** Fuse's pilot claim stays consumed;
virtual equity **$100.16** and zero Fuse positions after the
genuine RXRX exit. The separate Pulse pilot remains unclaimed.
Fuse's `RXRX` and Harbor's `SNAP` stock reservations remain
HELD; never release without established operator process.
No new PAPER buys or broker cancel/sells were placed to verify
this change. No scoring/risk thresholds, live funding,
Coil execution permissions, or challenge-day counter changed.
The official challenge counter remains **UNSTARTED**.

---

## Broker cancellation timestamp capture and evidence-only OCO audit — October 9, 2026

**PR [#112](https://github.com/zanibethel/CreatorHub/pull/112)** merged
as `678eb73dd14d6c5d4817e0537106614ede5c59bf`.
GitHub CI passed TypeScript, lint, PAPER tests and build; Vercel preview
passed. Production Vercel deployment
`dpl_7canYRj7wGYodcR8Z8Y8SDqGj6cS` was verified **READY**.
The additive Supabase migration `paper_oco_cancel_timeline_evidence`
was applied before deploying the collector.

**Deployed native Supabase Edge Function:** `paper-report-sync`
is **ACTIVE at version 15**, preserving its existing
`verify_jwt=false` configuration because the body already requires
a 64-hex private report token and verifies its SHA-256 hash before
any database or broker collection. The function's collected order
activity is private service-role data, not part of the public report.
No OAuth/API secrets were copied into artifacts.

**Exact new evidence path:**

- Tagged Alpaca broker parent/child orders retain validated UTC
  `canceledAt`, `replacedAt` and `updatedAt`, preserving raw
  submillisecond/nanosecond timestamp text privately rather than
  rounding with JavaScript `Date.toISOString()`.
  Independently tagged FILL activity likewise now passes its raw,
  validated timestamp into the private reconciliation feed for
  **future** fills. Existing financial ledger amounts were not changed.
- Additive function
  `public.paper_bot_record_order_lifecycle_evidence(jsonb,timestamptz)`
  merges the lifecycle timing into `paper_bot_broker_orders.metadata`
  only where broker order ID, client order ID, attributed client ID
  and `alpaca-paper` source all match.
  Service-role permission verified true; `anon` and
  `authenticated` execute privileges verified false.
- The read-only service-role-only RPC
  `public.paper_bot_stock_oco_gap_audit(text)` matches
  sibling stock stop/target orders by their verified Alpaca
  parent and bot attribution. It joins the real attributed
  target FILL events and flags a *possible* unprotected residual
  window whenever the stop was canceled before the final
  take-profit shares completed selling.
- The supplemental timestamp write is best-effort:
  its failure adds `brokerLifecycle` to sanitized report errors
  but **must never stop existing ledger fill application**.
  No buy/sell/cancel RPC, pilot reset, stock reservation release,
  market-data subscription or recurring alert is added.

**Independent production evidence, not hypothetical fixtures:**

- The first genuine post-deployment collector refresh stored the
  actual Alpaca RXRX stop cancellation timestamp
  `2026-10-09T16:31:40.895316177Z` under the Fuse stop broker order
  `dc76e4e6-d27e-433d-b82a-88a1e72f1375`,
  with `lifecycleObservedAt` around **17:57:06 UTC**.
- The real service-only risk query
  `select * from public.paper_bot_stock_oco_gap_audit('penny-volatility-day-100')`
  returned **one RXRX record**, matching target
  `20aa439e-bd0f-4cb9-9ded-f2a3ec14fdba`,
  parent `e8287aed-2227-4aed-aa5c-6f420617ffb2`,
  **2 RXRX residual shares when stop canceled**, and a
  **~1.61-second potential cover interval**.
- The SQL view currently reports `1612.684` milliseconds because
  this *historical* FILL transaction time was previously stored
  at millisecond precision (`16:31:42.508Z`).
  **Direct Alpaca activity and order records** provide the original
  finer timing: stop canceled
  `16:31:40.895316177Z`, final target fill
  `16:31:42.508790391Z`, difference
  **1613.474214 milliseconds**.
  Do not overwrite already-applied financial fill/journal timestamps
  merely to make the two displays equal.
- Supabase showed zero unapplied attributed broker fills and all
  eight PAPER cron-health jobs remained HTTP 200 with zero
  consecutive failures. The Fuse ledger remained **$100.16**
  after the closed 4-share +$0.16 RXRX trade. Pulse's first
  stock pilot is still unclaimed.

**Release decision:** **DO NOT rearm Fuse** based on a successful
trade or this retrospective risk report. The broker REST endpoint
provides cancellation/fill timestamps but not the complete history
of internal stop resizing or real-time WebSocket trade-update
states. We have verified a noteworthy *observable* gap in broker
order timing, **not** conclusively proven loss of all possible
internal broker downside protection. A future separate phase
should capture authenticated Alpaca PAPER `trade_updates` as
durable, ordered broker events, distinguish stop `replaced` from
`canceled`, detect partial-fill risks promptly, and confirm a
strategy-specific safe response before repeat entry authorization.

**No execution side effects:** Fuse's one-shot pilot stays claimed,
RXRX and Harbor SNAP shared stock reservations remain HELD,
Coil stays execution-disabled, no stock trade was placed or
canceled for the audit, and the official challenge/day
counter remains **UNSTARTED**.

---

## Dedicated Alpaca PAPER trade-update event stream — staged October 9, 2026

**New monitoring-only pipeline:** `workers/alpaca-paper-trade-updates.mjs`
and `supabase/functions/paper-trade-stream-ingest`, with private
append-only `paper_broker_trade_updates` event hash deduplication,
`paper_broker_trade_stream_health` heartbeat/freshness reporting,
disk-spooled at-least-once batch delivery from a persistent Node 22+
WebSocket client, and private service-role-only storage.
See `docs/PAPER_BROKER_TRADE_UPDATES_STREAM.md` for exact rollout
and operator checks.

**Do not mistake server readiness for live WebSocket coverage.**
The ingestion endpoint is purposely fail-closed until its dedicated
token digest is configured and a long-lived subscriber process has
verified real Alpaca PAPER authentication/listening acknowledgments.
This system is not a mechanism to order, cancel, replay trades,
or write to virtual ledgers. Existing REST 30-second fill reconciliation
remains authoritative for ledger entries. WebSocket disconnect intervals
are **not replayable by assumption** and must be shown as evidence gaps.

Fuse's completed RXRX broker trail remains the first real PAPER stock
entry-to-exit verification; its historical ~1.61-second partial-OCO
interval remains unresolved regarding broker internal coverage.
The one-shot Fuse entry is NOT rearmed, the RXRX and Harbor SNAP
reservations are NOT released, Coil is disarmed, and the official
challenge/day counter is **UNSTARTED**.

---

## Durable PAPER WebSocket stream server-side deployment evidence — October 9, 2026

**PR [#114](https://github.com/zanibethel/CreatorHub/pull/114)** merged as
`bbef7153ba77dc8a4861c2b0a3cc9494a123258b`.
TypeScript, lint, PAPER test suite, production build and Vercel preview
all passed; production deployment
`dpl_GZUbDCieThLXRafe44cPAC7qiMjN` was independently verified
**READY** on `creatorhub-gray.vercel.app`, alias error null.
The additive migration `paper_trade_updates_durable` was
successfully applied **before** deploying the new Supabase Edge
Function `paper-trade-stream-ingest`, confirmed **ACTIVE v1**.

**Security verification**:
- `paper_broker_record_trade_updates(jsonb,text,boolean,integer)`
  is executable by `service_role`, but **not** by `anon` or
  `authenticated`. Both underlying private tables have RLS enabled.
- The actual production HTTP POST probe, dispatched from Supabase
  pg_net with no authorization token, returned **HTTP 503**
  `PAPER stream ingest is not configured.` at
  **2026-10-09 19:00:09 UTC**. The endpoint requires a dedicated,
  unconfigured SHA256 ingress secret and cannot insert events
  in this state; it is NOT a live broker stream.
- An idempotency smoke test in an explicitly rolled-back transaction
  verified a single private event was accepted once and a duplicate
  reported as already received; the test left **zero** persisted
  synthetic broker events and did not modify any broker or
  trading ledger.
- `paper_broker_trade_stream_status` returned
  `connected=false`, `recently_connected=false`, no heartbeat,
  `stored_event_count=0`. This is **correct, honest offline
  state**, not a failed trading scheduler.

**Other production checks**: all eight existing monitored PAPER
scheduler jobs remained HTTP 200 with zero consecutive failures at
the **19:00–19:01 UTC** observation window. Existing
`paper_bot_broker_fills` had zero unapplied entries.
Fuse remains at **$100.16** cash/equity with **+$0.16**
realized P/L and consumed one-shot pilot; Pulse remains
**$100.00** with an unclaimed pilot. Shared RXRX/Fuse and
SNAP/Harbor reservations remain active. The only observed open
Alpaca PAPER position was Spark's BTCUSD crypto holding with
its associated BTC/USD sell order; **no stock trade was placed
for this evidence work**.

**Still required before real event coverage is signed off**:
Provision a distinct ingress secret in both the Edge Function
and a secure persistent worker host, start the actual Node 22+
`workers/alpaca-paper-trade-updates.mjs` under a supervised
long-lived service, observe Alpaca PAPER WebSocket authorization and
`trade_updates` subscription acknowledgments, then prove
reliable event ingest, heartbeat freshness, restart replay,
and real order-event attribution. We have not accessed or
configured the user's local Mac/Galaxy nodes here. Vercel's
serverless routes cannot substitute for the always-on listener;
WebSocket disconnect gaps must never be labeled complete history.

This is **monitoring-only staging**, not Fuse rearm authorization
or resolution of the historical ~1.61-second RXRX stop-cancel
question. Do not reset pilots, release RXRX/SNAP, turn on Coil,
or start the official challenge counter. Challenge is
**UNSTARTED**.

---

## Samsung Galaxy S10 broker-monitor host plan — October 9, 2026

The owner approved using the **existing CoOperative Galaxy S10 Android node
hardware instead of the Mac** to host the lightweight read-only Alpaca PAPER
event listener. The CoOperative repository currently publishes a
`CoOperativeLocalAI.apk` release but **does not contain the APK's Android
source/Gradle project**, so modifying/re-signing the installed APK is not
supported by the currently connected repository. This phase therefore
stages an independently supervised **Termux process on the same Galaxy S10**
without disrupting its paired CoOperative AI APK or changing job routing.

The new setup is documented at `docs/PAPER_STREAM_GALAXY_NODE.md`.
New code: `scripts/run-paper-stream-termux.sh`,
`scripts/install-paper-stream-termux.sh` and reboot-only Linux UUID
spool-lock recovery in `workers/alpaca-paper-trade-updates.mjs`.
Termux:Boot and `termux-services` (runit) can supervise the process
after Android reboot, with an optional wake lock and manual battery
optimization exemptions. The worker uses existing private Supabase
ingestion and Alpaca PAPER-only WebSocket, stores only scrubbed broker
events in Termux app-private data, and has **no trade execution API**.

**Do not claim activation from merged scripts.** The phone still needs
Termux/Termux:Boot installation, the private credentials and dedicated
ingress token digest configured, supervised process start, actual
Alpaca PAPER auth/subscription ACK, Supabase connection heartbeat,
screen-off endurance, network recovery and reboot verification. Do
not use the CoOperative pairing key as a trading-event ingestion token.
If an Android socket dies during sleep, report missing stream coverage,
not zero market/broker activity.

No pilot reset, RXRX/SNAP reservation release, forced simulated trade,
Coil arm, or challenge counter start is authorized.

---

## Shared release gates — checklist (retain evidence links per completed item)

- [ ] **G0 — Cron invocation proof:** collect dated authenticated production responses/logs for Fuse's five-minute runner and minute manager, Pulse's runner/stop manager, Atlas's strategy runner, Flash and Spark; ensure security/SSO does not silently block internal same-origin calls. A deployed `vercel.json` cron definition alone is insufficient.
- [ ] **G1 — Atomic venue ownership:** move from Fuse's local double checks to a shared venue-wide stock-symbol reservation protocol used by every stock bot, including Pulse, Atlas and Harbor. Revalidate real Alpaca positions/open orders just before POST. Do not allow one bot's OCO or partial sell to conflict with another bot.
- [ ] **G2 — Partial-fill handling:** broker read → filled/remaining quantities → cancel residual entry when risk dictates → confirmed stop or safe flatten → virtual position update. Distinguish accepted, partially filled, fully filled, protected, pending protection and closed.
- [ ] **G3 — Broker protection proof:** independently GET the real broker parent and individual child/stop orders after each actual PAPER fill; verify symbol, bot client order identity, sell side, order type, broker status, stop price and enough shares. A requested stop is not an active stop.
- [ ] **G4 — Failure scenarios:** rejected entries/stops, stale quotes, missing bars, halt, expired/canceled order, timeouts, duplicate cron calls, market close, broker API errors, wrong symbol attribution, delayed DB sync and lost connection; ensure all are fail-closed with auditable follow-up.
- [ ] **G5 — Safe end-of-session:** pre-close entry cancellation, confirmed child OCO cancellation, independent fresh broker recheck, at-most-once exit submission and no overnight unprotected stock exposure; explicitly document halt/illiquidity cases where a flat position cannot be guaranteed.
- [ ] **G6 — Virtual-ledger reconciliation:** verify fills, broker fees where available, quantity, average entry, realized/unrealized P/L and after-close equity; no double application or cross-bot mixing. Confirm the Supabase PAPER-report scheduler succeeded through the trade, not merely before it.
- [ ] **G7 — One actual PAPER lifecycle:** save timestamped evidence for setup, authorization, broker submission, broker fill, active protection, management and exit, close journal, and bot-specific ledger. **One live PAPER pilot per bot is a minimum smoke test, not statistical strategy validation.**
- [ ] **G8 — Pre-start release review:** only when safety gates are confirmed, decide separately whether to lift one-entry pilots and allow repeat PAPER trades. Do not silently toggle execution flags or start the official challenge counter.

## Recommended work order

1. **Pulse fractional stop lifecycle (P0):** resolve the documented unsupported fractional bracket path and verify simple order + separate stop on a controlled, naturally qualifying PAPER opportunity.
2. **Fuse full pilot lifecycle (P0):** verify real scheduler authentication, protection on fills/partial fills and safe close. Fuse is **already implemented and armed for exactly one** PAPER entry; the missing evidence is broker-proven end-to-end behavior, not another generic executor rewrite.
3. **Cross-bot symbol reservation and journaling (shared P0/P1):** make every strategy participate before authorizing concurrent automated stock trades.
4. **Atlas v4 quote/data provenance and end-to-end authorization (P1).**
5. **Flash rejection/counterfactual calibration (P1)** while preserving thresholds and the actual/hypothetical distinction.
6. **Spark protected-position lifecycle surveillance (P2)** plus ongoing sync/fee checks.
7. **All eight bots pre-start signoff** against G0–G8. Keep recurring evidence audits, but do not add unrelated notification tasks.

## Verification notes and follow-up records

- **Oct 8 late evening CT:** checked Supabase live ledgers: Pulse $100 with flags `executionEnabled=true`, `fractionalExecutionEnabled=true`, no fractional claim; Fuse $100 with `executionEnabled=true`, `fusePilotEnabled=true`, no Fuse pilot claim, zero Fuse orders/positions; Atlas ~$99.755227, Spark ~$99.762004; Flash $100.
- Pulse's only observed SQQQ entry record was **rejected** with the unsupported fractional-bracket error; it has no broker order ID or fill. Avoid saying its complete fractional lifecycle is already proven.
- Flash has 26 completed counterfactual studies. Fuse has three recorded historical shadow studies, not actual executed fills.
- Vercel production was READY on the latest checked merge; deployment readiness alone does **not** prove authenticated CRON execution or protection.
- Existing related tracker: [pre-start coverage issue #49](https://github.com/zanibethel/CreatorHub/issues/49), [Fuse issue #35](https://github.com/zanibethel/CreatorHub/issues/35). Add evidence/PR links under the relevant gate when marking it complete.
- Update this document only after a fresh production check; avoid presenting historical snapshots as live current-day guarantees.
