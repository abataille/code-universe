# Code Universe

Code Universe is a local 3D architecture map for Swift projects. It turns an Xcode project into a navigable city where files, views, structs, models, services, functions, properties, imports, and usage relationships can be inspected visually.

The app runs on your Mac. Source code is scanned locally and stays local.

![Code Universe screenshot](docs/screenshots/code-universe-current.png)

[Watch the Code Universe demo](docs/export.mp4)

## Highlights

- Explore Swift projects as a navigable 3D code city.
- Inspect files, types, functions, properties, dependencies, and source code.
- Compare heuristic, SwiftSyntax, merged, and Xcode-index analysis.
- Ask Codex to investigate or fix a specific application behavior.
- Watch Codex activity appear as a project-scoped trace across the city.
- Review complete token usage, readable conclusions, and verification results.
- Replay investigations and reload the latest trace for each project.

## Current Sample

The bundled sample graph is generated from the included SampleSwiftApp fixture:

```text
examples/SampleSwiftApp
```

This compact seven-file SwiftUI sample is included in the repository and is intended for reproducing the bundled graph.

The current bundled SampleSwiftApp graph contains:

- `45` graph nodes
- `75` relationships
- `7` Swift files
- `14` top-level Swift types

Regenerate it with:

```sh
npm run scan:sample
```

## Visual Model

Code Universe uses a consistent spatial model:

- **File plane**: the flat bottom lot for a Swift file.
- **File lot**: the outer file plane contains that file’s structs, views, models, services, enums, and protocols.
- **LOC inlay**: the smaller translucent inlay on a file plane represents original file size / lines of code.
- **Type object**: a view, struct, enum, model, service, or class sits above its file plane.
- **Object popup**: clicking a type opens its functions, properties, vars, and state inside that object’s popup shell.
- **File popup**: clicking a file opens its top-level contained objects using the same file-lot rule.
- **Connections**: relationship paths show usage, imports, conformances, state ownership, and member usage.

By default, most code objects are bright and opaque for readability. File lots, x-ray shells, labels, and relationship overlays remain translucent where seeing through the scene is useful.

## Run

```sh
npm start
```

Open:

```text
http://127.0.0.1:4173
```

If the port is occupied:

```sh
PORT=4174 npm start
```

## Use

The left control column is ordered for quick work:

1. `Home`, `Focus`, `Paths`, `Share PNG`
2. `Project`
3. `Map layers`
4. `Behavior review`
5. `Connection detail`

Connection detail defaults to only `Uses` checked so the map starts readable. Enable imports, conforms, defines, state, member usage, inferred hints, or Xcode index links when you need more detail.

### Project Panel

- `Choose Project or File`: scan an `.xcodeproj`, `project.pbxproj`, folder, or single `.swift` file.
- `Compare Parsers`: compare heuristic, SwiftSyntax, merged, and Xcode-index analysis for the selected project.
- `Load Sample Universe`: reload the bundled SampleSwiftApp graph.

### Map Layers

- `Show files`: toggles file lots.
- `Show imported modules`: toggles module rings.
- `Show protocols`: toggles protocol objects.
- `Show properties`: toggles properties / vars.
- `Selected object edges only`: reduces paths to the current selection.
- `Performance mode`: lowers render cost for large graphs.

### Navigation

- Drag: orbit the 3D map.
- Scroll: zoom.
- `W/A/S/D` or arrow keys: move across the map.
- `PageUp/PageDown` or `E/Q`: move vertically.
- Click an object: inspect it and open the source preview.
- Search and press `Enter`: jump to a matching symbol.

## Parser Modes

The default parser is `Fast overview` for quick large-project scanning.

Available modes:

- `Fast overview`: fast heuristic scanner.
- `Best combined view`: SwiftSyntax structure plus heuristic relationship hints.
- `Accurate Swift parse`: SwiftSyntax structural scan.
- `Xcode Index map`: local Xcode index relationships when available.

Regenerate the sample with SwiftSyntax:

```sh
npm run scan:sample:swiftsyntax
```

The first SwiftSyntax run may resolve Swift package dependencies.

You can set the server default scanner:

```sh
CODE_UNIVERSE_SCANNER=swiftsyntax npm start
```

Supported values are:

```text
heuristic
merged
swiftsyntax
xcode-index
```

## Codex Behavior Reviews

Review Mode overlays observable Codex activity on the existing source city. Inspected code is blue, searches purple, suspected causes amber, edits and successful verification green, and failures red. Bright rectangular streets show the order of the investigation.

### Codex Features

- **Large behavior prompt**: describe reproduction steps, expected behavior, relevant screens, and constraints in a multiline prompt.
- **Permission modes**: choose read-only investigation with `Inspect only` or allow focused source changes with `Inspect and fix`.
- **Model and reasoning controls**: inherit the current Codex defaults or choose/edit a model and reasoning effort for each review; the effective values are stored with the trace.
- **Visual investigation trace**: see searches, inspections, suspected causes, edits, builds, tests, and conclusions mapped onto project objects.
- **Exact review diffs**: click an edit step to inspect the review-scoped unified patch with green additions, red removals, line counts, and a shortcut to the complete source file.
- **Apply findings**: turn a completed `Inspect only` report into a linked `Inspect and fix` review that verifies the findings before editing.
- **Clean project scope**: ignore generated folders and external files, normalize source paths, collapse file inventories, and remove repetitive trace noise.
- **Node-focused navigation**: selecting a trace step highlights its mapped object without opening a popup or moving the camera.
- **Complete token ledger**: view total, input, uncached input, cached input, output, visible output, reasoning-output tokens, and metered model turns without double-counting subsets.
- **Readable final report**: preserve long conclusions and render headings, lists, source references, inline code, and code blocks in a copyable result panel.
- **Integrated source view**: open the complete Swift file, highlight the relevant line, or jump directly to Xcode.
- **Trace replay**: replay the investigation with progressive highlights and route streets, pause or resume it, and choose 0.5×, 1×, or 2× speed.
- **Project trace history**: automatically load the latest saved trace for the selected project or restore it with `Load Latest Trace`.
- **Import and automation**: import JSON traces or send review events through the command-line bridge.

Choose the project in Code Universe, enter the behavior in the `Behavior review` panel, choose a permission mode, and select `Run Codex Review`.

- `Inspect only` launches Codex in a read-only sandbox and cannot change source files.
- `Inspect and fix` allows Codex to edit the selected project and run focused verification.

After an `Inspect only` review completes, select `Apply findings` in the final-result card or drawer. Code Universe starts a new `Inspect and fix` review for the same project, includes the previous report as a hypothesis, and stores the originating review in `parentReviewId`.

Code Universe launches the Codex runtime bundled with the ChatGPT desktop app, consumes its JSONL event stream, and automatically maps observable searches, source inspections, file changes, builds, tests, and the final report onto the city. The review summary lists total, input, uncached input, cached input, output, visible output, reasoning-output tokens, and metered model turns without double-counting subsets. Private reasoning is neither requested nor stored.

### Code Universe MCP

Each review launches a temporary local STDIO MCP server named `code_universe`. No global Codex configuration or project file is required. Code Universe injects the server configuration into the review process and provides a short-lived token that is valid only while that review is running.

The MCP server exposes seven bounded, read-only tools:

- `get_project_summary`
- `search_nodes`
- `get_node`
- `get_relationships`
- `find_change_impact`
- `read_source`
- `get_latest_trace`

Codex uses these tools to query the graph before broad source searches. MCP calls are labeled in the review timeline and mapped to the returned file or object. The MCP server cannot edit files, run shell commands, open Xcode, or access a different project. In `Inspect and fix` mode, source changes still use Codex's normal workspace tools, approvals, Git patch capture, and focused verification.

Trace extraction is project-scoped: generated build folders and external files are ignored, project-wide source inventories are collapsed, repeated inspection/search events are deduplicated within each review phase, and build/test commands use concise outcome labels. Fix reviews use a bounded Swift source snapshot when a Git baseline is unavailable, so edit steps can still show their unified diff.

Completed and imported traces can be replayed from the `Review path` panel. Replay progressively reveals mapped nodes and route streets, supports pause/resume and 0.5×, 1×, or 2× speed, and reveals the final report only when the conclusion step is reached.

When a different project is scanned, Code Universe automatically requests that project's latest saved trace. `Load Latest Trace` repeats the lookup explicitly and can restore a trace after its overlay was hidden.

The command-line bridge remains available for adding events from another Codex task or from a manual workflow:

```sh
npm --prefix /path/to/code-universe run review -- inspect Sources/ScannerService.swift 84 "Inspect scanner entry point"
npm --prefix /path/to/code-universe run review -- suspect Sources/ScannerService.swift 112 "Synchronous process blocks the caller"
npm --prefix /path/to/code-universe run review -- edit Sources/ScannerService.swift 112 "Move scan work off the main actor"
npm --prefix /path/to/code-universe run review -- test passed "Large-project scan completes"
npm --prefix /path/to/code-universe run review -- finish passed "Freeze no longer reproduced"
```

The npm bridge preserves the directory from which it was invoked. Set `CODE_UNIVERSE_SOURCE_ROOT` explicitly when another tool changes that directory, and set `CODE_UNIVERSE_URL` when Code Universe uses a port other than `4173`. Set `CODE_UNIVERSE_CODEX_PATH` if the desktop Codex runtime is installed in a nonstandard location.

Completed JSON traces can also be loaded with `Import Trace`. The format is documented in `docs/review-schema.md`.

## macOS WebKit Shell

A small SwiftPM macOS shell lives in:

```text
mac/CodeUniverseMac
```

Build or run it with:

```sh
npm run mac:build
npm run mac:run
```

Build the app bundle:

```sh
npm run mac:bundle
```

Open the bundle:

```sh
npm run mac:open
```

The shell starts the local Node server, waits for `/api/health`, then loads the browser UI. It is designed to work when opened from Xcode behaviors as well as from the command line.

## Scripts

```sh
npm start
npm run scan:sample
npm run scan:sample:swiftsyntax
npm run test:scan
npm run test:review
npm run test:mcp
npm run review -- help
npm run mac:build
npm run mac:run
npm run mac:bundle
npm run mac:open
```

## Notes

- The app is a visual companion for Xcode, not a replacement IDE.
- Large graphs automatically enable performance mode.
- Relationship filters are intentionally conservative by default.
- Object sizing now uses non-saturated complexity and stronger LOC-based height scaling, so large objects read as visibly larger than small ones.
