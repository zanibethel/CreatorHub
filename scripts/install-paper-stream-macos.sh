#!/bin/bash
# Run on the owner's macOS machine only after the PAPER-only environment
# file is installed. Does not create secrets, touch trading permissions,
# or enable broker order submission.
set -euo pipefail
umask 077
if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This supervised installer supports macOS launchd only." >&2
  exit 1
fi
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
ENV_FILE="$HOME/.config/creatorhub/paper-trade-stream.env"
if [[ ! -f "$ENV_FILE" || -L "$ENV_FILE" ]]; then
  echo "Create $ENV_FILE as a private chmod 600 file first." >&2
  exit 1
fi
if [[ "$(stat -f '%Lp' "$ENV_FILE")" != "600" ]]; then
  echo "The credentials file must have mode 600." >&2
  exit 1
fi
if [[ "$(stat -f '%Su' "$ENV_FILE")" != "$(id -un)" ]]; then
  echo "The credentials file must belong to the current user." >&2
  exit 1
fi
PLIST="$HOME/Library/LaunchAgents/com.creatorhub.alpaca-paper-stream.plist"
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
python3 - "$ROOT" "$HOME" "$PLIST" <<'PYTHON'
import os, plistlib, sys
root, home, target = sys.argv[1:]
contents = {
  "Label": "com.creatorhub.alpaca-paper-stream",
  "ProgramArguments": ["/bin/bash",os.path.join(root,"scripts","run-paper-stream-macos.sh")],
  "RunAtLoad": True,
  "KeepAlive": {"SuccessfulExit": False},
  "ProcessType": "Background",
  "StandardOutPath": os.path.join(home,"Library","Logs","CreatorHubPaperStream.log"),
  "StandardErrorPath": os.path.join(home,"Library","Logs","CreatorHubPaperStream.err.log"),
}
with open(target, "wb") as f:
  plistlib.dump(contents, f)
os.chmod(target, 0o644)
PYTHON
DOMAIN="gui/$(id -u)"
/bin/launchctl bootout "$DOMAIN" "$PLIST" >/dev/null 2>&1 || true
/bin/launchctl bootstrap "$DOMAIN" "$PLIST"
/bin/launchctl kickstart -k "$DOMAIN/com.creatorhub.alpaca-paper-stream"
echo "CreatorHub PAPER trade-update listener supervised by macOS launchd."
echo "Check status: launchctl print $DOMAIN/com.creatorhub.alpaca-paper-stream"
echo "Logs: $HOME/Library/Logs/CreatorHubPaperStream.log"
echo "Warning: live coverage requires successful PAPER authorization and Supabase heartbeats."
