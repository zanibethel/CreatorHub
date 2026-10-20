# AI Clipper — Pass 1 review: YouTube API quota enforcement

**Status:** Draft implementation PR; not merged or deployed. Stacked on discovery PR #137. Single scoped change: YouTube API request throttling, counters and authorization checks.

## Behavior

- YouTube API calls remain **server-side** under the platform's restricted `YOUTUBE_DATA_API_KEY`.
- `search.list` default: **5 requests per logged-in CreatorHub account per Pacific day**; **90 per shared CreatorHub Google project per day**; **3 per account per minute**.
- `channels.list` metadata for saving a public channel is also counted, but separately: **50 per account/day**, **9,000 per project/day**, **10/account/minute**. Channel lookup is a different provider API operation and quota cost from search.
- Creating a second creator workspace **does not** grant extra user allowance. Every search requires an owned CreatorHub workspace.
- Every upstream call now disables Next's fetch cache. First atomically reserve one request, then call Google; on an ambiguous provider failure **do not refund**. If a quota reservation fails, **do not call Google**.
- Postgres `clipper_youtube_reserve_quota` uses service-role-only transactional project → account → burst row locks to serialize concurrent requests, with the daily reset computed in `America/Los_Angeles` including daylight-saving transitions.
- The `/api/clipper/youtube/quota?creatorId=<owned-workspace-uuid>` endpoint returns only the authenticated user's search count/limit and the shared project count/limit; it does not return other users' data.
- A small counter in the Clipper search UI shows the account and platform usage, without changing discovery or clipping behavior.

## Configurable server environment

| Variable | Default |
| --- | ---: |
| `CLIPPER_YOUTUBE_SEARCH_ACCOUNT_DAILY` | 5 |
| `CLIPPER_YOUTUBE_SEARCH_PROJECT_DAILY` | 90 |
| `CLIPPER_YOUTUBE_SEARCH_PER_MINUTE` | 3 |
| `CLIPPER_YOUTUBE_CHANNELS_ACCOUNT_DAILY` | 50 |
| `CLIPPER_YOUTUBE_CHANNELS_PROJECT_DAILY` | 9000 |
| `CLIPPER_YOUTUBE_CHANNELS_PER_MINUTE` | 10 |

These are **application** budgets; changing environment variables does not change Google quotas. Do not increase global limits beyond verified Google Cloud allowance. These counters cannot see provider calls from other applications/keys in the same Cloud project. Before a live deployment, reconcile provider usage, reserve headroom, and consider a lower effective cap if other clients use the project.

## Review/test plan

1. Review the quota migration `20261020100000_clipper_youtube_api_quota.sql` independently before applying it. The earlier discovery migration must also be approved/applied; neither is applied by this PR.
2. CI: `npx tsc --noEmit`, `npm run lint`, `npm run test:paper`, `npm run test:clipper`, `npm run build`.
3. With an isolated test database, run **true parallel SQL RPC calls** across two users and multiple workspaces to verify project/account serialization. The JS test simulates the concurrency contract, but it is **not a substitute** for a Postgres integration test.
4. Verify anonymous, transfer-only, unknown creator, and cross-tenant requests are rejected without a provider call.
5. Verify missing API key and missing/unavailable RPC fail closed; verify provider failures do not reset counters.
6. Verify two Pacific midnight rollovers (spring/fall DST), burst limit, daily allowance, shared project exhaustion, status counter and mobile rendering.
7. Reconcile Google Cloud usage and mark any quota discrepancies before real-world use. Any future caching must be compliant and count only actual outbound calls.

**No changes** to CoOperative personal-node integration, the Clipper rendering pipeline, social publishing, paper trading, production secrets, production database, or deployed Vercel applications.

**Follow-up after explicit user review:** Pass 2 — direct YouTube URL parsing/selection, in its own PR. Do not merge/deploy by interpreting “continue” as production approval.
