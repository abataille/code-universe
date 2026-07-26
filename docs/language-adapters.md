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

It builds a project-aware TypeScript `Program`, honoring `tsconfig.json` / `jsconfig.json` compiler options and path aliases. Compiler symbols resolve aliased imports, constructors, methods, calls, heritage, and type references with high-confidence `typescript-checker` provenance. Nodes record stable semantic names in addition to source-qualified names.

It emits files, modules, imports, exports, classes, interfaces, enums, aliases, functions, methods, properties, variables, heritage relationships, semantic calls, and JSX components. Nested functions, object-literal methods, destructured bindings, CommonJS `require`, dynamic `import()`, and unresolved global call targets are retained. Framework detectors annotate React, Next.js, Preact, Solid, and generic JSX components without changing the neutral graph category.

JSX markup is modeled below its owning callable or component. Individual JSX elements retain tags, IDs, classes, navigation, accessibility, and media attributes. Static image, video, audio, font, document, and other supported asset strings in JavaScript arrays, objects, assignments, carousel constructor arguments, and JSX attributes reuse the same asset IDs as HTML and CSS. This means a slideshow variable and an HTML `<img>` that reference the same local image connect to one shared asset node.

Executable inline HTML `<script>` blocks are parsed as `inline_script` modules with source-accurate declaration locations. Static ES imports, dynamic imports, and CommonJS imports are supported. DOM selectors from `getElementById`, class/tag lookup, `querySelector`, `querySelectorAll`, `matches`, and `closest` create `uses` relationships to matching HTML or JSX nodes. Direct and locally bound `addEventListener` targets retain their event metadata, and `createElement` records the created tag relationship.

### HTML and CSS

The web-assets adapter uses parse5 and PostCSS. It emits architectural HTML elements, documents, stylesheet rules, keyframes, script/stylesheet loading, and confident selector-to-element `styles` relationships. CSS Modules imported by JavaScript/TypeScript produce direct `styles` relationships from the using component or callable to the matching selector rule.

HTML LOC uses physical source lines. An emitted element spans its opening tag through its closing tag rather than defaulting to one line. Document and element-subtree complexity analyze the complete parsed DOM, including anonymous `div` and `span` descendants that are intentionally collapsed from the 3D map. The metric includes element count, nesting, attributes, event handlers, conditional directives, templates, and interactive controls, keeping visual density independent from measurement accuracy.

Opening an HTML file exposes up to 64 meaningful internals: architectural elements, identified/classed elements, anchors, and image markup. They are sorted by source line and placed on a flat, evenly spaced DOM board with compact dimensions; subtree LOC affects height without placing descendant-sized objects inside one another. Anchor text becomes the object label. `links_to` connections resolve same-page fragments to matching IDs, relative links to project HTML files or fragments, and external HTTP, email, and telephone destinations to external URL nodes. Link streets are overlaid on the board while containment edges stay hidden, keeping the page readable without turning anonymous layout wrappers into separate objects.

`img`, `picture`, `source`, `video`, `audio`, `iframe`, `embed`, `object`, form controls, labels, scripts, styles, links, and inline SVG are always visible even when they have no ID or class. Image labels prefer `alt` text and then the source filename. A `<source>` inherits image, video, or audio meaning from its parent rather than being assumed to be an image. Semantic parent-child containment is retained—for example, `picture -> source/img`—while the file popup recursively places every meaningful element on one readable flat board.

Every `src`, `srcset`, `poster`, embeddable `data`, downloadable `href`, icon/manifest reference, and CSS `url(...)` becomes a local, external, or embedded asset node. Images and media use `displays`; embedded documents use `embeds`; downloads use `downloads`; forms use `submits_to`; and loading relationships use `loads`. Local assets record existence, byte size, broken-reference state, and actual dimensions for supported image headers. HTML `width`/`height`, CSS selector dimensions, responsive descriptors, loading behavior, and whether `alt` is described, decorative, or missing remain separately inspectable.

Asset nodes are visible in the main 3D city as low plaques whose footprints follow the real image aspect ratio. Opening an HTML file also includes declarations from its inline scripts, so generated galleries and carousel arrays expose their image assets and `displays` connections even when the HTML contains no literal `<img>` element.

Inline `<style>` rules, CSS custom properties, `@import`, keyframes, and CSS URL assets are parsed. `<base href>` affects relative HTML links and assets. The popup no longer truncates HTML at 64 internals; all meaningful elements remain available, while anonymous layout-only wrappers continue to affect full-DOM LOC and complexity without adding map noise.

### C#

The C# adapter handles `.cs` files and detects `.sln`, `.csproj`, `global.json`, and `Directory.Build.props` project evidence. It emits namespaces on qualified names, classes, records, structs, interfaces, enums, constructors, methods, properties, `using` modules, inheritance, interface implementation, type usage, and locally resolvable call relationships.

The current `csharp-structural` index is dependency-free and intended for architecture mapping. A future Roslyn bridge can replace or enrich its inferred call edges without changing graph IDs or the adapter contract.

### Objective-C and Objective-C++

The Objective-C adapter handles `.h`, `.m`, and `.mm`. It preserves `.mm` as `objective-cpp` while sharing one adapter for headers and implementations. It emits interfaces, implementations, categories, protocols, properties, methods/selectors, C-style functions, imports, superclass relationships, protocol conformance, interface-to-implementation links, and locally resolvable Objective-C message sends.

Xcode project evidence selects Xcode project handling for Objective-C repositories just as it does for Swift. A future Clang index bridge can enrich the dependency-free `objective-c-structural` index while retaining the same neutral graph.

## Detection

Detection combines supported source-file counts with `Package.swift`, `.xcodeproj`, `.sln`, `.csproj`, `global.json`, `Directory.Build.props`, `package.json`, `tsconfig.json`, and `jsconfig.json` evidence. It returns every detected language and selects a primary language only for presentation.

Shared discovery excludes generated, dependency, cache, and build directories, including `node_modules`, `DerivedData`, `.build`, `dist`, and `coverage`.

## Incremental scans

Every project scan receives a SHA-256 fingerprint derived from the analysis profile, adapter versions, source-file metadata, and project configuration. Unchanged full graphs are reused immediately.

Adapter fragments have independent fingerprints. For example, changing CSS content reruns the web-assets adapter while reusing unchanged Swift and JavaScript/TypeScript fragments. CSS filenames remain part of TypeScript fingerprints for module resolution, while CSS contents do not force a TypeScript reparse.

The in-memory caches are bounded and invalidate automatically when source files, `Package.swift`, `package.json`, `tsconfig.json`, `jsconfig.json`, .NET project files, Xcode project files, adapter versions, or analysis profiles change.

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
7. TypeScript semantic index, incremental fingerprints, CSS Modules, and framework detection: complete.
8. C# and Objective-C/Objective-C++ structural adapters: complete.

Roslyn/Clang semantic enrichment and persistent SQLite graph history remain optional roadmap work. The structural C# and Objective-C adapters are fully integrated without requiring those external toolchains.
