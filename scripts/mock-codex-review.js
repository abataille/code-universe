#!/usr/bin/env node

const cdArgumentIndex = process.argv.indexOf("--cd");
const sourceRoot = cdArgumentIndex >= 0 ? process.argv[cdArgumentIndex + 1] : process.cwd();
const finalReport = `## Most likely cause

The likely behavior source is \`AuthenticationService\` in [Services.swift:4](${sourceRoot}/Services.swift:4).

- The service owns the affected behavior.
- The focused tests passed.

\`\`\`swift
struct AuthenticationService {}
\`\`\`

## Evidence

${"Detailed project evidence remains available in the trace. ".repeat(45)}

END OF COMPLETE REVIEW`;

const records = [
  { type: "thread.started", thread_id: "fixture-thread" },
  {
    type: "item.completed",
    item: {
      id: "fixture-inventory",
      type: "command_execution",
      command: "find . -name '*.swift'",
      status: "completed",
      exit_code: 0
    }
  },
  {
    type: "item.completed",
    item: {
      id: "fixture-search",
      type: "command_execution",
      command: "rg -n AuthenticationService Services.swift",
      status: "completed",
      exit_code: 0
    }
  },
  {
    type: "item.completed",
    item: {
      id: "fixture-search-duplicate",
      type: "command_execution",
      command: "rg -n AuthenticationService Services.swift .build/Generated.swift",
      status: "completed",
      exit_code: 0
    }
  },
  {
    type: "item.completed",
    item: {
      id: "fixture-inspect",
      type: "command_execution",
      command: "sed -n 1,40p Services.swift",
      status: "completed",
      exit_code: 0
    }
  },
  {
    type: "item.completed",
    item: {
      id: "fixture-test-help",
      type: "command_execution",
      command: "swift test --help",
      status: "completed",
      exit_code: 0
    }
  },
  {
    type: "item.completed",
    item: {
      id: "fixture-edit",
      type: "file_change",
      changes: [{ path: `${sourceRoot}/Services.swift`, kind: "update" }]
    }
  },
  {
    type: "item.completed",
    item: {
      id: "fixture-test",
      type: "command_execution",
      command: "swift test --package-path .",
      status: "completed",
      exit_code: 0
    }
  },
  {
    type: "item.completed",
    item: {
      id: "fixture-message",
      type: "agent_message",
      text: finalReport
    }
  },
  {
    type: "turn.completed",
    usage: {
      input_tokens: 120,
      cached_input_tokens: 50,
      output_tokens: 30,
      reasoning_output_tokens: 5
    }
  }
];

for (const record of records) {
  console.log(JSON.stringify(record));
  await new Promise((resolve) => setTimeout(resolve, 20));
}
