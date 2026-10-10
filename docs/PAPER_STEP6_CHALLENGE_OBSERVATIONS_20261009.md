# BigOrders Step 6 — Independent challenge/source observation attribution

**Date:** October 9, 2026 (America/Chicago). **Execution:** PAPER broker access disabled for every new challenge.

## What has been implemented

Each of the eight trading strategies continues to produce its actual legacy research journal entries through its existing, unchanged scanner/evaluator. A new **database-sourced shadow projection** maps a bounded number of those *real persisted journal records* to each enrolled `(challenge_id,bot_instance_id)`.

This is a **research-source replay**, not eight new independent evaluator executions and not a trade simulation. A named challenge can contain multiple independent instance identities of one strategy, but those instances may share the same source journal data and are not independent statistical samples. A registered Catalog/Midas contributor has no trade rights; this step does not invent their contributions.

The new `paper_challenge_source_observations` table stores:
- The immutable source foreign key `source_journal_id` and original legacy bot ID.
- Challenge ID, instance ID, strategy ID/version, source event/qualification, symbol, and original source timestamp.
- Virtual capital snapshot from the *authoritative challenge source* at capture time: existing shared preview scenario or standalone shadow account. **No double counting.**
- Original source plan/evidence as reference JSON, explicitly marked *not challenge revalidated*, *no verified fresh quote*, *no simulated fill*, *hypothetical P/L null*, *broker authorization false*.
- Immutable composite idempotency key `(challenge_id,bot_instance_id,source_journal_id)`.

Per-instance source events are captured only if their original `paper_bot_journal.occurred_at` is later than both challenge and instance registration times, and is within 36 hours of the sync; the source journal bot/strategy/version must match the recorded participant identity. Only `candidate`, `rejected`, and `scanner_assigned` source research events are projected. Broker fills, order submissions, authorization events, source trades and ledger P/L are never adopted as new challenge trades.

## Scheduled and manual source capture

- Service-role-only `paper_challenge_sync_source_observations(challenge_id,limit)` database RPC, `SECURITY INVOKER`, explicit `REVOKE EXECUTE FROM PUBLIC,anon,authenticated`.
- Cron endpoint `GET /api/paper-trading/bots/challenges/observations/cron` with `CRON_SECRET` and conservative fixed per-challenge/per-instance limits (8 per instance, up to 30 preview challenges per run); every 15 minutes in `vercel.json`.
- Owner session endpoint `GET/POST /api/paper-trading/bots/challenges/observations`: shows private per-instance comparison and allows explicit bounded capture for a selected challenge (12 per instance). Fresh Supabase owner session and same-origin JSON POST are required. No admin secrets go to a browser.
- Both paths are append-only, idempotent, non-destructive, and contain **no** broker calls or use of legacy bot funds.

The owner UI Challenge Manager displays counts of source observations, recent events, candidate/rejection counts, symbol coverage and latest event time per enrolled instance. Reporting explicitly labels historical qualification as *source-only*, not challenge approval; `hypotheticalProfitLossUsd:null` remains null until separately verified shadow-outcome tracking is built.

## Security and safe invariants

- Private table RLS and revoked public grants; private aggregation view has `security_invoker=true`, with SELECT only for the service role.
- Every projected row has `paper_only=true`, `broker_order_authorized=false`, `simulated_fill_verified=false`, `challenge_strategy_revalidated=false` enforced at the database layer.
- Existing `paper_challenge_proposal_journal`, Step 2 adapters, `paper_shared_capital_reservations`, all eight original $100 bot ledgers, and original broker positions and orders are left untouched.
- Updating a challenge lineup changes its current projection membership only. Previously captured attribution remains immutable for historical auditing; removed members need a separate historical reporting surface in a later step.
- Do **not** treat evidence counts as earnings, expected returns, win rate, opportunity cost, or execution-ready setups.

## Next step: independent simulated outcomes

Implement versioned source-derived scenario setup revalidation using actual recorded inputs (fresh quotes, completed bars, market session, fees, live virtual cash, risk limits, and challenge positions). Only after source-qualified *challenge* proposals exist, create a conservative, timestamped bar-by-bar shadow fill/stop/target simulation and account ledger that tracks reservations, fees, partial exits, and realized/unrealized P/L separately. All challenge simulated performance must be honest about assumptions and not use future information. Broker PAPER execution remains a separate safety gate, including physical account/symbol and protective order isolation.

## Verification

1. TypeScript, lint, PAPER regression tests and Next.js build on PR.
2. Transactionally apply migration; query grants, RLS, immutability, source identity, and the aggregation view.
3. Run the service-role source sync in a `BEGIN ... ROLLBACK` transaction for existing `shared-paper-v1` with 8 instances; ensure source ids are real and the test leaves no persistent entries.
4. Check the $5,000 shared preview, concurrency QA, 8x$100 legacy ledgers, and Alpaca PAPER stop/position have not changed.
5. Merge after CI and DB verification; confirm the exact production deployment SHA. Without a session credential, do not claim authenticated end-to-end UI smoke verification.
