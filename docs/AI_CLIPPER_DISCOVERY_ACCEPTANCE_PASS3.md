# AI Clipper — Pass 3 discovery acceptance review

**Status:** An isolated, reviewable verification PR. The full YouTube/Clipper stack is not merged or live.

Reviewed:
- [PR #137 — in-app YouTube discovery](https://github.com/zanibethel/CreatorHub/pull/137)
- [PR #139 — account/project quota enforcement](https://github.com/zanibethel/CreatorHub/pull/139)
- [PR #140 — direct YouTube URL intake](https://github.com/zanibethel/CreatorHub/pull/140)

## Findings and verified boundaries

1. **GitHub code:** Pass 2 CI completed successfully (TypeScript, ESLint, existing paper-trading regression, Clipper unit tests, build); these checks do **not** demonstrate that production configuration or OAuth/YouTube API calls are working.
2. **Supabase:** The connected project `yufptpfiwdbzzrvhkvux` has **no applied `clipper_youtube_channels` table, quota ledger, or quota RPC**. The three migration files remain proposed, not deployed.
3. **Development database:** No Supabase branches existed when checked. Creating one requires explicit **hourly-cost confirmation**, so no new paid branch was created. This PR uses a self-contained PostgreSQL 17 GitHub Actions service instead, seeded with minimal mock auth identities and isolated creator workspaces. This validates real SQL transactions but not live Supabase PostgREST/Auth deployment behavior.
4. **Vercel:** The connected Vercel CreatorHub project has no environment variable named `YOUTUBE_DATA_API_KEY` in its visible env-var inventory. Without a restricted YouTube Data API v3 server key, real authenticated YouTube discovery and direct URL lookups cannot be exercised end-to-end. **No secret values were requested or read.**
5. **Playlist correctness issue corrected in this PR:** `playlistItems.snippet.channelId` is the playlist channel, not reliably the video owner. The `/resolve` endpoint no longer assigns that channel to unrelated videos when `videoOwnerChannelId` is absent. The playlist preview now uses `videoOwnerChannelId` and `videoOwnerChannelTitle` (rather than playlist-owner metadata), and `contentDetails.videoPublishedAt` for the video's publish date rather than the date it was added to the playlist. Such entries are omitted from first-page results when the video owner cannot be verified; we prefer incomplete data over falsely attributing content. A pure unit test covers these distinctions.

## New isolated database acceptance check

`.github/workflows/clipper-postgres-acceptance.yml` starts disposable `postgres:17` only inside GitHub CI. It executes the **exact** three proposed migrations in order, after minimal test-only Auth/Creator bootstrap.

`tests/clipper-postgres-integration.test.mjs` verifies:
- true simultaneous PostgreSQL RPC reservations across two account IDs;
- shared project ceiling and separate per-account ceilings;
- no counter increments for rejected reservations, including minute-level burst limit;
- Pacific midnight reset on the DST fall-back boundary;
- anonymous/authenticated denial of service-only ledger and quota function;
- two distinct accounts' saved public-channel bookmarks protected by RLS, including anonymous-JWT rejection.

The script **refuses** any database URL other than `postgresql://postgres:postgres@127.0.0.1:5432/clipper_ci`. These tests do not query or mutate production, provision Supabase branches, or use real customer identifiers.

## Still required for *live* discovery acceptance

- Verify Google Cloud project quota and configure a restricted server-only `YOUTUBE_DATA_API_KEY` in an approved environment; do not paste the key into GitHub or chat.
- Review and authorize applying the three Clipper SQL migrations to an approved environment. Production migration execution is explicitly outside this pass.
- Test the real user flow with a logged-in CreatorHub account: channel search, video search, saved channel reload/removal, video/Short/@handle/playlist pasted URL, playlist with missing owner metadata, quota status, API key failure/quota exhausted, mobile usability.
- Test Supabase Auth/RLS and quota concurrency against an **isolated Supabase development environment** if approved and cost confirmed, because a vanilla PostgreSQL fixture cannot validate managed JWT/PostgREST behavior end to end.
- Verify project-wide YouTube API usage across *all* clients/keys; the individual application ledgers cannot see other applications' Google calls.

## Decision gate

Do not merge PRs #137, #139, or #140; do not apply migrations or deploy based on GitHub CI alone. A passing isolated-PostgreSQL test proves the SQL reservation contract under database concurrency, **not** a live YouTube integration. Leave runtime acceptance pending until credentials and a safely approved test environment are available.

Next planned feature after successful discovery acceptance: **Pass 4, authorized media intake**. A bare "continue" should not erase blocked acceptance requirements or approve production migrations.
