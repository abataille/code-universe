# Code Universe Review Trace

Review traces overlay observable Codex activity on an existing source graph. They describe what was inspected, suspected, changed, built, and verified. They do not contain or attempt to reconstruct private model reasoning.

## Session

```json
{
  "version": 1,
  "id": "6c33e706-cae8-44ca-bc37-667066e79847",
  "title": "Why does project scanning freeze?",
  "behavior": "Opening a large Xcode project stops responding",
  "sourceRoot": "/path/to/project",
  "status": "running",
  "startedAt": "2026-07-22T09:00:00.000Z",
  "updatedAt": "2026-07-22T09:01:00.000Z",
  "finishedAt": null,
  "events": [],
  "codex": {
    "status": "running",
    "mode": "inspect",
    "threadId": null,
    "startedAt": "2026-07-22T09:00:00.000Z",
    "usage": {
      "inputTokens": 24763,
      "cachedInputTokens": 24448,
      "uncachedInputTokens": 315,
      "outputTokens": 122,
      "reasoningOutputTokens": 0,
      "visibleOutputTokens": 122,
      "totalTokens": 24885,
      "turns": 1
    }
  },
  "git": {
    "before": null,
    "after": null
  }
}
```

`status` is `running`, `completed`, or `failed`.

`codex.mode` is `inspect` for a read-only review or `fix` when source edits are allowed. Code Universe reads the documented `codex exec --json` stream and converts observable command executions, file changes, tests, builds, and the final agent message into review events. Reasoning items are deliberately ignored.

Token usage is aggregated from every `turn.completed` or `turn.failed` record. The UI lists total tokens, input total, uncached input, cached input, output total, visible output, reasoning output, and the number of metered model turns. Cached input is a subset of input total, and reasoning output is a subset of output total, so neither is added twice. Tool execution does not expose a separate token counter; tool results are included when they return to the model as input.

Automatic traces retain only project-local Swift files, exclude `.build`, `build`, `DerivedData`, and `.git` output, collapse project-wide file inventories, and suppress duplicate search/inspection events until the next edit, build, test, or conclusion phase.

## Events

```json
{
  "id": "39f76126-5ec8-4d15-a055-c4876e64c775",
  "sequence": 1,
  "at": "2026-07-22T09:00:10.000Z",
  "kind": "inspect",
  "outcome": null,
  "file": "Services/ScannerService.swift",
  "line": 84,
  "nodeId": null,
  "summary": "Inspected scanProject()",
  "command": null,
  "durationMs": null
}
```

Supported event kinds:

- `inspect`: a source location was read.
- `search`: a search led to a source location.
- `suspect`: evidence points to a possible cause.
- `edit`: source was changed.
- `build`: a build was executed.
- `test`: a test or behavior check was executed.
- `conclusion`: the review reached a result.

`outcome` may be `passed`, `failed`, `changed`, `info`, or `null`.

## Source Mapping

The viewer maps an event to the graph using:

1. Exact `nodeId` when supplied.
2. A source node in the matching `file` at or immediately before `line`.
3. The matching file node.
4. The previous mapped event for global build, test, and conclusion events.

Function and property events color their popup objects. Their containing type or file acts as the visible anchor in the main city.

## Visual Meaning

- Blue: inspected.
- Purple: searched.
- Amber: suspected cause.
- Green: edited or passed.
- Red: failed.
- Cyan: build or test activity.
- White: conclusion.

Rectangular review streets follow event sequence and remain separate from source dependency streets.
