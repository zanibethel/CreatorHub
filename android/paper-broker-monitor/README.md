# CreatorHub PAPER Broker Monitor — Samsung Galaxy S10 sideload APK

This native Android app is a **separate companion**, not a modification of the
installed CoOperativeLocalAI node. Sideload it on the **same device**. It does
not contain API credentials, place trades, cancel orders, or use AI resources.

## Contents

- `MainActivity`: local credentials, new independent 32-byte ingest token
  generator, **Copy SHA-256 digest** and monitoring start/stop.
- `SecretStore`: Android Keystore AES-256-GCM encryption of the PAPER API
  key/secret and raw ingestion token. Android backup disabled.
- `PaperStreamService`: foreground networking with ongoing notification
  and PARTIAL_WAKE_LOCK, Alpaca PAPER-only WebSocket, allowlisted order fields,
  crash-survivable fsynced app-private pending-event spool, idempotent batch
  delivery to Supabase, reconnection, and periodic health acknowledgments.
- `BootReceiver`: attempts restart only when the user left monitoring enabled.
- **No order endpoint, account order mutation, real-money switch, or
  integration into the existing CoOperative APK.**

## Build and installation

GitHub Actions workflow `Galaxy PAPER Monitor APK` builds a
**debug-signed, development-only** installable APK on an Android SDK runner.
In the repository's Actions tab, open a successful run of that workflow,
select `CreatorHub-PAPER-Monitor-Android-APK`, and extract
`app-debug.apk` from the downloaded artifact zip. Copy it to the Galaxy S10,
allow **Install unknown apps** for the file manager, and open it to sideload.
This does **not** require Play Store, F-Droid, Termux or developer tools
on the phone.

This is a **test-signature APK**, not a production release. Debug keystores
on different GitHub runners can differ; later installs may require an
uninstall/reinstall, which erases app-private buffered events and credentials.
Do not uninstall when unapplied events exist. Stable updates require an
owner-managed, persistent private Android signing key, never committed
to GitHub.

## Pairing the dedicated ingestion token

1. Enter **Alpaca PAPER** API key ID and PAPER secret, never live keys.
   Verify this account is the same PAPER account as CreatorHub's broker.
2. Tap **Generate new ingest token**; tap **Copy SHA-256 digest**.
   Configure that digest as Supabase Edge Function secret
   `PAPER_STREAM_INGEST_TOKEN_SHA256`. This is a **server-side**
   Supabase setting: the APK cannot change it. Do not share the raw
   token or broker secret by message.
3. Tap **Save and START monitoring**. For an existing configured app,
   leave all three entry fields blank to use encrypted saved settings.
4. Allow notifications. Disable battery optimization/app sleeping for this
   app if possible, keep the device powered and Wi-Fi enabled.
5. Independently verify the private Supabase view:
   `public.paper_broker_trade_stream_status`. It should show
   `recently_connected=true` with a moving heartbeat.
   Test screen-off, Wi-Fi loss/recovery and reboot. A connected status
   on the phone does **not** prove the server received events.
6. Broker trade updates arrive only **after** this subscriber connects.
   Alpaca does not guarantee replay of WebSocket events missed during
   disconnection. Keep existing REST collector and historical OCO audits.

## Security and alpha limitations

- Network endpoints are hardcoded HTTPS to CreatorHub Supabase and
  `wss://paper-api.alpaca.markets/stream` PAPER broker only.
- Only allowlisted trade-update fields are saved to Android app-private
  storage; no raw broker account objects or identity fields are saved.
- Durable delivery starts only after event receipt; app termination, OS
  Doze, radio loss and vendor battery settings may create coverage gaps.
  Android dataSync foreground services can be time-restricted on newer
  Android versions; users must independently verify actual uptime.
- The private Supabase ingestion endpoint intentionally returns HTTP 503
  until the dedicated SHA-256 digest is configured.
- A stable production APK, hardened secret onboarding and tested
  long-duration uptime remain separate release criteria. Never claim the
  official PAPER challenge is started by installing this monitor.
