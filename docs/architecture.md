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
