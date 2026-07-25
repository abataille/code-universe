import { basename } from "node:path";
import { LanguageAdapterRegistry } from "../adapters/registry.js";
import { createSwiftAdapter } from "../adapters/swift-adapter.js";
import { typescriptAdapter } from "../adapters/typescript-adapter.js";
import { webAssetsAdapter } from "../adapters/web-assets-adapter.js";
import { mergeGraphFragments } from "../graph/merge.js";
import { assertValidGraph } from "../graph/schema.js";
import { discoverProjectFiles } from "./discover-files.js";
import { detectProjectLanguages } from "./detect.js";

export async function scanProject(root, options) {
  const files = await discoverProjectFiles(root);
  const detection = await detectProjectLanguages(root, files);
  if (detection.languages.length === 0) {
    throw new Error("No supported Swift, JavaScript, TypeScript, HTML, or CSS source files were found.");
  }

  const registry = new LanguageAdapterRegistry([
    createSwiftAdapter(options.scanSwift),
    typescriptAdapter,
    webAssetsAdapter
  ]);
  const adapters = registry.applicable(detection);
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
  const results = await Promise.all(adapters.map((adapter) =>
    adapter.scan({ root, files, detection, profile: options.profile })
  ));
  const adapterMetadata = adapters.map((adapter) => ({
    id: adapter.id,
    version: adapter.version,
    profile: adapter.profiles.includes(options.profile) ? options.profile : "balanced"
  }));
  const fragments = [
    { nodes: [rootNode], edges: [] },
    ...results.map((result) => result.fragment)
  ];
  const graph = mergeGraphFragments({
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
  assertValidGraph(graph);

  const diagnostics = genericDiagnostics(graph, results, detection, options);
  return { graph, diagnostics, detection };
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
