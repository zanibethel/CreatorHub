# BigOrders — Step 3: challenge persistence and virtual capital accounting

**Date:** 2026-10-09 America/Chicago. **Broker:** PAPER only. **Execution:** disabled.

## What Step 3 adds

Forward-only migration: `supabase/migrations/20261010030000_paper_challenge_registry_shadow_v1.sql`. It establishes six RLS-enabled, private tables:

| Table | Purpose |
| --- | --- |
| `paper_challenges` | Challenge identity, configurable starting virtual capital, policy, mode and one-to-one optional existing `scenario_id` link |
| `paper_challenge_bot_instances` | Independent `(challenge_id,bot_instance_id)` strategy identity/version; optional reference to original `paper_bot_ledgers.bot_id` as provenance only |
| `paper_challenge_research_contributors` | Optional Catalog/Midas evidence contributors. CHECK constraint forbids order rights |
| `paper_challenge_capital_accounts` | Shadow-only opening/snapshot amounts. Existing `shared-paper-v1` account explicitly labeled non-authoritative **mirror** |
| `paper_challenge_funding_events` | Chronological idempotent signed funding instructions: deposits, withdrawals, accounting adjustments. Append-only; all `recorded-unposted` until future safe posting work |
| `paper_challenge_proposal_journal` | Challenge/instance-scoped decision evidence and idempotency, composite FK to registered strategy participant; append-only and broker authorization forbidden |

All new tables: RLS enabled and `REVOKE ALL FROM PUBLIC, anon, authenticated`. Only `service_role` gets read access; there are no general public RLS policies. No DDL changes to legacy tables, risk functions, prices, broker execution routes, `vercel.json`, or original portfolio balances.

## One actual registration (no duplicate $5,000 account)

`shared-paper-v1` becomes `BigOrders All Eight (preview)`, linked via `paper_challenges.legacy_scenario_id` to the already-existing shared PAPER preview. Its eight participants are Atlas, Fuse, Harbor, Flash, Pulse, Spark, Orbit and Coil; their strategy IDs/versions are canonical, with unique challenge-local instance IDs. `legacy_source_bot_id` means strategy/decision lineage, **never ownership of the old bot's $100 ledger**. No Catalog/Midas enrollment is assumed; adding them later is optional.

The existing `paper_shared_portfolio_scenarios` row remains the **only authoritative balance** for `shared-paper-v1`. Its shadow capital-account mirror may help detect accounting drift, but shall NEVER be summed with the scenario equity or treated as independent buying power. The original $1,000 `paper_capital_plan`, original eight $100 bot ledgers, QA concurrency scenario, reservations and trade journals are untouched. No extra active $5,000 challenge is created.

New independent hypothetical challenges can have $500, $5,000 or another positive starting balance. Their opening virtual account is distinct, with unique challenge and instance names, but they are **shadow only**, with `broker_account_ref IS NULL`. Broker account/subaccount isolation is not assumed. New challenge creation and funding posting workflows are **not** exposed in this step.

## Recording future funding

The funding table accepts a signed `amount_delta` for each event type with an unambiguous idempotency `(challenge_id,event_key)`, `effective_at`, immutable `recorded_at`, and a nonempty reason and evidence. No funding event is seeded during this migration; existing initial capital is the opening balance and must not be counted again as a deposit.

Funding events are **never silently applied** to equity/cash. The fixed `recorded-unposted` state makes it impossible for the Step 3 API to portray an entry as spendable balance. Future funding posting must use audited, atomic, versioned capital-account updates, duplicate prevention, immutable evidence, source-of-truth scenario handling and tested RLS/permissions. The challenge starting capital shall never be rewritten to imitate a later deposit/withdrawal.

## Read-only API

`GET /api/paper-trading/bots/challenges` is internal only with the >=32-character `CRON_SECRET` bearer token. It performs Supabase SELECTs and no brokerage calls. It refuses incomplete results, checks linked scenario vs account mirror, reports challenge participants/research, excludes unposted funding from available capital, and conservatively reports `brokerExecutionPermitted:false`. This endpoint requires `SUPABASE_SECRET_KEY` and returns `no-store`.

## Verification and handoff

Verify all six RLS flags, privileges, trigger immutability, eight scenario participants, starting values, original ledgers and broker PAPER position/order unchanged. Run TypeScript, lint, PAPER tests and Next production build. PR must pass before merge, and Vercel production must serve the exact merge commit. If a migration is applied, independently recheck database safety even if GitHub CI passed.

**Step 4 handoff:** add a tested challenge lifecycle manager and write API with strict identity/owner authorization and effective capital snapshots; funding-event atomic posting and actual challenge-instance-specific journals/positions only after version checks. Avoid linking multiple virtual challenge instances to one physical Alpaca PAPER account until broker isolation is proven. Challenge allocator alone, never strategy code, may eventually issue spend grants. Catalog/Midas remain research-only.
