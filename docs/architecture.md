# Architecture

```text
Swift source folder
  -> scripts/scan-swift.js
  -> public/sample-graph.json
  -> public/app.js
  -> browser/macOS 3D explorer
```

The app is split into scanners, a local Node server, a browser-based Three.js viewer, and a small macOS WebKit shell. Each part communicates through the same versioned graph contract so the viewer can evolve independently from scanner quality.

## Current Analysis Limits

The fast scanner is heuristic and optimized for quick architectural orientation. Deeper modes layer in SwiftSyntax and Xcode index data for stronger declarations and semantic links.

Longer-term scanner work should use:

- `SwiftSyntax` for declarations and source ranges.
- `xcodebuild -list` and `.pbxproj` parsing for targets.
- SourceKit-LSP or index store data for richer references.
- A versioned SQLite graph for fast `used by`, impact, and path queries.

## SwiftSyntax Upgrade Path

The scanner should keep improving in stages:

1. Parse source files with `SwiftParser` and emit declarations with stable qualified names.
2. Capture exact source ranges for files, types, functions, and properties.
3. Resolve member references inside function bodies so popup internals can show accurate calls and property access.
4. Merge SourceKit-LSP or Xcode index-store references for cross-file `uses`, `used by`, and call edges.
5. Persist graph snapshots in SQLite so large projects can load incrementally and compare architecture over time.

The SwiftSyntax implementation lives in `scanners/swiftsyntax-scanner` and is run through `scripts/scan-swift-syntax.js`. It emits the existing graph schema so the viewer can switch scanners without a UI rewrite.
