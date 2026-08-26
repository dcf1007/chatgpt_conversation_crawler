#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

URL="http://localhost:${PORT:-3000}"

echo "Starting ChatGPT Conversation Crawler..."

if ! command -v node >/dev/null 2>&1; then
  echo
  echo "Node.js was not found in PATH."
  echo "Install Node.js 20 or newer, then run ./setup-macos.sh."
  exit 1
fi

NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
if [[ ! "$NODE_MAJOR" =~ ^[0-9]+$ ]] || (( NODE_MAJOR < 20 )); then
  echo
  echo "Node.js 20 or newer is required. Found: $(node --version)"
  exit 1
fi

if [[ ! -f "$SCRIPT_DIR/node_modules/playwright/package.json" || ! -f "$SCRIPT_DIR/node_modules/express/package.json" ]]; then
  echo
  echo "Dependencies are not installed in this folder."
  echo "Run ./setup-macos.sh once, then run this script again."
  exit 1
fi

(
  sleep 1.5
  open "$URL" >/dev/null 2>&1 || true
) &

echo "Local UI: $URL"
echo "Press Ctrl+C to stop the server."
exec node "$SCRIPT_DIR/server.mjs"
