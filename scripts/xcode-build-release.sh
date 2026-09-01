#!/bin/zsh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REQUESTED_ACTION="${1:-${ACTION:-build}}"

if [[ "$REQUESTED_ACTION" == "clean" ]]; then
  echo "Code Universe release artifacts are retained during Xcode Clean."
  exit 0
fi

find_npm() {
  local candidate
  for candidate in "${CODE_UNIVERSE_NPM_BINARY:-}" /opt/homebrew/bin/npm /usr/local/bin/npm; do
    if [[ -n "$candidate" && -x "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  command -v npm
}

NPM_BINARY="$(find_npm || true)"
if [[ -z "$NPM_BINARY" ]]; then
  echo "error: npm was not found. Install Node.js or set CODE_UNIVERSE_NPM_BINARY." >&2
  exit 1
fi

export PATH="$(dirname "$NPM_BINARY"):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"
cd "$ROOT_DIR"

if [[ ! -x node_modules/.bin/electron-packager ]]; then
  echo "Installing locked npm dependencies for the release build..."
  "$NPM_BINARY" ci
fi

echo "Creating the signed, notarized, and stapled Code Universe DMG..."
"$NPM_BINARY" run mac:release
