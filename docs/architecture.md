# Prototype Architecture

```text
Swift source folder
  -> scripts/scan-swift.js
  -> public/sample-graph.json
  -> public/app.js
  -> browser canvas 3D explorer
```

The desktop shell is intentionally absent from the first prototype. The viewer is static and the scanner is a command-line script, so a future Tauri, Electron, SwiftUI, or web shell can reuse the same graph contract.

## Prototype Limits

The scanner is heuristic. It is good enough to validate the product shape, not good enough for production static analysis.

The production scanner should use:

- `SwiftSyntax` for declarations and source ranges.
- `xcodebuild -list` and `.pbxproj` parsing for targets.
- SourceKit-LSP or index store data for richer references.
- A versioned SQLite graph for fast `used by`, impact, and path queries.

## SwiftSyntax Upgrade Path

The regex scanner should be replaced in stages:

1. Parse source files with `SwiftParser` and emit declarations with stable qualified names.
2. Capture exact source ranges for files, types, functions, and properties.
3. Resolve member references inside function bodies so popup internals can show accurate calls and property access.
4. Merge SourceKit-LSP or Xcode index-store references for cross-file `uses`, `used by`, and call edges.
5. Persist graph snapshots in SQLite so large projects can load incrementally and compare architecture over time.

The first implementation lives in `scanners/swiftsyntax-scanner` and is run through `scripts/scan-swift-syntax.js`. It intentionally emits the existing graph schema so the viewer can switch scanners without a UI rewrite.
