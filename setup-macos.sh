#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "ChatGPT Conversation Crawler - macOS setup"

if ! command -v node >/dev/null 2>&1; then
  echo
  echo "Node.js was not found in PATH."
  echo "Install Node.js 20 or newer with npm, then run this script again."
  echo "For example, install Node.js from nodejs.org or with Homebrew."
  exit 1
fi

NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
if [[ ! "$NODE_MAJOR" =~ ^[0-9]+$ ]] || (( NODE_MAJOR < 20 )); then
  echo
  echo "Node.js 20 or newer is required. Found: $(node --version)"
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo
  echo "npm was not found in PATH. Install npm for the active Node.js installation."
  exit 1
fi

echo "Using Node: $(command -v node) ($(node --version))"
echo "Using npm:  $(command -v npm) ($(npm --version))"

echo
echo "Installing project packages..."
npm install

PLAYWRIGHT_CLI="$SCRIPT_DIR/node_modules/playwright/cli.js"
if [[ ! -f "$PLAYWRIGHT_CLI" ]]; then
  echo
  echo "Playwright's CLI was not installed as expected:"
  echo "  $PLAYWRIGHT_CLI"
  exit 1
fi

echo
echo "Installing Playwright Chromium..."
node "$PLAYWRIGHT_CLI" install chromium

echo
echo "Setup complete."
echo "Run ./start-macos.sh to launch the crawler."
