# BigOrders Step 4 — Operator-only shadow challenge lifecycle and virtual funding

**Scope:** PAPER-only challenge registry management. No user-facing credentials or broker execution.

## Features

- Privileged POST `/api/paper-trading/bots/challenges/manage` requires `Authorization: Bearer <CRON_SECRET>` (at least 32 characters) and `SUPABASE_SECRET_KEY` on the server; the secret must never be put into browser/client code.
- `create`: choose any 1–16 bot instances (canonical eight legacy strategies; duplicates of the same source strategy allowed with separate `botInstanceId`), optional Catalog/Midas research, `startingCapitalUsd` between $0.01 and $1,000,000, fixed audited preview policy, display name and permanent challenge ID. Uses one Postgres transaction. Always `standalone-shadow`, PAPER only, NULL broker account, and disabled broker execution.
- `configure`: replace participants/research and set preview/paused/archived lifecycle if caller supplies expected capital account version and challenge is independent, unarchived and has no recorded trade proposals. No edits to linked `shared-paper-v1` or any historical execution route.
- `fund`: signed USD-cent virtual deposit or withdrawal with a stable idempotency key and expected account version. Postgres locks challenge/account rows; validates positive equity, no negative settled cash or buying power, no reserved cash, shadow-only status, and inserts an immutable instruction plus immutable linked posting receipt atomically while updating virtual cash/equity and version. Repeated same-key/same-payload calls return the original receipt; a conflicting reuse is rejected. No actual brokerage funding or cash transfer.

## Accounting invariants

The append-only `paper_challenge_funding_events` from Step 3 remains `recorded-unposted` by schema. A new immutable `paper_challenge_funding_postings` receipt is the **sole evidence of actual shadow accounting posting**. A funding event without its receipt is pending and excluded from capital; with its receipt the new account balance is authoritative. The registry reconciles opening capital plus posted receipts against available shadow cash/equity, and reports anomalies. No transaction ever reads or mutates the eight historical $100 ledgers as cash sources.

The linked `shared-paper-v1` remains under `paper_shared_portfolio_scenarios` authority. The Step 4 RPCs refuse both its identifier and any challenge with `legacy_scenario_id` set. Existing $5,000 challenge equity is not counted again as funding.

## Security

All API inputs are Zod-validated. Only server-side service role can execute SQL RPCs; PUBLIC/anon/authenticated execute privileges are explicitly revoked. The unexposed `bigorders_private` schema houses helper identity/participant functions, with its schema usage revoked from public JWT roles. All financial tables are RLS-enabled; the new posting table has immutable update/delete trigger, no public grants. No RPC is `SECURITY DEFINER`.

Only POST actions are supported; the existing privileged GET registry reports account versions, participant identities, posted/unposted event counts, and fail-closed accounting issues. No web UI is exposed in Step 4 because an owner-authenticated UI must not leak CRON_SECRET.

## Operational limits

This is **virtual shadow-account bookkeeping only**, not spendable allocation or Alpaca broker cash. It does not permit challenge-specific trades, changes to physical positions, historic bot journal rewrites, order management, or automatic funding on a schedule. Policy is pinned to `shared-paper-capital-v1` and strategy-specific hard safety caps remain unchanged.

For further functionality, develop a dedicated owner-authorized UI and channel-safe user auth, per-challenge risk budgets, journal attribution and replay, then physical account isolation and protection before enabling PAPER execution.

## Validation

Run CI, deterministic tests, Vercel preview. Apply the forward-only migration and test create / configure / fund / idempotent replay / overspend rejection / cross-challenge isolation within **one explicit transaction rolled back**. Confirm no smoke-test rows persist. Verify RLS/grants, $5,000 shared original, eight $100 original ledgers and open Alpaca PAPER orders/positions. Only then merge and independently check production deployment commit.
