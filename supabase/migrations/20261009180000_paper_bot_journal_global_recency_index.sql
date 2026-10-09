-- Strategy Review fetches the newest cross-bot journal evidence ordered by
-- occurred_at DESC. Existing (bot_id, occurred_at) indexes cannot efficiently
-- serve the global sort, causing PostgREST statement timeouts as evidence grows.
--
-- Read-only performance change: no changes to PAPER orders, risk, or evidence.
create index if not exists paper_bot_journal_occurred_at_desc_idx
  on public.paper_bot_journal (occurred_at desc);
