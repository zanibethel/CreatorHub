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
- Harbor's **14:55:07 UTC** cron returned HTTP 200/action `none`, but
  that invocation was before the #96 production READY timestamp and
  therefore is **not** post-deployment proof. A later real cron still
  needs verification.

**Cross-bot evidence:** Coil remains disabled; no shared stock reservation
was released and no PAPER stock buy was forced. Spark's BTC/USD was the
only broker physical position at this stage, with a matching open
protective stop-limit sell. Do not conflate the physical Alpaca account
balance with either bot's independent virtual equity.

**Next gates:** verify Harbor and Fuse scheduled invocations after their
respective deploy timestamps; observe naturally qualifying broker fills
before signing G2/G3/G5/G6/G7; reconcile SNAP independently before any
operator-authorized release. Global crypto scheduler G0 remains open.
Official challenge/day counter **UNSTARTED**.

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
