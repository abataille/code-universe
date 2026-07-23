import { createServer } from "node:http";
import { access, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { basename, extname, dirname, join, normalize, relative, resolve } from "node:path";
import { execFile, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
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
const sourceFileIndexCache = new Map();
const reviewDataRoot = process.env.CODE_UNIVERSE_DATA_ROOT
  ? resolve(process.env.CODE_UNIVERSE_DATA_ROOT)
  : join(process.cwd(), ".code-universe-data", "reviews");
const reviewCache = new Map();
const activeCodexRuns = new Map();
const reviewWriteQueues = new Map();
const reviewEventKinds = new Set(["inspect", "search", "suspect", "edit", "build", "test", "conclusion"]);

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

    if (url.pathname === "/api/health" && request.method === "GET") {
      sendJson(response, 200, { ok: true, port });
      return;
    }

    if (url.pathname === "/api/codex-settings" && request.method === "GET") {
      sendJson(response, 200, await codexSettings());
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

    if (url.pathname === "/api/reviews/start" && request.method === "POST") {
      const body = await readJsonBody(request);
      sendJson(response, 200, await startReview(body));
      return;
    }

    if (url.pathname === "/api/reviews/launch" && request.method === "POST") {
      const body = await readJsonBody(request);
      sendJson(response, 200, await launchCodexReview(body));
      return;
    }

    if (url.pathname === "/api/reviews/event" && request.method === "POST") {
      const body = await readJsonBody(request);
      sendJson(response, 200, await appendReviewEvent(body));
      return;
    }

    if (url.pathname === "/api/reviews/finish" && request.method === "POST") {
      const body = await readJsonBody(request);
      sendJson(response, 200, await finishReview(body));
      return;
    }

    if (url.pathname === "/api/reviews/active" && request.method === "GET") {
      sendJson(response, 200, { review: await findLatestReview(url.searchParams.get("sourceRoot")) });
      return;
    }

    if (url.pathname === "/api/reviews/import" && request.method === "POST") {
      const body = await readJsonBody(request);
      sendJson(response, 200, await importReview(body));
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
  sourceFileIndexCache.delete(resolve(projectRoot));
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
    evidence: edge.evidence || null,
    confidence: edge.confidence || null,
    inferred: edge.inferred === true,
    indexResolved: edge.indexResolved === true
  };
}

function nodeComparisonKey(node) {
  if (node.kind === "repository") return `${node.kind}:${node.name}`;
  if (node.kind === "file") return `${node.kind}:${node.file}`;
  if (node.kind === "module") return `${node.kind}:${node.name}`;
  return `${node.kind}:${node.file}:${node.name}:${node.line || 1}`;
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
  const { resolvedFile, relativeFile, targetLine } = await resolveSourceLocation(body);
  const source = await readFile(resolvedFile, "utf8");
  const lines = source.split(/\r?\n/);
  const clampedLine = Math.max(1, Math.min(lines.length, targetLine));
  const context = Math.max(4, Math.min(80, Number(body?.context || 12)));
  const fullFile = body?.fullFile === true;
  const startLine = fullFile ? 1 : Math.max(1, clampedLine - context);
  const endLine = fullFile ? lines.length : Math.min(lines.length, clampedLine + context);

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
  const { resolvedFile, relativeFile, targetLine } = await resolveSourceLocation(body);
  await execFileAsync("xed", ["--line", String(targetLine), resolvedFile]);
  return {
    opened: true,
    file: relativeFile,
    line: targetLine
  };
}

async function startReview(body) {
  const sourceRoot = await validatedReviewRoot(body?.sourceRoot);
  const now = new Date().toISOString();
  const existing = await findActiveReview(sourceRoot);
  if (existing) {
    activeCodexRuns.get(existing.id)?.kill("SIGTERM");
    activeCodexRuns.delete(existing.id);
    existing.status = "completed";
    existing.finishedAt = now;
    existing.updatedAt = now;
    await saveReview(existing);
  }
  const [beforeEvidence, baseline] = await Promise.all([
    captureGitEvidence(sourceRoot),
    captureGitReviewBaseline(sourceRoot)
  ]);
  const review = {
    version: 1,
    id: randomUUID(),
    title: cleanReviewText(body?.title, "Code review"),
    behavior: cleanReviewText(body?.behavior, ""),
    sourceRoot,
    status: "running",
    startedAt: now,
    updatedAt: now,
    finishedAt: null,
    events: [],
    codex: null,
    git: {
      before: beforeEvidence,
      after: null,
      baseline,
      diff: null
    }
  };
  await saveReview(review);
  return { review };
}

async function launchCodexReview(body) {
  const sourceRoot = await validatedReviewRoot(body?.sourceRoot);
  const mode = body?.mode === "fix" ? "fix" : "inspect";
  const defaults = await readCodexDefaults();
  const requestedModel = cleanCodexModel(body?.model);
  const requestedReasoningEffort = cleanReasoningEffort(body?.reasoningEffort);
  if (typeof body?.model === "string" && body.model.trim() && !requestedModel) {
    throw new Error("The selected Codex model contains unsupported characters.");
  }
  if (typeof body?.reasoningEffort === "string" && body.reasoningEffort.trim() && !requestedReasoningEffort) {
    throw new Error("The selected Codex reasoning effort is not supported.");
  }
  const effectiveModel = requestedModel || defaults.model;
  const effectiveReasoningEffort = requestedReasoningEffort || defaults.reasoningEffort;
  const codex = await resolveCodexCommand();
  const { review } = await startReview({
    ...body,
    sourceRoot,
    title: cleanReviewText(body?.title, "Codex behavior review")
  });
  review.codex = {
    status: "starting",
    mode,
    command: codex.displayName,
    model: effectiveModel,
    reasoningEffort: effectiveReasoningEffort,
    modelOverride: Boolean(requestedModel),
    reasoningOverride: Boolean(requestedReasoningEffort),
    threadId: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    exitCode: null,
    error: null,
    lastMessage: null,
    usage: emptyCodexUsage()
  };
  await saveReview(review);

  const prompt = codexReviewPrompt(review, mode);
  const args = [
    ...codex.argsPrefix,
    ...(requestedModel ? ["--model", requestedModel] : []),
    ...(requestedReasoningEffort ? ["--config", `model_reasoning_effort="${requestedReasoningEffort}"`] : []),
    "exec",
    "--json",
    "--ephemeral",
    "--sandbox",
    mode === "fix" ? "workspace-write" : "read-only",
    "--cd",
    sourceRoot,
    prompt
  ];
  const child = spawn(codex.command, args, {
    cwd: sourceRoot,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"]
  });
  activeCodexRuns.set(review.id, child);
  review.codex.status = "running";
  review.updatedAt = new Date().toISOString();
  await saveReview(review);

  const stdout = createInterface({ input: child.stdout });
  stdout.on("line", (line) => queueReviewUpdate(review.id, () => consumeCodexJsonLine(review.id, line)));
  let stderrTail = "";
  child.stderr.on("data", (chunk) => {
    stderrTail = `${stderrTail}${String(chunk)}`.slice(-4000);
  });
  child.on("error", (error) => {
    queueReviewUpdate(review.id, () => completeCodexReview(review.id, 1, error.message));
  });
  child.on("close", (exitCode) => {
    queueReviewUpdate(review.id, () => completeCodexReview(review.id, exitCode ?? 1, exitCode ? stderrTail.trim() : null));
  });

  return { review };
}

async function resolveCodexCommand() {
  const configured = process.env.CODE_UNIVERSE_CODEX_PATH;
  const candidates = [
    configured,
    "/Applications/ChatGPT.app/Contents/Resources/codex",
    "/Applications/Codex.app/Contents/Resources/codex"
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      await access(candidate, candidate.endsWith(".js") ? fsConstants.R_OK : fsConstants.X_OK);
      if (candidate.endsWith(".js")) {
        return { command: process.execPath, argsPrefix: [candidate], displayName: candidate };
      }
      return { command: candidate, argsPrefix: [], displayName: candidate };
    } catch {
      continue;
    }
  }

  try {
    const { stdout } = await execFileAsync("which", ["codex"]);
    const candidate = stdout.trim();
    if (candidate) return { command: candidate, argsPrefix: [], displayName: candidate };
  } catch {
    // Fall through to the actionable error below.
  }
  throw new Error("Codex CLI was not found. Install it or set CODE_UNIVERSE_CODEX_PATH.");
}

function codexReviewPrompt(review, mode) {
  const behavior = review.behavior || review.title;
  const action = mode === "fix"
    ? "Find the root cause, implement the smallest safe fix, and run focused verification."
    : "Investigate only. Do not modify source files. Find the most likely root cause and gather concrete evidence.";
  return [
    `Review this behavior: ${behavior}`,
    action,
    "Inspect the relevant source code instead of guessing.",
    "Run only focused, non-destructive commands and tests that help establish the behavior.",
    "In the final response, name the relevant Swift files and symbols, explain the evidence, and clearly separate confirmed facts from hypotheses."
  ].join("\n");
}

function queueReviewUpdate(reviewId, update) {
  const previous = reviewWriteQueues.get(reviewId) || Promise.resolve();
  const next = previous.catch(() => {}).then(update);
  reviewWriteQueues.set(reviewId, next);
  next.finally(() => {
    if (reviewWriteQueues.get(reviewId) === next) reviewWriteQueues.delete(reviewId);
  });
  return next;
}

async function consumeCodexJsonLine(reviewId, line) {
  let record;
  try {
    record = JSON.parse(line);
  } catch {
    return;
  }
  const review = await loadReview(reviewId);
  if (!review || review.status !== "running") return;

  if (record.type === "thread.started") {
    review.codex.threadId = record.thread_id || null;
    review.codex.model = cleanCodexModel(record.model || record.model_id) || review.codex.model;
    review.codex.reasoningEffort = cleanReasoningEffort(record.reasoning_effort || record.reasoningEffort) || review.codex.reasoningEffort;
    review.updatedAt = new Date().toISOString();
    await saveReview(review);
    return;
  }

  if (record.type === "turn.failed" || record.type === "error") {
    addCodexUsage(review, record.usage);
    review.codex.error = cleanReviewText(record.error?.message || record.message, "Codex review failed");
    review.codex.status = "failed";
    review.updatedAt = new Date().toISOString();
    await saveReview(review);
    return;
  }

  if (record.type === "turn.completed") {
    addCodexUsage(review, record.usage);
    review.updatedAt = new Date().toISOString();
    await saveReview(review);
    return;
  }

  if (record.type !== "item.completed" || !record.item) return;
  const item = record.item;
  if (item.type === "agent_message") {
    review.codex.lastMessage = cleanReviewResultText(item.text) || null;
    review.updatedAt = new Date().toISOString();
    await saveReview(review);
    return;
  }
  const events = reviewEventsFromCodexItem(item, review.sourceRoot);
  if (events.length === 0) return;
  appendNormalizedReviewEvents(review, events);
  await saveReview(review);
}

function reviewEventsFromCodexItem(item, sourceRoot) {
  const command = cleanReviewText(item.command, "");
  const failed = item.status === "failed" || Number(item.exit_code) > 0;
  const outcome = failed ? "failed" : "passed";

  if (["file_change", "file_changes"].includes(item.type)) {
    return swiftFilesInText(JSON.stringify(item), sourceRoot)
      .map((file) => ({ kind: "edit", outcome: "changed", file: file.file, line: file.line, summary: `Changed ${basename(file.file)}` }));
  }
  if (item.type !== "command_execution") return [];

  const kind = classifyCodexCommand(command);
  if (kind === "test" || kind === "build") {
    return [{ kind, outcome, summary: summarizeCodexCommand(command, kind, outcome), command }];
  }
  if (isSourceInventoryCommand(command)) {
    return [{ kind: "search", outcome: failed ? "failed" : "info", summary: "Indexed project source files", command }];
  }
  const files = swiftFilesInText(command, sourceRoot);
  if (kind === "edit") {
    return files.map((file) => ({ kind, outcome: "changed", file: file.file, line: file.line, summary: `Changed ${basename(file.file)}`, command }));
  }
  if (files.length > 0) {
    return files.map((file) => ({ kind, outcome: failed ? "failed" : "info", file: file.file, line: file.line, summary: `${kind === "search" ? "Searched" : "Inspected"} ${basename(file.file)}`, command }));
  }
  return [];
}

function classifyCodexCommand(command) {
  if (/\b(xcodebuild\b.*(?:^|\s)test(?:\s|$)|swift\s+test\b(?![^\n]*--help)|npm\s+(?:run\s+)?test\b|pytest\b|cargo\s+test\b)/i.test(command)) return "test";
  if (/\b(xcodebuild\b.*(?:^|\s)(?:build|archive)(?:\s|$)|swift\s+build\b(?![^\n]*--help)|npm\s+run\s+build\b|cargo\s+build\b)/i.test(command)) return "build";
  if (/\b(apply_patch|perl\s+-i|sed\s+-i)\b/i.test(command)) return "edit";
  if (/\b(rg|grep|find|fd|mdfind)\b/i.test(command)) return "search";
  return "inspect";
}

function isSourceInventoryCommand(command) {
  return /(?:rg\s+--files|find\b[^\n]*(?:-name|-path)[^\n]*\*\.swift)/i.test(command);
}

function summarizeCodexCommand(command, kind, outcome) {
  if (kind === "test") {
    if (/swift\s+test/i.test(command)) return `Swift package tests ${outcome}`;
    if (/xcodebuild\b.*\btest\b/i.test(command)) return `Xcode tests ${outcome}`;
    return `Tests ${outcome}`;
  }
  if (/swift\s+build/i.test(command)) return `Swift package build ${outcome}`;
  if (/xcodebuild/i.test(command)) return `Xcode build ${outcome}`;
  return `Build ${outcome}`;
}

function swiftFilesInText(text, sourceRoot) {
  const matches = [];
  const seen = new Set();
  const pattern = /((?:\/?[A-Za-z0-9_@+.-]+\/)*[A-Za-z0-9_@+.-]+\.swift)(?::(\d+))?/g;
  for (const match of String(text || "").matchAll(pattern)) {
    const file = normalizeTraceSourceFile(match[1], sourceRoot);
    const key = `${file}:${match[2] || ""}`;
    if (!file || seen.has(key)) continue;
    seen.add(key);
    matches.push({ file, line: match[2] ? Number(match[2]) : null });
    if (matches.length >= 8) break;
  }
  return matches;
}

function normalizeTraceSourceFile(candidate, sourceRoot) {
  const cleaned = String(candidate || "").trim().replace(/^['"`]+|['"`,]+$/g, "");
  if (!cleaned) return null;
  const resolvedRoot = resolve(sourceRoot);
  const resolvedFile = cleaned.startsWith("/") ? resolve(cleaned) : resolve(resolvedRoot, cleaned);
  const projectFile = relative(resolvedRoot, resolvedFile);
  if (!projectFile || projectFile.startsWith("..") || projectFile.startsWith("/")) return null;
  const normalizedFile = normalize(projectFile).replaceAll("\\", "/");
  if (/(^|\/)(?:\.build|build|DerivedData|\.git)(?:\/|$)/.test(normalizedFile)) return null;
  return normalizedFile;
}

function appendNormalizedReviewEvents(review, events) {
  events.forEach((event) => {
    const normalized = normalizeReviewEvent(event, review.events.length + 1);
    if (shouldAppendTraceEvent(review.events, normalized)) review.events.push(normalized);
  });
  review.updatedAt = new Date().toISOString();
}

function shouldAppendTraceEvent(existingEvents, candidate) {
  if (!["inspect", "search"].includes(candidate.kind)) return true;
  const lastMilestoneIndex = existingEvents.findLastIndex((event) => ["edit", "build", "test", "suspect", "conclusion"].includes(event.kind));
  const phaseEvents = existingEvents.slice(lastMilestoneIndex + 1);
  return !phaseEvents.some((event) => event.kind === candidate.kind && event.file === candidate.file && event.summary === candidate.summary);
}

function emptyCodexUsage() {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    uncachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    visibleOutputTokens: 0,
    totalTokens: 0,
    turns: 0
  };
}

function addCodexUsage(review, usage) {
  if (!usage || !review.codex) return;
  const totals = review.codex.usage || emptyCodexUsage();
  totals.inputTokens += numericUsage(usage.input_tokens ?? usage.inputTokens);
  totals.cachedInputTokens += numericUsage(usage.cached_input_tokens ?? usage.cachedInputTokens);
  totals.outputTokens += numericUsage(usage.output_tokens ?? usage.outputTokens);
  totals.reasoningOutputTokens += numericUsage(usage.reasoning_output_tokens ?? usage.reasoningOutputTokens);
  totals.uncachedInputTokens = Math.max(0, totals.inputTokens - totals.cachedInputTokens);
  totals.visibleOutputTokens = Math.max(0, totals.outputTokens - totals.reasoningOutputTokens);
  totals.totalTokens = totals.inputTokens + totals.outputTokens;
  totals.turns += 1;
  review.codex.usage = totals;
}

function numericUsage(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

async function completeCodexReview(reviewId, exitCode, explicitError = null) {
  const review = await loadReview(reviewId);
  if (!review || review.status !== "running") return;
  activeCodexRuns.delete(reviewId);
  const failed = exitCode !== 0 || review.codex?.status === "failed";
  const finalMessage = review.codex?.lastMessage;
  if (finalMessage) {
    const suspectedFiles = swiftFilesInText(finalMessage, review.sourceRoot);
    appendNormalizedReviewEvents(review, suspectedFiles.map((file) => ({
      kind: "suspect",
      file: file.file,
      line: file.line,
      summary: `Referenced in Codex conclusion: ${basename(file.file)}`
    })));
    appendNormalizedReviewEvents(review, [{
      kind: "conclusion",
      outcome: failed ? "failed" : "passed",
      summary: "Final review result"
    }]);
  } else {
    appendNormalizedReviewEvents(review, [{
      kind: "conclusion",
      outcome: failed ? "failed" : "passed",
      summary: explicitError || review.codex?.error || (failed ? "Codex review failed" : "Codex review completed")
    }]);
  }
  const now = new Date().toISOString();
  review.status = failed ? "failed" : "completed";
  review.finishedAt = now;
  review.updatedAt = now;
  review.codex.status = failed ? "failed" : "completed";
  review.codex.finishedAt = now;
  review.codex.exitCode = exitCode;
  review.codex.error = explicitError || review.codex.error;
  review.git.after = await captureGitEvidence(review.sourceRoot);
  review.git.diff = await captureReviewGitDiff(review.sourceRoot, reviewDiffBaseline(review));
  await saveReview(review);
  scheduleShutdownIfIdle();
}

async function appendReviewEvent(body) {
  const review = await resolveRequestedReview(body);
  if (!review) throw new Error("No active Code Universe review found.");
  if (review.status !== "running") throw new Error("This review is already finished.");
  const event = normalizeReviewEvent(body?.event || body, review.events.length + 1);
  review.events.push(event);
  review.updatedAt = event.at;
  await saveReview(review);
  return { review, event };
}

async function finishReview(body) {
  const review = await resolveRequestedReview(body);
  if (!review) throw new Error("No active Code Universe review found.");
  const now = new Date().toISOString();
  if (body?.summary) {
    review.events.push(normalizeReviewEvent({ kind: "conclusion", summary: body.summary, outcome: body.outcome }, review.events.length + 1));
  }
  review.status = body?.outcome === "failed" ? "failed" : "completed";
  review.finishedAt = now;
  review.updatedAt = now;
  review.git.after = await captureGitEvidence(review.sourceRoot);
  review.git.diff = await captureReviewGitDiff(review.sourceRoot, reviewDiffBaseline(review));
  await saveReview(review);
  return { review };
}

async function importReview(body) {
  const candidate = body?.review || body;
  if (!candidate || !Array.isArray(candidate.events)) throw new Error("Review import must contain an events array.");
  const sourceRoot = await validatedReviewRoot(body?.sourceRoot || candidate.sourceRoot);
  const now = new Date().toISOString();
  const review = {
    version: 1,
    id: typeof candidate.id === "string" && /^[a-zA-Z0-9-]+$/.test(candidate.id) ? candidate.id : randomUUID(),
    title: cleanReviewText(candidate.title, "Imported review"),
    behavior: cleanReviewText(candidate.behavior, ""),
    sourceRoot,
    status: candidate.status === "running" ? "running" : candidate.status === "failed" ? "failed" : "completed",
    startedAt: candidate.startedAt || now,
    updatedAt: candidate.updatedAt || now,
    finishedAt: candidate.finishedAt || (candidate.status === "running" ? null : now),
    events: candidate.events.map((event, index) => normalizeReviewEvent(event, index + 1)),
    codex: candidate.codex || null,
    git: candidate.git || { before: null, after: null }
  };
  await saveReview(review);
  return { review };
}

function normalizeReviewEvent(candidate, sequence) {
  const kind = reviewEventKinds.has(candidate?.kind) ? candidate.kind : "inspect";
  const outcome = ["passed", "failed", "changed", "info"].includes(candidate?.outcome) ? candidate.outcome : null;
  const line = Number(candidate?.line);
  return {
    id: typeof candidate?.id === "string" && candidate.id ? candidate.id : randomUUID(),
    sequence,
    at: candidate?.at || new Date().toISOString(),
    kind,
    outcome,
    file: cleanReviewText(candidate?.file, "") || null,
    line: Number.isFinite(line) && line > 0 ? Math.floor(line) : null,
    nodeId: cleanReviewText(candidate?.nodeId, "") || null,
    summary: cleanReviewText(candidate?.summary, friendlyReviewEvent(kind)),
    command: cleanReviewText(candidate?.command, "") || null,
    durationMs: Number.isFinite(Number(candidate?.durationMs)) ? Math.max(0, Number(candidate.durationMs)) : null
  };
}

function friendlyReviewEvent(kind) {
  if (kind === "suspect") return "Possible cause identified";
  if (kind === "edit") return "Source changed";
  if (kind === "test") return "Test executed";
  if (kind === "build") return "Build executed";
  if (kind === "search") return "Source searched";
  if (kind === "conclusion") return "Review concluded";
  return "Source inspected";
}

async function validatedReviewRoot(sourceRoot) {
  if (!sourceRoot || typeof sourceRoot !== "string") throw new Error("A sourceRoot is required for a review.");
  const resolvedRoot = resolve(sourceRoot);
  if (!(await stat(resolvedRoot)).isDirectory()) throw new Error("Review sourceRoot must be a directory.");
  return resolvedRoot;
}

async function resolveRequestedReview(body) {
  if (body?.reviewId) return loadReview(body.reviewId);
  return findActiveReview(body?.sourceRoot);
}

async function findActiveReview(sourceRoot) {
  return findLatestReview(sourceRoot, "running");
}

async function findLatestReview(sourceRoot, requiredStatus = null) {
  const normalizedRoot = sourceRoot ? resolve(sourceRoot) : null;
  const files = await reviewFiles();
  let latest = null;
  for (const file of files) {
    const review = await loadReview(file.slice(0, -5));
    if (!review || (requiredStatus && review.status !== requiredStatus)) continue;
    if (normalizedRoot && resolve(review.sourceRoot) !== normalizedRoot) continue;
    if (!latest || review.updatedAt > latest.updatedAt) latest = review;
  }
  if (latest) await backfillReviewGitDiff(latest);
  return latest;
}

async function backfillReviewGitDiff(review) {
  if (review.status === "running" || review.git?.diff || !reviewDiffBaseline(review)) return;
  const current = await captureGitEvidence(review.sourceRoot);
  const fullEvidenceMatch = gitEvidenceMatches(current, review.git?.after);
  const matchingReviewFiles = fullEvidenceMatch ? null : matchingReviewEditFiles(review, current, review.git?.after);
  if (!fullEvidenceMatch && matchingReviewFiles.size === 0) return;
  const diff = await captureReviewGitDiff(review.sourceRoot, reviewDiffBaseline(review));
  if (!diff) return;
  if (matchingReviewFiles) {
    diff.files = diff.files.filter((file) => matchingReviewFiles.has(normalize(file.file).replaceAll("\\", "/")));
    if (diff.files.length === 0) return;
  }
  review.git.diff = diff;
  review.updatedAt = new Date().toISOString();
  await saveReview(review);
}

function reviewDiffBaseline(review) {
  if (review.git?.baseline?.commit) return review.git.baseline;
  if (review.git?.before?.commit && (review.git.before.status || []).length === 0) {
    return { commit: review.git.before.commit, untrackedFiles: [] };
  }
  return null;
}

function gitEvidenceMatches(left, right) {
  if (!left || !right || left.commit !== right.commit) return false;
  return JSON.stringify(left.status || []) === JSON.stringify(right.status || [])
    && JSON.stringify(left.changes || []) === JSON.stringify(right.changes || []);
}

function matchingReviewEditFiles(review, current, recordedAfter) {
  const matches = new Set();
  if (!current || !recordedAfter || current.commit !== recordedAfter.commit) return matches;
  const editedFiles = new Set(review.events
    .filter((event) => event.kind === "edit" && event.file)
    .map((event) => normalize(event.file).replaceAll("\\", "/")));
  const currentChanges = new Map((current.changes || []).map((change) => [normalize(change.file).replaceAll("\\", "/"), change]));
  const recordedChanges = new Map((recordedAfter.changes || []).map((change) => [normalize(change.file).replaceAll("\\", "/"), change]));
  for (const file of editedFiles) {
    const currentChange = currentChanges.get(file);
    const recordedChange = recordedChanges.get(file);
    if (!currentChange || !recordedChange) continue;
    if (currentChange.added === recordedChange.added && currentChange.deleted === recordedChange.deleted) matches.add(file);
  }
  return matches;
}

async function reviewFiles() {
  await mkdir(reviewDataRoot, { recursive: true });
  return (await readdir(reviewDataRoot)).filter((file) => file.endsWith(".json"));
}

async function loadReview(reviewId) {
  if (!reviewId || typeof reviewId !== "string" || !/^[a-zA-Z0-9-]+$/.test(reviewId)) return null;
  if (reviewCache.has(reviewId)) return reviewCache.get(reviewId);
  try {
    const review = JSON.parse(await readFile(join(reviewDataRoot, `${reviewId}.json`), "utf8"));
    reviewCache.set(reviewId, review);
    return review;
  } catch {
    return null;
  }
}

async function saveReview(review) {
  await mkdir(reviewDataRoot, { recursive: true });
  reviewCache.set(review.id, review);
  await writeFile(join(reviewDataRoot, `${review.id}.json`), `${JSON.stringify(review, null, 2)}\n`, "utf8");
}

async function captureGitEvidence(sourceRoot) {
  try {
    const [{ stdout: commit }, { stdout: status }, { stdout: numstat }] = await Promise.all([
      execFileAsync("git", ["rev-parse", "HEAD"], { cwd: sourceRoot }),
      execFileAsync("git", ["status", "--short"], { cwd: sourceRoot }),
      execFileAsync("git", ["diff", "--numstat"], { cwd: sourceRoot })
    ]);
    return {
      commit: commit.trim(),
      status: status.trim().split("\n").filter(Boolean),
      changes: numstat.trim().split("\n").filter(Boolean).map((line) => {
        const [added, deleted, ...fileParts] = line.split("\t");
        return { file: fileParts.join("\t"), added: Number(added) || 0, deleted: Number(deleted) || 0 };
      })
    };
  } catch {
    return null;
  }
}

async function codexSettings() {
  const defaults = await readCodexDefaults();
  return {
    defaults,
    models: [...new Set([
      defaults.model,
      "gpt-5.6-sol",
      "gpt-5.6",
      "gpt-5.6-terra",
      "gpt-5.4",
      "gpt-5.3-codex-spark"
    ].filter(Boolean))],
    reasoningEfforts: ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"]
  };
}

async function readCodexDefaults() {
  const configRoot = process.env.CODEX_HOME ? resolve(process.env.CODEX_HOME) : join(homedir(), ".codex");
  try {
    const config = await readFile(join(configRoot, "config.toml"), "utf8");
    return {
      model: tomlStringSetting(config, "model"),
      reasoningEffort: cleanReasoningEffort(tomlStringSetting(config, "model_reasoning_effort"))
    };
  } catch {
    return { model: null, reasoningEffort: null };
  }
}

function tomlStringSetting(config, key) {
  const match = String(config || "").match(new RegExp(`^\\s*${key}\\s*=\\s*["']([^"']+)["']\\s*$`, "m"));
  return match?.[1]?.trim() || null;
}

function cleanCodexModel(value) {
  if (typeof value !== "string") return null;
  const model = value.trim();
  return model && model.length <= 100 && /^[A-Za-z0-9._:/-]+$/.test(model) ? model : null;
}

function cleanReasoningEffort(value) {
  const effort = typeof value === "string" ? value.trim().toLowerCase() : "";
  return ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"].includes(effort) ? effort : null;
}

async function captureGitReviewBaseline(sourceRoot) {
  try {
    const [{ stdout: stashCommit }, { stdout: headCommit }, { stdout: untracked }] = await Promise.all([
      execFileAsync("git", ["stash", "create", "code-universe-review-baseline"], { cwd: sourceRoot }),
      execFileAsync("git", ["rev-parse", "HEAD"], { cwd: sourceRoot }),
      execFileAsync("git", ["ls-files", "--others", "--exclude-standard"], { cwd: sourceRoot })
    ]);
    return {
      commit: stashCommit.trim() || headCommit.trim(),
      untrackedFiles: untracked.trim().split("\n").filter(Boolean)
    };
  } catch {
    return null;
  }
}

async function captureReviewGitDiff(sourceRoot, baseline) {
  if (!baseline?.commit) return null;
  try {
    const { stdout } = await execFileAsync("git", ["diff", "--no-ext-diff", "--no-color", "--unified=3", baseline.commit, "--"], {
      cwd: sourceRoot,
      maxBuffer: 1024 * 1024 * 4
    });
    const untrackedPatch = await patchesForNewUntrackedFiles(sourceRoot, new Set(baseline.untrackedFiles || []));
    const completePatch = [stdout.trimEnd(), untrackedPatch].filter(Boolean).join("\n");
    const maxPatchLength = 500_000;
    const truncated = completePatch.length > maxPatchLength;
    const patch = truncated ? completePatch.slice(0, maxPatchLength) : completePatch;
    return {
      truncated,
      files: splitReviewGitPatch(patch)
    };
  } catch {
    return null;
  }
}

async function patchesForNewUntrackedFiles(sourceRoot, untrackedBefore) {
  const { stdout } = await execFileAsync("git", ["ls-files", "--others", "--exclude-standard"], { cwd: sourceRoot });
  const newFiles = stdout.trim().split("\n")
    .filter((file) => file && !untrackedBefore.has(file) && file.endsWith(".swift"))
    .slice(0, 30);
  const patches = [];
  for (const file of newFiles) {
    const resolvedFile = resolve(sourceRoot, file);
    if (!isInsideRoot(sourceRoot, resolvedFile)) continue;
    try {
      const source = await readFile(resolvedFile, "utf8");
      const lines = source.split(/\r?\n/);
      patches.push([
        `diff --git a/${file} b/${file}`,
        "new file mode 100644",
        "--- /dev/null",
        `+++ b/${file}`,
        `@@ -0,0 +1,${lines.length} @@`,
        ...lines.map((line) => `+${line}`)
      ].join("\n"));
    } catch {
      continue;
    }
  }
  return patches.join("\n");
}

function splitReviewGitPatch(patch) {
  if (!patch) return [];
  return patch.split(/(?=^diff --git )/m).filter(Boolean).map((section) => {
    const lines = section.split("\n");
    const destination = lines.find((line) => line.startsWith("+++ b/"))?.slice(6);
    const source = lines.find((line) => line.startsWith("--- a/"))?.slice(6);
    const file = cleanGitPatchPath(destination || source || "Unknown file");
    const added = lines.filter((line) => line.startsWith("+") && !line.startsWith("+++")).length;
    const deleted = lines.filter((line) => line.startsWith("-") && !line.startsWith("---")).length;
    return { file, added, deleted, patch: section.trimEnd() };
  });
}

function cleanGitPatchPath(path) {
  return String(path || "").replace(/^"|"$/g, "").replaceAll("\\", "/");
}

function cleanReviewText(value, fallback) {
  if (typeof value !== "string") return fallback;
  const text = value.trim();
  return text ? text.slice(0, 2000) : fallback;
}

function cleanReviewResultText(value) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, 50_000);
}

async function resolveSourceLocation(body) {
  const sourceRoot = body?.sourceRoot;
  const file = body?.file;
  const line = Number(body?.line || 1);

  if (!sourceRoot || !file || typeof sourceRoot !== "string" || typeof file !== "string") {
    throw new Error("Missing source location.");
  }

  const resolvedRoot = resolve(sourceRoot);
  const resolvedFile = await resolveSourceFile(resolvedRoot, file);
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

async function resolveSourceFile(resolvedRoot, file) {
  const directFile = resolve(resolvedRoot, file);
  if (isInsideRoot(resolvedRoot, directFile) && await isReadableFile(directFile)) {
    return directFile;
  }

  const sourceFiles = await swiftFileIndexForRoot(resolvedRoot);
  const normalizedFile = normalize(file);
  const suffixMatches = sourceFiles.filter((candidate) => {
    const candidateRelative = normalize(relative(resolvedRoot, candidate));
    return candidateRelative === normalizedFile || candidateRelative.endsWith(`${normalize("/")}${normalizedFile}`);
  });
  if (suffixMatches.length === 1) return suffixMatches[0];

  const basenameMatches = sourceFiles.filter((candidate) => basename(candidate) === basename(file));
  if (basenameMatches.length === 1) return basenameMatches[0];

  if (basenameMatches.length > 1) {
    const choices = basenameMatches
      .slice(0, 6)
      .map((candidate) => relative(resolvedRoot, candidate))
      .join(", ");
    throw new Error(`Multiple Swift files named ${basename(file)}. Matching files: ${choices}${basenameMatches.length > 6 ? ", ..." : ""}`);
  }

  throw new Error(`Source file not found: ${file}`);
}

async function swiftFileIndexForRoot(resolvedRoot) {
  const cached = sourceFileIndexCache.get(resolvedRoot);
  if (cached) return cached;
  const files = await listSwiftSourceFiles(resolvedRoot);
  sourceFileIndexCache.set(resolvedRoot, files);
  return files;
}

async function listSwiftSourceFiles(directory) {
  let entries = [];
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];

  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === "DerivedData" || entry.name === "build") continue;
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listSwiftSourceFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".swift")) {
      files.push(fullPath);
    }
  }

  return files;
}

async function isReadableFile(path) {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

function isInsideRoot(rootPath, filePath) {
  const relativeFile = relative(rootPath, filePath);
  return Boolean(relativeFile) && !relativeFile.startsWith("..") && !relativeFile.startsWith("/");
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
  if (activeClients.size > 0 || activeCodexRuns.size > 0 || shutdownTimer) return;
  shutdownTimer = setTimeout(() => {
    if (activeClients.size > 0 || activeCodexRuns.size > 0) return;
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
