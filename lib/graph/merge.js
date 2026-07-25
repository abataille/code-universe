import { normalizeGraph } from "./schema.js";

export function mergeGraphFragments(project, fragments, options = {}) {
  const nodes = new Map();
  const edges = new Map();
  for (const fragment of fragments) {
    for (const node of fragment.nodes || []) {
      const existing = nodes.get(node.id);
      nodes.set(node.id, existing ? mergeNode(existing, node) : node);
    }
    for (const edge of fragment.edges || []) {
      if (!nodes.has(edge.from) && !fragments.some((candidate) => candidate.nodes?.some((node) => node.id === edge.from))) continue;
      if (!nodes.has(edge.to) && !fragments.some((candidate) => candidate.nodes?.some((node) => node.id === edge.to))) continue;
      edges.set(edgeKey(edge), edge);
    }
  }

  const graph = normalizeGraph({
    schemaVersion: 2,
    project,
    nodes: [...nodes.values()].sort((left, right) => left.id.localeCompare(right.id)),
    edges: [...edges.values()].sort((left, right) => edgeKey(left).localeCompare(edgeKey(right)))
  }, options);
  return graph;
}

export function edgeKey(edge) {
  return `${edge.from}|${edge.kind}|${edge.to}`;
}

function mergeNode(left, right) {
  return {
    ...left,
    ...right,
    metrics: { ...(left.metrics || {}), ...(right.metrics || {}) },
    attributes: { ...(left.attributes || {}), ...(right.attributes || {}) }
  };
}
