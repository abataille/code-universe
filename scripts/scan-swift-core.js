import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

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
    const fileName = relative(inputRoot, file);
    const fileId = `file:${fileName}`;
    const lines = source.split(/\r?\n/);

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

    lines.forEach((line, index) => {
      const lineNumber = index + 1;
      const importMatch = line.match(importPattern);
      if (importMatch) imports.push(importMatch[1]);

      const declarationMatch = line.match(declarationPattern);
      if (declarationMatch) {
        const [, declarationKind, name, inheritance = ""] = declarationMatch;
        const nodeKind = classifyType(declarationKind, name, inheritance, source);
        const node = {
          id: `type:${name}`,
          kind: nodeKind,
          declarationKind,
          name,
          file: fileName,
          line: lineNumber,
          metrics: { methods: 0, properties: 0 }
        };

        addNode(nodes, node);
        addEdge(edges, fileId, node.id, "defines");
        typeNames.add(name);
        declarations.push({ ...node, inheritance, source });
        currentType = nodes.get(node.id);

        inheritance
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
          .forEach((conformance) => {
            addEdge(edges, node.id, `type:${conformance}`, "conforms_to");
          });
        return;
      }

      const functionMatch = line.match(functionPattern);
      if (functionMatch && currentType) {
        const name = functionMatch[1];
        const functionId = `function:${currentType.name}.${name}`;
        addNode(nodes, {
          id: functionId,
          kind: "function",
          name,
          file: fileName,
          line: lineNumber,
          metrics: {}
        });
        addEdge(edges, currentType.id, functionId, "defines");
        currentType.metrics.methods += 1;
        functions.push({
          id: functionId,
          parentTypeName: currentType.name,
          source: extractFunctionBody(lines, index)
        });
        return;
      }

      const propertyMatch = line.match(propertyPattern);
      if (propertyMatch && currentType) {
        const name = propertyMatch[1];
        const propertyId = `property:${currentType.name}.${name}`;
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
        addEdge(edges, declaration.id, `type:${typeName}`, "uses");
      }
    }
  }

  for (const functionNode of functions) {
    for (const typeName of typeNames) {
      if (typeName === functionNode.parentTypeName) continue;
      if (referencesType(functionNode.source, typeName)) {
        addEdge(edges, functionNode.id, `type:${typeName}`, "uses");
      }
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
    const fullPath = join(root, entry.name);
    if (entry.isDirectory()) {
      results.push(...await listSwiftFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".swift")) {
      results.push(fullPath);
    }
  }

  return results.sort((left, right) => left.localeCompare(right));
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

function extractFunctionBody(lines, startIndex) {
  const collected = [];
  let depth = 0;
  let foundOpeningBrace = false;

  for (let index = startIndex; index < lines.length; index += 1) {
    const line = lines[index];
    collected.push(line);

    for (const character of line) {
      if (character === "{") {
        depth += 1;
        foundOpeningBrace = true;
      } else if (character === "}") {
        depth -= 1;
      }
    }

    if (foundOpeningBrace && depth <= 0) break;
  }

  return collected.join("\n");
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
