#!/data/data/com.termux/files/usr/bin/bash
# Run from an up-to-date CreatorHub checkout in Termux on the SAME Samsung node.
# Does not generate/reveal API credentials or enable purchases.
set -euo pipefail
umask 077
EXPECTED_PREFIX="/data/data/com.termux/files/usr"
if [[ "${PREFIX:-}" != "$EXPECTED_PREFIX" ]]; then
  echo "This installer must be run inside the official Termux environment." >&2
  exit 1
fi
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
ENV_FILE="$HOME/.config/creatorhub/paper-trade-stream.env"
RUN="$ROOT/scripts/run-paper-stream-termux.sh"
NODE_SERVICE="$PREFIX/var/service/creatorhub-paper-stream"
BOOT="$HOME/.termux/boot/50-creatorhub-paper-stream"

if ! command -v node >/dev/null 2>&1 ||
   ! node -e 'process.exit(Number(process.versions.node.split(".")[0])>=22?0:1)'; then
  echo "Install Node 22+ in Termux first (pkg install nodejs-lts)." >&2
  exit 1
fi
if ! command -v sv-enable >/dev/null 2>&1 ||
   [[ ! -f "$PREFIX/etc/profile.d/start-services.sh" ]]; then
  echo "Install termux-services first (pkg install termux-services)." >&2
  exit 1
fi
if [[ ! -f "$ENV_FILE" || -L "$ENV_FILE" ]] ||
   [[ "$(stat -c %a "$ENV_FILE")" != "600" ]] ||
   [[ "$(stat -c %u "$ENV_FILE")" != "$(id -u)" ]]; then
  echo "Create $ENV_FILE privately, chmod 600, with the PAPER keys and ingress token." >&2
  exit 1
fi
mkdir -p "$NODE_SERVICE" "$HOME/.termux/boot"
# Launch only the committed read-only PAPER worker, not the CoOperative APK.
printf '#!/data/data/com.termux/files/usr/bin/sh\nexec "%s" "%s"\n' \
 "$PREFIX/bin/sh" "$RUN" > "$NODE_SERVICE/run"
chmod 700 "$NODE_SERVICE/run"
cat > "$BOOT" <<'EOF'
#!/data/data/com.termux/files/usr/bin/sh
# Requires Termux and Termux:Boot installed from the same signing source.
# Keep the broker socket alive; disable Android battery restrictions manually.
termux-wake-lock || true
if [ -f "$PREFIX/etc/profile.d/start-services.sh" ]; then
  . "$PREFIX/etc/profile.d/start-services.sh"
fi
EOF
chmod 700 "$BOOT"
# Runit supervises the process across crashes; Termux:Boot starts runit
# after actual Android reboot. The app's existing AI APK is unaffected.
. "$PREFIX/etc/profile.d/start-services.sh"
sv-enable creatorhub-paper-stream
sv up creatorhub-paper-stream || true
echo "Installed read-only Alpaca PAPER listener using Termux runit."
echo "Status: sv status creatorhub-paper-stream"
echo "Broker stream health must be independently confirmed in Supabase."
echo "Open Termux:Boot once manually and exempt Termux from battery restrictions."
