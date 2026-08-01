# Architecture

```text
Project folder or source file
  -> shared discovery and language detection
  -> Swift, JavaScript/TypeScript, HTML/CSS, Python, PHP, Java, C#, and Objective-C adapters
  -> optional Tree-sitter WASM syntax metadata for supported languages
  -> validated schema-v2 graph
  -> browser/macOS 3D explorer, reviews, and MCP
```

The app is split into language adapters, a local Node server, a browser-based Three.js viewer, and a small macOS WebKit shell. Each part communicates through the same versioned graph contract so the viewer can evolve independently from scanner quality. The existing Swift scanners are preserved behind the Swift adapter.

See `language-adapters.md` for detection, adapter, editor, and migration details.

JavaScript and TypeScript semantic relationships are resolved through a project-aware TypeScript compiler program. C# and Objective-C use dependency-free structural adapters with language-specific declaration, inheritance, member, import, and call/message-send resolution. Python, PHP, and Java use a neutral structural adapter with optional Tree-sitter WASM syntax metadata and exact ranges. The optional Tree-sitter backend annotates web and programming-language nodes with concrete syntax ranges and parse status while leaving semantic and DOM producers authoritative. Project, adapter, and parser fingerprints avoid repeating unchanged work while keeping scanner profiles and adapter versions isolated.

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
