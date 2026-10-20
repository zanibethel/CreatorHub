# CreatorHub AI Clipper — Product goals, YouTube quotas, and review passes

**Decision date:** 2026-10-19  
**Status:** Direction approved for planning; each implementation pass requires a separate user "continue" / "ok go" before work begins.  
**Current discovery proposal:** [PR #137](https://github.com/zanibethel/CreatorHub/pull/137) (draft; do not merge/deploy as part of this planning pass).

## North-star experience

CreatorHub AI Clipper serves the owner's own projects **and** a multi-tenant paid creator service from one codebase.

1. A signed-in CreatorHub user searches YouTube channels or videos **inside CreatorHub**, views results and previews, and bookmarks a public channel in a chosen creator workspace.
2. Users do **not** need to copy MCP URLs, manage plugins, or paste YouTube links for ordinary discovery; optional URLs remain a fallback.
3. A public channel bookmark **is not** an authenticated YouTube connection and conveys no ownership or copying rights.
4. Connecting an owned YouTube account for owner-only data or publishing is a separate, user-consented Google OAuth flow. It must not be mandatory for public-channel search.
5. AI clipping operates on uploads/original media, licensed material, or another YouTube-approved source mechanism. A public YouTube video URL or channel OAuth access alone must **not** trigger downloading video/audio.
6. Users may request Auto, Economy, Balanced, or Premium processing, with optional expert overrides. **CoOperative AI** chooses eligible models/nodes by stage, favors suitable user-owned/linked compute, enforces a reserved maximum budget, and reconciles actual cost. Separate tasks include transcription, timestamps/diarization, highlight suggestions, reframing, subtitles, FFmpeg renders, and QA.
7. The final paid product will have tenant-isolated media/jobs, usage limits, billing, human preview/approval, and authorized publishing/analytics integrations. No automatic publication in early passes.

**Boundary:** This work must not modify PAPER-trading logic, trading cron jobs, broker credentials, or trading deployments.

## Answer to the per-user YouTube quota question

**Yes, CreatorHub can issue an independent application-level daily allowance per logged-in CreatorHub account. No, that is not a separate Google quota pool for each account.**

- CreatorHub's backend authenticates the signed-in Supabase user, checks their account permission and workspace ownership, then makes the YouTube request using a **server-owned** restricted credential. Never expose the key to a browser.
- The Google quota is associated with the **YouTube API / Google Cloud project**, not with each CreatorHub login or OAuth-granted Google account.
- As of the 2026-10-19 documentation review, the YouTube Data API default project allocation is **100 `search.list` calls per day in its own Search Queries bucket**, **100 `videos.insert` calls/day in a separate bucket**, and **10,000 units/day combined for other endpoints**. Google's quotas are subject to change and must be checked in the actual Cloud Console. Search pagination also incurs calls.
- Google's `quotaUser` identifier supports *per-user requests-per-second* enforcement, not independent per-user daily quotas. Do not send raw private account data to Google for this purpose; decide separately whether a pseudonymous ID is necessary.
- Giving each of 10 CreatorHub accounts an internal '100/day' allowance **does not** create 1,000 Google search calls/day. In the default project, they still share 100 upstream searches total.
- Do **not** split the same CreatorHub YouTube discovery use case across artificially created Google Cloud projects/keys to manufacture extra quota; YouTube explicitly prohibits quota sharding. Larger legitimate capacity requires a compliant YouTube API quota extension/audit.
- User-entered YouTube OAuth credentials do not automatically change the project quota.

Official evidence:
- https://developers.google.com/youtube/data/getting-started
- https://developers.google.com/youtube/v3/docs/search/list
- https://developers.google.com/youtube/data/determine_quota_cost
- https://support.google.com/googleapi/answer/7035610
- https://developers.google.com/youtube/terms/developer-policies-guide
- https://developers.google.com/youtube/v3/guides/quota_and_compliance_audits

## Application-side quota contract for the next implementation pass

**Proposed initial allowances, to approve separately:** conservative **5 upstream search calls/account/day**, platform-side cap **90 upstream search calls/day** until real project settings are confirmed (10-call operational headroom). These are configuration proposals, **not** provider-assigned entitlements and **not implemented by this document**. A 100-search/day *per-account* plan becomes feasible only if our actual project quota supports enough aggregate capacity.

- Usage counted against the **authenticated CreatorHub `auth.users.id`**, not each creator workspace, so creating many creator workspaces does not reset a user's budget.
- Store `workspace_id` only for attribution and authorization, not an extra allowance.
- Apply a **global project daily bucket** plus a **per-user daily bucket**; a user must have room in both before any outbound request.
- Use atomic database reservations/updates in a server-only service or Postgres function. Concurrent requests, multiple instances, retries, and parallel tabs must not bypass either ceiling.
- Day boundaries match Google's midnight **Pacific Time (America/Los_Angeles)**, including DST. Store time and accounting records in UTC with an explicit provider-period identity.
- Distinguish buckets by operation: the `search.list` cap is *not* a blanket 100/day allowance for `channels.list` or all other API calls. Track higher-cost/method-specific usage separately when integrated.
- Reserve the budget **before** forwarding an uncached request. Failed/invalid calls may still consume provider quota; do not automatically refund ambiguous failures or claim accuracy for calls made by other external clients.
- A *verified compliant* cache hit that makes **no** upstream request should not decrement provider-call counters. Enforce terms-compliant retention/refresh periods and keep tenant-private content isolated.
- Provide a clear account UI / API: searches used today, allowance, next reset, and whether the user's own allowance or CreatorHub's shared pool caused a block. Avoid exposing another account's identifiers or usage.
- Apply a server-side burst rate limiter and abuse controls. The daily quota alone does not address repeated concurrent requests or automated spam.
- Use the API Console to reconcile provider-side quota with CreatorHub reservations, including out-of-band provider use, and stop safely before exceeding the verified project limit. Server reservation counters are application telemetry, not a claim to be Google's authoritative usage report.
- Treat rate-limited results as expected statuses, not as reasons to rotate keys or silently switch Google projects.
- Authorization, validation, and capacity checks all happen on the server. No client-enforced-only counters.

### Acceptance criteria for quota enforcement

1. Two separate signed-in test accounts have independent allowance counters, but share one provider project cap.
2. Multiple creator workspaces for the *same* user share one account allowance.
3. Parallel requests cannot exceed either cap; blocked requests make **zero** outbound Google API calls.
4. Missing Google key, provider 403/429, malformed queries, upstream outages, and cold/warm cache paths behave correctly.
5. A Pacific midnight rollover resets the right accounting periods, including DST changes.
6. Anonymous and transfer-only users cannot search; account A cannot inspect or modify account B's quota records.
7. A test with a synthetic low project cap demonstrates graceful project-exhausted behavior even if a user's own account budget remains.
8. CI tests pass; no real Google calls required in unit tests; verification of production quotas is separate.

## Controlled implementation sequence: exactly one reviewable pass at a time

Every pass produces **one narrowly scoped PR with tests and a short verification note**; it remains unmerged and undeployed unless the user explicitly authorizes that action. When a pass is complete, **stop**. The next pass begins only after the user says **"continue"** or **"ok go"**. Those words approve *starting the next pass*, not automatically merging, migrating production, or deploying.

| Pass | Deliverable | Review boundary |
| --- | --- | --- |
| **0 — This pass** | Persist north-star goals, quota facts, proposed limits, risk boundaries, and this checklist in a standalone documentation PR. | **Stop for review. No runtime code or database writes.** |
| **1 — Quota enforcement** | Atomic Supabase quota ledger/service, wire into `/api/clipper/youtube/search`, account/global throttles, telemetry, and tests; no UI redesign. Work as a **separate, reviewable PR** (stacked onto PR #137 if needed while #137 remains unmerged). | Demonstrate per-account separation and provider-pool safety. Stop. |
| **2 — Discovery acceptance** | Review PR #137 and Pass 1 together, set/restrict YouTube server key when approved, apply only reviewed migration(s), test mobile channel search/bookmarks/preview, verify quotas and production gating. | Merge/deploy only upon separate explicit instruction; stop. |
| **3 — Authorized media intake** | Attach a licensed/original upload to a Clipper project and create tenant-owned asynchronous jobs; reuse existing uploads safely. | Test access isolation, file size and rights attestations; stop. |
| **4 — AI transcript/highlights** | Worker transcription, timestamping, candidate highlights and review UI using CoOperative's capability-aware routing. | Validate time alignment, cost cap, failure recovery; stop. |
| **5 — Rendering/editing** | FFmpeg cuts, 9:16 framing, captions, speaker-aware follow, preview and export for authorized source files. | Validate actual output files, sync, duration and costs; stop. |
| **6 — Creator productization** | Plans/usage credits, purchase flow, job lifecycle/admin cost dashboards; then owner OAuth and supported social publishing in further isolated passes. | No automated posting without approval and permissions; stop. |

**Source-of-truth and conflict handling:** PR #137 already implements only the proposed discovery interface. This document does not claim those changes are live. Before starting any later pass, check current `main`, open PRs, Supabase migrations and deployment state, and adapt rather than rewrite or duplicate existing work. Do not bundle unrelated fixes.

## Product decisions not yet locked

- Initial per-account cap of 5 searches/day vs another modest number; quota tiers and any admin exceptions.
- How to reserve global quota for admin testing, paid plans, and fair access as user count grows.
- Whether to cache public results shared across accounts and which retention rules are permitted.
- YouTube OAuth scopes, video import legality, and publishing permissions for specific creator workflows.
- Dedicated worker/node availability, FFmpeg runtime requirements, model quality targets, and actual per-minute rendering costs.
- Paid plan pricing, allowances, and minimum margin.

Keep these decisions explicit; do not silently treat a proposal as user approval or production configuration.
