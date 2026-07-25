# Code Universe Graph Schema

Code Universe uses a language-neutral JSON graph. Schema v2 adds universal categories, languages, ranges, qualified names, adapter metadata, and provenance while retaining the v1 `kind`, `file`, and `line` fields.

Schema v1 graphs remain loadable and are normalized in the viewer and server.

## Project

```json
{
  "schemaVersion": 2,
  "project": {
    "name": "Example",
    "scannedAt": "2026-07-25T12:00:00.000Z",
    "sourceRoot": "/projects/example",
    "primaryLanguage": "typescript",
    "languages": [
      { "id": "typescript", "fileCount": 12, "confidence": 0.95 },
      { "id": "html", "fileCount": 2, "confidence": 0.7 },
      { "id": "css", "fileCount": 3, "confidence": 0.75 }
    ],
    "projectKind": "typescript",
    "scanProfile": "balanced",
    "adapters": [
      { "id": "typescript", "version": 1, "profile": "balanced" },
      { "id": "web-assets", "version": 1, "profile": "balanced" }
    ]
  }
}
```

Mixed-language projects run every applicable adapter. `primaryLanguage` is presentation metadata, not an instruction to exclude other languages.

## Nodes

```json
{
  "id": "symbol:typescript:src/app.ts#App.render:method:12",
  "category": "callable",
  "kind": "method",
  "language": "typescript",
  "name": "render",
  "qualifiedName": "App.render",
  "file": "src/app.ts",
  "line": 12,
  "column": 3,
  "location": {
    "file": "src/app.ts",
    "range": {
      "start": { "line": 12, "column": 3 },
      "end": { "line": 18, "column": 4 }
    }
  },
  "metrics": {
    "lines": 7,
    "complexity": 2
  },
  "attributes": {},
  "provenance": {
    "adapter": "typescript",
    "source": "typescript-compiler",
    "confidence": 0.95,
    "inferred": false
  }
}
```

Neutral categories:

- `repository`
- `directory`
- `file`
- `module`
- `component`
- `type`
- `callable`
- `data`
- `markup`
- `style`

`kind` is extensible and language-specific. Current kinds include the existing Swift kinds plus `react_component`, `interface`, `type_alias`, `method`, `constructor`, `variable`, `html_document`, `html_element`, `stylesheet`, `css_rule`, and `keyframes`.

## Edges

```json
{
  "from": "symbol:css:styles.css##app:1",
  "to": "symbol:html:index.html#main#app:8",
  "kind": "styles",
  "source": "css-selector",
  "confidence": 0.98,
  "inferred": false,
  "provenance": {
    "adapter": null,
    "source": "css-selector",
    "confidence": 0.98,
    "inferred": false
  }
}
```

Supported relationships include:

- `contains`
- `defines`
- `imports`
- `exports`
- `uses`
- `calls`
- `extends`
- `implements`
- `conforms_to`
- `owns_state`
- `uses_member`
- `loads`
- `styles`

The legacy Swift relationship names remain supported. Future migrations may normalize `conforms_to` to `implements` at query time, but existing Swift graph output is intentionally preserved.

## Compatibility

- Existing schema-v1 files continue loading.
- Existing Swift node IDs and kinds are unchanged.
- `file` and `line` remain populated alongside the v2 location range.
- Unknown kinds receive a neutral category and safe viewer geometry.
- Schema validation rejects duplicate IDs, dangling edges, and project-escaping source paths.
