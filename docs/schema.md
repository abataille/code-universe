# Code Universe Graph Schema

This prototype uses a small JSON graph that can later move to SQLite without changing the viewer contract.

## Nodes

Each node describes a source-code object.

```json
{
  "id": "type:ContentView",
  "kind": "swiftui_view",
  "name": "ContentView",
  "file": "ContentView.swift",
  "line": 3,
  "metrics": {
    "methods": 0,
    "properties": 2
  }
}
```

Supported prototype node kinds:

- `repository`
- `directory`
- `file`
- `swiftui_view`
- `class`
- `struct`
- `enum`
- `protocol`
- `function`
- `property`
- `service`
- `model`

## Edges

Edges describe relationships between nodes.

```json
{
  "from": "type:ContentView",
  "to": "type:DashboardView",
  "kind": "uses"
}
```

Supported prototype edge kinds:

- `contains`
- `defines`
- `imports`
- `uses`
- `calls`
- `conforms_to`
- `owns_state`
- `depends_on`

## Next Schema Steps

- Add stable `qualifiedName` values.
- Add Xcode target membership.
- Add source ranges, not only start lines.
- Add separate `callsite` nodes for precise call graph inspection.
- Add graph snapshot metadata for comparisons over time.
