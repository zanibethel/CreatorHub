# Galaxy S10 CoOperative node — PAPER broker monitor

This deploys the existing **CreatorHub Alpaca PAPER-only broker listener**
alongside the already-installed CoOperativeLocalAI Android node. It **does not
modify or replace** the installed APK, because the linked CoOperative repo
only contains the released APK URL, not its Android source/build project.
The Termux process shares the Galaxy S10 hardware, not the APK's app sandbox.

**Broker monitoring only:** listens for order updates over
`wss://paper-api.alpaca.markets/stream`, fsyncs sanitized frames in
Termux-private storage, and sends them to the already-deployed Supabase
`paper-trade-stream-ingest` endpoint. It neither submits trades nor
interferes with CoOperative AI queues and is **not** subject to the AI node's
idleOnly job scheduling.

## Phone setup (owner actions)

1. On the Galaxy S10, install **Termux** and **Termux:Boot** from the
   **same trusted signing source** (for example F-Droid). Open
   Termux:Boot **once** to grant its boot functionality.
   Do not uninstall the working CoOperativeLocalAI node APK.
2. Open Termux, and install packages:
   `pkg update && pkg install git nodejs-lts termux-services`.
   Confirm `node --version` reports v22 or newer, and then restart
   Termux once so the Termux services environment initializes.
3. Clone the code to Termux-private home:
   `git clone https://github.com/zanibethel/CreatorHub.git "$HOME/CreatorHub"`
   (or pull the existing checkout).
4. Create `$HOME/.config/creatorhub/paper-trade-stream.env` on the
   **phone**, owned by that login and `chmod 600`. Put these values
   into the private file *without posting the values to chat or GitHub*:
   `ALPACA_PAPER_API_KEY_ID` and `ALPACA_PAPER_API_SECRET_KEY`
   (PAPER, never live credentials), and a newly generated random
   64-character lowercase-hex `PAPER_STREAM_INGEST_TOKEN`.
   Generate the token locally using:
   `openssl rand -hex 32`. Do not reuse existing pairing codes,
   CoOperative node keys or trading order tags.
5. In the Supabase **Edge Function Secrets** settings, set
   `PAPER_STREAM_INGEST_TOKEN_SHA256` to the SHA-256 digest of
   the new random token. You can calculate this *locally on the phone*:
   `printf %s "$PAPER_STREAM_INGEST_TOKEN" | sha256sum`
   after locally sourcing the mode-600 file. **Only enter the digest
   in Supabase**; do not reveal the raw token or your PAPER keys
   to the website, chat, GitHub or any logs.
6. With both halves of the secret provisioned, from Termux run:
   `bash "$HOME/CreatorHub/scripts/install-paper-stream-termux.sh"`.
   This installs a dedicated runit service and a Termux:Boot hook.
   Verify `sv status creatorhub-paper-stream`.
7. On the Galaxy, allow unrestricted battery/background operation for
   Termux and Termux:Boot, keep the phone charged with safe ventilation,
   permit Wi-Fi use in sleep, and disable Android automatic app sleeping
   where supported. Power / background behavior varies with One UI and
   Android version.

## Acceptance tests — do not infer success from service running

- The first worker log should show Alpaca PAPER `authorization=authorized`
  and subscription acknowledgement `trade_updates`.
- Query the service-only Supabase
  `paper_broker_trade_stream_status` view: `recently_connected=true`
  and `last_heartbeat_at` must continue advancing. This view
  is intentionally private; **do not** expose credentials or
  full broker messages on the public dashboard.
- Run screen-off, background AI activity, Wi-Fi transition and reboot
  tests; confirm the worker returns online and resumes persistence.
  A socket outage is an **evidence gap**, not proof that no event occurred.
- A lock from a **provably different Linux/Android boot UUID** is
  recoverable on reboot. A same-boot/crash lock fails closed; manually
  confirm no prior worker process exists before operator recovery.
- Periodically confirm a real broker event reaches the append-only
  table; **do not force an order or reset an entry pilot solely for testing**.
- Runit reports process health via `sv status creatorhub-paper-stream`;
  remote broker subscription health must still be observed separately.

## Rollback

In Termux: `sv-disable creatorhub-paper-stream`; then
`sv down creatorhub-paper-stream`. Remove only the
`~/.termux/boot/50-creatorhub-paper-stream` boot hook if desired.
Do not delete the event spool until all acknowledged/unacknowledged
evidence is reconciled. Never alter trading permissions or bot
reservations as part of monitor rollback.

## Project trading release gate

This Samsung monitoring service is not a fix for Fuse's historical
~1.61-second residual-share stop-cancellation risk. All trading
safety/release gates in
`docs/PAPER_BOT_EXECUTION_READINESS_PLAN_2026-10-08.md` remain.
Fuse's one-shot pilot remains claimed, Harbor SNAP and Fuse RXRX
reservations remain held, and the challenge counter is **UNSTARTED**.
