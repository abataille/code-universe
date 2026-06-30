# Code Universe 

A first view for exploring a Swift macOS/iOS codebase as a 3D software universe.

## What It Does

- Scans a folder of `.swift` files.
- Extracts files, types, functions, properties, imports, and basic relationships.
- Detects SwiftUI `View` types, services, stores, and simple models.
- Writes a portable graph JSON file.
- Displays the graph as an interactive 3D map in the browser.

## Screenshot

![Code Universe browser screenshot](docs/screenshots/code-universe-browser.png)

## Run It

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

Inside the app, click `Choose Xcode Project`, then select the `.xcodeproj` in the native macOS picker. The local server resolves the project root and scans the Swift source files on disk.

Use `Load Sample Universe` any time to return to the bundled demo graph.

## Parser Modes

The default app view is `Xcode Index layered`: SwiftSyntax supplies the structural nodes, the JavaScript heuristic scanner overlays lower-confidence inferred hints, and Xcode DerivedData index records add higher-confidence semantic links when the project has been built or indexed by Xcode.

Available modes:

- `Xcode Index layered`: best local view when Xcode has indexed the project.
- `Merged layered`: SwiftSyntax structure plus heuristic dependency hints.
- `SwiftSyntax accurate`: syntax-accurate declarations and structural relationships.
- `Fast heuristic`: rough fallback scanner for quick sketches and debugging.

```sh
npm run scan:sample:swiftsyntax
```

The first run resolves the `swift-syntax` Swift package dependency, so it needs network access. After that, it emits the same graph JSON shape as the prototype scanner.

To force one scanner mode from the running app:

```sh
CODE_UNIVERSE_SCANNER=swiftsyntax npm start
```

Supported values are `xcode-index`, `merged`, `swiftsyntax`, and `heuristic`. Use the parser selector in the Project panel to switch modes per scan. The environment variable only sets the server default.

The Xcode index mode reads local `~/Library/Developer/Xcode/DerivedData/*/Index.noindex/DataStore` records. If no matching index store exists, build the app in Xcode once and scan again.

## Prototype Notes

The scanner is intentionally heuristic. It validates the product idea and data flow, but production analysis should move to `SwiftSyntax`, SourceKit-LSP, and Xcode index data.

The viewer is intentionally shell-independent. A future Tauri, Electron, SwiftUI, or web app can reuse the same graph JSON contract.
