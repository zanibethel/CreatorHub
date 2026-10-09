#!/data/data/com.termux/files/usr/bin/sh
# Dedicated monitoring-only Alpaca PAPER process on an existing Android node.
# No credentials in APK resources, boot script, shell arguments or GitHub.
set -eu
umask 077

REPO_DIR="${PAPER_STREAM_REPO_DIR:-$HOME/CreatorHub}"
ENV_FILE="$HOME/.config/creatorhub/paper-trade-stream.env"
if [ ! -f "$ENV_FILE" ] || [ -L "$ENV_FILE" ]; then
  echo "PAPER stream private env file missing or symlinked. No broker connection started." >&2
  exit 1
fi
if [ "$(stat -c '%a' "$ENV_FILE")" != "600" ] ||
   [ "$(stat -c '%u' "$ENV_FILE")" != "$(id -u)" ]; then
  echo "PAPER stream secrets require owner-only chmod 600." >&2
  exit 1
fi
if [ ! -f "$REPO_DIR/workers/alpaca-paper-trade-updates.mjs" ]; then
  echo "CreatorHub PAPER stream worker not found at $REPO_DIR." >&2
  exit 1
fi
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required in Termux." >&2
  exit 1
fi
if ! node -e 'process.exit(Number(process.versions.node.split(".")[0])>=22?0:1)'; then
  echo "Node 22 or newer is required." >&2
  exit 1
fi

# The spool is inside Termux private app storage, never Android Downloads
# or public/external SD storage. Only independent monitoring workloads run.
set -a
. "$ENV_FILE"
set +a
export PAPER_STREAM_SPOOL_DIR="${PAPER_STREAM_SPOOL_DIR:-$HOME/.local/share/creatorhub/paper-stream-spool}"
case "$PAPER_STREAM_SPOOL_DIR" in
  "$HOME"/*) ;;
  *) echo "PAPER stream spool must remain inside Termux private HOME." >&2; exit 1 ;;
esac
mkdir -p "$PAPER_STREAM_SPOOL_DIR"
chmod 700 "$PAPER_STREAM_SPOOL_DIR"
exec node "$REPO_DIR/workers/alpaca-paper-trade-updates.mjs"
