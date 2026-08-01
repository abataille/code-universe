import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { categoryForKind } from "../graph/schema.js";

const LANGUAGE_DEFINITIONS = {
  python: {
    extensions: new Set([".py", ".pyw"]),
    nodeKinds: new Map([
      ["class_definition", "class"],
      ["function_definition", "function"],
      ["async_function_definition", "function"],
      ["import_statement", "module"],
      ["import_from_statement", "module"],
      ["assignment", "variable"]
    ])
  },
  php: {
    extensions: new Set([".php", ".phtml"]),
    nodeKinds: new Map([
      ["namespace_definition", "namespace"],
      ["class_declaration", "class"],
      ["interface_declaration", "interface"],
      ["trait_declaration", "trait"],
      ["enum_declaration", "enum"],
      ["method_declaration", "method"],
      ["function_definition", "function"],
      ["property_declaration", "property"],
      ["const_declaration", "variable"],
      ["namespace_use_declaration", "module"],
      ["include_expression", "module"],
      ["require_expression", "module"]
    ])
  },
  java: {
    extensions: new Set([".java"]),
    nodeKinds: new Map([
      ["package_declaration", "namespace"],
      ["class_declaration", "class"],
      ["interface_declaration", "interface"],
      ["enum_declaration", "enum"],
      ["record_declaration", "record"],
      ["annotation_type_declaration", "interface"],
      ["method_declaration", "method"],
      ["constructor_declaration", "constructor"],
      ["field_declaration", "property"],
      ["local_variable_declaration", "variable"],
      ["import_declaration", "module"]
    ])
  }
};

const LANGUAGE_BY_EXTENSION = new Map(
  Object.entries(LANGUAGE_DEFINITIONS).flatMap(([language, definition]) =>
    [...definition.extensions].map((extension) => [extension, language])
  )
);

export const TREE_SITTER_LANGUAGE_EXTENSIONS = [...LANGUAGE_BY_EXTENSION.keys()];

export const treeSitterLanguageAdapter = {
  id: "tree-sitter-languages",
  displayName: "Python / PHP / Java",
  version: 1,
  languages: Object.keys(LANGUAGE_DEFINITIONS),
  extensions: TREE_SITTER_LANGUAGE_EXTENSIONS,
  profiles: ["fast", "balanced", "accurate", "indexed", "tree-sitter"],
  async scan(context) {
    const files = context.files.filter((file) => LANGUAGE_BY_EXTENSION.has(file.extension));
    const nodes = new Map();
    const edges = [];
    let parsedFiles = 0;
    let fallbackFiles = 0;

    for (const file of files) {
      const source = await readFile(file.absolute, "utf8");
      const language = LANGUAGE_BY_EXTENSION.get(file.extension);
      const syntax = context.treeSitterScan?.byFile?.get(file.relative) || null;
      const fileId = `file:${file.relative}`;
      addNode(nodes, fileNode(file, language, source));
      edges.push(edge("repo:root", fileId, "contains", syntax ? "tree-sitter-wasm" : "tree-sitter-structural", syntax ? 1 : 0.96));

      const declarations = syntax
        ? syntaxDeclarations(file, source, language, syntax)
        : fallbackDeclarations(file, source, language);
      if (syntax) parsedFiles += 1;
      else fallbackFiles += 1;
      const emitted = declarations.map((declaration) => declarationNode(file, source, language, declaration, Boolean(syntax)));
      emitted.forEach((node) => addNode(nodes, node));
      connectDeclarations(fileId, emitted, edges);
    }

    return {
      fragment: { nodes: [...nodes.values()], edges: uniqueEdges(edges) },
      diagnostics: {
        adapter: "tree-sitter-languages",
        filesScanned: files.length,
        parsedFiles,
        fallbackFiles,
        nodesByKind: countBy([...nodes.values()], "kind"),
        edgesByKind: countBy(edges, "kind"),
        semanticIndex: "tree-sitter-structural",
        parserLanguages: [...new Set(files.map((file) => LANGUAGE_BY_EXTENSION.get(file.extension)))]
      }
    };
  }
};

function fileNode(file, language, source) {
  const end = lineColumn(source, source.length);
  return {
    id: `file:${file.relative}`,
    kind: "file",
    category: "file",
    language,
    name: basename(file.relative),
    qualifiedName: file.relative,
    file: file.relative,
    line: 1,
    column: 1,
    endLine: end.line,
    endColumn: end.column,
    location: {
      file: file.relative,
      range: { start: { line: 1, column: 1 }, end, precision: "exact" }
    },
    metrics: { lines: Math.max(1, source.split(/\r\n|\r|\n/).length) },
    attributes: { languageAdapter: "tree-sitter-languages" },
    source: "tree-sitter-structural",
    confidence: 0.96
  };
}

function syntaxDeclarations(file, source, language, syntax) {
  const definition = LANGUAGE_DEFINITIONS[language];
  return syntax.nodes
    .filter((entry) => definition.nodeKinds.has(entry.type) && entry.range?.start && entry.range?.end)
    .map((entry) => ({
      type: entry.type,
      kind: definition.nodeKinds.get(entry.type),
      name: cleanName(entry.name) || nameFromSyntax(source, entry),
      range: entry.range,
      parser: "tree-sitter-wasm",
      grammar: syntax.grammar,
      hasError: syntax.hasError,
      errorCount: syntax.errorCount
    }))
    .filter((entry) => entry.name)
    .sort((left, right) => rangeSpan(left.range) - rangeSpan(right.range) || comparePosition(left.range.start, right.range.start));
}

function fallbackDeclarations(file, source, language) {
  const declarations = [];
  if (language === "python") {
    for (const match of source.matchAll(/^([ \t]*)(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/gm)) {
      declarations.push(fallbackDeclaration("function_definition", "function", match[2], source, match.index, pythonBlockEnd(source, match.index, match[1].length)));
    }
    for (const match of source.matchAll(/^([ \t]*)class\s+([A-Za-z_]\w*)\b/gm)) {
      declarations.push(fallbackDeclaration("class_definition", "class", match[2], source, match.index, pythonBlockEnd(source, match.index, match[1].length)));
    }
    for (const match of source.matchAll(/^\s*(?:from\s+([^\s]+)\s+import|import\s+([^\n#]+))/gm)) {
      declarations.push(fallbackDeclaration("import_statement", "module", (match[1] || match[2]).trim(), source, match.index, lineEnd(source, match.index)));
    }
  } else if (language === "java") {
    for (const match of source.matchAll(/^\s*package\s+([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s*;/gm)) {
      declarations.push(fallbackDeclaration("package_declaration", "namespace", match[1], source, match.index, lineEnd(source, match.index)));
    }
    for (const match of source.matchAll(/^\s*import\s+(?:static\s+)?([A-Za-z_]\w*(?:\.[A-Za-z_]\w*|\.\*)*)\s*;/gm)) {
      declarations.push(fallbackDeclaration("import_declaration", "module", match[1], source, match.index, lineEnd(source, match.index)));
    }
    for (const match of source.matchAll(/\b(class|interface|enum|record)\s+([A-Za-z_]\w*)[^\{]*\{/g)) {
      declarations.push(fallbackDeclaration(`${match[1]}_declaration`, match[1] === "record" ? "record" : match[1], match[2], source, match.index, braceBlockEnd(source, source.indexOf("{", match.index))));
    }
    for (const match of source.matchAll(/^\s*(?:(?:public|private|protected|static|final|abstract|synchronized|native|default|strictfp)\s+)*(?:<[^>]+>\s*)?[A-Za-z_]\w*(?:[<>,.?\[\] ]*)\s+([A-Za-z_]\w*)\s*\([^;{}]*\)\s*(?:throws[^\{]+)?\{/gm)) {
      if (["if", "for", "while", "switch", "catch"].includes(match[1])) continue;
      declarations.push(fallbackDeclaration("method_declaration", "method", match[1], source, match.index, braceBlockEnd(source, source.indexOf("{", match.index))));
    }
  } else if (language === "php") {
    for (const match of source.matchAll(/\bnamespace\s+([^;{]+)\s*[;{]/g)) {
      declarations.push(fallbackDeclaration("namespace_definition", "namespace", match[1].trim(), source, match.index, lineEnd(source, match.index)));
    }
    for (const match of source.matchAll(/^\s*(?:use|require|include)\s+([^;]+);/gm)) {
      declarations.push(fallbackDeclaration("namespace_use_declaration", "module", match[1].trim(), source, match.index, lineEnd(source, match.index)));
    }
    for (const match of source.matchAll(/\b(class|interface|trait|enum)\s+([A-Za-z_]\w*)[^\{]*\{/g)) {
      declarations.push(fallbackDeclaration(`${match[1]}_declaration`, match[1], match[2], source, match.index, braceBlockEnd(source, source.indexOf("{", match.index))));
    }
    for (const match of source.matchAll(/\bfunction\s+&?([A-Za-z_]\w*)\s*\([^)]*\)\s*(?::\s*[A-Za-z_][\w\\|?\\[\]]*)?\s*(?:\{|;)/g)) {
      declarations.push(fallbackDeclaration("function_definition", "function", match[1], source, match.index, source[match.index + match[0].length - 1] === "{" ? braceBlockEnd(source, source.indexOf("{", match.index)) : lineEnd(source, match.index)));
    }
  }
  return declarations.filter(Boolean).sort((left, right) => comparePosition(left.range.start, right.range.start));
}

function fallbackDeclaration(type, kind, name, source, start, end) {
  return {
    type,
    kind,
    name: cleanName(name),
    range: rangeForOffsets(source, start, Math.max(start + 1, end)),
    parser: "tree-sitter-structural",
    grammar: null,
    hasError: false,
    errorCount: 0
  };
}

function declarationNode(file, source, language, declaration, parsed) {
  const range = declaration.range;
  const lineSpan = Math.max(1, range.end.line - range.start.line + 1);
  const slice = source.slice(range.start.index || 0, range.end.index || source.length);
  const branches = (slice.match(/\b(?:if|elif|else|for|while|catch|case|switch)\b/g) || []).length;
  const kind = declaration.kind;
  const name = declaration.name || `${kind}@${range.start.line}`;
  const id = `symbol:${language}:${file.relative}#${kind}:${safeId(name)}:${range.start.line}:${range.start.column}`;
  const parser = parsed ? "tree-sitter-wasm" : "tree-sitter-structural";
  return {
    id,
    kind,
    category: categoryForKind(kind),
    language,
    name,
    qualifiedName: name,
    file: file.relative,
    line: range.start.line,
    column: range.start.column,
    endLine: range.end.line,
    endColumn: range.end.column,
    location: { file: file.relative, range: { ...range, precision: "exact" } },
    metrics: {
      lines: lineSpan,
      sourceLines: lineSpan,
      branches,
      complexity: 1 + branches,
      metricModel: "source-span-cyclomatic"
    },
    attributes: {
      syntaxNodeType: declaration.type,
      parser,
      grammar: declaration.grammar,
      hasSyntaxError: declaration.hasError === true,
      syntaxErrorCount: Number(declaration.errorCount || 0)
    },
    provenance: {
      parser,
      grammar: declaration.grammar,
      source: parser
    },
    source: parser,
    confidence: parsed ? 0.94 : 0.74
  };
}

function connectDeclarations(fileId, declarations, edges) {
  const structural = declarations.filter((node) => node.kind !== "module");
  for (const node of declarations) {
    if (node.kind === "module") {
      edges.push(edge(fileId, node.id, "imports", node.source, node.confidence));
      continue;
    }
    const parent = structural
      .filter((candidate) => candidate.id !== node.id && contains(candidate.location.range, node.location.range))
      .sort((left, right) => rangeSpan(left.location.range) - rangeSpan(right.location.range))[0];
    const owner = parent || { id: fileId };
    const kind = parent && parent.kind === "class" && node.kind === "function" ? "method" : node.kind;
    if (kind !== node.kind) {
      node.kind = kind;
      node.category = categoryForKind(kind);
    }
    edges.push(edge(owner.id, node.id, "defines", node.source, node.confidence));
  }
}

function edge(from, to, kind, source, confidence) {
  return { from, to, kind, source, confidence, inferred: confidence < 0.8 };
}

function addNode(nodes, node) {
  const existing = nodes.get(node.id);
  nodes.set(node.id, existing ? {
    ...existing,
    ...node,
    metrics: { ...(existing.metrics || {}), ...(node.metrics || {}) },
    attributes: { ...(existing.attributes || {}), ...(node.attributes || {}) }
  } : node);
}

function uniqueEdges(edges) {
  return [...new Map(edges.map((item) => [`${item.from}|${item.kind}|${item.to}`, item])).values()];
}

function countBy(items, key) {
  return items.reduce((counts, item) => {
    const value = item[key] || "unknown";
    counts[value] = (counts[value] || 0) + 1;
    return counts;
  }, {});
}

function nameFromSyntax(source, entry) {
  const start = entry.range.start.index;
  const end = entry.range.end.index;
  if (!Number.isInteger(start) || !Number.isInteger(end)) return null;
  const text = source.slice(start, end);
  if (["field_declaration", "property_declaration", "local_variable_declaration", "assignment"].includes(entry.type)) {
    const variable = text.match(/\$?([A-Za-z_]\w*)\s*(?:=|;|,|$)/g)?.at(-1);
    if (variable) return cleanName(variable.replace(/\s*(?:=|;|,|$)/, ""));
  }
  return cleanName(
    text.match(/\b(?:class|interface|trait|enum|record|def|function|method|namespace|package|import|use|include|require)\s+&?([A-Za-z_][\w.$\\]*)/)?.[1]
      || text.match(/^\s*([A-Za-z_][\w.$\\]*)/)?.[1]
  );
}

function cleanName(value) {
  return String(value || "").trim().replace(/^[$&]/, "").replace(/[;,{(].*$/, "").trim().slice(0, 160) || null;
}

function safeId(value) {
  return encodeURIComponent(value).replace(/%/g, "_");
}

function contains(container, target) {
  return comparePosition(container.start, target.start) <= 0 && comparePosition(container.end, target.end) >= 0;
}

function rangeSpan(range) {
  return Math.max(1, (range.end.line - range.start.line) * 100000 + range.end.column - range.start.column);
}

function comparePosition(left, right) {
  return left.line - right.line || left.column - right.column;
}

function rangeForOffsets(source, start, end) {
  return {
    start: { ...lineColumn(source, start), index: start },
    end: { ...lineColumn(source, end), index: end },
    precision: "exact"
  };
}

function lineColumn(source, offset) {
  const prefix = source.slice(0, Math.max(0, Math.min(source.length, offset)));
  const lines = prefix.split(/\r\n|\r|\n/);
  return { line: lines.length, column: lines.at(-1).length + 1 };
}

function lineEnd(source, start) {
  const end = source.indexOf("\n", start);
  return end >= 0 ? end : source.length;
}

function pythonBlockEnd(source, start, indent) {
  const lines = source.split(/\r\n|\r|\n/);
  let offset = 0;
  let startLine = 0;
  for (let index = 0; index < lines.length; index += 1) {
    if (offset <= start) startLine = index;
    offset += lines[index].length + 1;
    if (offset > start) break;
  }
  let cursor = lines.slice(0, startLine + 1).join("\n").length + 1;
  for (let index = startLine + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) {
      cursor += line.length + 1;
      continue;
    }
    const currentIndent = line.match(/^[ \t]*/)[0].length;
    if (currentIndent <= indent) return cursor - 1;
    cursor += line.length + 1;
  }
  return source.length;
}

function braceBlockEnd(source, open) {
  if (open < 0) return source.length;
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}" && --depth === 0) return index + 1;
  }
  return source.length;
}
