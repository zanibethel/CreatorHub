#!/bin/bash
# macOS launchd wrapper: credentials are read from a private file, never
# embedded in launchd XML, shell arguments, version control or service logs.
set -euo pipefail
umask 077
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
ENV_FILE="${PAPER_STREAM_ENV_FILE:-$HOME/.config/creatorhub/paper-trade-stream.env}"
if [[ ! -f "$ENV_FILE" || -L "$ENV_FILE" ]]; then
  echo "PAPER stream private environment file not found or is a symlink." >&2
  exit 1
fi
if [[ "$(stat -f '%Lp' "$ENV_FILE")" != "600" ]]; then
  echo "PAPER stream secrets file requires chmod 600." >&2
  exit 1
fi
set -a
# Local operator-controlled 0600 file. Do not accept remote-supplied paths.
source "$ENV_FILE"
set +a
export PAPER_STREAM_SPOOL_DIR="${PAPER_STREAM_SPOOL_DIR:-$HOME/Library/Application Support/CreatorHub/paper-stream-spool}"
if [[ -n "${PAPER_STREAM_NODE_BINARY:-}" ]]; then
  NODE="$PAPER_STREAM_NODE_BINARY"
elif [[ -x /opt/homebrew/bin/node ]]; then
  NODE=/opt/homebrew/bin/node
elif [[ -x /usr/local/bin/node ]]; then
  NODE=/usr/local/bin/node
else
  NODE="$(command -v node || true)"
fi
if [[ -z "$NODE" || ! -x "$NODE" ]]; then
  echo "Node 22+ was not found; set PAPER_STREAM_NODE_BINARY in the private env file." >&2
  exit 1
fi
exec "$NODE" "$ROOT/workers/alpaca-paper-trade-updates.mjs"
