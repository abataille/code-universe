import { normalizeGraph } from "../graph/schema.js";

export function createSwiftAdapter(scanSwift) {
  return {
    id: "swift",
    displayName: "Swift",
    version: 1,
    languages: ["swift"],
    extensions: [".swift"],
    profiles: ["fast", "balanced", "accurate", "indexed"],
    async scan(context) {
      const result = await scanSwift(context.root, context.profile);
      const graph = normalizeGraph(result.graph, {
        language: "swift",
        scanProfile: context.profile,
        adapters: [{ id: "swift", version: 1, mode: result.diagnostics.scanner }]
      });
      return {
        fragment: {
          nodes: graph.nodes,
          edges: graph.edges
        },
        diagnostics: {
          ...result.diagnostics,
          adapter: "swift",
          filesScanned: result.diagnostics.swiftFileCount,
          nodesByKind: countBy(graph.nodes, "kind"),
          edgesByKind: countBy(graph.edges, "kind")
        }
      };
    }
  };
}

function countBy(items, key) {
  return items.reduce((counts, item) => {
    const value = item[key] || "unknown";
    counts[value] = (counts[value] || 0) + 1;
    return counts;
  }, {});
}
