# IVEEditorPackage

Reusable SwiftUI image + video editor modules for iPhone, iPad, and macOS host apps.

## Modules

- `IVEEditorUI`: `IVEEditorView(configuration:project:services:)` and host integration protocol.
- `IVEEditorCore`: timeline/layer domain models, command stack, snapshots, capabilities.
- `IVEEditorMedia`: ingest, thumbnail/proxy abstractions, transcode adapter contracts.
- `IVEEditorExport`: export presets, planner, and export service protocol.
- `IVEEditorAI`: protocol-only AI provider interfaces and orchestrator helpers.

## Host App Integration

1. In Xcode, add local package at path `../IVEEditorPackage`.
2. Link `IVEEditorUI` to your app target (it pulls transitive dependencies).
3. Implement `IVEHostServices` in the host app.
4. Render:

```swift
IVEEditorView(
    configuration: IVEEditorConfiguration(),
    project: IVEProjectHandle(displayName: "Project"),
    services: hostServices
)
```

The host remains source of truth for persistence, entitlement/capability policy, telemetry, and AI provider choice.
