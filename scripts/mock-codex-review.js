#!/usr/bin/env node

import { existsSync } from "node:fs";
import { join } from "node:path";

const cdArgumentIndex = process.argv.indexOf("--cd");
const sourceRoot = cdArgumentIndex >= 0 ? process.argv[cdArgumentIndex + 1] : process.cwd();
const skipsGitRepoCheck = process.argv.includes("--skip-git-repo-check");
const isObjectiveCFixture = existsSync(join(sourceRoot, "Widget.m"));
const fixtureSymbol = isObjectiveCFixture ? "Widget" : skipsGitRepoCheck ? "Standalone" : "AuthenticationService";
const fixtureFile = isObjectiveCFixture ? "Widget.m" : skipsGitRepoCheck ? "Standalone.swift" : "Services.swift";
const prompt = process.argv.at(-1) || "";
if (isObjectiveCFixture && (!prompt.includes("Primary language: Objective-C.") || prompt.includes("relevant Swift files"))) {
  throw new Error("Code Universe did not provide Objective-C-aware review instructions.");
}
if (!process.argv.some((argument) => argument.includes("mcp_servers.code_universe.command"))) {
  throw new Error("Code Universe did not configure the MCP server for the Codex review.");
}
const mcpEnvironmentConfig = process.argv.find((argument) => argument.includes("mcp_servers.code_universe.env_vars"));
if (!mcpEnvironmentConfig) {
  throw new Error("Code Universe did not forward the MCP review environment.");
}
if (!mcpEnvironmentConfig.includes("ELECTRON_RUN_AS_NODE")) {
  throw new Error("Code Universe did not preserve Electron's Node runtime mode for the MCP server.");
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
      query: fixtureSymbol,
      limit: 5
    }
  })
});
const mcpPayload = await mcpResponse.json();
if (!mcpResponse.ok || !mcpPayload.result?.nodes?.some((node) => node.name === fixtureSymbol)) {
  throw new Error(mcpPayload.error || "Code Universe MCP fixture search failed.");
}

const finalReport = `## Most likely cause

The likely behavior source is \`${fixtureSymbol}\` in [${fixtureFile}:1](${sourceRoot}/${fixtureFile}:1).

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
