# Code Universe Review Trace

Review traces overlay observable Codex activity on an existing source graph. They describe what was inspected, suspected, changed, built, and verified. They do not contain or attempt to reconstruct private model reasoning.

## Session

```json
{
  "version": 1,
  "id": "6c33e706-cae8-44ca-bc37-667066e79847",
  "title": "Why does project scanning freeze?",
  "behavior": "Opening a large Xcode project stops responding",
  "parentReviewId": null,
  "sourceRoot": "/path/to/project",
  "status": "running",
  "startedAt": "2026-07-22T09:00:00.000Z",
  "updatedAt": "2026-07-22T09:01:00.000Z",
  "finishedAt": null,
  "events": [],
  "codex": {
    "status": "running",
    "mode": "inspect",
    "model": "gpt-5.6-sol",
    "reasoningEffort": "high",
    "modelOverride": false,
    "reasoningOverride": false,
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
    "after": null,
    "baseline": {
      "commit": "temporary-git-tree",
      "untrackedFiles": []
    },
    "sourceBaseline": null,
    "diff": {
      "truncated": false,
      "files": [
        {
          "file": "Services/ScannerService.swift",
          "added": 2,
          "deleted": 1,
          "patch": "diff --git a/Services/ScannerService.swift b/Services/ScannerService.swift\n..."
        }
      ]
    }
  }
}
```

`status` is `running`, `completed`, or `failed`.

`parentReviewId` links an `Inspect and fix` review to the completed `Inspect only` review whose findings started it. The previous report is supplied as a hypothesis and must be verified against the current source before edits are made.

`codex.mode` is `inspect` for a read-only review or `fix` when source edits are allowed. Code Universe reads the documented `codex exec --json` stream and converts observable command executions, file changes, tests, builds, and the final agent message into review events. Reasoning items are deliberately ignored.

`codex.model` and `codex.reasoningEffort` record the effective settings used for the review. The `Override` fields distinguish explicit per-review choices from values inherited from `~/.codex/config.toml`. The model selector includes recommended presets plus an editable `Custom model` option, while the reasoning picker offers `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`, and `ultra`; actual availability depends on the selected model and account.

Token usage is aggregated from every `turn.completed` or `turn.failed` record. The UI lists total tokens, input total, uncached input, cached input, output total, visible output, reasoning output, and the number of metered model turns. Cached input is a subset of input total, and reasoning output is a subset of output total, so neither is added twice. Tool execution does not expose a separate token counter; tool results are included when they return to the model as input.

Automatic traces retain only project-local Swift files, exclude `.build`, `build`, `DerivedData`, and `.git` output, collapse project-wide file inventories, and suppress duplicate search/inspection events until the next edit, build, test, or conclusion phase.

During an automatic Codex review, Code Universe also exposes a temporary read-only MCP server. MCP searches, graph inspections, relationship traversal, impact traversal, bounded source reads, and trace reads use the same active `sourceRoot`. The MCP bridge requires the running review ID and a short-lived bearer token created for that review.

For Git projects, Code Universe creates a non-destructive baseline when the review starts and compares the completed working tree against it. This isolates changes made during the review from modifications that already existed. Fix reviews also create a bounded Swift source snapshot. When no Git patch is available, Code Universe compares edited files with that snapshot and sets `git.diff.source` to `snapshot`. `git.diff.files` contains per-file unified patches and added/deleted counts. Newly created untracked Swift files are included; patches are capped at 500,000 characters and marked with `truncated` when necessary.

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
  "source": "mcp",
  "tool": "get_node",
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

`source` is `mcp` for events created by the Code Universe MCP bridge and otherwise `null`. `tool` contains the bounded MCP tool name when `source` is `mcp`. MCP tools are read-only; edits continue to be captured from Codex's normal file-change stream.

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
