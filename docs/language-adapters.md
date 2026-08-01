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

The optional `tree-sitter` profile adds a WebAssembly syntax backend for JavaScript,
TypeScript/TSX, HTML, and CSS. It is loaded lazily through `web-tree-sitter` and the
grammar packages listed in `package.json`'s `optionalDependencies`. If those packages
are omitted, the existing adapters continue unchanged and diagnostics report the
fallback instead of failing project startup.

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

Swift remains the compatibility baseline for the neutral model. SwiftSyntax now supplies exact declaration ranges and emits extensions, initializers, enum cases, direct local variables, and closure-valued locals. The heuristic scanner supplies declaration spans, extensions, initializers, and enum cases when SwiftSyntax is unavailable. Both retain the established Swift node IDs and `defines` hierarchy. Named, generated, system, and dynamic `Image`, `UIImage`, and `NSImage` references connect the enclosing Swift symbol to an inspectable image object.

### JavaScript and TypeScript

The TypeScript compiler parser handles `.js`, `.mjs`, `.cjs`, `.jsx`, `.ts`, `.mts`, `.cts`, and `.tsx`.

It builds a project-aware TypeScript `Program`, honoring `tsconfig.json` / `jsconfig.json` compiler options and path aliases. Compiler symbols resolve aliased imports, constructors, methods, calls, heritage, and type references with high-confidence `typescript-checker` provenance. Nodes record stable semantic names in addition to source-qualified names.

It emits files, modules, imports, exports, classes, interfaces, enums, aliases, functions, methods, properties, variables, heritage relationships, semantic calls, and JSX components. Nested functions, object-literal methods, destructured bindings, CommonJS `require`, dynamic `import()`, and unresolved global call targets are retained. Framework detectors annotate React, Next.js, Preact, Solid, and generic JSX components without changing the neutral graph category.

JSX markup is modeled below its owning callable or component. Individual JSX elements retain tags, IDs, classes, navigation, accessibility, and media attributes. Static image, video, audio, font, document, and other supported asset strings in JavaScript arrays, objects, assignments, carousel constructor arguments, and JSX attributes reuse the same asset IDs as HTML and CSS. Dynamic JSX `src`/`poster`, property assignments, and `setAttribute` image expressions remain visible as low-confidence dynamic image objects instead of disappearing from the graph.

Executable inline HTML `<script>` blocks are parsed as `inline_script` modules with source-accurate declaration locations. Static ES imports, dynamic imports, and CommonJS imports are supported. DOM selectors from `getElementById`, class/tag lookup, `querySelector`, `querySelectorAll`, `matches`, and `closest` create `uses` relationships to matching HTML or JSX nodes. Direct and locally bound `addEventListener` targets retain their event metadata, and `createElement` records the created tag relationship.

### HTML and CSS

The web-assets adapter uses parse5 and PostCSS. It emits architectural HTML elements, documents, stylesheet rules, keyframes, script/stylesheet loading, and confident selector-to-element `styles` relationships. CSS Modules imported by JavaScript/TypeScript produce direct `styles` relationships from the using component or callable to the matching selector rule.

HTML LOC uses physical source lines. An emitted element spans its opening tag through its closing tag rather than defaulting to one line. Document and element-subtree complexity analyze the complete parsed DOM, including anonymous `div` and `span` descendants that are intentionally collapsed from the 3D map. The metric includes element count, nesting, attributes, event handlers, conditional directives, templates, and interactive controls, keeping visual density independent from measurement accuracy.

Opening an HTML file produces a city block rather than a flat DOM diagram. Top-level semantic branches occupy separate lots, architectural elements become buildings, nested containers become raised terraces, and images, links, controls, and other leaves become visible landmarks. DOM depth raises objects into readable levels instead of enclosing them inside opaque parent meshes. `contains` edges act as low-contrast streets between levels, while `links_to` connections resolve same-page fragments to matching IDs, relative links to project HTML files or fragments, and external HTTP, email, and telephone destinations to external URL nodes.

`img`, `picture`, `source`, `video`, `audio`, `iframe`, `embed`, `object`, form controls, labels, scripts, styles, links, and inline SVG are always visible even when they have no ID or class. Image labels prefer `alt` text and then the source filename. A `<source>` inherits image, video, or audio meaning from its parent rather than being assumed to be an image. Semantic parent-child containment is retained—for example, `picture -> source/img`—while the file popup recursively places every meaningful element on one readable flat board.

Every `src`, `srcset`, `poster`, embeddable `data`, downloadable `href`, icon/manifest reference, and CSS `url(...)` becomes a local, external, or embedded asset node. Images and media use `displays`; embedded documents use `embeds`; downloads use `downloads`; forms use `submits_to`; and loading relationships use `loads`. Local assets record existence, byte size, broken-reference state, and actual dimensions for supported image headers. HTML `width`/`height`, CSS selector dimensions, responsive descriptors, loading behavior, and whether `alt` is described, decorative, or missing remain separately inspectable.

Asset nodes are visible in the main 3D city as low plaques whose footprints follow the real image aspect ratio. Opening an HTML file also includes declarations from its inline scripts, so generated galleries and carousel arrays expose their image assets and `displays` connections even when the HTML contains no literal `<img>` element.

The same city grammar applies to programming languages. Files are lots; classes, structs, services, components, and other types are buildings; callables become compact exterior offices or balconies; properties, fields, and variables become façade markers; and nested types become annex buildings. Dense types distribute members around all four façades and suppress low-value labels rather than growing a second member tower above the type. Inspection expands this architecture without switching to a generic nested-object diagram, so Swift, JavaScript/TypeScript, C#, Objective-C, HTML, and CSS retain one spatial vocabulary.

The project-assets adapter indexes local images independently of source language. Xcode `.imageset` scale variants are represented as one logical image object with a preferred preview, scale, idiom, appearance, and catalog-property metadata. SF Symbols are external system image objects; runtime-computed names remain visible as low-confidence dynamic image objects. PNG/APNG, JPEG, GIF, WebP, SVG, BMP, ICO, and AVIF headers provide intrinsic dimensions where available. Direct web image files retain path-stable asset IDs.

After all adapters merge, Code Universe derives one spatial hierarchy from `contains` and `defines` edges. Repository folders become directory platforms. Every node receives a stable identity, primary and alternate parents, shared consumers, depth, sibling index, child count, normalized display weight, source-span LOC, and cyclomatic complexity. The renderer uses this hierarchy for folders, nested symbols, DOM elements, and asset placement while ordinary relationship edges remain connections rather than forced containment.

Filesystem depth remains a logical relationship, not a vertical stack. All directory platforms are packed as adjacent ground-level districts using their actual file-lot footprints; nested directories retain their parent IDs and inspector breadcrumbs but do not sit on top of parent districts. Files are packed within their immediate district with variable spacing derived from the buildings they contain.

Inline `<style>` rules, CSS custom properties, `@import`, keyframes, and CSS URL assets are parsed. `<base href>` affects relative HTML links and assets. The popup no longer truncates HTML at 64 internals; all meaningful elements remain available, while anonymous layout-only wrappers continue to affect full-DOM LOC and complexity without adding map noise.

### Optional Tree-sitter WASM backend

Selecting `tree-sitter` (or setting `CODE_UNIVERSE_SCANNER=tree-sitter`) keeps the
existing TypeScript compiler, parse5/PostCSS, Swift, C#, Objective-C, and asset
adapters as the graph producers. The WebAssembly backend parses supported web source
files and annotates the resulting nodes with `attributes.treeSitter` and parser
provenance. This gives the inspector concrete syntax node kinds, parse-error status,
and embedded JavaScript/CSS coverage without changing stable node IDs or semantic
TypeScript edges.

The backend is intentionally optional and never downloads grammars at runtime. It
records runtime and grammar versions in `project.parsers`, includes the parser
fingerprint in scan caches, and falls back to the current adapters when the runtime or
a grammar is unavailable. HTML `<script>` and `<style>` ranges are parsed with their
embedded grammars, while the outer DOM remains owned by the existing HTML adapter.

`Compare Parsers` now uses the same neutral graph for side-by-side parser checks. A
web project compares the semantic/DOM adapter graph with the Tree-sitter graph and
reports shared and parser-only nodes and edges, grammar coverage, embedded-language
coverage, and syntax diagnostics. Swift projects retain the existing heuristic,
SwiftSyntax, merged, and Xcode-index comparison. Mixed projects return both panels;
the original Swift fields remain at the response root for compatibility with older
clients.

### C#

The C# adapter handles `.cs` files and detects `.sln`, `.csproj`, `global.json`, and `Directory.Build.props` project evidence. It emits namespace nodes, classes, records, structs, interfaces, enums, delegates, events, constructors, methods, properties, `using` modules, inheritance, interface implementation, type usage, and locally resolvable call relationships.

The current `csharp-structural` index is dependency-free and intended for architecture mapping. A future Roslyn bridge can replace or enrich its inferred call edges without changing graph IDs or the adapter contract.

### Objective-C and Objective-C++

The Objective-C adapter handles `.h`, `.m`, and `.mm`. It preserves `.mm` as `objective-cpp` while sharing one adapter for headers and implementations. It emits interfaces, implementations, categories, protocols, properties, ivars, blocks, methods/selectors, C-style functions, imports, superclass relationships, protocol conformance, interface-to-implementation links, and locally resolvable Objective-C message sends.

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

The handoff carries the full start/end range. Xcode and VS Code command-line tools open at the exact start; Code Universe’s source drawer highlights every line in the declaration, and the provider result retains the complete selection for integrations that support range selection.

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
9. Optional Tree-sitter WASM syntax backend for web languages: complete; opt-in and fallback-safe.

Roslyn/Clang semantic enrichment and persistent SQLite graph history remain optional roadmap work. The structural C# and Objective-C adapters are fully integrated without requiring those external toolchains.
