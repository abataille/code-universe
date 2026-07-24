import { createServer } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "..");
const bridgeToken = "fixture-token";
const reviewId = "fixture-review";
const bridge = createServer(async (request, response) => {
  if (request.url !== "/api/mcp/tool" || request.method !== "POST") {
    response.writeHead(404);
    response.end();
    return;
  }
  if (request.headers.authorization !== `Bearer ${bridgeToken}`) {
    response.writeHead(403, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "forbidden" }));
    return;
  }
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(JSON.stringify({
    result: {
      tool: body.tool,
      reviewId: body.reviewId,
      arguments: body.arguments
    }
  }));
});

await new Promise((resolveListen, rejectListen) => {
  bridge.once("error", rejectListen);
  bridge.listen(0, "127.0.0.1", resolveListen);
});

const address = bridge.address();
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [resolve(repositoryRoot, "scripts", "code-universe-mcp.js")],
  env: {
    ...process.env,
    CODE_UNIVERSE_MCP_URL: `http://127.0.0.1:${address.port}`,
    CODE_UNIVERSE_REVIEW_ID: reviewId,
    CODE_UNIVERSE_MCP_TOKEN: bridgeToken
  }
});
const client = new Client({ name: "code-universe-mcp-test", version: "1.0.0" });

try {
  await client.connect(transport);
  const listed = await client.listTools();
  assert(listed.tools.length === 7, "MCP server should expose seven bounded read-only tools");
  assert(listed.tools.every((tool) => tool.annotations?.readOnlyHint === true), "every MCP tool should be marked read-only");
  const result = await client.callTool({
    name: "search_nodes",
    arguments: {
      query: "AuthenticationService",
      kinds: ["service"],
      limit: 5
    }
  });
  assert(result.structuredContent.tool === "search_nodes", "tool calls should reach the Code Universe bridge");
  assert(result.structuredContent.reviewId === reviewId, "tool calls should retain the active review");
  assert(result.structuredContent.arguments.limit === 5, "validated arguments should reach the bridge");
} finally {
  await client.close();
}

const contextlessTransport = new StdioClientTransport({
  command: process.execPath,
  args: [resolve(repositoryRoot, "scripts", "code-universe-mcp.js")],
  env: {
    PATH: process.env.PATH || ""
  }
});
const contextlessClient = new Client({ name: "code-universe-mcp-handshake-test", version: "1.0.0" });
try {
  await contextlessClient.connect(contextlessTransport);
  const listed = await contextlessClient.listTools();
  assert(listed.tools.length === 7, "MCP handshake should succeed before review context is available");
  const result = await contextlessClient.callTool({
    name: "get_project_summary",
    arguments: {}
  });
  assert(result.isError === true, "MCP tools should explain missing review context without terminating the server");
} finally {
  await contextlessClient.close();
  await new Promise((resolveClose) => bridge.close(resolveClose));
}

console.log("MCP protocol fixture passed.");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
