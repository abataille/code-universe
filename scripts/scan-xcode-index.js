import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { homedir } from "node:os";

const printablePattern = /[\x20-\x7E]{4,}/g;
const swiftRecordPattern = /[A-Za-z0-9_+.-]+\.swift-[A-Z0-9]+/g;
const maxStoresToScore = 10;
const maxUnitsPerStoreScore = 220;
const maxUnitsForProject = 900;
const maxRecordsToIndex = 1200;
const maxRecordBytes = 1_500_000;

export async function enrichGraphWithXcodeIndex(graph, projectRoot) {
  const resolvedRoot = resolve(projectRoot);
  const dataStores = await findCandidateDataStores(resolvedRoot);

  if (dataStores.length === 0) {
    return {
      graph,
      diagnostics: {
        xcodeIndexAvailable: false,
        xcodeIndexMessage: "No matching Xcode index store found. Build the project in Xcode once, then scan again.",
        xcodeIndexEdges: 0,
        xcodeIndexRecords: 0
      }
    };
  }

  const dataStore = dataStores[0];
  const recordFiles = await indexRecordFiles(dataStore.path);
  const indexedRecords = await recordsForProject(dataStore.path, recordFiles, resolvedRoot, graph);
  const enrichedGraph = addIndexEdges(graph, indexedRecords);
  const xcodeIndexEdges = enrichedGraph.edges.filter((edge) => edge.source === "xcode-index").length;

  return {
    graph: enrichedGraph,
    diagnostics: {
      xcodeIndexAvailable: true,
      xcodeIndexStore: dataStore.path,
      xcodeIndexStoreScore: dataStore.score,
      xcodeIndexEdges,
      xcodeIndexRecords: indexedRecords.length
    }
  };
}

async function findCandidateDataStores(projectRoot) {
  const derivedDataRoot = process.env.CODE_UNIVERSE_DERIVED_DATA
    ? resolve(process.env.CODE_UNIVERSE_DERIVED_DATA)
    : join(homedir(), "Library/Developer/Xcode/DerivedData");
  const projectName = basename(projectRoot).toLowerCase();
  const entries = (await safeReaddir(derivedDataRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => {
      const leftMatch = left.name.toLowerCase().includes(projectName) ? 0 : 1;
      const rightMatch = right.name.toLowerCase().includes(projectName) ? 0 : 1;
      return leftMatch - rightMatch || left.name.localeCompare(right.name);
    })
    .slice(0, maxStoresToScore);
  const candidates = [];

  for (const entry of entries) {
    const dataStore = join(derivedDataRoot, entry.name, "Index.noindex/DataStore");
    if (!await exists(dataStore)) continue;
    const score = await scoreDataStore(dataStore, projectRoot);
    if (score > 0) {
      candidates.push({ path: dataStore, score });
    }
  }

  return candidates.sort((left, right) => right.score - left.score);
}

async function scoreDataStore(dataStore, projectRoot) {
  const unitsDir = await latestVersionDirectory(dataStore, "units");
  if (!unitsDir) return 0;

  const projectName = basename(projectRoot);
  const unitFiles = await listFiles(unitsDir, 1);
  let score = 0;

  for (const unitFile of unitFiles.slice(0, maxUnitsPerStoreScore)) {
    const text = await readPrintableText(unitFile);
    if (text.includes(projectRoot)) score += 8;
    if (text.includes(projectName)) score += 1;
  }

  return score;
}

async function recordsForProject(dataStore, recordFiles, projectRoot, graph) {
  const unitsDir = await latestVersionDirectory(dataStore, "units");
  if (!unitsDir) return [];

  const graphFiles = new Map(graph.nodes
    .filter((node) => node.kind === "file" && node.file)
    .map((node) => [node.file, node]));
  const fileBasenames = new Map([...graphFiles.keys()].map((file) => [basename(file), file]));
  const unitFiles = (await listFiles(unitsDir, 1)).slice(0, maxUnitsForProject);
  const records = new Map();

  for (const unitFile of unitFiles) {
    const text = await readPrintableText(unitFile);
    if (!text.includes(projectRoot) && !matchesAnyGraphFile(text, graphFiles, fileBasenames)) {
      continue;
    }

    const recordNames = text.match(swiftRecordPattern) || [];
    for (const recordName of recordNames) {
      const recordPath = recordFiles.get(recordName);
      if (!recordPath) continue;
      const graphFile = resolveGraphFileForRecord(recordName, graphFiles, fileBasenames);
      if (!graphFile) continue;
      records.set(recordPath, { path: recordPath, file: graphFile });
      if (records.size >= maxRecordsToIndex) break;
    }
    if (records.size >= maxRecordsToIndex) break;
  }

  const indexedRecords = [];
  for (const record of records.values()) {
    indexedRecords.push({
      ...record,
      symbols: symbolsInRecord(await readPrintableText(record.path), graph)
    });
  }

  return indexedRecords;
}

function addIndexEdges(graph, indexedRecords) {
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const typeNodes = graph.nodes.filter((node) => node.id.startsWith("type:"));
  const typesByFile = groupBy(typeNodes, (node) => node.file);
  const knownEdges = new Set(graph.edges.map(edgeKey));
  const edges = [...graph.edges];

  for (const record of indexedRecords) {
    const sourceTypes = typesByFile.get(record.file) || [];
    for (const sourceType of sourceTypes) {
      for (const targetId of record.symbols) {
        if (targetId === sourceType.id || !nodesById.has(targetId)) continue;
        const edge = {
          from: sourceType.id,
          to: targetId,
          kind: "uses",
          source: "xcode-index",
          confidence: 0.82,
          inferred: false,
          indexResolved: true,
          evidence: "file-level",
          file: record.file
        };
        const key = edgeKey(edge);
        if (knownEdges.has(key)) continue;
        knownEdges.add(key);
        edges.push(edge);
      }
    }
  }

  return {
    ...graph,
    project: {
      ...graph.project,
      scanner: "xcode-index"
    },
    edges: edges.sort((left, right) => edgeKey(left).localeCompare(edgeKey(right)))
  };
}

function symbolsInRecord(text, graph) {
  const typeNodes = graph.nodes.filter((node) => node.id.startsWith("type:"));
  const symbols = new Set();

  for (const node of typeNodes) {
    if (containsSwiftSymbol(text, node.name)) {
      symbols.add(node.id);
    }
  }

  return symbols;
}

function containsSwiftSymbol(text, symbolName) {
  const escaped = escapeRegExp(symbolName);
  return new RegExp(`\\b${escaped}\\b`).test(text)
    || new RegExp(`\\d+${escaped}[CVOP]`).test(text);
}

function matchesAnyGraphFile(text, graphFiles, fileBasenames) {
  for (const file of graphFiles.keys()) {
    if (text.includes(file)) return true;
  }
  for (const fileName of fileBasenames.keys()) {
    if (text.includes(fileName)) return true;
  }
  return false;
}

function resolveGraphFileForRecord(recordName, graphFiles, fileBasenames) {
  const swiftFileName = recordName.replace(/-[A-Z0-9]+$/, "");
  if (graphFiles.has(swiftFileName)) return swiftFileName;
  return fileBasenames.get(swiftFileName) || null;
}

async function indexRecordFiles(dataStore) {
  const recordsDir = await latestVersionDirectory(dataStore, "records");
  const records = new Map();
  if (!recordsDir) return records;

  for (const file of (await listFiles(recordsDir, 2)).slice(0, maxRecordsToIndex * 4)) {
    records.set(basename(file), file);
  }

  return records;
}

async function latestVersionDirectory(dataStore, childName) {
  const entries = await safeReaddir(dataStore, { withFileTypes: true });
  const versions = entries
    .filter((entry) => entry.isDirectory() && /^v\d+$/.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => Number(right.slice(1)) - Number(left.slice(1)));

  for (const version of versions) {
    const directory = join(dataStore, version, childName);
    if (await exists(directory)) return directory;
  }

  return null;
}

async function listFiles(root, maxDepth = Infinity, depth = 0) {
  const entries = await safeReaddir(root, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = join(root, entry.name);
    if (entry.isDirectory() && depth < maxDepth) {
      files.push(...await listFiles(fullPath, maxDepth, depth + 1));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }

  return files.sort((left, right) => left.localeCompare(right));
}

async function readPrintableText(file) {
  const buffer = (await readFile(file)).subarray(0, maxRecordBytes);
  return (buffer.toString("utf8").match(printablePattern) || []).join("\n");
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function safeReaddir(path, options) {
  try {
    return await readdir(path, options);
  } catch {
    return [];
  }
}

function groupBy(items, keyForItem) {
  const groups = new Map();
  for (const item of items) {
    const key = keyForItem(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return groups;
}

function edgeKey(edge) {
  return `${edge.kind}:${edge.from}->${edge.to}`;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
