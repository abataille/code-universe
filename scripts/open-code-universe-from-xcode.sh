#!/bin/zsh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_DIR="$ROOT_DIR/dist/Code Universe.app"
APP_BINARY="$APP_DIR/Contents/MacOS/CodeUniverseMac"
MAC_SOURCE="$ROOT_DIR/mac/CodeUniverseMac/Sources/CodeUniverseMac/main.swift"
BUILD_SCRIPT="$ROOT_DIR/scripts/build-mac-app-bundle.sh"
LOG_FILE="$HOME/Library/Logs/CodeUniverseXcodeBehavior.log"
mkdir -p "$(dirname "$LOG_FILE")"

log() {
  printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$LOG_FILE"
}

resolve_project_folder() {
  local candidate="$1"
  if [ -z "$candidate" ]; then
    return 1
  fi

  if [[ "$candidate" == *.xcodeproj || "$candidate" == *.xcworkspace ]]; then
    dirname "$candidate"
  elif [[ "$candidate" == */project.pbxproj ]]; then
    dirname "$(dirname "$candidate")"
  elif [ -f "$candidate" ]; then
    local folder
    folder="$(dirname "$candidate")"
    while [ "$folder" != "/" ]; do
      if find "$folder" -maxdepth 1 \( -name "*.xcodeproj" -o -name "*.xcworkspace" \) -print -quit | grep -q .; then
        printf '%s\n' "$folder"
        return 0
      fi
      folder="$(dirname "$folder")"
    done
    dirname "$candidate"
  else
    printf '%s\n' "$candidate"
  fi
}

PROJECT_PATH="$(osascript <<'APPLESCRIPT' 2>/dev/null || true
tell application "Xcode"
  activate
  try
    set documentPath to path of active workspace document
    return POSIX path of documentPath
  on error
    try
      set documentPath to path of front workspace document
      return POSIX path of documentPath
    on error
      return ""
    end try
  end try
end tell
APPLESCRIPT
)"

if [ -n "$PROJECT_PATH" ]; then
  log "xcode-document=$PROJECT_PATH"
  PROJECT_PATH="$(resolve_project_folder "$PROJECT_PATH")"
fi

if [ -z "$PROJECT_PATH" ] && [ -n "${PROJECT_DIR:-}" ]; then
  log "project-dir-env=$PROJECT_DIR"
  PROJECT_PATH="$(resolve_project_folder "$PROJECT_DIR")"
fi

if [ -z "$PROJECT_PATH" ] && [ -n "${SRCROOT:-}" ]; then
  log "srcroot-env=$SRCROOT"
  PROJECT_PATH="$(resolve_project_folder "$SRCROOT")"
fi

if [ -z "$PROJECT_PATH" ]; then
  PROJECT_PATH="$(osascript -e 'POSIX path of (choose folder with prompt "Choose the Xcode project folder to scan in Code Universe")')"
  log "manual-folder=$PROJECT_PATH"
fi

if [ -z "$PROJECT_PATH" ]; then
  log "no-project-path"
  exit 1
fi

if [ ! -x "$APP_BINARY" ] || [ "$MAC_SOURCE" -nt "$APP_BINARY" ] || [ "$BUILD_SCRIPT" -nt "$APP_BINARY" ]; then
  log "rebuilding-bundle"
  "$ROOT_DIR/scripts/build-mac-app-bundle.sh" >/dev/null
fi

log "opening=$PROJECT_PATH app=$APP_DIR"
open -n "$APP_DIR" --args --scan-path "$PROJECT_PATH"
