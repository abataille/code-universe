#!/usr/bin/env node

const cdArgumentIndex = process.argv.indexOf("--cd");
const sourceRoot = cdArgumentIndex >= 0 ? process.argv[cdArgumentIndex + 1] : process.cwd();
if (!process.argv.some((argument) => argument.includes("mcp_servers.code_universe.command"))) {
  throw new Error("Code Universe did not configure the MCP server for the Codex review.");
}
if (!process.argv.some((argument) => argument.includes("mcp_servers.code_universe.env_vars"))) {
  throw new Error("Code Universe did not forward the MCP review environment.");
}

const mcpResponse = await fetch(new URL("/api/mcp/tool", process.env.CODE_UNIVERSE_MCP_URL), {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${process.env.CODE_UNIVERSE_MCP_TOKEN}`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    reviewId: process.env.CODE_UNIVERSE_REVIEW_ID,
    tool: "search_nodes",
    arguments: {
      query: "AuthenticationService",
      limit: 5
    }
  })
});
const mcpPayload = await mcpResponse.json();
if (!mcpResponse.ok || !mcpPayload.result?.nodes?.some((node) => node.name === "AuthenticationService")) {
  throw new Error(mcpPayload.error || "Code Universe MCP fixture search failed.");
}

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
