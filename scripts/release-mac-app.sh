#!/bin/zsh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_VERSION="$(sed -nE 's/^[[:space:]]*"version": "([^"]+)".*/\1/p' "$ROOT_DIR/package.json" | head -1)"
ARCHITECTURE="$(uname -m)"
APP_DIR="$ROOT_DIR/dist/Code Universe.app"
ARCHIVE_PATH="$ROOT_DIR/dist/Code-Universe-${APP_VERSION}-macOS-${ARCHITECTURE}.zip"
UPLOAD_PATH="$ROOT_DIR/dist/Code-Universe-${APP_VERSION}-notarization-upload.zip"
CHECKSUM_PATH="$ARCHIVE_PATH.sha256"
RESULT_PATH="$ROOT_DIR/dist/notarization-result.json"
LOG_PATH="$ROOT_DIR/dist/notarization-log.json"
SIGN_IDENTITY="${CODE_UNIVERSE_SIGN_IDENTITY:-Developer ID Application: Raymund Vorwerk (C9STR7BGUR)}"
KEYCHAIN_PROFILE="${CODE_UNIVERSE_NOTARY_PROFILE:-code-universe-notary}"

CODE_UNIVERSE_SIGN_IDENTITY="$SIGN_IDENTITY" zsh "$ROOT_DIR/scripts/build-electron-mac-app-bundle.sh"

codesign --verify --deep --strict --verbose=2 "$APP_DIR"
SIGNATURE_DETAILS="$(codesign --display --verbose=4 "$APP_DIR" 2>&1)"
[[ "$SIGNATURE_DETAILS" == *"Authority=Developer ID Application:"* ]]
[[ "$SIGNATURE_DETAILS" == *"runtime"* ]]

rm -f "$UPLOAD_PATH" "$RESULT_PATH" "$LOG_PATH"
/usr/bin/ditto -c -k --keepParent "$APP_DIR" "$UPLOAD_PATH"

set +e
xcrun notarytool submit "$UPLOAD_PATH" \
  --keychain-profile "$KEYCHAIN_PROFILE" \
  --wait \
  --output-format json > "$RESULT_PATH"
NOTARY_EXIT=$?
set -e

SUBMISSION_ID="$(jq -r '.id // empty' "$RESULT_PATH" 2>/dev/null || true)"
STATUS="$(jq -r '.status // empty' "$RESULT_PATH" 2>/dev/null || true)"

if [[ -n "$SUBMISSION_ID" ]]; then
  xcrun notarytool log "$SUBMISSION_ID" \
    --keychain-profile "$KEYCHAIN_PROFILE" \
    "$LOG_PATH" >/dev/null 2>&1 || true
fi

if [[ "$NOTARY_EXIT" -ne 0 || "$STATUS" != "Accepted" ]]; then
  echo "Notarization did not succeed. Status: ${STATUS:-unknown}" >&2
  [[ -n "$SUBMISSION_ID" ]] && echo "Submission: $SUBMISSION_ID" >&2
  [[ -f "$LOG_PATH" ]] && echo "Log: $LOG_PATH" >&2
  exit 1
fi

xcrun stapler staple "$APP_DIR"
xcrun stapler validate "$APP_DIR"
codesign --verify --deep --strict --verbose=2 "$APP_DIR"
spctl --assess --type execute --verbose=4 "$APP_DIR"

rm -f "$ARCHIVE_PATH" "$CHECKSUM_PATH"
/usr/bin/ditto -c -k --sequesterRsrc --keepParent "$APP_DIR" "$ARCHIVE_PATH"
shasum -a 256 "$ARCHIVE_PATH" > "$CHECKSUM_PATH"

echo "Notarized app: $APP_DIR"
echo "Download archive: $ARCHIVE_PATH"
echo "SHA-256: $CHECKSUM_PATH"
echo "Submission: $SUBMISSION_ID"
