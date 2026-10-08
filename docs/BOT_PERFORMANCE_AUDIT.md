# Bot Performance Audit (October 8, 2026)

Read-only production page: `/paper-trading/bots/performance`.

## Data sources and exact meaning
- `paper_bot_performance_audit_v1` security-invoker view aggregates `paper_bot_journal` (rolling 24h/7d, event categories and distinct symbols), `paper_bot_ledgers`, real broker orders, staged orders, actual trade metrics, counterfactual statuses, and *current snapshot* prospect assignments.
- `paper_fuse_observations` is a **separate journal**, so research-only Fuse scans are shown in its diagnostic rather than incorrectly counted as candidate decisions in the trading journal.
- Candidate checks and rejections are **repeated rows per run**; never describe them as distinct opportunities or compute naive conversion rates.
- Win count applies only to **closed simulated trades** with strictly positive realized P/L. Small samples must not be promoted as strategy proof.
- Counterfactual +2R before stop is **hypothetical**, not missed executable winnings; decision states, score tiers, entry feasibility, spread, fees, and risk are not guaranteed in retrospective price paths. Scenarios classified `waiting` are explicitly *not* a confirmed reject.
- A truly missed market move absent from scanner coverage is **unobservable here**. Future audit should compare ex-ante universes with subsequent realized moves using time-indexed bars, market sessions, latency and transaction-cost models.
- No changing algorithm thresholds, broker order routing, portfolio permissions, ledger values, or risk management in this audit.

## Actionable instrumentation gaps
1. Pulse scheduled readiness is recording `system:noCandidates` but zero currently assigned stock prospects. Inspect scanner-to-Pulse recommendation path and stock source universe. Do not loosen strategy gates without evidence.
2. Atlas virtual fills exist but its candidate review/decision events have no paper_bot_journal entries in the rolling 7-day decision window. Add consistent decision journaling to the existing adapter separately; no double-counting fills.
3. Flash has hypothetical +2R candidates among completed counterfactuals; decision_state can remain `waiting`, so this is a hypothesis for further forward-testing, not 6 missed wins.
4. Fuse research events are outside the shared journal; index them with their own source and keep scope labels visible.
5. For a reliable missed-move count, persist unique opportunity IDs with first-seen UTC time, universe, eligibility, decision reason, subsequent market outcome, and coverage completeness before computing recall.

The view definition is versioned in `supabase/migrations/20261008081500_paper_bot_performance_audit_read_only.sql`, deployed through the Supabase migration tool.
