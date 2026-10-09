# Samsung Galaxy S10 PAPER broker monitor — acceptance and failure diagnostics (2026-10-09)

## Status and verified baseline
- Alpha Android APK installed on Galaxy S10 alongside the untouched CoOperativeLocalAI node.
- Independent Supabase checks: at 2026-10-09 21:51:06.812604 UTC the private stream view showed `connected=true`, `recently_connected=true`, heartbeat 2026-10-09 21:50:53.042007 UTC (13.77 seconds old), reconnects 0, captured events 0. Earlier independently verified heartbeat: 21:48:03.05274 UTC.
- The Vercel production alias resolved to READY deployment of merged PR #118 (`abc96f74b066f6983635504c958fe1e82cdbc3d7`). This does **not** verify screen-off or reboot survivability.
- This monitor is evidence capture only. No orders, strategies, money, reservations or bot execution permissions change. Official $100 challenge remains UNSTARTED.

## Safe read-only operator check (service role or project SQL editor only)
```sql
SELECT stream_name,connected,recently_connected,monitor_state,
       evaluated_at,last_heartbeat_at,heartbeat_age_seconds,
       last_connected_at,reconnect_count,stored_event_count,total_recorded_events
FROM public.paper_broker_trade_stream_status;
```
- `connected_and_delivering`: a recent authenticated ingest from a broker-subscribed app, **not** proof that the socket never briefly disconnected.
- `broker_disconnected`: phone explicitly reported an offline socket while Supabase ingest was reachable.
- `stale_heartbeat`: no accepted heartbeat within 75 seconds; could mean Android service/OS stopped, network failure, token rejection, Supabase downtime, or other ingest failure. It does **not** identify a unique root cause.
- `never_received`: no accepted heartbeat ever. `last_connected_at` is now updated only upon a transition to connected or changed process session, rather than on every heartbeat. Historical records **before the migration** cannot be reconstructed.
- `reconnect_count` in the original alpha APK resets on successful subscription. The **source fix** preserves per-service-session reconnects, but it is not running until an updated APK is signed and installed. Reboot/new process starts a new session and resets the local counter; a zero value never proves perfect uninterrupted uptime.
- No artificially generated broker fills or order placements are allowed to test `stored_event_count`. Count may remain zero legitimately.

## Device acceptance tests (owner operates the physical phone)
For each test, record **before and after** timestamps from the private view, app notification state, and any coverage gap. Never share broker key, ingest token or sensitive screenshots.

1. **Baseline / screen on:** keep charging and connected to Wi-Fi. Confirm notification remains visible, app displays `PAPER connected` and `Supabase delivery confirmed`. Record two advancing heartbeats 30–60 seconds apart. Pass: age stays under 75 seconds.
2. **Screen off / battery restrictions:** turn screen off and leave the app running for at least 20 minutes; no app force-stop. Verify heartbeats still advance after 5 and 20 minutes. If stale, check OS battery-optimization exemptions/app-sleep settings; do not assume wake lock prevents Doze.
3. **Wi-Fi loss / recovery:** intentionally disable Wi-Fi while no genuine trade is expected and no event backlog is pending. After at least 90 seconds check server reports `stale_heartbeat` (or `broker_disconnected` if mobile data still permits ingest). Re-enable Wi-Fi and independently verify a new heartbeat within 2 minutes plus a newly established broker subscription. If mobile data remains on, the test may not create a network outage; repeat with airplane mode if safe.
4. **Phone reboot:** verify spool is empty where safely observable and monitoring enabled, then restart Galaxy. Do **not** uninstall the app or clear app data. Once unlocked, confirm foreground notification, new `worker_session_id`, broker subscription and advancing heartbeat. A failed boot-restart is an acceptance failure, not a silent pass.
5. **Ingress failure isolation:** do not rotate or expose the live ingestion secret just to force a failure. In controlled tests with synthetic local frames and test credentials only, confirm an HTTP 401/403 displays ingest-auth failure, 5xx/network error displays delivery failure, and storage error displays private spool failure. Pending event files must never be deleted without an acknowledged receipt.
6. **Natural broker lifecycle / attribution:** only when legitimate bot strategy activity occurs, compare captured `broker_order_id`, `client_order_id`, event time and symbol against `paper_bot_broker_orders` and current parent-child associations. Verify exact bot attribution and duplicate hash behavior. Until a real observed event is present, mark this item **NOT VERIFIED**, not passed.

## APK update constraint
PR #118 generated a debug-signed alpha on a GitHub runner. Another runner may generate a different debug signing certificate. **Do not uninstall or replace the installed APK as a casual upgrade**: an uninstall destroys encrypted local credentials and any undelivered app-private broker events. Prior to applying Android source improvements, establish owner-controlled stable signing and test Android's in-place install compatibility. A source merge alone does not update the active Galaxy APK.

## Protected PAPER trading gates
- Fuse one-shot RXRX pilot consumed: never rearm.
- Historical ~1.61-second possible RXRX OCO partial-exit residual protection gap unresolved.
- RXRX/Fuse and SNAP/Harbor reservations remain HELD. Coil disabled.
- Pulse still requires first naturally qualified PAPER lifecycle.
- Leave broker reconciliation and bot risk safeguards unchanged.
- No artificial PAPER fills, no live-money trading. Challenge clock UNSTARTED.
