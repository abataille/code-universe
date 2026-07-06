import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

const excludedDirectoryNames = new Set([
  ".build",
  ".git",
  "DerivedData",
  "build",
  "Build",
  "Pods",
  "Carthage",
  ".swiftpm",
  "SourcePackages",
  "Generated",
  "generated"
]);

const declarationPattern = /^\s*(?:(?:public|private|fileprivate|internal|open|final)\s+)*(struct|class|enum|protocol)\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s*:\s*([^{]+))?/;
const functionPattern = /^\s*(?:(?:public|private|fileprivate|internal|open|static|mutating|nonisolated)\s+)*func\s+([A-Za-z_][A-Za-z0-9_]*)/;
const propertyPattern = /^\s*(?:@[A-Za-z][A-Za-z0-9_]*(?:\([^)]*\))?\s+)*(?:(?:public|private|fileprivate|internal|open|static)\s+)*(?:let|var)\s+([A-Za-z_][A-Za-z0-9_]*)/;
const importPattern = /^\s*import\s+([A-Za-z_][A-Za-z0-9_]*)/;

export async function scanSwiftFolder(inputRoot) {
  const files = await listSwiftFiles(inputRoot);
  const nodes = new Map();
  const edges = [];
  const typeNames = new Set();
  const declarations = [];
  const functions = [];
  const properties = [];
  const typeIdsByName = new Map();
  const pendingConformances = [];

  addNode(nodes, {
    id: "repo:root",
    kind: "repository",
    name: basename(inputRoot),
    file: "",
    line: 1,
    metrics: {}
  });

  for (const file of files) {
    const source = await readFile(file, "utf8");
    const code = stripSwiftComments(source);
    const fileName = relative(inputRoot, file);
    const fileId = `file:${fileName}`;
    const lines = source.split(/\r?\n/);
    const codeLines = code.split(/\r?\n/);

    addNode(nodes, {
      id: fileId,
      kind: "file",
      name: fileName,
      file: fileName,
      line: 1,
      metrics: { lines: lines.length }
    });
    addEdge(edges, "repo:root", fileId, "contains");

    const imports = [];
    let currentType = null;

    codeLines.forEach((line, index) => {
      const lineNumber = index + 1;
      const importMatch = line.match(importPattern);
      if (importMatch) imports.push(importMatch[1]);

      const declarationMatch = line.match(declarationPattern);
      if (declarationMatch) {
        const [, declarationKind, name, inheritance = ""] = declarationMatch;
        const nodeKind = classifyType(declarationKind, name, inheritance, code);
        const declarationSource = extractDeclarationBody(codeLines, index);
        const typeId = typeNodeId(fileName, name);
        const node = {
          id: typeId,
          kind: nodeKind,
          declarationKind,
          name,
          file: fileName,
          line: lineNumber,
          metrics: { lines: countSourceLines(declarationSource), methods: 0, properties: 0 }
        };

        addNode(nodes, node);
        addEdge(edges, fileId, node.id, "defines");
        typeNames.add(name);
        addTypeId(typeIdsByName, name, node.id);
        declarations.push({ ...node, inheritance, source: declarationSource });
        currentType = nodes.get(node.id);

        inheritance
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
          .forEach((conformance) => {
            pendingConformances.push({ from: node.id, name: conformance });
          });
        return;
      }

      const functionMatch = line.match(functionPattern);
      if (functionMatch && currentType) {
        const name = functionMatch[1];
        const functionId = memberNodeId("function", currentType.file, currentType.name, name, lineNumber);
        const source = extractFunctionBody(codeLines, index);
        addNode(nodes, {
          id: functionId,
          kind: "function",
          name,
          file: fileName,
          line: lineNumber,
          metrics: metricsForFunctionSource(source)
        });
        addEdge(edges, currentType.id, functionId, "defines");
        currentType.metrics.methods += 1;
        functions.push({
          id: functionId,
          parentTypeName: currentType.name,
          source
        });
        return;
      }

      const propertyMatch = line.match(propertyPattern);
      if (propertyMatch && currentType) {
        const name = propertyMatch[1];
        const propertyId = memberNodeId("property", currentType.file, currentType.name, name, lineNumber);
        addNode(nodes, {
          id: propertyId,
          kind: "property",
          name,
          file: fileName,
          line: lineNumber,
          metrics: {}
        });
        addEdge(edges, currentType.id, propertyId, "defines");
        currentType.metrics.properties += 1;
        properties.push({
          id: propertyId,
          parentTypeName: currentType.name,
          name
        });

        if (line.includes("@State") || line.includes("@Environment") || line.includes("@Observable") || line.includes("@Binding")) {
          addEdge(edges, currentType.id, propertyId, "owns_state");
        }
      }
    });

    imports.forEach((importedModule) => {
      const importId = `module:${importedModule}`;
      addNode(nodes, {
        id: importId,
        kind: "module",
        name: importedModule,
        file: "",
        line: 1,
        metrics: {}
      });
      addEdge(edges, fileId, importId, "imports");
    });
  }

  for (const declaration of declarations) {
    for (const typeName of typeNames) {
      if (typeName === declaration.name) continue;
      if (referencesType(declaration.source, typeName)) {
        resolveTypeIds(typeIdsByName, typeName, declaration.id)
          .forEach((typeId) => addEdge(edges, declaration.id, typeId, "uses"));
      }
    }
  }

  for (const functionNode of functions) {
    for (const typeName of typeNames) {
      if (typeName === functionNode.parentTypeName) continue;
      if (referencesType(functionNode.source, typeName)) {
        resolveTypeIds(typeIdsByName, typeName, functionNode.id)
          .forEach((typeId) => addEdge(edges, functionNode.id, typeId, "uses"));
      }
    }
  }

  for (const conformance of pendingConformances) {
    resolveTypeIds(typeIdsByName, conformance.name, conformance.from, externalTypeId(conformance.name))
      .forEach((typeId) => addEdge(edges, conformance.from, typeId, "conforms_to"));
  }

  for (const edge of edges) {
    if (edge.kind === "conforms_to" && !nodes.has(edge.to) && edge.to.startsWith("type:external:")) {
      const protocolName = edge.to.slice("type:external:".length);
      addNode(nodes, {
        id: edge.to,
        kind: "protocol",
        declarationKind: "protocol",
        name: protocolName,
        file: "",
        line: 1,
        metrics: {}
      });
    }
  }

  for (const functionNode of functions) {
    for (const property of properties) {
      if (property.parentTypeName !== functionNode.parentTypeName) continue;
      if (referencesMember(functionNode.source, property.name)) {
        addEdge(edges, functionNode.id, property.id, "uses_member");
      }
    }
  }

  return {
    graph: {
      schemaVersion: 1,
      project: {
        name: basename(inputRoot),
        scannedAt: new Date().toISOString(),
        sourceRoot: inputRoot
      },
      nodes: [...nodes.values()],
      edges: uniqueEdges(edges)
    },
    diagnostics: {
      swiftFileCount: files.length,
      typeCount: [...nodes.values()].filter((node) => node.id.startsWith("type:")).length,
      functionCount: [...nodes.values()].filter((node) => node.kind === "function").length,
      propertyCount: [...nodes.values()].filter((node) => node.kind === "property").length
    }
  };
}

async function listSwiftFiles(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const results = [];

  for (const entry of entries) {
    if (entry.isDirectory() && shouldSkipDirectory(entry.name)) continue;
    const fullPath = join(root, entry.name);
    if (entry.isDirectory()) {
      results.push(...await listSwiftFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".swift")) {
      results.push(fullPath);
    }
  }

  return results.sort((left, right) => left.localeCompare(right));
}

function shouldSkipDirectory(name) {
  return excludedDirectoryNames.has(name) || name.endsWith(".xcodeproj") || name.endsWith(".xcworkspace");
}

function classifyType(declarationKind, name, inheritance, source) {
  if (inheritance.split(",").map((item) => item.trim()).includes("View")) return "swiftui_view";
  if (declarationKind === "class") return "class";
  if (name.endsWith("Service") || name.endsWith("Store")) return "service";
  if (source.includes(`${name}(`) && /let\s+\w+:\s*String|var\s+\w+:\s*String|Identifiable/.test(source)) return "model";
  return declarationKind;
}

function referencesType(source, typeName) {
  return source.includes(`${typeName}(`)
    || source.includes(`${typeName}.`)
    || source.includes(`: ${typeName}`)
    || source.includes(`[${typeName}]`)
    || source.includes(`<${typeName}>`);
}

function referencesMember(source, memberName) {
  return new RegExp(`\\b${memberName}\\b`).test(source);
}

function typeNodeId(fileName, name) {
  return `type:${fileName}:${name}`;
}

function memberNodeId(kind, fileName, typeName, name, lineNumber) {
  return `${kind}:${fileName}:${typeName}.${name}:${lineNumber}`;
}

function externalTypeId(name) {
  return `type:external:${name}`;
}

function addTypeId(typeIdsByName, name, id) {
  if (!typeIdsByName.has(name)) typeIdsByName.set(name, []);
  typeIdsByName.get(name).push(id);
}

function resolveTypeIds(typeIdsByName, name, sourceId, fallbackId = null) {
  const ids = typeIdsByName.get(name) || [];
  const resolved = ids.filter((id) => id !== sourceId);
  if (resolved.length > 0) return resolved;
  return fallbackId ? [fallbackId] : [];
}

function extractFunctionBody(lines, startIndex) {
  return extractDeclarationBody(lines, startIndex);
}

function extractDeclarationBody(lines, startIndex) {
  const collected = [];
  let depth = 0;
  let foundOpeningBrace = false;
  const braceScan = createBraceScanState();

  for (let index = startIndex; index < lines.length; index += 1) {
    const line = lines[index];
    collected.push(line);

    const braceDelta = braceDeltaOutsideStrings(line, braceScan);
    if (braceDelta > 0) foundOpeningBrace = true;
    depth += braceDelta;

    if (foundOpeningBrace && depth <= 0) break;
  }

  return collected.join("\n");
}

function createBraceScanState() {
  return {
    inString: false,
    stringDelimiter: ""
  };
}

function braceDeltaOutsideStrings(line, state) {
  let delta = 0;
  let index = 0;

  while (index < line.length) {
    const character = line[index];

    if (state.inString) {
      if (character === "\\" && state.stringDelimiter === "\"") {
        index += 2;
        continue;
      }
      if (line.startsWith(state.stringDelimiter, index)) {
        index += state.stringDelimiter.length;
        state.inString = false;
        state.stringDelimiter = "";
        continue;
      }
      index += 1;
      continue;
    }

    if (line.startsWith("\"\"\"", index)) {
      state.inString = true;
      state.stringDelimiter = "\"\"\"";
      index += 3;
      continue;
    }

    if (character === "\"") {
      state.inString = true;
      state.stringDelimiter = "\"";
      index += 1;
      continue;
    }

    if (character === "{") {
      delta += 1;
    } else if (character === "}") {
      delta -= 1;
    }
    index += 1;
  }

  return delta;
}

function metricsForFunctionSource(source) {
  const branchMatches = source.match(/\b(if|else if|switch|case|for|while|guard|catch|async let|Task)\b|\?\s*[^:]+:/g) || [];
  const callMatches = source.match(/\b[A-Za-z_][A-Za-z0-9_]*\s*\(/g) || [];
  return {
    lines: countSourceLines(source),
    branches: branchMatches.length,
    calls: callMatches.length
  };
}

function countSourceLines(source) {
  const lines = source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("//"));
  return Math.max(1, lines.length);
}

function stripSwiftComments(source) {
  let output = "";
  let index = 0;
  let blockDepth = 0;
  let inLineComment = false;
  let inString = false;
  let stringDelimiter = "";

  while (index < source.length) {
    const character = source[index];
    const next = source[index + 1];

    if (inLineComment) {
      if (character === "\n") {
        inLineComment = false;
        output += "\n";
      } else {
        output += " ";
      }
      index += 1;
      continue;
    }

    if (blockDepth > 0) {
      if (character === "/" && next === "*") {
        blockDepth += 1;
        output += "  ";
        index += 2;
        continue;
      }
      if (character === "*" && next === "/") {
        blockDepth -= 1;
        output += "  ";
        index += 2;
        continue;
      }
      output += character === "\n" ? "\n" : " ";
      index += 1;
      continue;
    }

    if (inString) {
      output += character;
      if (character === "\\" && stringDelimiter === "\"") {
        output += next || "";
        index += 2;
        continue;
      }
      if (source.startsWith(stringDelimiter, index)) {
        output += stringDelimiter.slice(1);
        index += stringDelimiter.length;
        inString = false;
        stringDelimiter = "";
        continue;
      }
      index += 1;
      continue;
    }

    if (source.startsWith("\"\"\"", index)) {
      inString = true;
      stringDelimiter = "\"\"\"";
      output += "\"\"\"";
      index += 3;
      continue;
    }

    if (character === "\"") {
      inString = true;
      stringDelimiter = "\"";
      output += character;
      index += 1;
      continue;
    }

    if (character === "/" && next === "/") {
      inLineComment = true;
      output += "  ";
      index += 2;
      continue;
    }

    if (character === "/" && next === "*") {
      blockDepth = 1;
      output += "  ";
      index += 2;
      continue;
    }

    output += character;
    index += 1;
  }

  return output;
}

function addNode(nodes, node) {
  const existing = nodes.get(node.id);
  if (existing) {
    nodes.set(node.id, { ...existing, ...node, metrics: { ...existing.metrics, ...node.metrics } });
    return;
  }
  nodes.set(node.id, node);
}

function addEdge(edges, from, to, kind) {
  edges.push({ from, to, kind });
}

function uniqueEdges(edgeList) {
  const seen = new Set();
  return edgeList.filter((edge) => {
    const key = `${edge.from}|${edge.to}|${edge.kind}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function basename(path) {
  return path.replace(/\/+$/, "").split("/").at(-1) || path;
}
