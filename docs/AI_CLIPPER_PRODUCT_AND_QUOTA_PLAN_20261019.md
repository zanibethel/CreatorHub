# CreatorHub AI Clipper — Product goals, YouTube quotas, and review passes

**Decision date:** 2026-10-19  
**Product workflow clarification:** 2026-10-19 — user explicitly requested both direct YouTube URLs and channel search, generated captioned clips, and ready-to-distribute output for four owned social destinations.  
**Status:** Direction approved for planning; each implementation pass requires a separate user "continue" / "ok go" before work begins.  
**Current discovery proposal:** [PR #137](https://github.com/zanibethel/CreatorHub/pull/137) (draft; do not merge/deploy as part of this planning pass).

## North-star experience

CreatorHub AI Clipper serves the owner's own projects **and** a multi-tenant paid creator service from one codebase.

1. A signed-in CreatorHub user chooses **either of two equally prominent starting points**: **Search YouTube** (channels, videos, and channel browsing inside CreatorHub) or **Paste YouTube URL** (video, Shorts, channel/@handle, or supported playlist URL). Neither path requires a plugin, MCP URL copying, or manual YouTube browsing.
2. Selecting a channel or pasting a channel URL opens its public video library and permits one-click bookmarking in the active CreatorHub workspace. Selecting a video or pasting a video/Shorts URL resolves and previews the exact public video, then opens a new Clipper project.
3. Users choose Auto, Economy, Balanced, or Premium processing, the number and approximate duration of clips, platform targets, and optional editing preferences. **CoOperative AI** routes eligible models/nodes by task and cost, favoring capable owner/linked compute, reserving a maximum budget and reconciling actual costs.
4. For **authorized source media**, the app transcribes speech, locates high-value moments, proposes clips, reframes for vertical 9:16 video, and renders edited exports with synchronized captions/subtitles (burned-in and/or optional sidecar). Clips must actually finish rendering and be playable before being labeled ready.
5. A **Clip Library / Distribution Queue** displays each rendered clip with thumbnail, source, duration, captions, editable hook/title/description/hashtags, preview, download, destination accounts, and per-platform readiness/validation status. Users can review/revise and approve each clip independently.
6. After one-time user-consented connection of their own destination account, the user can stage each approved clip for **their YouTube channel, Instagram professional account, TikTok account, and Facebook Page**; upload/publish/schedule through supported platform APIs only with the required app approvals, account permissions, and user confirmation.
7. The personal-use and paid multi-tenant service share the same processing pipeline; tenant-isolated projects, media, OAuth tokens, usage allowances, fair quotas, billing, job status, and per-platform publishing history protect each customer.

**Critical source-rights distinction:** Public YouTube search and URL pasting give CreatorHub a **discovery/selection/preview entry point**, not permission or technical authority to download the video's audiovisual content. Render jobs may start only after the user supplies their own original file, independently licensed source media, or a separately verified YouTube-approved source mechanism. **Do not silently download YouTube videos or mislabel a metadata-only video as clip-ready.** Google OAuth for the destination account does not remove the YouTube API's prior-written-approval requirement for downloading/importing content.

## Full product workflow: Find → Create → Prepare → Distribute

| Stage | User-facing behavior | Ready condition |
| --- | --- | --- |
| **Find** | Search public YouTube channels/videos *or* enter a direct URL; browse a channel and select a video. | Correct ID and metadata resolved; public embedded preview available if supported. |
| **Source** | Associate that selection with an upload/original file, a separately licensed asset, or an explicitly YouTube-approved import route. | Server has actual permitted video bytes and a documented source/rights status. |
| **Generate** | Launch a budgeted CoOperative job; transcribe, score highlights, cut, reframe, generate captions, and render a batch. | Rendered media accessible, playable, caption timing verified, actual cost recorded. |
| **Clip Library** | Review clips individually, make subtitle/title changes, select channel-specific variants, and approve. | Clip has an approved immutable version and valid target-specific export. |
| **Distribute** | Choose the **user's own** connected YouTube/Instagram/TikTok/Facebook destinations, edit captions/hashtags, schedule where supported, and publish only by explicit approval. | Authorized connection, supported posting permission, platform validation, and confirmation; track queued/submitting/published/failed separately. |

**Distribution format contract:** Export portable H.264/AAC MP4 where supported; prioritize 9:16 vertical; validate actual target duration, frame rate, audio, aspect ratio, file size, thumbnail/text policies, content classifications, and per-platform restrictions **at publishing time**. Maintain per-destination overrides because publishing one identical file to all four services is not always valid. Show a clear reason for blocked destinations and preserve a downloadable file when direct posting is unavailable.

### Platform connection and publishing boundaries

| Destination | Intended integration | Important limitation |
| --- | --- | --- |
| **YouTube** | Separate Google OAuth with least-privilege `youtube.upload` and verified destination channel; resumable `videos.insert` after clip review. | Public channel bookmarking is not authorization to upload. The API has project quotas and account privacy options. |
| **Instagram** | Account-owner consent and Reels publishing for eligible professional Creator/Business accounts, using the supported Instagram Login or Facebook Login flow. | Not all personal/consumer accounts are supported; ensure the exact chosen login flow and required app permissions are approved. |
| **TikTok** | Content Posting API: `video.publish` for authorized direct posting or `video.upload` for inbox/draft handoff; show creator-chosen privacy settings. | App review/audit may be needed for public direct posting; unaudited direct-post clients are restricted to private content. |
| **Facebook** | Facebook Login, Pages authorization, Page-level token and Reels/video publishing to a Page the user manages. | **Pages**, not arbitrary personal profiles or groups, are the initial supported destination; Page posting requires appropriate Meta permissions. |

The existing CreatorHub repository has Instagram/TikTok OAuth foundations; publishing scopes and operational approvals must still be verified. **YouTube owner publishing OAuth and Facebook Page publishing are not currently implemented** in the reviewed repo. Treat account connection, rendered-media readiness, and actual publishing success as distinct states. Never claim a post published merely because a request was queued.

Official API references: https://developers.google.com/youtube/data/reference/rest/v3/videos/insert ; https://developers.tiktok.com/docs/en/content-posting-api-get-started ; https://developers.tiktok.com/docs/en/content-posting-api-get-started-upload-content ; https://www.postman.com/meta/instagram/folder/y6xustx/reels-publishing ; https://www.postman.com/meta/facebook/documentation/r56bjfd/facebook-api

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
| **0 — This pass** | Persist full search-or-URL → authorized source → captioned clip → four-destination distribution goals, quota facts, risk boundaries and this checklist in the existing documentation PR #138. | **Stop for review. No runtime code or database writes.** |
| **1 — Quota enforcement** | Atomic Supabase quota ledger/service, wire into `/api/clipper/youtube/search`, account/global throttles, telemetry, and tests; no UI redesign. Work as a **separate, reviewable PR** (stacked onto PR #137 if needed while #137 remains unmerged). | Demonstrate per-account separation and provider-pool safety. Stop. |
| **2 — Direct URL intake** | Add first-class YouTube watch/Shorts/channel/@handle/playlist link parsing, secure canonical-ID resolution, clear input errors and video-selection UI to PR #137 discovery foundation. Do not download video bytes. | Validate URL variants, pasted hostile URLs, no arbitrary server-side fetch or SSRF; stop. |
| **3 — Discovery acceptance** | Review the discovery PR and quota/URL passes together, confirm key restrictions, review/apply migration(s) only if separately authorized, and test mobile search/bookmarks/preview/direct-URL selection with real API credentials. | No merge/deploy without separate explicit instruction; stop. |
| **4 — Authorized media intake** | Attach uploaded/owned/licensed video bytes to a selected YouTube URL or search result in a tenant-owned Clipper project and create asynchronous jobs. | Test media rights status, source matching, access isolation and resumable upload; stop. |
| **5 — AI transcript/highlights** | Worker transcription, timestamping, candidate highlights and review UI using CoOperative's capability-aware routing. | Validate time alignment, cost ceiling and retry behavior; stop. |
| **6 — Captioned rendering/editing** | FFmpeg clip batches, synchronized subtitles, vertical framing, previews, optional caption editing, and downloadable final exports. | Validate playable final video, captions, output size and actual compute cost; stop. |
| **7 — Clip Library & distribution staging** | Per-creator clip library, format checks, metadata/caption overrides and approval-based ready-to-distribute queue for all four destinations. | No false "ready" status and no posting without connected account approval; stop. |
| **8+ — Connectors, publish & monetization** | Build YouTube channel owner OAuth, Facebook Page OAuth, verify/upgrade Instagram and TikTok publishing scopes, then add each platform's posting flow **in separate reviewable passes**. Add credit/billing/analytics in further isolated passes. | Validate one destination at a time, consent, publish result, retry/idempotency and paid margin. Stop after each pass. |

**Source-of-truth and conflict handling:** PR #137 already implements only the proposed discovery interface. This document does not claim those changes are live. Before starting any later pass, check current `main`, open PRs, Supabase migrations and deployment state, and adapt rather than rewrite or duplicate existing work. Do not bundle unrelated fixes.

## Product decisions not yet locked

- Initial per-account cap of 5 searches/day vs another modest number; quota tiers and any admin exceptions.
- How to reserve global quota for admin testing, paid plans, and fair access as user count grows.
- Whether to cache public results shared across accounts and which retention rules are permitted.
- YouTube OAuth scopes, video import legality, and publishing permissions for specific creator workflows.
- Dedicated worker/node availability, FFmpeg runtime requirements, model quality targets, and actual per-minute rendering costs.
- Paid plan pricing, allowances, and minimum margin.

Keep these decisions explicit; do not silently treat a proposal as user approval or production configuration.
