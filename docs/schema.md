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
- `asset`

`kind` is extensible and language-specific. Current kinds include the existing Swift kinds plus `react_component`, `interface`, `record`, `implementation`, `category`, `type_alias`, `method`, `constructor`, `external_symbol`, `variable`, `inline_script`, `html_document`, `html_element`, `jsx_element`, `image_asset`, `video_asset`, `audio_asset`, `font_asset`, `web_asset`, `stylesheet`, `css_rule`, `css_custom_property`, and `keyframes`.

Adapter-specific attributes may add semantic data without changing the neutral contract. Current examples include `semanticName`, `framework`, `component`, `cssModuleClasses`, `domReferences`, C# namespaces/base types, Objective-C selectors/protocols/categories, CSS selector classes/IDs/dimensions, HTML/JSX tag/class/ID metadata, and asset source, existence, byte size, pixel dimensions, alternative-text, sizing, loading, media-role, and responsive-candidate metadata.

HTML document and element metrics use a `full-dom` model. `lines` is the physical source span; `elements`, `divs`, `spans`, `images`, `missingAlt`, `responsiveSources`, `attributes`, `eventHandlers`, `conditionals`, `templates`, `controls`, `maxDepth`, and `complexity` include collapsed anonymous descendants. These descendants affect measurements without requiring individual graph nodes.

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
- `links_to`
- `displays`
- `embeds`
- `downloads`
- `submits_to`

The legacy Swift relationship names remain supported. Future migrations may normalize `conforms_to` to `implements` at query time, but existing Swift graph output is intentionally preserved.

## Compatibility

- Existing schema-v1 files continue loading.
- Existing Swift node IDs and kinds are unchanged.
- `file` and `line` remain populated alongside the v2 location range.
- Unknown kinds receive a neutral category and safe viewer geometry.
- Schema validation rejects duplicate IDs, dangling edges, and project-escaping source paths.
