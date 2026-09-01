#!/bin/zsh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_DIR="$ROOT_DIR/dist/Code Universe.app"

if [[ ! -d "$APP_DIR" ]]; then
  echo "error: Code Universe.app was not produced by the Xcode build." >&2
  exit 1
fi

open -n "$APP_DIR"
