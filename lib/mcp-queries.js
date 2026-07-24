const DEFAULT_SEARCH_LIMIT = 20;
const MAX_SEARCH_LIMIT = 50;
const DEFAULT_EDGE_LIMIT = 50;
const MAX_EDGE_LIMIT = 100;
const DEFAULT_IMPACT_LIMIT = 60;
const MAX_IMPACT_LIMIT = 100;
const MAX_IMPACT_DEPTH = 3;

export const mcpGraphToolNames = new Set([
  "get_project_summary",
  "search_nodes",
  "get_node",
  "get_relationships",
  "find_change_impact"
]);

export function executeMcpGraphTool(tool, args, graph, diagnostics = {}) {
  if (!mcpGraphToolNames.has(tool)) throw new Error(`Unsupported graph tool: ${tool}`);
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    throw new Error("Code Universe graph is unavailable.");
  }

  if (tool === "get_project_summary") return projectSummary(graph, diagnostics);
  if (tool === "search_nodes") return searchNodes(graph, args);
  if (tool === "get_node") return getNode(graph, args);
  if (tool === "get_relationships") return getRelationships(graph, args);
  return findChangeImpact(graph, args);
}

export function mcpTraceEvent(tool, args, result) {
  if (tool === "get_latest_trace") return null;
  if (tool === "get_project_summary") {
    return {
      kind: "search",
      summary: "Read project architecture summary",
      source: "mcp",
      tool
    };
  }

  const node = result?.node || result?.nodes?.[0] || result?.startNode || null;
  const file = result?.file || node?.file || null;
  const line = result?.line || node?.line || null;
  const nodeId = node?.id || args?.nodeId || null;
  const label = node?.name || file || args?.query || "project";
  return {
    kind: tool === "search_nodes" ? "search" : "inspect",
    file,
    line,
    nodeId,
    summary: mcpTraceSummary(tool, label),
    source: "mcp",
    tool
  };
}

function projectSummary(graph, diagnostics) {
  return {
    project: {
      name: graph.project?.name || "Swift project",
      sourceRoot: graph.project?.sourceRoot || null,
      scanner: diagnostics.scanner || graph.project?.scanner || null,
      scannedAt: graph.project?.scannedAt || null
    },
    counts: {
      nodes: graph.nodes.length,
      edges: graph.edges.length,
      nodesByKind: countBy(graph.nodes, (node) => node.kind || "unknown"),
      edgesByKind: countBy(graph.edges, (edge) => edge.kind || "unknown")
    }
  };
}

function searchNodes(graph, args) {
  const exactQuery = requiredText(args?.query, "query");
  const query = exactQuery.toLocaleLowerCase();
  const kinds = normalizedKinds(args?.kinds);
  const limit = boundedInteger(args?.limit, DEFAULT_SEARCH_LIMIT, 1, MAX_SEARCH_LIMIT);
  const matches = graph.nodes
    .filter((node) => kinds.size === 0 || kinds.has(node.kind))
    .map((node) => ({ node, score: nodeSearchScore(node, query, exactQuery) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) =>
      right.score - left.score
      || String(left.node.name || "").localeCompare(String(right.node.name || ""))
      || String(left.node.id || "").localeCompare(String(right.node.id || ""))
    )
    .slice(0, limit)
    .map((entry) => publicNode(entry.node, graph));

  return {
    query: args.query,
    totalMatches: matches.length,
    nodes: matches
  };
}

function getNode(graph, args) {
  const nodeId = requiredText(args?.nodeId, "nodeId");
  const node = graph.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) throw new Error(`Code object not found: ${nodeId}`);
  return { node: publicNode(node, graph) };
}

function getRelationships(graph, args) {
  const nodeId = requiredText(args?.nodeId, "nodeId");
  const node = graph.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) throw new Error(`Code object not found: ${nodeId}`);
  const direction = ["incoming", "outgoing", "both"].includes(args?.direction) ? args.direction : "both";
  const kinds = normalizedKinds(args?.kinds);
  const limit = boundedInteger(args?.limit, DEFAULT_EDGE_LIMIT, 1, MAX_EDGE_LIMIT);
  const nodesById = new Map(graph.nodes.map((candidate) => [candidate.id, candidate]));
  const relationships = [];

  for (const edge of graph.edges) {
    const outgoing = edge.from === nodeId;
    const incoming = edge.to === nodeId;
    if ((!outgoing && !incoming) || (direction === "incoming" && !incoming) || (direction === "outgoing" && !outgoing)) continue;
    if (kinds.size > 0 && !kinds.has(edge.kind)) continue;
    const otherId = outgoing ? edge.to : edge.from;
    relationships.push({
      direction: outgoing ? "outgoing" : "incoming",
      kind: edge.kind,
      from: edge.from,
      to: edge.to,
      otherNode: nodesById.has(otherId) ? publicNode(nodesById.get(otherId), graph, false) : { id: otherId }
    });
    if (relationships.length >= limit) break;
  }

  return {
    node: publicNode(node, graph),
    total: relationships.length,
    relationships
  };
}

function findChangeImpact(graph, args) {
  const nodeId = requiredText(args?.nodeId, "nodeId");
  const startNode = graph.nodes.find((candidate) => candidate.id === nodeId);
  if (!startNode) throw new Error(`Code object not found: ${nodeId}`);
  const depth = boundedInteger(args?.depth, 2, 1, MAX_IMPACT_DEPTH);
  const limit = boundedInteger(args?.limit, DEFAULT_IMPACT_LIMIT, 1, MAX_IMPACT_LIMIT);
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const edgesByNode = new Map();

  for (const edge of graph.edges) {
    if (!edgesByNode.has(edge.from)) edgesByNode.set(edge.from, []);
    if (!edgesByNode.has(edge.to)) edgesByNode.set(edge.to, []);
    edgesByNode.get(edge.from).push({ edge, otherId: edge.to, direction: "outgoing" });
    edgesByNode.get(edge.to).push({ edge, otherId: edge.from, direction: "incoming" });
  }

  const visited = new Set([nodeId]);
  const queue = [{ id: nodeId, depth: 0 }];
  const impacted = [];
  while (queue.length > 0 && impacted.length < limit) {
    const current = queue.shift();
    if (current.depth >= depth) continue;
    for (const relationship of edgesByNode.get(current.id) || []) {
      if (visited.has(relationship.otherId)) continue;
      visited.add(relationship.otherId);
      const node = nodesById.get(relationship.otherId);
      impacted.push({
        depth: current.depth + 1,
        via: relationship.edge.kind,
        direction: relationship.direction,
        node: node ? publicNode(node, graph, false) : { id: relationship.otherId }
      });
      queue.push({ id: relationship.otherId, depth: current.depth + 1 });
      if (impacted.length >= limit) break;
    }
  }

  return {
    startNode: publicNode(startNode, graph),
    depth,
    total: impacted.length,
    impacted
  };
}

function publicNode(node, graph, includeRelationshipCounts = true) {
  const result = {
    id: node.id,
    kind: node.kind,
    declarationKind: node.declarationKind || null,
    name: node.name,
    file: node.file || null,
    line: Number(node.line) || 1,
    metrics: node.metrics || {}
  };
  if (!includeRelationshipCounts) return result;
  result.relationships = graph.edges.reduce((counts, edge) => {
    if (edge.from === node.id) counts.outgoing += 1;
    if (edge.to === node.id) counts.incoming += 1;
    return counts;
  }, { incoming: 0, outgoing: 0 });
  return result;
}

function nodeSearchScore(node, query, exactQuery) {
  if (String(node.name || "") === exactQuery) return 110;
  const name = String(node.name || "").toLocaleLowerCase();
  const file = String(node.file || "").toLocaleLowerCase();
  const id = String(node.id || "").toLocaleLowerCase();
  const kind = String(node.kind || "").toLocaleLowerCase();
  const declarationKind = String(node.declarationKind || "").toLocaleLowerCase();
  if (name === query) return 100;
  if (file === query || id === query) return 90;
  if (name.startsWith(query)) return 75;
  if (name.includes(query)) return 60;
  if (file.includes(query)) return 45;
  if (id.includes(query)) return 35;
  if (kind.includes(query) || declarationKind.includes(query)) return 20;
  return 0;
}

function mcpTraceSummary(tool, label) {
  if (tool === "search_nodes") return `MCP searched for ${label}`;
  if (tool === "get_node") return `MCP inspected ${label}`;
  if (tool === "get_relationships") return `MCP inspected relationships for ${label}`;
  if (tool === "find_change_impact") return `MCP mapped change impact for ${label}`;
  if (tool === "read_source") return `MCP read ${label}`;
  return `MCP used ${tool}`;
}

function normalizedKinds(value) {
  if (!Array.isArray(value)) return new Set();
  return new Set(value.map((kind) => String(kind || "").trim()).filter(Boolean));
}

function requiredText(value, name) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} is required.`);
  return value.trim();
}

function boundedInteger(value, fallback, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.floor(number)));
}

function countBy(items, keyForItem) {
  return items.reduce((counts, item) => {
    const key = keyForItem(item);
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}
