# Alpaca PAPER `trade_updates` durable stream — rollout and safeguards

## Purpose

Collect authentic account-order `trade_updates` from **`wss://paper-api.alpaca.markets/stream`** in a persistent, private, append-only trail. Events include `partial_fill`, `fill`, `pending_replace`, `replaced`, `pending_cancel`, `canceled` and broker errors. Preserve broker event timestamps as raw validated text (up to nine fractional digits), together with first receipt times, order identities and quantities, without exposing account identities to the public CreatorHub reports.

This is **evidence collection only**, separate from the existing 30-second `paper-report-sync` REST order/fill collector and virtual-ledger attribution. It has no buy, sell, replace or cancel logic.

## Components

- `workers/alpaca-paper-trade-updates.mjs`: standalone **Node 22+** persistent WebSocket consumer. Uses the PAPER host only, authenticates and subscribes to `trade_updates`, **strips private account fields before persisting** accepted frames to a local `0600` fsynced spool, then POSTs batches to the dedicated private Edge ingestion endpoint. Files are deleted only after the database acknowledges receipt. Reconnects with capped backoff. Never commits spool files.
- `supabase/functions/paper-trade-stream-ingest/`: independent Edge endpoint accepting only 64-hex bearer-like token in `x-paper-stream-token` after matching its SHA-256 digest to the configured secret. Rejects missing credentials, oversized/malformed envelopes, unrecognized streams or bad orders. Removes account identifiers and all unapproved order fields before insert. **Not an ordinary authenticated-user endpoint.**
- `supabase/migrations/20261009191000_paper_trade_updates_durable.sql`: service-role-only `paper_broker_trade_updates` append-only history keyed by deterministic event hash, plus one-row `paper_broker_trade_stream_health`. Unique hashes handle retransmission without replaying changes to virtual balances. The private view `paper_broker_trade_stream_status` sets `recently_connected=false` if broker subscription heartbeats stop for over 75 seconds.
- Existing `paper_report_state`, `paper_bot_broker_fills`, `paper_bot_ledgers` and `paper_bot_stock_oco_gap_audit()` retain their current meaning. A stream event is never treated as a financial FILL or used to reset a one-shot pilot.

## Rollout

1. Merge after CI; apply additive schema migration.
2. Deploy `paper-trade-stream-ingest` with **`verify_jwt=false` only because it enforces its own dedicated 64-hex token / SHA-256 authentication**. Leave `PAPER_STREAM_INGEST_TOKEN_SHA256` unset until the operating host and distinct strong secret are provisioned; an unconfigured endpoint must always return HTTP 503, without database access.
3. On a secured **always-on** Mac/Linux or managed service, provision its own independent secret `PAPER_STREAM_INGEST_TOKEN` and the corresponding SHA-256 value as a **Supabase Edge Function Secret** named `PAPER_STREAM_INGEST_TOKEN_SHA256`. Never put either secret into a repository, GitHub Action log, public dashboard, QR code, client bundle, or chat artifact. Alpaca PAPER API key ID and secret must likewise exist **only** in the worker's private runtime environment.
4. Run `node workers/alpaca-paper-trade-updates.mjs` under a supervised long-lived process with a persistent writable `PAPER_STREAM_SPOOL_DIR` (default `.paper-stream-spool`). This is not a Vercel request route or short-lived scheduled function. Keep the worker online across market sessions if uninterrupted history is desired.
5. Verify `paper_broker_trade_stream_status.recently_connected` is true and `last_heartbeat_at` moves forward after the worker has received Alpaca's real `authorization` and `listening` acknowledgments. The event count may remain zero for long periods without orders; do not force a PAPER trade merely to increment it. Reconcile new events against real `paper_bot_broker_orders` by broker ID and the existing parent attribution.
6. On a process crash, retained spool files are retried; event hashes are idempotent. On a socket disconnection, missed broker events **cannot be assumed replayable** via this Alpaca Trading WebSocket. Report a monitoring coverage gap, reconnect, and use existing REST broker snapshot/fill reconciliation to fill factual status where possible. Do not claim uninterrupted subsecond coverage from eventual REST states.

## macOS persistent operator install (staged; not auto-activated)

The secure worker is meant for the owner-controlled always-on Mac, not a
Vercel serverless route, public webpage or an idle-only Android compute node.
The installation files have been committed but **no connected tool has
access to execute them on the Mac**.

1. The operator creates `$HOME/.config/creatorhub/paper-trade-stream.env`,
   owned by the macOS login account with **`chmod 600`**. It must define
   `ALPACA_PAPER_API_KEY_ID`, `ALPACA_PAPER_API_SECRET_KEY` (PAPER keys
   only), `PAPER_STREAM_INGEST_TOKEN` (a locally generated random
   64-character lowercase hex token), and optionally
   `PAPER_STREAM_NODE_BINARY` for a Node 22+ absolute binary path.
   Do not commit, paste, upload or echo this file. The SHA-256 digest of
   the random token—not the raw token—must separately be configured
   as Supabase Edge Function secret `PAPER_STREAM_INGEST_TOKEN_SHA256`.
   Until both are configured the Edge function intentionally returns
   HTTP 503. The app's existing report cron secret is **not** reusable.
2. From an up-to-date CreatorHub checkout on that Mac, run
   `bash scripts/install-paper-stream-macos.sh` after validating
   the credentials. It generates an owner-specific macOS launchd plist
   without secrets, enables background restart supervision and uses
   `scripts/run-paper-stream-macos.sh` to load the mode-600 env file.
   Check service state with
   `launchctl print gui/$(id -u)/com.creatorhub.alpaca-paper-stream`.
3. The node exclusively owns its durable spool with a locally locked
   `.paper-trade-stream.lock`; a second instance fails closed.
   After an ungraceful power loss, **verify no previous process is
   still running** before manually removing a stale lock.
   The spool contains only allowlisted broker event fields; account
   numbers and unexpected raw provider fields are discarded locally.
   The worker serializes WebSocket message handling and awaits pending
   disk writes across disconnects to preserve observed ordering.
4. Observe *actual* broker `authorization=authorized` and
   `listening=trade_updates` messages, plus
   `paper_broker_trade_stream_status.recently_connected=true`,
   and exercise crash/replay using a legitimate observed event
   (do not submit a manufactured trade). Watch the spool and logs
   for disk pressure and reconnect storms. **A connected flag cannot
   retroactively reconstruct events missed while the socket was down.**

The macOS supervisor, single-spool lock and callback ordering reduce
host-side failure risk. They **do not provide globally exclusive
subscriptions across multiple hosts**; provision only one authorized
worker for this Alpaca PAPER account.

## Private verification queries (service role only)

```sql
SELECT stream_name, connected, recently_connected, last_heartbeat_at,
       last_event_at, reconnect_count, stored_event_count
FROM public.paper_broker_trade_stream_status;

SELECT e.event_name, e.event_timestamp_raw, e.first_received_at,
       e.broker_order_id, e.symbol, e.cumulative_fill_quantity,
       e.event_fill_quantity, e.broker_status,
       o.bot_id, o.metadata->>'parentBrokerOrderId' AS parent_order_id
FROM public.paper_broker_trade_updates e
LEFT JOIN public.paper_bot_broker_orders o
  ON o.broker_order_id=e.broker_order_id
ORDER BY e.first_received_at DESC LIMIT 40;
```

## Open safety gates

- **No always-on worker, dedicated secret, or live stream uptime can be presumed from code deployment.** Until independently observed, the status is `NOT CONNECTED / NOT VERIFIED`.
- Durability applies to frames that reach the subscriber's disk and are acknowledged by Supabase; the Trading WebSocket has no documented catch-up cursor. Stream gaps, reconnect storms, missed events, clock skew, spool saturation and broker-side OCO partial-exit races remain subject to operator review.
- Fuse's one-shot RXRX pilot stays consumed, RXRX and Harbor SNAP reservations stay held, Coil remains disarmed, and the official challenge/day counter is **UNSTARTED**. Do not infer repeat-entry authorization or change risk settings.
