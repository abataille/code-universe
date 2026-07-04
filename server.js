import { createServer } from "node:http";
import { mkdir, readFile, stat } from "node:fs/promises";
import { extname, dirname, join, normalize, relative, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { scanSwiftFolder } from "./scripts/scan-swift-core.js";
import { enrichGraphWithXcodeIndex } from "./scripts/scan-xcode-index.js";

const execFileAsync = promisify(execFile);
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "127.0.0.1";
const root = join(process.cwd(), "public");
const scannerMode = process.env.CODE_UNIVERSE_SCANNER || "merged";
const swiftSyntaxTimeoutMs = Number(process.env.CODE_UNIVERSE_SWIFTSYNTAX_TIMEOUT_MS || 45000);
const activeClients = new Map();
let shutdownTimer = null;
let pruneTimer = null;

const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"]
]);

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${host}:${port}`);

  try {
    if (url.pathname === "/api/client-open" && request.method === "POST") {
      const clientId = await readClientId(request);
      registerClient(clientId);
      sendJson(response, 200, { ok: true });
      return;
    }

    if (url.pathname === "/api/client-heartbeat" && request.method === "POST") {
      const clientId = await readClientId(request);
      registerClient(clientId);
      sendJson(response, 200, { ok: true });
      return;
    }

    if (url.pathname === "/api/client-close" && request.method === "POST") {
      const clientId = await readClientId(request);
      unregisterClient(clientId);
      sendJson(response, 200, { ok: true });
      return;
    }

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
});

server.listen(port, host, () => {
  console.log(`Code Universe: http://${host}:${port}`);
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
  const inputEntry = await stat(resolvedInput);
  const projectRoot = await resolveProjectRoot(resolvedInput);
  const selectedSwiftFile = !inputEntry.isDirectory() && resolvedInput.endsWith(".swift")
    ? relative(projectRoot, resolvedInput)
    : null;
  const resolvedScanner = resolveScannerMode(scanner);
  const { graph, diagnostics } = resolvedScanner === "xcode-index"
    ? await scanSwiftFolderWithXcodeIndex(projectRoot)
    : resolvedScanner === "merged"
      ? await scanSwiftFolderMerged(projectRoot)
      : resolvedScanner === "swiftsyntax"
        ? await scanSwiftFolderWithSwiftSyntax(projectRoot)
        : await scanSwiftFolder(projectRoot);

  const displayedGraph = selectedSwiftFile
    ? graphForSelectedSwiftFile(graph, selectedSwiftFile)
    : graph;
  const displayedDiagnostics = selectedSwiftFile
    ? diagnosticsForGraph(diagnostics, displayedGraph, selectedSwiftFile)
    : diagnostics;

  return {
    graph: {
      ...displayedGraph,
      project: {
        ...displayedGraph.project,
        pickedPath: resolvedInput,
        sourceRoot: projectRoot,
        selectedFile: selectedSwiftFile
      }
    },
    diagnostics: {
      ...displayedDiagnostics,
      scanner: resolvedScanner,
      pickedPath: resolvedInput,
      sourceRoot: projectRoot,
      selectedFile: selectedSwiftFile
    }
  };
}

function graphForSelectedSwiftFile(graph, selectedFile) {
  const fileNode = graph.nodes.find((node) => node.kind === "file" && node.file === selectedFile);
  if (!fileNode) return graph;

  const importedModuleIds = new Set(graph.edges
    .filter((edge) => edge.from === fileNode.id && edge.kind === "imports")
    .map((edge) => edge.to));
  const visibleNodes = graph.nodes.filter((node) =>
    node.id === "repo:root"
    || node.id === fileNode.id
    || node.file === selectedFile
    || importedModuleIds.has(node.id)
  );
  const visibleIds = new Set(visibleNodes.map((node) => node.id));
  const visibleEdges = graph.edges.filter((edge) => visibleIds.has(edge.from) && visibleIds.has(edge.to));

  return {
    ...graph,
    project: {
      ...graph.project,
      name: selectedFile,
      focusedFile: selectedFile
    },
    nodes: visibleNodes,
    edges: visibleEdges
  };
}

function diagnosticsForGraph(diagnostics, graph, selectedFile) {
  return {
    ...diagnostics,
    focusedFile: selectedFile,
    fullSwiftFileCount: diagnostics.swiftFileCount,
    fullTypeCount: diagnostics.typeCount,
    fullFunctionCount: diagnostics.functionCount,
    fullPropertyCount: diagnostics.propertyCount,
    swiftFileCount: graph.nodes.filter((node) => node.kind === "file").length,
    typeCount: graph.nodes.filter((node) => node.id.startsWith("type:")).length,
    functionCount: graph.nodes.filter((node) => node.kind === "function").length,
    propertyCount: graph.nodes.filter((node) => node.kind === "property").length
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
  const mergedGraph = mergeGraphs(swiftSyntaxScan.graph, heuristicScan.graph);
  const xcodeIndexScan = await enrichGraphWithXcodeIndex(mergedGraph, projectRoot);
  const heuristicVsSwiftNodes = compareNodes(heuristicScan.graph.nodes, swiftSyntaxScan.graph.nodes);
  const swiftVsMergedNodes = compareNodeSets(swiftSyntaxScan.graph.nodes, mergedGraph.nodes);
  const mergedVsIndexNodes = compareNodeSets(mergedGraph.nodes, xcodeIndexScan.graph.nodes);
  const heuristicVsSwiftEdges = compareEdges(heuristicScan.graph.edges, swiftSyntaxScan.graph.edges, swiftSyntaxScan.graph.nodes);
  const swiftVsMergedEdges = compareEdges(swiftSyntaxScan.graph.edges, mergedGraph.edges, mergedGraph.nodes);
  const mergedVsIndexEdges = compareEdges(mergedGraph.edges, xcodeIndexScan.graph.edges, xcodeIndexScan.graph.nodes);

  return {
    project: {
      name: heuristicScan.graph.project.name,
      pickedPath: resolvedInput,
      sourceRoot: projectRoot
    },
    comparedAt: new Date().toISOString(),
    heuristic: summarizeGraph(heuristicScan.graph),
    swiftsyntax: summarizeGraph(swiftSyntaxScan.graph),
    merged: summarizeGraph(mergedGraph),
    xcodeIndex: summarizeGraph(xcodeIndexScan.graph),
    xcodeIndexDiagnostics: xcodeIndexScan.diagnostics,
    nodes: {
      ...heuristicVsSwiftNodes,
      onlyMerged: swiftVsMergedNodes.onlyRight,
      onlyMergedByKind: swiftVsMergedNodes.onlyRightByKind,
      onlyXcodeIndex: mergedVsIndexNodes.onlyRight,
      onlyXcodeIndexByKind: mergedVsIndexNodes.onlyRightByKind
    },
    edges: {
      ...heuristicVsSwiftEdges,
      mergedOnly: swiftVsMergedEdges.onlyRight,
      xcodeIndexOnly: mergedVsIndexEdges.onlyRight,
      xcodeIndexOnlyDetails: mergedVsIndexEdges.onlyRightDetails
    }
  };
}

function resolveScannerMode(scanner) {
  if (scanner === "xcode-index" || scanner === "merged" || scanner === "swiftsyntax" || scanner === "heuristic") {
    return scanner;
  }
  if (scannerMode === "xcode-index" || scannerMode === "merged" || scannerMode === "swiftsyntax" || scannerMode === "heuristic") {
    return scannerMode;
  }
  return "merged";
}

async function scanSwiftFolderWithXcodeIndex(projectRoot) {
  const mergedScan = await scanSwiftFolderMerged(projectRoot);
  const indexScan = await withTimeout(
    enrichGraphWithXcodeIndex(mergedScan.graph, projectRoot),
    5000,
    {
      graph: mergedScan.graph,
      diagnostics: {
        xcodeIndexAvailable: false,
        xcodeIndexMessage: "Xcode index scan timed out. Showing merged graph without index links.",
        xcodeIndexEdges: 0,
        xcodeIndexRecords: 0
      }
    }
  );
  return {
    graph: indexScan.graph,
    diagnostics: {
      ...mergedScan.diagnostics,
      ...indexScan.diagnostics,
      swiftFileCount: indexScan.graph.nodes.filter((node) => node.kind === "file").length,
      typeCount: indexScan.graph.nodes.filter((node) => node.id.startsWith("type:")).length,
      functionCount: indexScan.graph.nodes.filter((node) => node.kind === "function").length,
      propertyCount: indexScan.graph.nodes.filter((node) => node.kind === "property").length
    }
  };
}

function withTimeout(promise, timeoutMs, fallback) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(fallback), timeoutMs))
  ]);
}

async function scanSwiftFolderMerged(projectRoot) {
  const heuristicScan = await scanSwiftFolder(projectRoot);
  const swiftSyntaxScan = await scanSwiftFolderWithSwiftSyntax(projectRoot).catch((error) => ({
    graph: heuristicScan.graph,
    diagnostics: {
      swiftSyntaxAvailable: false,
      swiftSyntaxMessage: `SwiftSyntax scan skipped: ${error.message}`,
      swiftFileCount: heuristicScan.diagnostics.swiftFileCount,
      typeCount: heuristicScan.diagnostics.typeCount,
      functionCount: heuristicScan.diagnostics.functionCount,
      propertyCount: heuristicScan.diagnostics.propertyCount
    }
  }));
  const graph = mergeGraphs(swiftSyntaxScan.graph, heuristicScan.graph);

  return {
    graph,
    diagnostics: {
      ...swiftSyntaxScan.diagnostics,
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
    if (nodes.has(node.id)) {
      const existing = nodes.get(node.id);
      nodes.set(node.id, {
        ...existing,
        metrics: {
          ...(node.metrics || {}),
          ...(existing.metrics || {})
        }
      });
    } else {
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
  const comparison = compareNodeSets(heuristicNodes, swiftSyntaxNodes);
  return {
    shared: comparison.shared,
    onlyHeuristic: comparison.onlyLeft,
    onlySwiftSyntax: comparison.onlyRight,
    onlyHeuristicByKind: comparison.onlyLeftByKind,
    onlySwiftSyntaxByKind: comparison.onlyRightByKind
  };
}

function compareNodeSets(leftNodes, rightNodes) {
  const leftMap = mapByKey(leftNodes, nodeComparisonKey);
  const rightMap = mapByKey(rightNodes, nodeComparisonKey);
  const shared = [];
  const onlyLeft = [];
  const onlyRight = [];

  for (const [key, node] of leftMap) {
    if (rightMap.has(key)) {
      shared.push(toComparableNode(node));
    } else {
      onlyLeft.push(toComparableNode(node));
    }
  }

  for (const [key, node] of rightMap) {
    if (!leftMap.has(key)) {
      onlyRight.push(toComparableNode(node));
    }
  }

  return {
    shared: shared.length,
    onlyLeft: sortComparableNodes(onlyLeft),
    onlyRight: sortComparableNodes(onlyRight),
    onlyLeftByKind: countBy(onlyLeft, (node) => node.kind),
    onlyRightByKind: countBy(onlyRight, (node) => node.kind)
  };
}

function compareEdges(leftEdges, rightEdges, nodes = []) {
  const leftByKey = new Map(leftEdges.map((edge) => [edgeComparisonKey(edge), edge]));
  const rightByKey = new Map(rightEdges.map((edge) => [edgeComparisonKey(edge), edge]));
  const leftKeys = new Set(leftByKey.keys());
  const rightKeys = new Set(rightByKey.keys());
  const onlyLeftKeys = [...leftKeys].filter((key) => !rightKeys.has(key));
  const onlyRightKeys = [...rightKeys].filter((key) => !leftKeys.has(key));

  return {
    shared: [...leftKeys].filter((key) => rightKeys.has(key)).length,
    onlyLeft: onlyLeftKeys.length,
    onlyRight: onlyRightKeys.length,
    onlyLeftDetails: onlyLeftKeys.map((key) => toComparableEdge(leftByKey.get(key), nodes)),
    onlyRightDetails: onlyRightKeys.map((key) => toComparableEdge(rightByKey.get(key), nodes))
  };
}

function toComparableEdge(edge, nodes) {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const from = nodeMap.get(edge.from);
  const to = nodeMap.get(edge.to);
  return {
    from: edge.from,
    fromName: from?.name || edge.from,
    to: edge.to,
    toName: to?.name || edge.to,
    kind: edge.kind,
    source: edge.source || null,
    confidence: edge.confidence || null,
    inferred: edge.inferred === true,
    indexResolved: edge.indexResolved === true
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
    timeout: swiftSyntaxTimeoutMs,
    maxBuffer: 1024 * 1024 * 12,
    env: {
      ...process.env,
      CLANG_MODULE_CACHE_PATH: resolve(".swift-cache/clang-module-cache")
    }
  }).catch((error) => {
    if (error.killed || error.signal === "SIGTERM" || error.code === "ETIMEDOUT") {
      throw new Error(`timed out after ${Math.round(swiftSyntaxTimeoutMs / 1000)}s`);
    }
    throw error;
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
set chosenItem to choose file with prompt "Choose an .xcodeproj, project.pbxproj, or Swift file"
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

async function readClientId(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  if (chunks.length === 0) return null;

  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) return null;

  try {
    const body = JSON.parse(text);
    return typeof body?.clientId === "string" ? body.clientId : null;
  } catch {
    return text;
  }
}

function registerClient(clientId) {
  if (!clientId) return;
  activeClients.set(clientId, Date.now());
  if (shutdownTimer) {
    clearTimeout(shutdownTimer);
    shutdownTimer = null;
  }
  scheduleClientPrune();
}

function unregisterClient(clientId) {
  if (clientId) {
    activeClients.delete(clientId);
  }
  scheduleShutdownIfIdle();
}

function scheduleClientPrune() {
  if (pruneTimer) return;
  pruneTimer = setInterval(() => {
    const staleBefore = Date.now() - 45000;
    for (const [clientId, lastSeen] of activeClients) {
      if (lastSeen < staleBefore) {
        activeClients.delete(clientId);
      }
    }
    scheduleShutdownIfIdle();
  }, 15000);
  pruneTimer.unref?.();
}

function scheduleShutdownIfIdle() {
  if (activeClients.size > 0 || shutdownTimer) return;
  shutdownTimer = setTimeout(() => {
    if (activeClients.size > 0) return;
    console.log("Code Universe: web app closed, shutting down server.");
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1200).unref?.();
  }, 3500);
  shutdownTimer.unref?.();
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(payload));
}
