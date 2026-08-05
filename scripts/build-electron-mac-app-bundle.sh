#!/bin/zsh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SCANNER_PACKAGE_DIR="$ROOT_DIR/scanners/swiftsyntax-scanner"
APP_VERSION="$(sed -nE 's/^[[:space:]]*"version": "([^"]+)".*/\1/p' "$ROOT_DIR/package.json" | head -1)"
ARCHITECTURE="$(uname -m)"
ELECTRON_ARCH="$ARCHITECTURE"
[[ "$ARCHITECTURE" == "x86_64" ]] && ELECTRON_ARCH="x64"
APP_DIR="$ROOT_DIR/dist/Code Universe.app"
ARCHIVE_PATH="$ROOT_DIR/dist/Code-Universe-${APP_VERSION}-macOS-${ARCHITECTURE}.zip"
CHECKSUM_PATH="$ARCHIVE_PATH.sha256"
SIGN_IDENTITY="${CODE_UNIVERSE_SIGN_IDENTITY:--}"
BUILD_VERSION="$(date +%Y%m%d%H%M%S)"
STAGE_DIR="$(mktemp -d "$ROOT_DIR/.tmp-code-universe-electron.XXXXXX")"
PACKAGE_OUT="$(mktemp -d "$ROOT_DIR/.tmp-code-universe-package.XXXXXX")"
ICON_WORK="$(mktemp -d "$ROOT_DIR/.tmp-code-universe-icon.XXXXXX")"

cleanup() {
  rm -rf "$STAGE_DIR" "$PACKAGE_OUT" "$ICON_WORK"
}
trap cleanup EXIT

swift build -c release --package-path "$SCANNER_PACKAGE_DIR"
SCANNER_BINARY="$(swift build -c release --show-bin-path --package-path "$SCANNER_PACKAGE_DIR")/scan-swift-syntax"

mkdir -p "$STAGE_DIR/bin" "$STAGE_DIR/desktop/electron"
/usr/bin/ditto "$ROOT_DIR/public" "$STAGE_DIR/public"
/usr/bin/ditto "$ROOT_DIR/lib" "$STAGE_DIR/lib"
/usr/bin/ditto "$ROOT_DIR/scripts" "$STAGE_DIR/scripts"
/usr/bin/ditto "$ROOT_DIR/node_modules" "$STAGE_DIR/node_modules"
cp "$ROOT_DIR/server.js" "$ROOT_DIR/package-lock.json" "$STAGE_DIR/"
cp "$ROOT_DIR/desktop/electron/main.cjs" "$STAGE_DIR/desktop/electron/"
cp "$SCANNER_BINARY" "$STAGE_DIR/bin/scan-swift-syntax"
chmod +x "$STAGE_DIR/bin/scan-swift-syntax"
rm -rf "$STAGE_DIR/node_modules/playwright-core"
rm -f "$STAGE_DIR/node_modules/.bin/playwright-core"

cat > "$STAGE_DIR/package.json" <<JSON
{
  "name": "code-universe-desktop",
  "version": "$APP_VERSION",
  "private": true,
  "type": "module",
  "main": "desktop/electron/main.cjs",
  "dependencies": {
    "@modelcontextprotocol/sdk": "1.29.0",
    "parse5": "^7.3.0",
    "postcss": "^8.5.23",
    "three": "^0.185.0",
    "typescript": "^5.9.3",
    "zod": "^3.25.76"
  },
  "optionalDependencies": {
    "tree-sitter-css": "^0.25.0",
    "tree-sitter-html": "^0.23.2",
    "tree-sitter-java": "^0.23.5",
    "tree-sitter-javascript": "^0.25.0",
    "tree-sitter-php": "^0.24.2",
    "tree-sitter-python": "^0.25.0",
    "tree-sitter-typescript": "^0.23.2",
    "web-tree-sitter": "^0.26.11"
  }
}
JSON

ICON_PNG="$ICON_WORK/CodeUniverse.png"
ICONSET_DIR="$ICON_WORK/CodeUniverse.iconset"
ICON_PATH="$ICON_WORK/CodeUniverse.icns"
mkdir -p "$ICONSET_DIR"
swift "$ROOT_DIR/scripts/generate-mac-icon.swift" "$ICON_PNG"
sips -z 16 16 "$ICON_PNG" --out "$ICONSET_DIR/icon_16x16.png" >/dev/null
sips -z 32 32 "$ICON_PNG" --out "$ICONSET_DIR/icon_16x16@2x.png" >/dev/null
sips -z 32 32 "$ICON_PNG" --out "$ICONSET_DIR/icon_32x32.png" >/dev/null
sips -z 64 64 "$ICON_PNG" --out "$ICONSET_DIR/icon_32x32@2x.png" >/dev/null
sips -z 128 128 "$ICON_PNG" --out "$ICONSET_DIR/icon_128x128.png" >/dev/null
sips -z 256 256 "$ICON_PNG" --out "$ICONSET_DIR/icon_128x128@2x.png" >/dev/null
sips -z 256 256 "$ICON_PNG" --out "$ICONSET_DIR/icon_256x256.png" >/dev/null
sips -z 512 512 "$ICON_PNG" --out "$ICONSET_DIR/icon_256x256@2x.png" >/dev/null
sips -z 512 512 "$ICON_PNG" --out "$ICONSET_DIR/icon_512x512.png" >/dev/null
cp "$ICON_PNG" "$ICONSET_DIR/icon_512x512@2x.png"
iconutil -c icns "$ICONSET_DIR" -o "$ICON_PATH"

"$ROOT_DIR/node_modules/.bin/electron-packager" \
  "$STAGE_DIR" \
  "Code Universe" \
  --platform=darwin \
  --arch="$ELECTRON_ARCH" \
  --out="$PACKAGE_OUT" \
  --overwrite \
  --prune=true \
  --no-asar \
  --app-bundle-id="com.vclab.code-universe.desktop" \
  --app-version="$APP_VERSION" \
  --build-version="$BUILD_VERSION" \
  --osx-dark-mode-support

PACKAGED_APP="$PACKAGE_OUT/Code Universe-darwin-$ELECTRON_ARCH/Code Universe.app"
/usr/bin/ditto "$ICON_PATH" "$PACKAGED_APP/Contents/Resources/electron.icns"

if [[ "$SIGN_IDENTITY" == "-" ]]; then
  codesign --force --deep --sign - "$PACKAGED_APP"
else
  node "$ROOT_DIR/scripts/sign-electron-app.mjs" \
    "$PACKAGED_APP" \
    "$SIGN_IDENTITY" \
    "$PACKAGED_APP/Contents/Resources/app/bin/scan-swift-syntax"
fi

codesign --verify --deep --strict --verbose=2 "$PACKAGED_APP"
rm -rf "$APP_DIR" "$ARCHIVE_PATH" "$CHECKSUM_PATH"
/usr/bin/ditto "$PACKAGED_APP" "$APP_DIR"

codesign --verify --deep --strict --verbose=2 "$APP_DIR"
plutil -lint "$APP_DIR/Contents/Info.plist"
/usr/bin/ditto -c -k --sequesterRsrc --keepParent "$APP_DIR" "$ARCHIVE_PATH"
shasum -a 256 "$ARCHIVE_PATH" > "$CHECKSUM_PATH"

echo "Electron app bundle: $APP_DIR"
echo "Download archive: $ARCHIVE_PATH"
echo "SHA-256: $CHECKSUM_PATH"
