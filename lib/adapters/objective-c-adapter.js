import { readFile } from "node:fs/promises";
import { basename, dirname, join, normalize } from "node:path";
import { categoryForKind } from "../graph/schema.js";

const OBJC_EXTENSIONS = new Set([".h", ".m", ".mm"]);
const BLOCK_PATTERN = /@(interface|implementation|protocol)\s+([A-Za-z_]\w*)(?:\s*\(\s*([A-Za-z_]\w*)\s*\))?\s*(?:\:\s*([A-Za-z_]\w*))?\s*(?:<([^>]+)>)?([\s\S]*?)@end/g;

export const objectiveCAdapter = {
  id: "objective-c",
  displayName: "Objective-C / Objective-C++",
  version: 1,
  languages: ["objective-c", "objective-cpp"],
  extensions: [...OBJC_EXTENSIONS],
  profiles: ["fast", "balanced", "accurate", "indexed"],
  async scan(context) {
    const files = context.files.filter((file) => OBJC_EXTENSIONS.has(file.extension));
    const nodes = new Map();
    const edges = [];
    const declarations = [];
    const pendingTypes = [];
    const pendingCalls = [];
    const imports = [];

    for (const file of files) {
      const source = await readFile(file.absolute, "utf8");
      scanFile(file, source, nodes, edges, declarations, pendingTypes, pendingCalls, imports);
    }
    resolveImports(files, nodes, edges, imports);
    const typesByName = indexByName(declarations.filter((item) => item.category === "type"));
    const methodsBySelector = indexBySelector(declarations.filter((item) => item.kind === "method"));
    for (const pending of pendingTypes) {
      const target = uniqueTarget(typesByName, pending.name);
      if (target) edges.push(edge(pending.from, target.id, pending.kind, 0.9));
    }
    for (const pending of pendingCalls) {
      const target = uniqueMethodTarget(methodsBySelector, pending.selector);
      if (target && target.id !== pending.from) edges.push(edge(pending.from, target.id, "calls", 0.8, true));
    }

    return {
      fragment: { nodes: [...nodes.values()], edges: uniqueEdges(edges) },
      diagnostics: {
        adapter: "objective-c",
        filesScanned: files.length,
        nodesByKind: countBy([...nodes.values()], "kind"),
        edgesByKind: countBy(edges, "kind"),
        semanticIndex: "objective-c-structural"
      }
    };
  }
};

function scanFile(file, source, nodes, edges, declarations, pendingTypes, pendingCalls, imports) {
  const language = file.extension === ".mm" ? "objective-cpp" : "objective-c";
  const clean = maskCommentsAndStrings(source);
  const fileId = `file:${file.relative}`;
  addNode(nodes, sourceNode(fileId, "file", basename(file.relative), language, file.relative, 1, 1, {
    ...rangeExtra(source, 0, source.length),
    metrics: { lines: source.split(/\r\n|\r|\n/).length }
  }));
  edges.push(edge("repo:root", fileId, "contains", 1));

  for (const match of source.matchAll(/^\s*#\s*(?:import|include)\s*[<"]([^>"]+)[>"]/gm)) {
    imports.push({ from: fileId, file: file.relative, target: match[1] });
  }

  for (const match of clean.matchAll(BLOCK_PATTERN)) {
    const blockKind = match[1];
    const name = match[2];
    const categoryName = match[3] || null;
    const superclass = match[4] || null;
    const protocols = (match[5] || "").split(",").map((item) => item.trim()).filter(Boolean);
    const body = match[6];
    const location = lineColumn(source, match.index);
    const kind = blockKind === "protocol"
      ? "protocol"
      : categoryName
        ? "category"
        : blockKind === "implementation"
          ? "implementation"
          : "class";
    const qualifiedName = categoryName ? `${name}(${categoryName})` : name;
    const id = `symbol:${language}:${file.relative}#${qualifiedName}:${kind}:${location.line}`;
    const node = sourceNode(id, kind, qualifiedName, language, file.relative, location.line, location.column, {
      qualifiedName,
      ...rangeExtra(source, match.index, match.index + match[0].length),
      metrics: {
        lines: lineSpan(source, match.index, match.index + match[0].length),
        methods: 0,
        properties: 0
      },
      attributes: { className: name, category: categoryName, superclass, protocols, declarationKind: blockKind }
    });
    addNode(nodes, node);
    declarations.push(node);
    edges.push(edge(fileId, id, "defines", 0.96));
    if (superclass) pendingTypes.push({ from: id, name: superclass, kind: "extends" });
    for (const protocol of protocols) pendingTypes.push({ from: id, name: protocol, kind: "conforms_to" });
    if (blockKind === "implementation") pendingTypes.push({ from: id, name, kind: "implements" });
    scanBlockMembers(file, source, language, match.index + match[0].indexOf(body), body, node, nodes, edges, declarations, pendingTypes, pendingCalls);
  }

  scanFunctions(file, source, clean, language, nodes, edges, declarations, pendingCalls);
}

function scanBlockMembers(file, source, language, bodyOffset, body, owner, nodes, edges, declarations, pendingTypes, pendingCalls) {
  const ivarBlock = body.match(/\{([\s\S]*?)\}/);
  if (ivarBlock) {
    const ivarOffset = bodyOffset + ivarBlock.index + 1;
    for (const match of ivarBlock[1].matchAll(/^[ \t]*([A-Za-z_][\w\s*<>]*?\*?)\s*([A-Za-z_]\w*)\s*;/gm)) {
      const location = lineColumn(source, ivarOffset + match.index);
      const id = `symbol:${language}:${file.relative}#${owner.qualifiedName}.${match[2]}:ivar:${location.line}`;
      const node = sourceNode(id, "ivar", match[2], language, file.relative, location.line, location.column, {
        qualifiedName: `${owner.qualifiedName}.${match[2]}`,
        ...rangeExtra(source, ivarOffset + match.index, ivarOffset + match.index + match[0].length),
        metrics: { lines: lineSpan(source, ivarOffset + match.index, ivarOffset + match.index + match[0].length) },
        attributes: { type: match[1].trim() }
      });
      addNode(nodes, node);
      declarations.push(node);
      edges.push(edge(owner.id, id, "defines", 0.92));
    }
  }
  for (const match of body.matchAll(/\b([A-Za-z_][\w\s*<>]*?)\(\s*\^\s*([A-Za-z_]\w*)\s*\)\s*\(([^)]*)\)\s*=/g)) {
    const location = lineColumn(source, bodyOffset + match.index);
    const id = `symbol:${language}:${file.relative}#${owner.qualifiedName}.${match[2]}:block:${location.line}`;
    const declarationEnd = Math.max(bodyOffset + match.index + match[0].length, source.indexOf(";", bodyOffset + match.index) + 1);
    const node = sourceNode(id, "block", match[2], language, file.relative, location.line, location.column, {
      qualifiedName: `${owner.qualifiedName}.${match[2]}`,
      ...rangeExtra(source, bodyOffset + match.index, declarationEnd),
      metrics: { lines: lineSpan(source, bodyOffset + match.index, declarationEnd), parameters: parameterCount(match[3]) },
      attributes: { returnType: match[1].trim() }
    });
    addNode(nodes, node);
    declarations.push(node);
    edges.push(edge(owner.id, id, "defines", 0.9));
  }
  for (const match of body.matchAll(/@property\s*(?:\([^)]*\))?\s*([^;\n]+)\s*;/g)) {
    const declaration = match[1].trim();
    const parsed = declaration.match(/^(.*?)([A-Za-z_]\w*)$/);
    if (!parsed) continue;
    const name = parsed[2];
    const type = parsed[1].trim();
    const location = lineColumn(source, bodyOffset + match.index);
    const id = `symbol:${language}:${file.relative}#${owner.qualifiedName}.${name}:property:${location.line}`;
    const node = sourceNode(id, "property", name, language, file.relative, location.line, location.column, {
      qualifiedName: `${owner.qualifiedName}.${name}`,
      ...rangeExtra(source, bodyOffset + match.index, bodyOffset + match.index + match[0].length),
      metrics: { lines: lineSpan(source, bodyOffset + match.index, bodyOffset + match.index + match[0].length) },
      attributes: { type }
    });
    addNode(nodes, node);
    const ownerNode = nodes.get(owner.id);
    if (ownerNode) ownerNode.metrics.properties = Number(ownerNode.metrics.properties || 0) + 1;
    declarations.push(node);
    edges.push(edge(owner.id, id, "defines", 0.95));
    const typeName = objectiveTypeName(type);
    if (typeName) pendingTypes.push({ from: id, name: typeName, kind: "uses" });
  }

  const methodMatches = [...body.matchAll(/^[ \t]*([+-])\s*\(([^)]+)\)\s*([^;{\n]+)\s*[;{]/gm)];
  for (let index = 0; index < methodMatches.length; index += 1) {
    const match = methodMatches[index];
    const selector = selectorFromSignature(match[3]);
    if (!selector) continue;
    const location = lineColumn(source, bodyOffset + match.index);
    const declarationStart = bodyOffset + match.index;
    const declarationEnd = objectiveDeclarationEnd(source, declarationStart, bodyOffset + body.length);
    const id = `symbol:${language}:${file.relative}#${owner.qualifiedName}.${selector}:method:${location.line}`;
    const node = sourceNode(id, "method", selector, language, file.relative, location.line, location.column, {
      qualifiedName: `${owner.qualifiedName}.${selector}`,
      ...rangeExtra(source, declarationStart, declarationEnd),
      metrics: {
        lines: lineSpan(source, declarationStart, declarationEnd),
        parameters: (selector.match(/:/g) || []).length,
        branches: branchCount(source.slice(declarationStart, declarationEnd)),
        complexity: 1 + branchCount(source.slice(declarationStart, declarationEnd))
      },
      attributes: {
        selector,
        classMethod: match[1] === "+",
        returnType: match[2].trim(),
        ownerDeclarationKind: owner.attributes?.declarationKind || null
      }
    });
    addNode(nodes, node);
    const ownerNode = nodes.get(owner.id);
    if (ownerNode) ownerNode.metrics.methods = Number(ownerNode.metrics.methods || 0) + 1;
    declarations.push(node);
    edges.push(edge(owner.id, id, "defines", 0.96));
    const methodEnd = methodMatches[index + 1]?.index ?? body.length;
    for (const call of body.slice(match.index, methodEnd).matchAll(/\[\s*[^\]\s]+\s+([A-Za-z_]\w*(?:\s*:[^\]]*)?)\]/g)) {
      const calledSelector = selectorFromMessage(call[1]);
      if (calledSelector) pendingCalls.push({ from: id, selector: calledSelector });
    }
  }
}

function scanFunctions(file, source, clean, language, nodes, edges, declarations, pendingCalls) {
  const outsideBlocks = clean.replace(BLOCK_PATTERN, (value) => value.replace(/[^\n]/g, " "));
  for (const match of outsideBlocks.matchAll(/^\s*(?!#)([A-Za-z_][\w\s*<>]*?)\s+([A-Za-z_]\w*)\s*\(([^;]*)\)\s*\{/gm)) {
    const name = match[2];
    if (["if", "for", "while", "switch"].includes(name)) continue;
    const location = lineColumn(source, match.index);
    const open = clean.indexOf("{", match.index);
    const close = open >= 0 ? matchingBrace(clean, open) : -1;
    const declarationEnd = close >= 0 ? close + 1 : match.index + match[0].length;
    const id = `symbol:${language}:${file.relative}#${name}:function:${location.line}`;
    const node = sourceNode(id, "function", name, language, file.relative, location.line, location.column, {
      attributes: { returnType: match[1].trim() },
      ...rangeExtra(source, match.index, declarationEnd),
      metrics: {
        lines: lineSpan(source, match.index, declarationEnd),
        parameters: match[3].trim() === "void" || !match[3].trim() ? 0 : match[3].split(",").length,
        branches: branchCount(source.slice(match.index, declarationEnd)),
        complexity: 1 + branchCount(source.slice(match.index, declarationEnd))
      }
    });
    addNode(nodes, node);
    declarations.push(node);
    edges.push(edge(`file:${file.relative}`, id, "defines", 0.9));
    for (const call of match[0].matchAll(/\b([A-Za-z_]\w*)\s*\(/g)) {
      if (call[1] !== name) pendingCalls.push({ from: id, selector: call[1] });
    }
  }
}

function resolveImports(files, nodes, edges, imports) {
  const known = new Set(files.map((file) => file.relative));
  const byBasename = new Map(files.map((file) => [basename(file.relative), file.relative]));
  for (const item of imports) {
    const relativeTarget = normalize(join(dirname(item.file), item.target)).replaceAll("\\", "/");
    const target = known.has(relativeTarget) ? relativeTarget : byBasename.get(basename(item.target));
    if (target) {
      edges.push(edge(item.from, `file:${target}`, "imports", 0.98));
      continue;
    }
    const moduleName = item.target.split("/")[0];
    const moduleId = `module:objective-c:${moduleName}`;
    addNode(nodes, {
      id: moduleId, kind: "module", category: "module", language: "objective-c",
      name: moduleName, qualifiedName: item.target, file: "", line: 1, column: 1,
      metrics: {}, attributes: { external: true, header: item.target },
      source: "objective-c-syntax", confidence: 0.98
    });
    edges.push(edge(item.from, moduleId, "imports", 0.98));
  }
}

function selectorFromSignature(signature) {
  const parts = [...signature.matchAll(/([A-Za-z_]\w*)\s*:/g)].map((match) => `${match[1]}:`);
  return parts.length ? parts.join("") : signature.trim().match(/^([A-Za-z_]\w*)/)?.[1] || null;
}

function selectorFromMessage(message) {
  const parts = [...message.matchAll(/([A-Za-z_]\w*)\s*:/g)].map((match) => `${match[1]}:`);
  return parts.length ? parts.join("") : message.trim().match(/^([A-Za-z_]\w*)/)?.[1] || null;
}

function objectiveTypeName(value = "") {
  return value.replace(/\b(?:const|nullable|nonnull|__kindof|struct|enum)\b/g, " ").replace(/[*<>]/g, " ").trim().split(/\s+/).at(-1) || null;
}

function sourceNode(id, kind, name, language, file, line, column, extra = {}) {
  return {
    id, kind, category: categoryForKind(kind), language, name, qualifiedName: extra.qualifiedName || name,
    file, line, column, endLine: extra.endLine || line, endColumn: extra.endColumn || column,
    metrics: extra.metrics || {}, attributes: extra.attributes || {},
    source: "objective-c-syntax", confidence: 0.94
  };
}

function objectiveDeclarationEnd(source, start, limit) {
  const semicolon = source.indexOf(";", start);
  const open = source.indexOf("{", start);
  if (open >= 0 && open < limit && (semicolon < 0 || open < semicolon)) {
    const close = matchingBrace(source, open);
    return close >= 0 && close < limit ? close + 1 : open + 1;
  }
  return semicolon >= 0 && semicolon < limit ? semicolon + 1 : Math.min(limit, start + 1);
}

function matchingBrace(source, open) {
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}" && --depth === 0) return index;
  }
  return -1;
}

function rangeExtra(source, start, end) {
  const finish = lineColumn(source, Math.max(start, end));
  return { endLine: finish.line, endColumn: finish.column };
}

function lineSpan(source, start, end) {
  return Math.max(1, lineColumn(source, end).line - lineColumn(source, start).line + 1);
}

function branchCount(source) {
  return (source.match(/\b(?:if|else\s+if|switch|case|for|while|catch)\b|\?\s*[^:]+:/g) || []).length;
}

function parameterCount(parameters = "") {
  return parameters.trim() && parameters.trim() !== "void" ? parameters.split(",").length : 0;
}

function maskCommentsAndStrings(source) {
  return source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|@?"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, (value) =>
    value.replace(/[^\n]/g, " ")
  );
}

function lineColumn(source, offset) {
  const lines = source.slice(0, offset).split(/\r?\n/);
  return { line: lines.length, column: lines.at(-1).length + 1 };
}

function indexByName(items) {
  const index = new Map();
  for (const item of items) {
    const name = item.attributes?.className || item.name;
    index.set(name, [...(index.get(name) || []), item]);
  }
  return index;
}

function indexBySelector(items) {
  const index = new Map();
  for (const item of items) {
    const selector = item.attributes?.selector || item.name;
    index.set(selector, [...(index.get(selector) || []), item]);
  }
  return index;
}

function uniqueTarget(index, name) {
  const targets = index.get(name) || [];
  const declarations = targets.filter((item) => item.kind !== "implementation");
  if (declarations.length === 1) return declarations[0];
  return targets.length === 1 ? targets[0] : null;
}

function uniqueMethodTarget(index, selector) {
  const targets = index.get(selector) || [];
  const implementations = targets.filter((item) => item.attributes?.ownerDeclarationKind === "implementation");
  if (implementations.length === 1) return implementations[0];
  return targets.length === 1 ? targets[0] : null;
}

function edge(from, to, kind, confidence, inferred = false) {
  return { from, to, kind, source: "objective-c-syntax", confidence, inferred, adapter: "objective-c" };
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
