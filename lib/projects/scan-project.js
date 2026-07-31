import { basename } from "node:path";
import { LanguageAdapterRegistry } from "../adapters/registry.js";
import { createSwiftAdapter } from "../adapters/swift-adapter.js";
import { typescriptAdapter } from "../adapters/typescript-adapter.js";
import { webAssetsAdapter } from "../adapters/web-assets-adapter.js";
import { csharpAdapter } from "../adapters/csharp-adapter.js";
import { objectiveCAdapter } from "../adapters/objective-c-adapter.js";
import { projectAssetsAdapter } from "../adapters/project-assets-adapter.js";
import { mergeGraphFragments } from "../graph/merge.js";
import { assertValidGraph, normalizeGraph } from "../graph/schema.js";
import { discoverProjectFiles } from "./discover-files.js";
import { detectProjectLanguages } from "./detect.js";
import { projectFingerprint } from "./fingerprint.js";

const scanCache = new Map();
const adapterScanCache = new Map();
const MAX_SCAN_CACHE_ENTRIES = 12;
const MAX_ADAPTER_CACHE_ENTRIES = 36;

export async function scanProject(root, options) {
  const files = await discoverProjectFiles(root);
  const detection = await detectProjectLanguages(root, files);
  if (detection.languages.length === 0) {
    throw new Error("No supported Swift, JavaScript, TypeScript, HTML, CSS, C#, or Objective-C source files were found.");
  }

  const registry = new LanguageAdapterRegistry([
    createSwiftAdapter(options.scanSwift),
    typescriptAdapter,
    webAssetsAdapter,
    csharpAdapter,
    objectiveCAdapter,
    projectAssetsAdapter
  ]);
  const adapters = registry.applicable(detection);
  const fingerprint = await projectFingerprint(root, files, adapters, options.profile);
  const cacheKey = `${root}|${fingerprint}`;
  const cached = scanCache.get(cacheKey);
  if (cached) {
    return {
      ...cached,
      diagnostics: { ...cached.diagnostics, cacheHit: true, fingerprint }
    };
  }
  const rootNode = {
    id: "repo:root",
    kind: "repository",
    category: "repository",
    language: null,
    name: basename(root),
    qualifiedName: basename(root),
    file: "",
    line: 1,
    column: 1,
    metrics: {},
    attributes: {}
  };
  const results = await Promise.all(adapters.map(async (adapter) => {
    const relevantExtensions = new Set(adapter.fingerprintExtensions || adapter.extensions);
    const relevantFiles = files
      .filter((file) => relevantExtensions.has(file.extension))
      .map((file) => adapter.id === "typescript" && file.extension === ".css"
        ? { ...file, size: 0, mtimeMs: 0 }
        : file);
    const adapterFingerprint = await projectFingerprint(root, relevantFiles, [adapter], options.profile);
    const adapterKey = `${root}|${adapter.id}|${adapterFingerprint}`;
    const cachedAdapter = adapterScanCache.get(adapterKey);
    if (cachedAdapter) {
      return {
        ...cachedAdapter,
        diagnostics: { ...cachedAdapter.diagnostics, adapterCacheHit: true, fingerprint: adapterFingerprint }
      };
    }
    const result = await adapter.scan({ root, files, detection, profile: options.profile });
    const cachedResult = {
      ...result,
      diagnostics: { ...result.diagnostics, adapterCacheHit: false, fingerprint: adapterFingerprint }
    };
    adapterScanCache.set(adapterKey, cachedResult);
    while (adapterScanCache.size > MAX_ADAPTER_CACHE_ENTRIES) adapterScanCache.delete(adapterScanCache.keys().next().value);
    return cachedResult;
  }));
  const adapterMetadata = adapters.map((adapter) => ({
    id: adapter.id,
    version: adapter.version,
    profile: adapter.profiles.includes(options.profile) ? options.profile : "balanced"
  }));
  const fragments = [
    projectStructureFragment(files, rootNode),
    ...results.map((result) => result.fragment)
  ];
  const mergedGraph = mergeGraphFragments({
    name: basename(root),
    scannedAt: new Date().toISOString(),
    sourceRoot: root,
    primaryLanguage: detection.primaryLanguage,
    languages: detection.languages.map(({ id, fileCount, confidence }) => ({ id, fileCount, confidence })),
    projectKind: detection.projectKind,
    scanProfile: options.profile,
    adapters: adapterMetadata,
    scanner: options.legacyScanner
  }, fragments, {
    scanProfile: options.profile,
    adapters: adapterMetadata
  });
  const graph = normalizeGraph(enrichCrossLanguageGraph(mergedGraph), {
    scanProfile: options.profile,
    adapters: adapterMetadata
  });
  assertValidGraph(graph);

  const diagnostics = { ...genericDiagnostics(graph, results, detection, options), cacheHit: false, fingerprint };
  const scan = { graph, diagnostics, detection };
  scanCache.set(cacheKey, scan);
  while (scanCache.size > MAX_SCAN_CACHE_ENTRIES) scanCache.delete(scanCache.keys().next().value);
  return scan;
}

function projectStructureFragment(files, rootNode) {
  const nodes = [rootNode];
  const edges = [];
  const directories = new Set();
  for (const file of files) {
    const parts = file.relative.split("/");
    for (let index = 1; index < parts.length; index += 1) {
      directories.add(parts.slice(0, index).join("/"));
    }
  }
  for (const path of [...directories].sort()) {
    const parentPath = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : null;
    const id = `directory:${path}`;
    nodes.push({
      id,
      kind: "directory",
      category: "directory",
      language: null,
      name: path.split("/").at(-1),
      qualifiedName: path,
      file: "",
      line: 1,
      column: 1,
      metrics: { files: files.filter((file) => file.relative.startsWith(`${path}/`)).length },
      attributes: { path }
    });
    edges.push({
      from: parentPath ? `directory:${parentPath}` : "repo:root",
      to: id,
      kind: "contains",
      source: "project-structure",
      confidence: 1,
      inferred: false
    });
  }
  for (const file of files) {
    const directory = file.relative.includes("/") ? file.relative.slice(0, file.relative.lastIndexOf("/")) : null;
    if (!directory) continue;
    edges.push({
      from: `directory:${directory}`,
      to: `file:${file.relative}`,
      kind: "contains",
      source: "project-structure",
      confidence: 1,
      inferred: false
    });
  }
  return { nodes, edges };
}

export function clearProjectScanCache() {
  scanCache.clear();
  adapterScanCache.clear();
}

function enrichCrossLanguageGraph(graph) {
  const rulesByFileAndClass = new Map();
  const htmlTargets = [];
  for (const node of graph.nodes) {
    if (node.kind !== "css_rule") continue;
    for (const className of node.attributes?.classes || []) {
      rulesByFileAndClass.set(`${node.file}|${className}`, node.id);
    }
  }
  for (const node of graph.nodes) {
    if (node.kind !== "html_element" && node.kind !== "jsx_element") continue;
    htmlTargets.push(node);
  }
  const edges = [...graph.edges];
  const known = new Set(edges.map((edge) => `${edge.from}|${edge.kind}|${edge.to}`));
  for (const node of graph.nodes) {
    for (const reference of node.attributes?.cssModuleClasses || []) {
      const target = rulesByFileAndClass.get(`${reference.file}|${reference.className}`);
      const key = `${node.id}|styles|${target}`;
      if (!target || known.has(key)) continue;
      known.add(key);
      edges.push({
        from: node.id,
        to: target,
        kind: "styles",
        source: "css-modules",
        confidence: 0.99,
        inferred: false,
        provenance: {
          adapter: "typescript",
          source: "css-modules",
          confidence: 0.99,
          inferred: false
        }
      });
    }
    for (const reference of node.attributes?.domReferences || []) {
      const targets = htmlTargets
        .filter((target) => domSelectorMatches(reference.selector, target))
        .sort((left, right) => Number(right.file === node.file) - Number(left.file === node.file));
      for (const target of targets.slice(0, reference.operation === "create" ? 1 : 24)) {
        const key = `${node.id}|uses|${target.id}`;
        if (known.has(key)) continue;
        known.add(key);
        edges.push({
          from: node.id,
          to: target.id,
          kind: "uses",
          source: "dom-selector",
          confidence: reference.selector.startsWith("#") ? 0.99 : 0.9,
          inferred: false,
          operation: reference.operation,
          event: reference.event || null
        });
      }
    }
    if (node.kind === "jsx_element" && node.attributes?.navigation && node.attributes.href) {
      const href = String(node.attributes.href);
      let target = null;
      if (href.startsWith("#")) {
        target = htmlTargets.find((candidate) => candidate.file === node.file && candidate.attributes?.id === href.slice(1));
      }
      if (!target && /^(?:https?:|mailto:|tel:|\/\/)/i.test(href)) {
        const targetId = `module:web-link:${encodeURIComponent(href)}`;
        if (!graph.nodes.some((candidate) => candidate.id === targetId)) {
          graph.nodes.push({
            id: targetId,
            kind: "module",
            category: "module",
            language: null,
            name: href,
            qualifiedName: href,
            file: "",
            line: 1,
            column: 1,
            location: null,
            metrics: {},
            attributes: { external: true, href },
            provenance: null
          });
        }
        target = graph.nodes.find((candidate) => candidate.id === targetId);
      }
      if (target) {
        const key = `${node.id}|links_to|${target.id}`;
        if (!known.has(key)) {
          known.add(key);
          edges.push({ from: node.id, to: target.id, kind: "links_to", source: "typescript-jsx", confidence: 0.98, inferred: false });
        }
      }
    }
  }
  const resolvedEdges = edges.map((edge) => {
    if (edge.source !== "swift-image-reference" || !edge.location?.file) return edge;
    const position = edge.location.range?.start;
    const owner = graph.nodes
      .filter((node) =>
        node.file === edge.location.file
        && node.kind !== "file"
        && node.location?.range
        && rangeContains(node.location.range, position)
      )
      .sort((left, right) =>
        (right.hierarchy?.depth || 0) - (left.hierarchy?.depth || 0)
        || rangeLineSpan(left.location.range) - rangeLineSpan(right.location.range)
      )[0];
    return owner ? { ...edge, from: owner.id } : edge;
  });
  const uniqueResolvedEdges = [...new Map(resolvedEdges.map((edge) => [
    `${edge.from}|${edge.kind}|${edge.to}|${edge.location?.range?.start?.line || 0}`,
    edge
  ])).values()];
  return {
    ...graph,
    edges: uniqueResolvedEdges.sort((left, right) =>
      `${left.from}|${left.kind}|${left.to}`.localeCompare(`${right.from}|${right.kind}|${right.to}`)
    )
  };
}

function rangeContains(range, position) {
  if (!position) return false;
  const afterStart = position.line > range.start.line
    || (position.line === range.start.line && position.column >= range.start.column);
  const beforeEnd = position.line < range.end.line
    || (position.line === range.end.line && position.column <= range.end.column);
  return afterStart && beforeEnd;
}

function rangeLineSpan(range) {
  return Math.max(1, range.end.line - range.start.line + 1);
}

function domSelectorMatches(selector, node) {
  const value = String(selector || "").trim();
  if (!value) return false;
  if (value.startsWith("#")) return node.attributes?.id === value.slice(1);
  if (value.startsWith(".")) return node.attributes?.classes?.includes(value.slice(1));
  const simple = value.match(/^(?:([A-Za-z][\w-]*))?(?:#([A-Za-z_][\w-]*))?(?:\.([A-Za-z_][\w-]*))?$/);
  if (!simple) return false;
  const [, tag, id, className] = simple;
  if (tag && node.attributes?.tag !== tag.toLowerCase()) return false;
  if (id && node.attributes?.id !== id) return false;
  if (className && !node.attributes?.classes?.includes(className)) return false;
  return Boolean(tag || id || className);
}

function genericDiagnostics(graph, results, detection, options) {
  const byKind = countBy(graph.nodes, "kind");
  const filesByLanguage = Object.fromEntries(graph.project.languages.map((entry) => [entry.id, entry.fileCount]));
  const swift = results.find((result) => result.diagnostics.adapter === "swift")?.diagnostics || {};
  return {
    ...swift,
    scanner: options.legacyScanner,
    scanProfile: options.profile,
    adapters: results.map((result) => result.diagnostics),
    languages: graph.project.languages,
    primaryLanguage: detection.primaryLanguage,
    projectKind: detection.projectKind,
    filesScanned: graph.nodes.filter((node) => node.kind === "file").length,
    filesByLanguage,
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
    nodesByKind: byKind,
    swiftFileCount: filesByLanguage.swift || 0,
    typeCount: graph.nodes.filter((node) => node.category === "type" || node.category === "component").length,
    functionCount: graph.nodes.filter((node) => node.category === "callable").length,
    propertyCount: graph.nodes.filter((node) => node.category === "data").length
  };
}

function countBy(items, key) {
  return items.reduce((counts, item) => {
    const value = item[key] || "unknown";
    counts[value] = (counts[value] || 0) + 1;
    return counts;
  }, {});
}

export function profileForScanner(scanner) {
  if (scanner === "heuristic" || scanner === "fast") return "fast";
  if (scanner === "swiftsyntax" || scanner === "accurate") return "accurate";
  if (scanner === "xcode-index" || scanner === "indexed") return "indexed";
  return "balanced";
}

export function scannerForProfile(profile, requestedScanner = null) {
  if (["heuristic", "merged", "swiftsyntax", "xcode-index"].includes(requestedScanner)) return requestedScanner;
  if (profile === "fast") return "heuristic";
  if (profile === "accurate") return "swiftsyntax";
  if (profile === "indexed") return "xcode-index";
  return "merged";
}
