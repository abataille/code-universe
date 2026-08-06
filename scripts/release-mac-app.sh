#!/bin/zsh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_VERSION="$(sed -nE 's/^[[:space:]]*"version": "([^"]+)".*/\1/p' "$ROOT_DIR/package.json" | head -1)"
ARCHITECTURE="$(uname -m)"
APP_DIR="$ROOT_DIR/dist/Code Universe.app"
ARCHIVE_PATH="$ROOT_DIR/dist/Code-Universe-${APP_VERSION}-macOS-${ARCHITECTURE}.zip"
CHECKSUM_PATH="$ARCHIVE_PATH.sha256"
DMG_PATH="$ROOT_DIR/dist/Code-Universe-${APP_VERSION}-macOS-${ARCHITECTURE}.dmg"
DMG_CHECKSUM_PATH="$DMG_PATH.sha256"
RESULT_PATH="$ROOT_DIR/dist/notarization-result.json"
LOG_PATH="$ROOT_DIR/dist/notarization-log.json"
SIGN_IDENTITY="${CODE_UNIVERSE_SIGN_IDENTITY:-Developer ID Application: Raymund Vorwerk (C9STR7BGUR)}"
KEYCHAIN_PROFILE="${CODE_UNIVERSE_NOTARY_PROFILE:-code-universe-notary}"
DMG_STAGE="$(mktemp -d "$ROOT_DIR/.tmp-code-universe-dmg.XXXXXX")"

cleanup() {
  rm -rf "$DMG_STAGE"
}
trap cleanup EXIT

CODE_UNIVERSE_SIGN_IDENTITY="$SIGN_IDENTITY" zsh "$ROOT_DIR/scripts/build-electron-mac-app-bundle.sh"

codesign --verify --deep --strict --verbose=2 "$APP_DIR"
SIGNATURE_DETAILS="$(codesign --display --verbose=4 "$APP_DIR" 2>&1)"
[[ "$SIGNATURE_DETAILS" == *"Authority=Developer ID Application:"* ]]
[[ "$SIGNATURE_DETAILS" == *"runtime"* ]]

mkdir -p "$DMG_STAGE"
/usr/bin/ditto "$APP_DIR" "$DMG_STAGE/Code Universe.app"
ln -s /Applications "$DMG_STAGE/Applications"

rm -f "$DMG_PATH" "$DMG_CHECKSUM_PATH" "$RESULT_PATH" "$LOG_PATH"
hdiutil create \
  -volname "Code Universe" \
  -srcfolder "$DMG_STAGE" \
  -format UDZO \
  -imagekey zlib-level=9 \
  -ov \
  "$DMG_PATH"
codesign --force --timestamp --sign "$SIGN_IDENTITY" "$DMG_PATH"
codesign --verify --verbose=2 "$DMG_PATH"
hdiutil verify "$DMG_PATH"

set +e
xcrun notarytool submit "$DMG_PATH" \
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

xcrun stapler staple "$DMG_PATH"
xcrun stapler validate "$DMG_PATH"
xcrun stapler staple "$APP_DIR"
xcrun stapler validate "$APP_DIR"
codesign --verify --deep --strict --verbose=2 "$APP_DIR"
spctl --assess --type execute --verbose=4 "$APP_DIR"
codesign --verify --verbose=2 "$DMG_PATH"
hdiutil verify "$DMG_PATH"
spctl --assess --type open --context context:primary-signature --verbose=4 "$DMG_PATH"

rm -f "$ARCHIVE_PATH" "$CHECKSUM_PATH"
/usr/bin/ditto -c -k --sequesterRsrc --keepParent "$APP_DIR" "$ARCHIVE_PATH"
shasum -a 256 "$ARCHIVE_PATH" > "$CHECKSUM_PATH"
shasum -a 256 "$DMG_PATH" > "$DMG_CHECKSUM_PATH"

echo "Notarized app: $APP_DIR"
echo "Primary download: $DMG_PATH"
echo "DMG SHA-256: $DMG_CHECKSUM_PATH"
echo "Secondary ZIP: $ARCHIVE_PATH"
echo "ZIP SHA-256: $CHECKSUM_PATH"
echo "Submission: $SUBMISSION_ID"
