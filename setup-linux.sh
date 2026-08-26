#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "ChatGPT Conversation Crawler - Linux setup"

if ! command -v node >/dev/null 2>&1; then
  echo
  echo "Node.js was not found in PATH."
  echo "Install Node.js 20 or newer with npm, then run this script again."
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

# On Debian/Ubuntu-family systems Playwright can install the required shared
# libraries as well as Chromium. On other distributions, install Chromium here
# and let Playwright report any missing OS packages when the browser is started.
if command -v apt-get >/dev/null 2>&1; then
  echo "apt-get detected; installing Chromium and Playwright system dependencies."
  if ! node "$PLAYWRIGHT_CLI" install --with-deps chromium; then
    echo
    echo "Playwright could not install all OS dependencies automatically."
    echo "Trying the browser-only installation instead..."
    node "$PLAYWRIGHT_CLI" install chromium
    echo
    echo "Chromium is installed, but your distribution may still need additional"
    echo "shared libraries. If startup fails, review Playwright's Linux dependency"
    echo "message and install the listed packages with your system package manager."
  fi
else
  echo "apt-get was not detected; installing the Chromium browser package only."
  node "$PLAYWRIGHT_CLI" install chromium
  echo
  echo "If Chromium later reports missing shared libraries, install the packages"
  echo "listed by Playwright using your distribution's package manager."
fi

echo
echo "Setup complete."
echo "Run ./start-linux.sh to launch the crawler."
