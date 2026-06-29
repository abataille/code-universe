import { createServer } from "node:http";
import { mkdir, readFile, stat } from "node:fs/promises";
import { extname, dirname, join, normalize, relative, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { scanSwiftFolder } from "./scripts/scan-swift-core.js";

const execFileAsync = promisify(execFile);
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "127.0.0.1";
const root = join(process.cwd(), "public");
const scannerMode = process.env.CODE_UNIVERSE_SCANNER || "merged";

const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"]
]);

createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${host}:${port}`);

  try {
    if (url.pathname === "/api/pick-project" && request.method === "POST") {
      const body = await readJsonBody(request);
      const payload = await pickAndScanProject(body?.scanner);
      sendJson(response, 200, payload);
      return;
    }

    if (url.pathname === "/api/scan-path" && request.method === "POST") {
      const body = await readJsonBody(request);
      const payload = await scanExplicitPath(body?.path, body?.scanner);
      sendJson(response, 200, payload);
      return;
    }

    if (url.pathname === "/api/compare-parsers" && request.method === "POST") {
      const body = await readJsonBody(request);
      const payload = await compareParsers(body?.path);
      sendJson(response, 200, payload);
      return;
    }

    if (url.pathname === "/api/source" && request.method === "POST") {
      const body = await readJsonBody(request);
      const payload = await readSourceSnippet(body);
      sendJson(response, 200, payload);
      return;
    }

    if (url.pathname === "/api/open-source" && request.method === "POST") {
      const body = await readJsonBody(request);
      const payload = await openSourceInXcode(body);
      sendJson(response, 200, payload);
      return;
    }

    await serveStatic(url, response);
  } catch (error) {
    sendJson(response, 500, { error: error.message });
  }
}).listen(port, host, () => {
  console.log(`Code Universe prototype: http://${host}:${port}`);
});

async function serveStatic(url, response) {
  const requestedPath = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = normalize(join(root, requestedPath));

  if (!filePath.startsWith(root)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const body = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": contentTypes.get(extname(filePath)) || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
}

async function pickAndScanProject(scanner) {
  const pickedPath = await showNativeProjectPicker();
  return scanResolvedPath(pickedPath, scanner);
}

async function scanExplicitPath(inputPath, scanner) {
  if (!inputPath || typeof inputPath !== "string") {
    throw new Error("Missing path.");
  }
  return scanResolvedPath(inputPath, scanner);
}

async function scanResolvedPath(inputPath, scanner) {
  const resolvedInput = resolve(inputPath);
  const projectRoot = await resolveProjectRoot(resolvedInput);
  const resolvedScanner = resolveScannerMode(scanner);
  const { graph, diagnostics } = resolvedScanner === "merged"
    ? await scanSwiftFolderMerged(projectRoot)
    : resolvedScanner === "swiftsyntax"
      ? await scanSwiftFolderWithSwiftSyntax(projectRoot)
      : await scanSwiftFolder(projectRoot);

  return {
    graph: {
      ...graph,
      project: {
        ...graph.project,
        pickedPath: resolvedInput,
        sourceRoot: projectRoot
      }
    },
    diagnostics: {
      ...diagnostics,
      scanner: resolvedScanner,
      pickedPath: resolvedInput,
      sourceRoot: projectRoot
    }
  };
}

async function compareParsers(inputPath) {
  if (!inputPath || typeof inputPath !== "string") {
    throw new Error("Missing path.");
  }

  const resolvedInput = resolve(inputPath);
  const projectRoot = await resolveProjectRoot(resolvedInput);
  const [heuristicScan, swiftSyntaxScan] = await Promise.all([
    scanSwiftFolder(projectRoot),
    scanSwiftFolderWithSwiftSyntax(projectRoot)
  ]);

  return {
    project: {
      name: heuristicScan.graph.project.name,
      pickedPath: resolvedInput,
      sourceRoot: projectRoot
    },
    comparedAt: new Date().toISOString(),
    heuristic: summarizeGraph(heuristicScan.graph),
    swiftsyntax: summarizeGraph(swiftSyntaxScan.graph),
    nodes: compareNodes(heuristicScan.graph.nodes, swiftSyntaxScan.graph.nodes),
    edges: compareEdges(heuristicScan.graph.edges, swiftSyntaxScan.graph.edges)
  };
}

function resolveScannerMode(scanner) {
  if (scanner === "merged" || scanner === "swiftsyntax" || scanner === "heuristic") {
    return scanner;
  }
  if (scannerMode === "merged" || scannerMode === "swiftsyntax" || scannerMode === "heuristic") {
    return scannerMode;
  }
  return "merged";
}

async function scanSwiftFolderMerged(projectRoot) {
  const [heuristicScan, swiftSyntaxScan] = await Promise.all([
    scanSwiftFolder(projectRoot),
    scanSwiftFolderWithSwiftSyntax(projectRoot)
  ]);
  const graph = mergeGraphs(swiftSyntaxScan.graph, heuristicScan.graph);

  return {
    graph,
    diagnostics: {
      swiftFileCount: graph.nodes.filter((node) => node.kind === "file").length,
      typeCount: graph.nodes.filter((node) => node.id.startsWith("type:")).length,
      functionCount: graph.nodes.filter((node) => node.kind === "function").length,
      propertyCount: graph.nodes.filter((node) => node.kind === "property").length,
      mergedBaseNodes: swiftSyntaxScan.graph.nodes.length,
      heuristicHintNodes: graph.nodes.filter((node) => node.source === "heuristic").length,
      heuristicHintEdges: graph.edges.filter((edge) => edge.source === "heuristic").length
    }
  };
}

function mergeGraphs(swiftSyntaxGraph, heuristicGraph) {
  const nodes = new Map(swiftSyntaxGraph.nodes.map((node) => [node.id, {
    ...node,
    source: "swiftsyntax",
    confidence: 0.95
  }]));
  const edges = new Map(swiftSyntaxGraph.edges.map((edge) => [edgeComparisonKey(edge), {
    ...edge,
    source: "swiftsyntax",
    confidence: 0.9
  }]));

  for (const node of heuristicGraph.nodes) {
    if (!nodes.has(node.id)) {
      nodes.set(node.id, {
        ...node,
        source: "heuristic",
        confidence: 0.55,
        inferred: true
      });
    }
  }

  for (const edge of heuristicGraph.edges) {
    const key = edgeComparisonKey(edge);
    if (edges.has(key)) continue;
    if (!nodes.has(edge.from) || !nodes.has(edge.to)) continue;
    edges.set(key, {
      ...edge,
      source: "heuristic",
      confidence: 0.55,
      inferred: true
    });
  }

  return {
    ...swiftSyntaxGraph,
    project: {
      ...swiftSyntaxGraph.project,
      scanner: "merged"
    },
    nodes: [...nodes.values()].sort((left, right) => left.id.localeCompare(right.id)),
    edges: [...edges.values()].sort((left, right) => edgeComparisonKey(left).localeCompare(edgeComparisonKey(right)))
  };
}

function summarizeGraph(graph) {
  return {
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
    byKind: countBy(graph.nodes, (node) => node.kind),
    edgesByKind: countBy(graph.edges, (edge) => edge.kind)
  };
}

function compareNodes(heuristicNodes, swiftSyntaxNodes) {
  const heuristicMap = mapByKey(heuristicNodes, nodeComparisonKey);
  const swiftSyntaxMap = mapByKey(swiftSyntaxNodes, nodeComparisonKey);
  const shared = [];
  const onlyHeuristic = [];
  const onlySwiftSyntax = [];

  for (const [key, node] of heuristicMap) {
    if (swiftSyntaxMap.has(key)) {
      shared.push(toComparableNode(node));
    } else {
      onlyHeuristic.push(toComparableNode(node));
    }
  }

  for (const [key, node] of swiftSyntaxMap) {
    if (!heuristicMap.has(key)) {
      onlySwiftSyntax.push(toComparableNode(node));
    }
  }

  return {
    shared: shared.length,
    onlyHeuristic: sortComparableNodes(onlyHeuristic),
    onlySwiftSyntax: sortComparableNodes(onlySwiftSyntax),
    onlyHeuristicByKind: countBy(onlyHeuristic, (node) => node.kind),
    onlySwiftSyntaxByKind: countBy(onlySwiftSyntax, (node) => node.kind)
  };
}

function compareEdges(heuristicEdges, swiftSyntaxEdges) {
  const heuristicKeys = new Set(heuristicEdges.map(edgeComparisonKey));
  const swiftSyntaxKeys = new Set(swiftSyntaxEdges.map(edgeComparisonKey));
  return {
    shared: [...heuristicKeys].filter((key) => swiftSyntaxKeys.has(key)).length,
    onlyHeuristic: [...heuristicKeys].filter((key) => !swiftSyntaxKeys.has(key)).length,
    onlySwiftSyntax: [...swiftSyntaxKeys].filter((key) => !heuristicKeys.has(key)).length
  };
}

function nodeComparisonKey(node) {
  if (node.kind === "repository") return `${node.kind}:${node.name}`;
  if (node.kind === "file") return `${node.kind}:${node.file}`;
  if (node.kind === "module") return `${node.kind}:${node.name}`;
  return `${node.kind}:${node.file}:${node.name}`;
}

function edgeComparisonKey(edge) {
  return `${edge.kind}:${edge.from}->${edge.to}`;
}

function mapByKey(items, keyForItem) {
  const map = new Map();
  for (const item of items) {
    const key = keyForItem(item);
    if (!map.has(key)) map.set(key, item);
  }
  return map;
}

function toComparableNode(node) {
  return {
    id: node.id,
    kind: node.kind,
    declarationKind: node.declarationKind || null,
    name: node.name,
    file: node.file,
    line: node.line,
    metrics: node.metrics || {}
  };
}

function sortComparableNodes(nodes) {
  return nodes.sort((left, right) =>
    left.kind.localeCompare(right.kind)
    || left.file.localeCompare(right.file)
    || left.line - right.line
    || left.name.localeCompare(right.name)
  );
}

function countBy(items, keyForItem) {
  return items.reduce((counts, item) => {
    const key = keyForItem(item);
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

async function scanSwiftFolderWithSwiftSyntax(projectRoot) {
  const outputDir = resolve(".swift-cache/server");
  const outputPath = join(outputDir, "graph.json");
  await mkdir(outputDir, { recursive: true });
  await execFileAsync("node", ["scripts/scan-swift-syntax.js", projectRoot, outputPath], {
    env: {
      ...process.env,
      CLANG_MODULE_CACHE_PATH: resolve(".swift-cache/clang-module-cache")
    }
  });

  const graph = JSON.parse(await readFile(outputPath, "utf8"));
  return {
    graph,
    diagnostics: {
      swiftFileCount: graph.nodes.filter((node) => node.kind === "file").length,
      typeCount: graph.nodes.filter((node) => node.id.startsWith("type:")).length,
      functionCount: graph.nodes.filter((node) => node.kind === "function").length,
      propertyCount: graph.nodes.filter((node) => node.kind === "property").length
    }
  };
}

async function readSourceSnippet(body) {
  const { resolvedFile, relativeFile, targetLine } = resolveSourceLocation(body);
  const source = await readFile(resolvedFile, "utf8");
  const lines = source.split(/\r?\n/);
  const clampedLine = Math.max(1, Math.min(lines.length, targetLine));
  const startLine = Math.max(1, clampedLine - 8);
  const endLine = Math.min(lines.length, clampedLine + 18);

  return {
    file: relativeFile,
    line: clampedLine,
    startLine,
    endLine,
    code: lines.slice(startLine - 1, endLine).map((content, index) => ({
      number: startLine + index,
      content
    }))
  };
}

async function openSourceInXcode(body) {
  const { resolvedFile, relativeFile, targetLine } = resolveSourceLocation(body);
  await execFileAsync("xed", ["--line", String(targetLine), resolvedFile]);
  return {
    opened: true,
    file: relativeFile,
    line: targetLine
  };
}

function resolveSourceLocation(body) {
  const sourceRoot = body?.sourceRoot;
  const file = body?.file;
  const line = Number(body?.line || 1);

  if (!sourceRoot || !file || typeof sourceRoot !== "string" || typeof file !== "string") {
    throw new Error("Missing source location.");
  }

  const resolvedRoot = resolve(sourceRoot);
  const resolvedFile = resolve(resolvedRoot, file);
  const relativeFile = relative(resolvedRoot, resolvedFile);

  if (relativeFile.startsWith("..") || relativeFile === "" || relativeFile.startsWith("/")) {
    throw new Error("Source file is outside the scanned project.");
  }

  return {
    resolvedFile,
    relativeFile,
    targetLine: Math.max(1, Number.isFinite(line) ? Math.floor(line) : 1)
  };
}

async function resolveProjectRoot(inputPath) {
  const entry = await stat(inputPath);
  if (entry.isDirectory() && inputPath.endsWith(".xcodeproj")) {
    return dirname(inputPath);
  }
  if (entry.isDirectory()) {
    return inputPath;
  }
  if (inputPath.endsWith(".xcodeproj/project.pbxproj")) {
    return dirname(dirname(inputPath));
  }
  return dirname(inputPath);
}

async function showNativeProjectPicker() {
  const script = `
set chosenItem to choose file with prompt "Choose an .xcodeproj or project.pbxproj file"
POSIX path of chosenItem
`;

  const { stdout } = await execFileAsync("osascript", ["-e", script]);
  const pickedPath = stdout.trim();
  if (!pickedPath) {
    throw new Error("No project selected.");
  }
  return pickedPath;
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  if (chunks.length === 0) return null;
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(payload));
}
