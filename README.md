# Code Universe Prototype

A first prototype for exploring a Swift macOS/iOS codebase as a 3D software universe.

## What It Does

- Scans a folder of `.swift` files.
- Extracts files, types, functions, properties, imports, and basic relationships.
- Detects SwiftUI `View` types, services, stores, and simple models.
- Writes a portable graph JSON file.
- Displays the graph as an interactive 3D map in the browser.

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

## Prototype Notes

The scanner is intentionally heuristic. It validates the product idea and data flow, but production analysis should move to `SwiftSyntax`, SourceKit-LSP, and Xcode index data.

The viewer is intentionally shell-independent. A future Tauri, Electron, SwiftUI, or web app can reuse the same graph JSON contract.
