const CATEGORY_BY_KIND = new Map([
  ["repository", "repository"],
  ["directory", "directory"],
  ["file", "file"],
  ["module", "module"],
  ["source_module", "type"],
  ["swiftui_view", "component"],
  ["react_component", "component"],
  ["html_document", "markup"],
  ["html_element", "markup"],
  ["jsx_element", "markup"],
  ["inline_script", "module"],
  ["image_asset", "asset"],
  ["video_asset", "asset"],
  ["audio_asset", "asset"],
  ["font_asset", "asset"],
  ["web_asset", "asset"],
  ["stylesheet", "style"],
  ["css_rule", "style"],
  ["css_custom_property", "data"],
  ["keyframes", "style"],
  ["function", "callable"],
  ["method", "callable"],
  ["constructor", "callable"],
  ["external_symbol", "callable"],
  ["property", "data"],
  ["variable", "data"],
  ["parameter", "data"],
  ["struct", "type"],
  ["class", "type"],
  ["enum", "type"],
  ["protocol", "type"],
  ["interface", "type"],
  ["record", "type"],
  ["implementation", "type"],
  ["category", "type"],
  ["type_alias", "type"],
  ["service", "type"],
  ["model", "type"]
]);

const LANGUAGE_BY_EXTENSION = new Map([
  [".swift", "swift"],
  [".js", "javascript"],
  [".mjs", "javascript"],
  [".cjs", "javascript"],
  [".jsx", "javascript"],
  [".ts", "typescript"],
  [".mts", "typescript"],
  [".cts", "typescript"],
  [".tsx", "typescript"],
  [".html", "html"],
  [".htm", "html"],
  [".css", "css"],
  [".cs", "csharp"],
  [".m", "objective-c"],
  [".mm", "objective-cpp"],
  [".h", "objective-c"]
]);

export function categoryForKind(kind) {
  return CATEGORY_BY_KIND.get(kind) || "type";
}

export function languageForFile(file = "") {
  const normalized = String(file).toLowerCase();
  const extension = [...LANGUAGE_BY_EXTENSION.keys()]
    .sort((left, right) => right.length - left.length)
    .find((candidate) => normalized.endsWith(candidate));
  return extension ? LANGUAGE_BY_EXTENSION.get(extension) : null;
}

export function normalizeGraph(graph, options = {}) {
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    throw new Error("A graph must contain nodes and edges arrays.");
  }
  const defaultLanguage = options.language || graph.project?.primaryLanguage || null;
  const nodes = graph.nodes.map((node) => normalizeNode(node, defaultLanguage));
  const languages = countLanguages(nodes);
  const primaryLanguage = graph.project?.primaryLanguage
    || [...languages].sort((left, right) => right.fileCount - left.fileCount)[0]?.id
    || defaultLanguage;

  return {
    ...graph,
    schemaVersion: 2,
    project: {
      ...graph.project,
      primaryLanguage,
      languages,
      scanProfile: graph.project?.scanProfile || options.scanProfile || legacyProfile(graph.project?.scanner),
      adapters: graph.project?.adapters || options.adapters || []
    },
    nodes,
    edges: graph.edges.map(normalizeEdge)
  };
}

export function normalizeNode(node, defaultLanguage = null) {
  const file = node.file || node.location?.file || "";
  const line = positiveInteger(node.line || node.location?.range?.start?.line, 1);
  const column = positiveInteger(node.column || node.location?.range?.start?.column, 1);
  const endLine = positiveInteger(node.endLine || node.location?.range?.end?.line, line);
  const endColumn = positiveInteger(node.endColumn || node.location?.range?.end?.column, column);
  const language = node.language || languageForFile(file) || defaultLanguage;
  return {
    ...node,
    category: node.category || categoryForKind(node.kind),
    language,
    qualifiedName: node.qualifiedName || node.name,
    file,
    line,
    column,
    location: file ? {
      file,
      range: {
        start: { line, column },
        end: { line: endLine, column: endColumn }
      }
    } : null,
    metrics: node.metrics || {},
    attributes: node.attributes || {},
    provenance: node.provenance || provenanceForLegacyNode(node)
  };
}

export function normalizeEdge(edge) {
  return {
    ...edge,
    provenance: edge.provenance || {
      adapter: edge.adapter || null,
      source: edge.source || null,
      confidence: edge.confidence ?? null,
      inferred: edge.inferred === true
    }
  };
}

export function validateGraph(graph) {
  const errors = [];
  if (graph?.schemaVersion !== 1 && graph?.schemaVersion !== 2) errors.push("schemaVersion must be 1 or 2");
  if (!graph?.project || typeof graph.project.name !== "string") errors.push("project.name is required");
  if (!Array.isArray(graph?.nodes)) errors.push("nodes must be an array");
  if (!Array.isArray(graph?.edges)) errors.push("edges must be an array");
  if (errors.length) return { valid: false, errors };

  const ids = new Set();
  for (const node of graph.nodes) {
    if (!node?.id || typeof node.id !== "string") errors.push("every node requires a string id");
    else if (ids.has(node.id)) errors.push(`duplicate node id: ${node.id}`);
    else ids.add(node.id);
    if (!node?.kind || typeof node.kind !== "string") errors.push(`node ${node?.id || "unknown"} requires kind`);
    if (node?.file && (node.file.startsWith("/") || node.file.split(/[\\/]/).includes(".."))) {
      errors.push(`node ${node.id} has a non-project-relative file`);
    }
  }
  for (const edge of graph.edges) {
    if (!ids.has(edge.from)) errors.push(`edge source does not exist: ${edge.from}`);
    if (!ids.has(edge.to)) errors.push(`edge target does not exist: ${edge.to}`);
    if (!edge.kind) errors.push(`edge ${edge.from} -> ${edge.to} requires kind`);
  }
  return { valid: errors.length === 0, errors };
}

export function assertValidGraph(graph) {
  const result = validateGraph(graph);
  if (!result.valid) throw new Error(`Invalid Code Universe graph: ${result.errors.slice(0, 8).join("; ")}`);
  return graph;
}

function countLanguages(nodes) {
  const counts = new Map();
  for (const node of nodes) {
    if (node.kind !== "file" || !node.language) continue;
    counts.set(node.language, (counts.get(node.language) || 0) + 1);
  }
  return [...counts]
    .map(([id, fileCount]) => ({ id, fileCount }))
    .sort((left, right) => right.fileCount - left.fileCount || left.id.localeCompare(right.id));
}

function legacyProfile(scanner) {
  if (scanner === "heuristic") return "fast";
  if (scanner === "swiftsyntax") return "accurate";
  if (scanner === "xcode-index") return "indexed";
  return "balanced";
}

function provenanceForLegacyNode(node) {
  if (!node.source && node.confidence == null && !node.inferred) return null;
  return {
    adapter: node.adapter || null,
    source: node.source || null,
    confidence: node.confidence ?? null,
    inferred: node.inferred === true
  };
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}
