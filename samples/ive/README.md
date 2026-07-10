# IVE Source Sample

This directory is a sanitized source snapshot used to generate the bundled Code Universe sample graph.

It includes:

- the 16 Swift source files represented by `public/sample-graph.json`
- the local `IVEEditorPackage` manifest and module documentation
- package sources and tests needed for meaningful architecture scanning

It intentionally excludes:

- Git history and remote configuration
- Xcode project and workspace metadata
- build products, caches, and user-specific files
- images, icons, media, and localization assets
- remote package URLs and package resolution metadata

The snapshot is provided as scanner input and architecture sample data, not as a standalone distributable application.
