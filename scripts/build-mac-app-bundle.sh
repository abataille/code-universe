#!/bin/zsh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DIST_DIR="${CODE_UNIVERSE_DIST_DIR:-$ROOT_DIR/dist}"
PACKAGE_DIR="$ROOT_DIR/mac/CodeUniverseMac"
SCANNER_PACKAGE_DIR="$ROOT_DIR/scanners/swiftsyntax-scanner"
APP_DIR="$DIST_DIR/Code Universe.app"
CONTENTS_DIR="$APP_DIR/Contents"
MACOS_DIR="$CONTENTS_DIR/MacOS"
RESOURCES_DIR="$CONTENTS_DIR/Resources"
SERVER_DIR="$RESOURCES_DIR/code-universe"
RUNTIME_DIR="$RESOURCES_DIR/runtime"
APP_VERSION="$(sed -nE 's/^[[:space:]]*"version": "([^"]+)".*/\1/p' "$ROOT_DIR/package.json" | head -1)"
ARCHITECTURE="$(uname -m)"
ARCHIVE_PATH="$DIST_DIR/Code-Universe-${APP_VERSION}-macOS-${ARCHITECTURE}.zip"
CHECKSUM_PATH="$ARCHIVE_PATH.sha256"
NODE_BINARY="${CODE_UNIVERSE_NODE_BINARY:-$(command -v node || true)}"
SIGN_IDENTITY="${CODE_UNIVERSE_SIGN_IDENTITY:--}"
ICONSET_DIR="$ROOT_DIR/.tmp-code-universe.iconset"
ICON_PNG="$ROOT_DIR/.tmp-code-universe-icon.png"
ICON_SWIFT="$ROOT_DIR/.tmp-code-universe-icon.swift"
BUNDLE_VERSION="$(date +%Y%m%d%H%M%S)"
mkdir -p "$DIST_DIR"

if [ -z "$NODE_BINARY" ] || [ ! -x "$NODE_BINARY" ]; then
  echo "A distributable Node.js executable is required. Set CODE_UNIVERSE_NODE_BINARY to an executable Node binary." >&2
  exit 1
fi

if ! file "$NODE_BINARY" | grep -q "$ARCHITECTURE"; then
  echo "Node.js architecture does not match this Mac ($ARCHITECTURE): $NODE_BINARY" >&2
  exit 1
fi

swift build -c release --package-path "$PACKAGE_DIR"
swift build -c release --package-path "$SCANNER_PACKAGE_DIR"
BINARY_PATH="$(swift build -c release --show-bin-path --package-path "$PACKAGE_DIR")/CodeUniverseMac"
SCANNER_BINARY="$(swift build -c release --show-bin-path --package-path "$SCANNER_PACKAGE_DIR")/scan-swift-syntax"

rm -rf "$APP_DIR" "$ARCHIVE_PATH" "$CHECKSUM_PATH"
mkdir -p "$MACOS_DIR" "$RESOURCES_DIR" "$SERVER_DIR/bin" "$RUNTIME_DIR"
cp "$BINARY_PATH" "$MACOS_DIR/CodeUniverseMac"
cp "$NODE_BINARY" "$RUNTIME_DIR/node"
cp "$SCANNER_BINARY" "$SERVER_DIR/bin/scan-swift-syntax"
chmod +x "$MACOS_DIR/CodeUniverseMac" "$RUNTIME_DIR/node" "$SERVER_DIR/bin/scan-swift-syntax"

/usr/bin/ditto "$ROOT_DIR/public" "$SERVER_DIR/public"
/usr/bin/ditto "$ROOT_DIR/lib" "$SERVER_DIR/lib"
/usr/bin/ditto "$ROOT_DIR/scripts" "$SERVER_DIR/scripts"
/usr/bin/ditto "$ROOT_DIR/node_modules" "$SERVER_DIR/node_modules"
cp "$ROOT_DIR/server.js" "$ROOT_DIR/package.json" "$ROOT_DIR/package-lock.json" "$ROOT_DIR/LICENSE" "$ROOT_DIR/COMMERCIAL-LICENSE.md" "$SERVER_DIR/"
if [[ -f "$ROOT_DIR/config/license-public-key.pem" ]]; then
  mkdir -p "$SERVER_DIR/config"
  cp "$ROOT_DIR/config/license-public-key.pem" "$SERVER_DIR/config/"
fi
rm -rf "$SERVER_DIR/node_modules/playwright-core"
rm -f "$SERVER_DIR/node_modules/.bin/playwright-core"

cat > "$CONTENTS_DIR/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>CodeUniverseMac</string>
  <key>CFBundleIdentifier</key>
  <string>com.vclab.code-universe</string>
  <key>CFBundleName</key>
  <string>Code Universe</string>
  <key>CFBundleDisplayName</key>
  <string>Code Universe</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleIconFile</key>
  <string>CodeUniverse.icns</string>
  <key>CFBundleIconName</key>
  <string>CodeUniverse</string>
  <key>CFBundleShortVersionString</key>
  <string>$APP_VERSION</string>
  <key>CFBundleVersion</key>
  <string>$BUNDLE_VERSION</string>
  <key>LSMinimumSystemVersion</key>
  <string>13.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
  <key>NSAppTransportSecurity</key>
  <dict>
    <key>NSAllowsLocalNetworking</key>
    <true/>
  </dict>
  <key>CFBundleURLTypes</key>
  <array>
    <dict>
      <key>CFBundleURLName</key>
      <string>Code Universe URL</string>
      <key>CFBundleURLSchemes</key>
      <array>
        <string>code-universe</string>
      </array>
    </dict>
  </array>
</dict>
</plist>
PLIST

if [ -f "$ROOT_DIR/assets/CodeUniverse.icns" ]; then
  cp "$ROOT_DIR/assets/CodeUniverse.icns" "$RESOURCES_DIR/CodeUniverse.icns"
elif [ -f "/Users/raymundvorwerk/Desktop/Code Universe.app/Contents/Resources/CodeUniverse.icns" ]; then
  cp "/Users/raymundvorwerk/Desktop/Code Universe.app/Contents/Resources/CodeUniverse.icns" "$RESOURCES_DIR/CodeUniverse.icns"
else
  rm -rf "$ICONSET_DIR" "$ICON_PNG" "$ICON_SWIFT"
  mkdir -p "$ICONSET_DIR"
  cat > "$ICON_SWIFT" <<'SWIFT'
import AppKit

let image = NSImage(size: NSSize(width: 1024, height: 1024))
image.lockFocus()

let rect = NSRect(x: 48, y: 48, width: 928, height: 928)
NSColor(calibratedRed: 0.05, green: 0.07, blue: 0.09, alpha: 1).setFill()
NSBezierPath(roundedRect: rect, xRadius: 210, yRadius: 210).fill()

NSGradient(colors: [
  NSColor(calibratedRed: 0.10, green: 0.46, blue: 0.40, alpha: 1),
  NSColor(calibratedRed: 0.08, green: 0.12, blue: 0.16, alpha: 1)
])!.draw(in: NSBezierPath(roundedRect: rect.insetBy(dx: 42, dy: 42), xRadius: 180, yRadius: 180), angle: -35)

func cube(_ rect: NSRect, _ color: NSColor) {
  let path = NSBezierPath(roundedRect: rect, xRadius: 28, yRadius: 28)
  color.setFill()
  path.fill()
  NSColor.white.withAlphaComponent(0.2).setStroke()
  path.lineWidth = 6
  path.stroke()
}

func edge(_ start: NSPoint, _ end: NSPoint) {
  let path = NSBezierPath()
  path.move(to: start)
  path.line(to: end)
  NSColor(calibratedRed: 1.0, green: 0.31, blue: 0.37, alpha: 0.82).setStroke()
  path.lineWidth = 16
  path.lineCapStyle = .round
  path.stroke()
}

edge(NSPoint(x: 320, y: 650), NSPoint(x: 515, y: 505))
edge(NSPoint(x: 515, y: 505), NSPoint(x: 720, y: 640))
edge(NSPoint(x: 515, y: 505), NSPoint(x: 520, y: 300))

cube(NSRect(x: 220, y: 590, width: 200, height: 200), NSColor(calibratedRed: 0.50, green: 0.84, blue: 0.76, alpha: 1))
cube(NSRect(x: 425, y: 410, width: 190, height: 190), NSColor(calibratedRed: 0.72, green: 0.65, blue: 0.90, alpha: 1))
cube(NSRect(x: 630, y: 590, width: 180, height: 180), NSColor(calibratedRed: 0.91, green: 0.75, blue: 0.40, alpha: 1))

let attrs: [NSAttributedString.Key: Any] = [
  .font: NSFont.systemFont(ofSize: 190, weight: .black),
  .foregroundColor: NSColor.white.withAlphaComponent(0.94)
]
("</>" as NSString).draw(in: NSRect(x: 315, y: 130, width: 410, height: 220), withAttributes: attrs)

image.unlockFocus()
let bitmap = NSBitmapImageRep(data: image.tiffRepresentation!)!
try bitmap.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
SWIFT
  swift "$ICON_SWIFT" "$ICON_PNG"
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
  iconutil -c icns "$ICONSET_DIR" -o "$RESOURCES_DIR/CodeUniverse.icns"
  rm -rf "$ICONSET_DIR" "$ICON_PNG" "$ICON_SWIFT"
fi

touch "$APP_DIR"

while IFS= read -r nested_code; do
  codesign --force --sign "$SIGN_IDENTITY" "$nested_code"
done < <(find "$SERVER_DIR/node_modules" -type f \( -name '*.node' -o -name '*.dylib' \) -print)
codesign --force --sign "$SIGN_IDENTITY" "$RUNTIME_DIR/node"
codesign --force --sign "$SIGN_IDENTITY" "$SERVER_DIR/bin/scan-swift-syntax"
codesign --force --sign "$SIGN_IDENTITY" "$MACOS_DIR/CodeUniverseMac"
codesign --force --sign "$SIGN_IDENTITY" "$APP_DIR"
codesign --verify --deep --strict --verbose=2 "$APP_DIR"
plutil -lint "$CONTENTS_DIR/Info.plist"

/usr/bin/ditto -c -k --sequesterRsrc --keepParent "$APP_DIR" "$ARCHIVE_PATH"
(cd "$DIST_DIR" && shasum -a 256 "$(basename "$ARCHIVE_PATH")") > "$CHECKSUM_PATH"

/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$APP_DIR" >/dev/null 2>&1 || true
echo "App bundle: $APP_DIR"
echo "Download archive: $ARCHIVE_PATH"
echo "SHA-256: $CHECKSUM_PATH"
