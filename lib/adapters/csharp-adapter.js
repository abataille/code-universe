import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { categoryForKind } from "../graph/schema.js";

const CSHARP_EXTENSIONS = new Set([".cs"]);
const TYPE_PATTERN = /\b(record(?:\s+(?:class|struct))?|class|interface|struct|enum)\s+([A-Za-z_]\w*)(?:\s*<[^>{}]+>)?\s*(?:\:\s*([^{}\n]+))?\s*\{/g;
const CONTROL_WORDS = new Set(["if", "for", "foreach", "while", "switch", "catch", "using", "lock", "return", "new", "nameof", "typeof", "sizeof"]);

export const csharpAdapter = {
  id: "csharp",
  displayName: "C#",
  version: 1,
  languages: ["csharp"],
  extensions: [...CSHARP_EXTENSIONS],
  profiles: ["fast", "balanced", "accurate", "indexed"],
  async scan(context) {
    const files = context.files.filter((file) => CSHARP_EXTENSIONS.has(file.extension));
    const nodes = new Map();
    const edges = [];
    const declarations = [];
    const pendingTypeEdges = [];
    const pendingCalls = [];

    for (const file of files) {
      const source = await readFile(file.absolute, "utf8");
      scanFile(file, source, nodes, edges, declarations, pendingTypeEdges, pendingCalls);
    }

    const typesByName = indexByName(declarations.filter((item) => item.category === "type"));
    const callablesByName = indexByName(declarations.filter((item) => item.category === "callable"));
    for (const pending of pendingTypeEdges) {
      const target = uniqueTarget(typesByName, pending.name);
      const kind = pending.kind === "base"
        ? pending.sourceKind === "interface" || target?.kind !== "interface" ? "extends" : "implements"
        : pending.kind;
      if (target) edges.push(edge(pending.from, target.id, kind, "csharp-syntax", 0.9));
    }
    for (const pending of pendingCalls) {
      const target = uniqueCallableTarget(callablesByName, pending.name);
      if (target && target.id !== pending.from) edges.push(edge(pending.from, target.id, "calls", "csharp-syntax", 0.78, true));
    }

    return {
      fragment: { nodes: [...nodes.values()], edges: uniqueEdges(edges) },
      diagnostics: {
        adapter: "csharp",
        filesScanned: files.length,
        nodesByKind: countBy([...nodes.values()], "kind"),
        edgesByKind: countBy(edges, "kind"),
        semanticIndex: "csharp-structural"
      }
    };
  }
};

function scanFile(file, source, nodes, edges, declarations, pendingTypeEdges, pendingCalls) {
  const clean = maskCommentsAndStrings(source);
  const fileId = `file:${file.relative}`;
  addNode(nodes, sourceNode(fileId, "file", basename(file.relative), file.relative, 1, 1, {
    ...rangeExtra(source, 0, source.length),
    metrics: { lines: source.split(/\r\n|\r|\n/).length }
  }));
  edges.push(edge("repo:root", fileId, "contains", "csharp-syntax", 1));

  const namespaceMatch = [...clean.matchAll(/\bnamespace\s+([A-Za-z_][\w.]*)\s*[;{]/g)][0] || null;
  const namespaceName = namespaceMatch?.[1] || null;
  let namespaceId = null;
  if (namespaceMatch) {
    namespaceId = `symbol:csharp:${file.relative}#namespace:${namespaceName}`;
    const location = lineColumn(source, namespaceMatch.index);
    const open = namespaceMatch[0].lastIndexOf("{");
    const close = open >= 0 ? matchingBrace(clean, namespaceMatch.index + open) : source.length - 1;
    addNode(nodes, sourceNode(namespaceId, "namespace", namespaceName, file.relative, location.line, location.column, {
      qualifiedName: namespaceName,
      ...rangeExtra(source, namespaceMatch.index, Math.max(namespaceMatch.index + namespaceMatch[0].length, close + 1)),
      metrics: { lines: lineSpan(source, namespaceMatch.index, Math.max(namespaceMatch.index + namespaceMatch[0].length, close + 1)) }
    }));
    edges.push(edge(fileId, namespaceId, "defines", "csharp-syntax", 0.98));
  }
  for (const match of clean.matchAll(/^\s*(?:global\s+)?using\s+(?:[A-Za-z_]\w*\s*=\s*)?([A-Za-z_][\w.]*)\s*;/gm)) {
    const moduleName = match[1];
    const moduleId = `module:csharp:${moduleName}`;
    addNode(nodes, {
      id: moduleId, kind: "module", category: "module", language: "csharp",
      name: moduleName, qualifiedName: moduleName, file: "", line: 1, column: 1,
      metrics: {}, attributes: { external: true }, source: "csharp-syntax", confidence: 0.98
    });
    edges.push(edge(fileId, moduleId, "imports", "csharp-syntax", 0.98));
  }

  for (const match of clean.matchAll(TYPE_PATTERN)) {
    const kindToken = match[1];
    const name = match[2];
    const open = match.index + match[0].lastIndexOf("{");
    const close = matchingBrace(clean, open);
    if (close < 0) continue;
    const location = lineColumn(source, match.index);
    const kind = kindToken.startsWith("record") ? "record" : kindToken;
    const qualifiedName = namespaceName ? `${namespaceName}.${name}` : name;
    const id = `symbol:csharp:${file.relative}#${qualifiedName}:${kind}:${location.line}`;
    const typeNode = sourceNode(id, kind, name, file.relative, location.line, location.column, {
      qualifiedName,
      ...rangeExtra(source, match.index, close + 1),
      metrics: {
        lines: lineSpan(source, match.index, close + 1),
        methods: 0,
        properties: 0
      },
      attributes: {
        namespace: namespaceName,
        bases: splitTypes(match[3]),
        recordKind: kindToken.startsWith("record") ? (kindToken.split(/\s+/)[1] || "class") : null
      }
    });
    addNode(nodes, typeNode);
    declarations.push(typeNode);
    edges.push(edge(namespaceId || fileId, id, "defines", "csharp-syntax", 0.96));
    for (const base of splitTypes(match[3])) {
      pendingTypeEdges.push({ from: id, name: simpleTypeName(base), kind: "base", sourceKind: kind });
    }
    scanMembers(file, source, clean, { id, name, kind, qualifiedName, open, close }, nodes, edges, declarations, pendingTypeEdges, pendingCalls);
  }
  for (const match of clean.matchAll(/\bdelegate\s+([A-Za-z_][\w.<>,?\[\]]*)\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*;/g)) {
    const location = lineColumn(source, match.index);
    const qualifiedName = namespaceName ? `${namespaceName}.${match[2]}` : match[2];
    const id = `symbol:csharp:${file.relative}#${qualifiedName}:delegate`;
    const node = sourceNode(id, "delegate", match[2], file.relative, location.line, location.column, {
      qualifiedName,
      ...rangeExtra(source, match.index, match.index + match[0].length),
      metrics: { lines: lineSpan(source, match.index, match.index + match[0].length), parameters: parameterCount(match[3]) },
      attributes: { returnType: match[1] }
    });
    addNode(nodes, node);
    declarations.push(node);
    edges.push(edge(namespaceId || fileId, id, "defines", "csharp-syntax", 0.95));
  }
}

function scanMembers(file, source, clean, type, nodes, edges, declarations, pendingTypeEdges, pendingCalls) {
  const body = clean.slice(type.open + 1, type.close);
  const lines = body.split(/\r?\n/);
  let offset = type.open + 1;
  let depth = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (depth === 0 && trimmed) {
      const method = trimmed.match(/^(?:(?:public|private|protected|internal|static|virtual|override|abstract|sealed|async|extern|new|partial|unsafe)\s+)*(?:([A-Za-z_][\w.<>,?\[\]]*)\s+)?([A-Za-z_]\w*)\s*\(([^)]*)\)\s*(?:where\b[^{=>;]+)?\s*(?:\{|=>|;)/);
      const property = !method && trimmed.match(/^(?:(?:public|private|protected|internal|static|virtual|override|abstract|sealed|required|readonly|new)\s+)*([A-Za-z_][\w.<>,?\[\]]*)\s+([A-Za-z_]\w*)\s*\{/);
      const event = !method && !property && trimmed.match(/^(?:(?:public|private|protected|internal|static|virtual|override|abstract|sealed|new)\s+)*event\s+([A-Za-z_][\w.<>,?\[\]]*)\s+([A-Za-z_]\w*)\s*;/);
      if (method && !CONTROL_WORDS.has(method[2])) {
        const name = method[2];
        const kind = name === type.name ? "constructor" : "method";
        const location = lineColumn(source, offset + Math.max(0, line.indexOf(name)));
        const qualifiedName = `${type.qualifiedName}.${name}`;
        const id = `symbol:csharp:${file.relative}#${qualifiedName}:${kind}:${location.line}`;
        const declarationStart = offset + Math.max(0, line.search(/\S/));
        const declarationEnd = declarationEndOffset(clean, declarationStart, type.close);
        const node = sourceNode(id, kind, name, file.relative, location.line, location.column, {
          qualifiedName,
          ...rangeExtra(source, declarationStart, declarationEnd),
          metrics: {
            lines: lineSpan(source, declarationStart, declarationEnd),
            parameters: parameterCount(method[3]),
            branches: branchCount(clean.slice(declarationStart, declarationEnd)),
            complexity: 1 + branchCount(clean.slice(declarationStart, declarationEnd))
          },
          attributes: {
            returnType: kind === "constructor" ? null : method[1] || null,
            ownerKind: type.kind
          }
        });
        addNode(nodes, node);
        const owner = nodes.get(type.id);
        if (owner) owner.metrics.methods = Number(owner.metrics.methods || 0) + 1;
        declarations.push(node);
        edges.push(edge(type.id, id, "defines", "csharp-syntax", 0.94));
        if (method[1] && kind !== "constructor") pendingTypeEdges.push({ from: id, name: simpleTypeName(method[1]), kind: "uses" });
        for (const call of trimmed.matchAll(/\b(?:[A-Za-z_]\w*\.)?([A-Za-z_]\w*)\s*\(/g)) {
          if (call[1] !== name && !CONTROL_WORDS.has(call[1])) pendingCalls.push({ from: id, name: call[1] });
        }
      } else if (property || event) {
        const declaration = property || event;
        const name = declaration[2];
        const location = lineColumn(source, offset + Math.max(0, line.indexOf(name)));
        const qualifiedName = `${type.qualifiedName}.${name}`;
        const memberKind = event ? "event" : "property";
        const id = `symbol:csharp:${file.relative}#${qualifiedName}:${memberKind}:${location.line}`;
        const declarationStart = offset + Math.max(0, line.search(/\S/));
        const declarationEnd = declarationEndOffset(clean, declarationStart, type.close);
        const node = sourceNode(id, memberKind, name, file.relative, location.line, location.column, {
          qualifiedName,
          ...rangeExtra(source, declarationStart, declarationEnd),
          metrics: { lines: lineSpan(source, declarationStart, declarationEnd) },
          attributes: { type: declaration[1] }
        });
        addNode(nodes, node);
        const owner = nodes.get(type.id);
        if (owner) owner.metrics.properties = Number(owner.metrics.properties || 0) + 1;
        declarations.push(node);
        edges.push(edge(type.id, id, "defines", "csharp-syntax", 0.92));
        pendingTypeEdges.push({ from: id, name: simpleTypeName(declaration[1]), kind: "uses" });
      }
    }
    depth += braceDelta(line);
    offset += line.length + 1;
  }
}

function sourceNode(id, kind, name, file, line, column, extra = {}) {
  return {
    id, kind, category: categoryForKind(kind), language: "csharp", name, qualifiedName: extra.qualifiedName || name,
    file, line, column, endLine: extra.endLine || line, endColumn: extra.endColumn || column,
    metrics: extra.metrics || {}, attributes: extra.attributes || {},
    source: "csharp-syntax", confidence: 0.94
  };
}

function declarationEndOffset(source, start, limit) {
  const semicolon = source.indexOf(";", start);
  const arrow = source.indexOf("=>", start);
  const open = source.indexOf("{", start);
  const firstTerminator = Math.min(
    ...[semicolon, arrow, open].filter((offset) => offset >= 0 && offset < limit),
    limit
  );
  if (firstTerminator === open) {
    const close = matchingBrace(source, open);
    return close >= 0 && close < limit ? close + 1 : Math.min(limit, open + 1);
  }
  if (firstTerminator === arrow) {
    const end = source.indexOf(";", arrow);
    return end >= 0 && end < limit ? end + 1 : Math.min(limit, arrow + 2);
  }
  return firstTerminator < limit ? firstTerminator + 1 : Math.min(limit, start + 1);
}

function rangeExtra(source, start, end) {
  const finish = lineColumn(source, Math.max(start, end));
  return { endLine: finish.line, endColumn: finish.column };
}

function lineSpan(source, start, end) {
  return Math.max(1, lineColumn(source, end).line - lineColumn(source, start).line + 1);
}

function branchCount(source) {
  return (source.match(/\b(?:if|else\s+if|switch|case|for|foreach|while|catch)\b|\?\s*[^:]+:/g) || []).length;
}

function maskCommentsAndStrings(source) {
  return source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|@"(?:""|[^"])*"|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, (value) =>
    value.replace(/[^\n]/g, " ")
  );
}

function matchingBrace(source, open) {
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}" && --depth === 0) return index;
  }
  return -1;
}

function braceDelta(line) {
  return (line.match(/\{/g)?.length || 0) - (line.match(/\}/g)?.length || 0);
}

function lineColumn(source, offset) {
  const prefix = source.slice(0, offset);
  const lines = prefix.split(/\r?\n/);
  return { line: lines.length, column: lines.at(-1).length + 1 };
}

function splitTypes(value = "") {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function simpleTypeName(value = "") {
  return value.replace(/[?<>\[\]]/g, " ").trim().split(/[.\s,]/).filter(Boolean).at(-1) || value;
}

function parameterCount(parameters = "") {
  return parameters.trim() ? parameters.split(",").length : 0;
}

function indexByName(items) {
  const index = new Map();
  for (const item of items) index.set(item.name, [...(index.get(item.name) || []), item]);
  return index;
}

function uniqueTarget(index, name) {
  const targets = index.get(name) || [];
  return targets.length === 1 ? targets[0] : null;
}

function uniqueCallableTarget(index, name) {
  const targets = index.get(name) || [];
  const concrete = targets.filter((item) => item.attributes?.ownerKind !== "interface");
  if (concrete.length === 1) return concrete[0];
  return targets.length === 1 ? targets[0] : null;
}

function edge(from, to, kind, source, confidence, inferred = false) {
  return { from, to, kind, source, confidence, inferred, adapter: "csharp" };
}

function addNode(nodes, node) {
  if (!nodes.has(node.id)) nodes.set(node.id, node);
}

function uniqueEdges(edges) {
  const seen = new Set();
  return edges.filter((item) => {
    const key = `${item.from}|${item.kind}|${item.to}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function countBy(items, key) {
  return items.reduce((counts, item) => {
    const value = item[key] || "unknown";
    counts[value] = (counts[value] || 0) + 1;
    return counts;
  }, {});
}
