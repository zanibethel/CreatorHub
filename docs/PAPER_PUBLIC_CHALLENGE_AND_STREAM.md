# CreatorHub public AI bot challenge, live carousel, and development journal

**Status:** Approved product direction; implementation pending. Documented 2026-10-08.  
**Source of truth:** This document specifies the desired public experience. Existing routes, scheduling, and storage are not automatically changed by this plan.

## Non-negotiable owner decisions

1. **Do not start the official challenge/day counter now.** The owner will explicitly request "start the challenge" **after the display carousel is finished and reviewed**. No deployment, preview, test, migration, or visitor action may implicitly start or reset it.
2. The official challenge starts only after the owner reviews the bots' decision logic, data quality, simulated order lifecycle, safety gates, and carousel. There is a **proposed 30-calendar-day preseason** to collect evidence; the calendar is not a launch trigger.
3. Produce **on-demand daily conversation + engineering summaries** whenever the owner asks what happened that day. Treat them as **private drafts requiring owner edits/approval** before public publication. **Do not create scheduled tasks or automatic publishing** for this workflow unless explicitly requested later.
4. Build a **slow, unattended, auto-rotating live display** and a **matching interactive public website**. The display should show a **QR code and readable destination URL on each slide** that opens the exact corresponding interactive page/state. Visitors must be able to click into bots, journal entries/history, orders/trades, and supporting detail, and scroll manually at their own pace.
5. Public views are strictly read-only. **Simulated trading must be clearly labeled**, no private broker keys or account IDs are exposed, and public interactions never route an order.
6. Do not represent planned features, hypothetical profit, scanner predictions, incomplete fills, or failed tests as completed and verified events. Public claims and statistics need underlying evidence.

## Product concept

A transparently documented, publicly watchable AI trading **simulation** that shows performance and operational learning as it happens. A person seeing a monitor or video stream can scan the QR code and open the **same report content**, current slide, bot, journal entry, or order in an interactive browser, with navigation and scrolling entirely under their control. The web page is the source of truth; a future video broadcast (e.g. YouTube/Twitch/OBS capture) reuses the presentation instead of operating as a separate data source.

### Two related display modes

| Mode | Behavior | Interaction |
| --- | --- | --- |
| **Presentation / carousel** | Kiosk-style, full-screen-ready, slow automatic advance through curated slides; persistent readable short URL plus slide-specific QR deep link | Pause/resume, previous/next, and owner setup controls; keep visible UI sparse for streaming |
| **Interactive public site** | Same components, metrics, styling, detail content, and event state as the display; loads directly to the scanned slide/detail | Buttons and links really work; manual navigation and scrolling; **no forced automatic advance**; no sign-in needed for read-only exploration |

Maintain a common presentation schema and responsive shared components rather than making visitors land on a different-looking marketing page. Interactive state belongs to each viewer: a broadcasting machine's rotation **must not** drive another browser's slide or interrupt a visitor reading an entry. A new viewer opens the scanned deep link with rotation disabled.

Existing report `/paper-trading` currently rotates five views every 12 seconds and stops when interacted with. This plan **extends, rather than falsely claims to replace**, that existing behavior. Routes to consider: `/paper-trading/live` for broadcast display; `/paper-trading` (or a `?view=` deep link) for interactive report; `/paper-trading/bots` and durable bot/detail routes; journal and order detail URLs. **Actual route names must be finalized against working route structure during implementation.** Every public QR code must link to a route already deployed and tested.

### Suggested carousel lineup

1. **Challenge overview:** preseason/official day state, $1,000 simulated program, six $100 reserved pools and $400 unallocated, portfolio changes, simulated P/L, freshness timestamp.
2. **Portfolio performance:** chart and verified balance/performance breakdown; exact distinction between virtual ledgers and external execution infrastructure.
3. **Bot spotlight(s):** bot name, strategy/version, active/planned status, score, holdings, realized/unrealized P/L, risk, research/readiness and current blockers. Cycle bot pages over time, including inactive bots clearly labeled.
4. **Prospects/watchlist:** discovered candidates, scanner and strategy scores shown separately, stage and signal freshness, why watchlist placement is not execution approval.
5. **Orders/trades/positions:** verified lifecycle status, planned vs staged vs submitted vs filled vs canceled vs rejected; stop/target and fees where available; direct link to immutable detail.
6. **Daily journal / Behind the Bots:** latest **approved** daily summary, notable observation, changes, what remains uncertain, playful notes when appropriate; QR deep link to that entry and browsable full history.
7. **Support/advertising** slots: optional vetted destination and QR, not misleadingly mixed into portfolio accounting. Only show support or ad purchase pages after their destination/checkout has actually been verified.

Do not expose hidden account data, private operational controls, or unsupported order details in broadcast mode. It is fine to rotate through condensed excerpts, provided the scan link opens the **full** corresponding interactive detail.

### Rotation, display, and QR acceptance requirements

- Start with a configurable **30–45 second slide interval** for initial usability tests (the 12-second existing interval is too fast for the new narrative). Longer/journal slides may need more time; final timing is subject to owner approval.
- Slow cross-fade or horizontal transition; no accidental lateral scroll, clipped content, layout jumps, or UI overflowing mobile viewports. Preserve the existing reduced-motion behavior and clear pause/next controls.
- Visible display continuously shows site URL plus a **separate high-contrast, scannable QR code for the specific current slide**. Refresh both when the slide changes. Allow the owner to copy that exact deep link.
- A QR scan opens the current content in the interactive site (not a still image), with all applicable drilldowns clickable, manual scrolling unrestricted, and auto-rotation **off by default**.
- Navigation: overall program > specific bot > positions/orders/trades/prospects > individual immutable event/detail, plus journal index > dated approved entry > related event/commit when public. Back and direct links should work; deep links should survive reload/share.
- Prefer server-side curated, safe data projections; cache and update with freshness timestamps. Clarify quote-source delay, paper simulation, polling vs truly streaming updates. Missing data is marked unavailable instead of zero or success.
- Public audience never changes bot settings, submits orders, approves journals, views internal credentials or private order identifiers.
- A future broadcast should be operable in a stable display browser while all visitors independently explore the public site.

## Challenge phases and start-date governance

### Phase A — Preseason (development and observable testing)

Aim for about **30 calendar days** of representative market observations, scanner evidence, simulated execution, strategy versioning, and reconciliation. Keep preseason clearly marked as experimental; the public can watch progress before the challenge officially begins. More time is needed if trade samples, market regimes, or execution coverage are insufficient. Do **not** manufacture trades merely to fill a quota.

Collect all scanner candidates and non-promotions, why signals were rejected, trade-plan changes, staged/canceled/expired orders, simulated fills, fees/spread/slippage observations, stop/target management, daily reconciled ledgers, errors, outages, recovery, and bot/strategy version changes. Preserve missed opportunities and negative outcomes.

### Phase B — Readiness gate

Require demonstrable end-to-end event tracing, complete and separate virtual-ledger accounting, reasonable quotes with labeled staleness/delay, broker paper lifecycle checks, working risk gates and reconciliation, approved public projections, stable carousel/deep links/QR tests across mobile and desktop, and human audit of report vs actual recorded events. Suggested minimum operational soak: **seven consecutive days without critical data loss/ledger corruption or unhandled execution faults**, plus enough completed simulated trade lifecycles to evaluate active strategies; no fabricated profitability threshold. Record the remaining caveats openly.

### Phase C — Owner-authorized launch

Only after the owner explicitly instructs it, create an **authoritative one-time start timestamp** in a protected database record (recommended Supabase), record owner approval/time/strategy-version baseline, and begin immutable public **Challenge Day 1** counting. UTC timestamp plus America/Chicago presentation/day boundary, documented consistently. Starting the challenge **must not** reset balances, rewrite trade history, or retroactively fold preseason results into official P/L. No anonymous controls may edit the start.

Keep pre-launch resets/preview controls confined to development and clearly separate from official challenge history. Corrections after launch should be audit-versioned, never silent date rewrites.

## Daily owner-reviewed journal ("Behind the Bots")

### Trigger and publication

- **On request only:** When the owner asks e.g. "What did we do today?", "Today's CreatorHub report", or "Draft Day 12," compile a private day-specific draft from available conversation/project decisions, GitHub commits/PRs, deployment evidence, logged scanners, orders, trades, failures, fixes and tests.
- The report should be grounded in **available verifiable sources**. If conversations/logs were not accessible, ask for missing context or say so; do not guess. Distinguish *discussed/proposed*, *coded/committed*, *deployed*, and *verified working*.
- **Private draft → owner review/edits → explicit approval → published entry.** No default reminder, daily automation, schedule, automatic publishing, or implied approval.
- The day heading is **"Preseason — [date]"** until owner-authorized Challenge Day 1. Preseason Day N is optional only if a separate, defined preseason baseline exists; never silently start the official counter just to label preseason reports.
- Archive drafts and publication approval metadata separately; published entries are durable and corrections are dated/versioned (avoid invisible editing of prior-day evidence). Keep private incident, financial, or identity data out of public entries.

### Suggested entry format

> **Preseason — [date] / Challenge Day N (only after official start)**  
> **Today we noticed:** [verified findings, observed market or bot behavior]  
> **What worked:** [tests and outcomes]  
> **What didn't:** [errors, misses and limitations]  
> **What changed:** [actual code/logic/settings; status: proposed/committed/deployed/verified]  
> **Tomorrow we're watching:** [ongoing checks and unresolved issues]  
> **Behind the Bots:** [light, engaging note — e.g. humorous hungry-bots support mention, only when the support page is actually live and verified]  
> **Evidence / sources:** [commits, observations, event IDs stripped of secrets, public links as appropriate]

Owner-facing drafts also include **approval needed**, evidence gaps, editorial notes, and claims requiring verification. Public summaries should be conversational, readable and genuine—not boilerplate or marketing promises of profitable trading.

### Planned storage and reader UX

Proposed protected Supabase journal records: date, phase, title, draft body, public body, source/evidence references, relevant bot IDs/event IDs, strategy versions, status (`draft`, `approved`, `published`, `retracted`), author/approver, timestamps, publication version and change history. Keep write/admin endpoints authenticated and out of anonymous read roles. Expose only approved public projection via a read-only endpoint. Readers can browse journal timeline, filter by bot/date, drill into an entry, and click to corresponding public bot/trade/order detail, with a deep-link QR from the carousel.

## Implementation slices (future work, not completed by this documentation commit)

1. Audit existing report carousel, mobile breakpoints, sponsor QR links, bot and order/detail routes, logging schema, and current public data projections.
2. Design shared slide/detail navigation contracts and stable shareable deep links; make carousel and interactive viewer use the same components and data. Test interactive page on a separate device.
3. Add slower owner-configurable carousel, per-slide QR and readable URL, full-screen streaming layout; retain reduced-motion and manual pause/next.
4. Implement read-only, drillable bot / event / order / journal route hierarchy with honest lifecycle timestamps and all buttons/links functional.
5. Implement protected journal draft/approve/publish database and API with public read-only history, and on-demand report drafting process (no scheduler).
6. Wire in optional verified support/advertising slots and public broadcast output only after secure links and true end-to-end display are tested.
7. Run preseason and readiness evaluation. **Wait for the owner's separate start-the-counter request after carousel completion**; only then provision the official immutable challenge start.

## Definition of done before the owner's launch request

- Every slide auto-advances slowly and stably; QR and textual link resolve to exactly the displayed page or event.
- A separate viewer can open the scanned URL and freely click, navigate, scroll, and stay on a page without the kiosk forcing it to change.
- Bot, trade, order, prospect, and journal pages are backed by real, correctly labeled simulated evidence; unsafe/private fields never leave the server.
- A daily journal draft can be requested on demand, reviewed/edited by the owner, and published **only after explicit approval**.
- Public preview is visibly preseason; journal history is auditable; no official day count is started prematurely.
- Works on iPhone/mobile and desktop; broadcast/capture layout remains legible, QR scans from a typical viewing distance, and any eventual livestream points to the matching public interactive URL.

## Related docs

- `docs/PAPER_TRADING_LAB.md` — current five-view public report, market feed, and browser-local settings.
- `docs/PAPER_BOT_PROFILES.md` — isolated bots, starting capital and comparison measures.
- `docs/PAPER_LIVE_READINESS_PLAN.md` — paper execution and safety prerequisites.
- `docs/PAPER_EVIDENCE_AND_STRATEGY_REVIEW.md` — decision/event journaling and review.
- `docs/PAPER_PROSPECT_SCANNER.md` — candidate discovery and promotion evidence.
