# BigOrders Step 5 — owner-only Challenge Manager

**URL**: `/paper-trading/bots/challenges`

## Purpose

Provides a responsive CreatorHub owner-only control panel for independent PAPER shadow challenges. It does not change trading strategy engines, broker APIs, shared capital reservations, or legacy ledgers. The original `shared-paper-v1` is shown **read-only** and remains authoritative in `paper_shared_portfolio_scenarios`.

## Security and access

- **Authentication**: every page request and every API GET/POST verifies the current Supabase user using server-side `auth.getUser()`; anonymous and unconfirmed identities fail closed.
- **Authorization**: only a verified user UUID in private `paper_challenge_owner_access` plus current `creatorhub_account_access.access_level='full'`. Existing full-access users are NOT automatically owners. Bootstrap migration inserts only one exact preverified account, refusing absence or ambiguity.
- **Table**: RLS on, no grants to anon/authenticated, service-role SELECT only.
- **API**: `/api/paper-trading/bots/challenges/owner` is cookie-session authorized. No `CRON_SECRET` or `SUPABASE_SECRET_KEY` is sent to the browser. Legacy cron/operator routes remain secret-only.
- **CSRF**: POST requires a matching explicit `Origin` and `Content-Type: application/json`. The already-audited shared Zod schema performs strict shape/amount validation.
- **No-store**: protected requests are uncached and do not leak private balances to unauthorized requests.
- **Safety**: all management uses existing atomic SECURITY INVOKER PostgreSQL shadow RPCs; no brokerage execution flags or order routes are touched.

## UI

- Separate portfolio cards with current virtual cash/equity/reserves and version, plus research contributors and recorded funding count.
- Create shadow challenge with configurable opening virtual capital, 1–16 bot instances drawn from eight strategies (up to four copies of one type through this UI) and optional Catalog/Midas research contributors.
- Existing independent challenges can change participating bots, pause/resume/archive (where history restrictions allow) via optimistic account version checks.
- Record virtual deposits/withdrawals with reason, confirmation, version lock and stable per-request idempotency key. Failed requests do not claim success; refresh updates authoritative numbers.
- Warnings/blockers and observation-only status are displayed; linked original shared $5K challenge is read-only and cannot be virtually funded via this UI.
- A navigation link is available from Bot Lab; the challenge page itself is owner-gated.

## Release verification

Verify owner UUID bootstrap and RLS first, then CI tests and production Next build, then PR merge and Vercel exact-commit READY. Browser session manual validation should confirm unauthenticated access blocked and the verified owner can see/manage shadow challenges. Without a logged-in owner session available to remote tools, do **not** claim successful interactive owner-browser smoke testing.

No new challenges are seeded beyond the owner allowlist. No virtual funding or trade changes are applied by this UI migration. These controls change simulated shadow capital, not a live Alpaca account.

## Next

Owner-permission lifecycle settings and stronger audit/oversight, strategy attribution for challenge-specific observations, and risk budget allocation. Actual independent PAPER broker execution remains prohibited without account/symbol isolation, order lifecycle and protective stop validation.
