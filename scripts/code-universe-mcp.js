#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const bridgeUrl = process.env.CODE_UNIVERSE_MCP_URL;
const reviewId = process.env.CODE_UNIVERSE_REVIEW_ID;
const token = process.env.CODE_UNIVERSE_MCP_TOKEN;

const server = new McpServer(
  {
    name: "code-universe",
    version: "0.1.0"
  },
  {
    instructions: "Use these read-only tools to inspect the active Swift project's architecture before broad shell searches. Start with get_project_summary or search_nodes, inspect exact nodes and relationships, then read only the source excerpts needed to confirm conclusions. These tools never modify source."
  }
);

registerTool(
  "get_project_summary",
  "Return bounded architecture counts and scanner information for the active Code Universe project.",
  {}
);
registerTool(
  "search_nodes",
  "Search files, types, functions, protocols, properties, services, and views in the active code graph.",
  {
    query: z.string().min(1),
    kinds: z.array(z.string()).max(12).optional(),
    limit: z.number().int().min(1).max(50).optional()
  }
);
registerTool(
  "get_node",
  "Return one exact code object with metrics and relationship counts.",
  { nodeId: z.string().min(1) }
);
registerTool(
  "get_relationships",
  "Return bounded incoming and outgoing relationships for one code object.",
  {
    nodeId: z.string().min(1),
    direction: z.enum(["incoming", "outgoing", "both"]).optional(),
    kinds: z.array(z.string()).max(16).optional(),
    limit: z.number().int().min(1).max(100).optional()
  }
);
registerTool(
  "find_change_impact",
  "Traverse a bounded neighborhood around one object to identify potentially affected code.",
  {
    nodeId: z.string().min(1),
    depth: z.number().int().min(1).max(3).optional(),
    limit: z.number().int().min(1).max(100).optional()
  }
);
registerTool(
  "read_source",
  "Read a bounded Swift source excerpt inside the active project.",
  {
    file: z.string().min(1),
    line: z.number().int().min(1).optional(),
    context: z.number().int().min(4).max(80).optional()
  }
);
registerTool(
  "get_latest_trace",
  "Return a bounded summary of the active project's latest Code Universe review trace.",
  {
    limit: z.number().int().min(1).max(100).optional()
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);

function registerTool(name, description, inputSchema) {
  server.registerTool(
    name,
    {
      description,
      inputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async (args) => {
      const result = await callBridge(name, args);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result
      };
    }
  );
}

async function callBridge(tool, args) {
  if (!bridgeUrl || !reviewId || !token) {
    throw new Error("Code Universe MCP requires an active review launched from Code Universe.");
  }
  const response = await fetch(new URL("/api/mcp/tool", bridgeUrl), {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      reviewId,
      tool,
      arguments: args
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Code Universe MCP bridge failed (${response.status}).`);
  return payload.result;
}
