# Language Adapters and Migration

## Architecture

```text
Project path
  -> shared source discovery and language detection
  -> applicable language adapters
  -> validated graph fragments
  -> deterministic schema-v2 merge
  -> viewer, review trace, and MCP queries
```

The adapter registry lives in `lib/adapters`. Project detection and orchestration live in `lib/projects`; the graph contract lives in `lib/graph`.

Each adapter declares:

- `id`, `displayName`, and `version`
- supported `languages`, extensions, and scan profiles
- `scan(context)`, returning a graph fragment and generic diagnostics

## Current adapters

### Swift

`SwiftLanguageAdapter` wraps the existing implementation. It maps profiles without replacing any scanner:

| Profile | Swift implementation |
| --- | --- |
| `fast` | heuristic scanner |
| `balanced` | SwiftSyntax plus heuristic hints |
| `accurate` | SwiftSyntax |
| `indexed` | merged graph plus Xcode index |

Existing Swift IDs, kinds, metrics, provenance, parser comparison, and Xcode handoff remain supported.

### JavaScript and TypeScript

The TypeScript compiler parser handles `.js`, `.mjs`, `.cjs`, `.jsx`, `.ts`, `.mts`, `.cts`, and `.tsx`.

It emits files, modules, imports, exports, classes, interfaces, enums, aliases, functions, methods, properties, variables, heritage relationships, statically resolvable calls, and React-style components.

### HTML and CSS

The web-assets adapter uses parse5 and PostCSS. It emits architectural HTML elements, documents, stylesheet rules, keyframes, script/stylesheet loading, and confident selector-to-element `styles` relationships.

## Detection

Detection combines supported source-file counts with `Package.swift`, `.xcodeproj`, `package.json`, `tsconfig.json`, and `jsconfig.json` evidence. It returns every detected language and selects a primary language only for presentation.

Shared discovery excludes generated, dependency, cache, and build directories, including `node_modules`, `DerivedData`, `.build`, `dist`, and `coverage`.

## Editor integration

The source endpoint uses an editor provider:

- Xcode through `xed`
- VS Code through `code --goto file:line:column`
- the macOS system handler as fallback

Set `CODE_UNIVERSE_EDITOR=xcode`, `vscode`, or `system` to override automatic selection.

## Migration status

1. Schema v2 and v1 compatibility: complete.
2. Adapter registry and preserved Swift adapter: complete.
3. JavaScript/TypeScript and HTML/CSS adapters: complete.
4. Mixed-language project detection and graph merge: complete.
5. Generic source lookup, review snapshots, diffs, and trace extraction: complete.
6. Editor-provider integration and generic viewer controls: complete.
7. Future semantic enrichment: TypeScript type-checker symbol identity, language-server indexes, incremental file fingerprints, CSS modules, and framework-specific adapters.
