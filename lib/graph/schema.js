const CATEGORY_BY_KIND = new Map([
  ["repository", "repository"],
  ["directory", "directory"],
  ["file", "file"],
  ["module", "module"],
  ["namespace", "module"],
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
  ["closure", "callable"],
  ["block", "callable"],
  ["external_symbol", "callable"],
  ["property", "data"],
  ["variable", "data"],
  ["local_variable", "data"],
  ["enum_case", "data"],
  ["event", "data"],
  ["ivar", "data"],
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
  ["extension", "type"],
  ["delegate", "type"],
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
  const edges = graph.edges.map(normalizeEdge);
  const normalizedNodes = graph.nodes.map((node) => normalizeNode(node, defaultLanguage));
  const nodes = enrichNodePresentation(assignStableIdentities(normalizedNodes), edges);
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
    edges
  };
}

export function normalizeNode(node, defaultLanguage = null) {
  const file = node.file || node.location?.file || "";
  const line = positiveInteger(node.line || node.location?.range?.start?.line, 1);
  const column = positiveInteger(node.column || node.location?.range?.start?.column, 1);
  const suppliedEnd = node.endLine != null || node.endColumn != null || node.location?.range?.end != null;
  const endLine = positiveInteger(node.endLine || node.location?.range?.end?.line, line);
  const endColumn = positiveInteger(node.endColumn || node.location?.range?.end?.column, column);
  const languageNeutral = ["repository", "directory"].includes(node.kind) || node.category === "asset" || node.kind?.endsWith("_asset");
  const language = node.language || languageForFile(file) || (languageNeutral ? null : defaultLanguage);
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
        end: { line: endLine, column: endColumn },
        precision: node.location?.range?.precision || (suppliedEnd ? "exact" : "line")
      }
    } : null,
    metrics: normalizedMetrics(node.metrics, file, line, endLine),
    identity: node.identity || null,
    hierarchy: node.hierarchy || null,
    display: node.display || {},
    attributes: node.attributes || {},
    provenance: node.provenance || provenanceForLegacyNode(node)
  };
}

function assignStableIdentities(nodes) {
  const groups = new Map();
  for (const node of nodes) {
    const base = stableIdentityBase(node);
    if (!groups.has(base)) groups.set(base, []);
    groups.get(base).push(node);
  }
  return nodes.map((node) => {
    if (node.identity?.stableId) return node;
    const base = stableIdentityBase(node);
    const siblings = groups.get(base)
      .sort((left, right) => signatureForIdentity(left).localeCompare(signatureForIdentity(right))
        || (left.line || 1) - (right.line || 1)
        || (left.column || 1) - (right.column || 1));
    const ordinal = siblings.indexOf(node);
    const key = siblings.length > 1 ? `${base}|${signatureForIdentity(node)}|${ordinal}` : base;
    return {
      ...node,
      identity: {
        stableId: `cu:${stableHash(key)}`,
        strategy: siblings.length > 1 ? "qualified-symbol-ordinal" : "qualified-symbol",
        ordinal
      }
    };
  });
}

function stableIdentityBase(node) {
  if (node.kind === "repository") return "repository";
  return [
    node.category || categoryForKind(node.kind),
    node.kind,
    node.language || "",
    node.file || node.attributes?.path || "",
    node.qualifiedName || node.name || ""
  ].join("|");
}

function signatureForIdentity(node) {
  return [
    node.attributes?.selector || "",
    node.attributes?.returnType || "",
    node.attributes?.type || "",
    node.metrics?.parameters ?? ""
  ].join("|");
}

function stableHash(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).padStart(7, "0");
}

function normalizedMetrics(metrics = {}, file, startLine, endLine) {
  if (!file) return { ...metrics };
  const sourceLines = Math.max(1, endLine - startLine + 1);
  const branches = Math.max(0, Number(metrics.branches || 0));
  return {
    ...metrics,
    sourceLines,
    complexity: Number.isFinite(Number(metrics.complexity))
      ? Math.max(1, Number(metrics.complexity))
      : 1 + branches,
    metricModel: metrics.metricModel || "source-span-cyclomatic"
  };
}

function enrichNodePresentation(nodes, edges) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const structuralEdges = edges.filter((edge) => edge.kind === "contains" || edge.kind === "defines");
  const childrenByParent = new Map();
  const parentByChild = new Map();
  const parentsByChild = new Map();
  const sharedByTarget = new Map();
  for (const edge of edges) {
    if (!["displays", "loads", "embeds", "downloads"].includes(edge.kind)) continue;
    if (!sharedByTarget.has(edge.to)) sharedByTarget.set(edge.to, []);
    sharedByTarget.get(edge.to).push(edge.from);
  }
  for (const edge of structuralEdges) {
    if (!byId.has(edge.from) || !byId.has(edge.to)) continue;
    if (!childrenByParent.has(edge.from)) childrenByParent.set(edge.from, []);
    childrenByParent.get(edge.from).push(edge.to);
    if (!parentsByChild.has(edge.to)) parentsByChild.set(edge.to, []);
    parentsByChild.get(edge.to).push({ id: edge.from, relation: edge.kind });
    const current = parentByChild.get(edge.to);
    if (!current || edge.kind === "defines") parentByChild.set(edge.to, { id: edge.from, relation: edge.kind });
  }
  for (const children of childrenByParent.values()) {
    children.sort((left, right) => {
      const a = byId.get(left);
      const b = byId.get(right);
      return (a?.line || 1) - (b?.line || 1) || (a?.column || 1) - (b?.column || 1) || left.localeCompare(right);
    });
  }
  const depthFor = (id, seen = new Set()) => {
    if (seen.has(id)) return 0;
    const parent = parentByChild.get(id);
    if (!parent) return 0;
    seen.add(id);
    return 1 + depthFor(parent.id, seen);
  };
  return nodes.map((node) => {
    const parent = parentByChild.get(node.id);
    const siblings = parent ? childrenByParent.get(parent.id) || [] : [];
    const sharedBy = sharedByTarget.get(node.id) || [];
    const metrics = node.metrics || {};
    const pixelWidth = positiveNumber(node.attributes?.pixelWidth);
    const pixelHeight = positiveNumber(node.attributes?.pixelHeight);
    const complexity = positiveNumber(metrics.complexity)
      || Math.max(1, 1 + Number(metrics.branches || 0));
    const lines = Math.max(1, Number(metrics.sourceLines || metrics.lines || 1));
    return {
      ...node,
      hierarchy: {
        parentId: parent?.id || null,
        parents: parentsByChild.get(node.id) || [],
        sharedBy: [...new Set(sharedBy)],
        shared: sharedBy.length > 1 || (parentsByChild.get(node.id)?.length || 0) > 1,
        relation: parent?.relation || null,
        depth: depthFor(node.id),
        index: parent ? siblings.indexOf(node.id) : 0,
        childCount: (childrenByParent.get(node.id) || []).length
      },
      display: {
        weight: Math.max(1, Math.sqrt(lines) * (1 + Math.log1p(complexity) * 0.25)),
        complexity,
        aspectRatio: pixelWidth && pixelHeight ? pixelWidth / pixelHeight : null,
        preview: node.kind === "image_asset" && node.attributes?.exists === true ? "image" : null,
        ...node.display
      }
    };
  });
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
    if (node?.category != null && typeof node.category !== "string") errors.push(`node ${node?.id || "unknown"} has invalid category`);
    if (node?.file && (node.file.startsWith("/") || node.file.split(/[\\/]/).includes(".."))) {
      errors.push(`node ${node.id} has a non-project-relative file`);
    }
    const range = node?.location?.range;
    if (range && !orderedRange(range)) errors.push(`node ${node.id} has an invalid source range`);
    if (node?.hierarchy?.parentId && !graph.nodes.some((candidate) => candidate.id === node.hierarchy.parentId)) {
      errors.push(`node ${node.id} has a missing hierarchy parent`);
    }
    if (node?.display?.weight != null && !Number.isFinite(node.display.weight)) {
      errors.push(`node ${node.id} has an invalid display weight`);
    }
  }
  for (const edge of graph.edges) {
    if (!ids.has(edge.from)) errors.push(`edge source does not exist: ${edge.from}`);
    if (!ids.has(edge.to)) errors.push(`edge target does not exist: ${edge.to}`);
    if (!edge.kind) errors.push(`edge ${edge.from} -> ${edge.to} requires kind`);
  }
  return { valid: errors.length === 0, errors };
}

function orderedRange(range) {
  const { start, end } = range;
  if (![start?.line, start?.column, end?.line, end?.column].every((value) => Number.isInteger(value) && value > 0)) return false;
  return end.line > start.line || (end.line === start.line && end.column >= start.column);
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

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}
