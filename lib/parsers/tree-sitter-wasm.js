import { existsSync, readFileSync } from "node:fs";
import { readFile as readFileAsync } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

export const TREE_SITTER_WASM_BACKEND_VERSION = 1;

const FILE_GRAMMARS = new Map([
  [".js", { language: "javascript", packageName: "tree-sitter-javascript", wasmFile: "tree-sitter-javascript.wasm" }],
  [".mjs", { language: "javascript", packageName: "tree-sitter-javascript", wasmFile: "tree-sitter-javascript.wasm" }],
  [".cjs", { language: "javascript", packageName: "tree-sitter-javascript", wasmFile: "tree-sitter-javascript.wasm" }],
  [".jsx", { language: "jsx", packageName: "tree-sitter-javascript", wasmFile: "tree-sitter-javascript.wasm" }],
  [".ts", { language: "typescript", packageName: "tree-sitter-typescript", wasmFile: "tree-sitter-typescript.wasm" }],
  [".mts", { language: "typescript", packageName: "tree-sitter-typescript", wasmFile: "tree-sitter-typescript.wasm" }],
  [".cts", { language: "typescript", packageName: "tree-sitter-typescript", wasmFile: "tree-sitter-typescript.wasm" }],
  [".tsx", { language: "tsx", packageName: "tree-sitter-typescript", wasmFile: "tree-sitter-tsx.wasm" }],
  [".html", { language: "html", packageName: "tree-sitter-html", wasmFile: "tree-sitter-html.wasm" }],
  [".htm", { language: "html", packageName: "tree-sitter-html", wasmFile: "tree-sitter-html.wasm" }],
  [".css", { language: "css", packageName: "tree-sitter-css", wasmFile: "tree-sitter-css.wasm" }]
]);

const INTERESTING_NODE_TYPES = new Set([
  "program",
  "function_declaration",
  "generator_function_declaration",
  "class_declaration",
  "abstract_class_declaration",
  "interface_declaration",
  "type_alias_declaration",
  "enum_declaration",
  "internal_module",
  "module",
  "namespace_export_declaration",
  "export_statement",
  "import_statement",
  "lexical_declaration",
  "variable_declaration",
  "variable_declarator",
  "method_definition",
  "public_field_definition",
  "field_definition",
  "call_expression",
  "new_expression",
  "jsx_element",
  "jsx_self_closing_element",
  "object",
  "pair",
  "document",
  "element",
  "script_element",
  "style_element",
  "doctype",
  "attribute",
  "stylesheet",
  "rule_set",
  "media_statement",
  "supports_statement",
  "keyframes_statement",
  "declaration",
  "class_selector",
  "id_selector",
  "tag_name"
]);

let runtimePromise = null;

/**
 * Load the optional WebAssembly parser runtime and the grammars shipped by npm.
 * This function never throws for a missing optional dependency: callers receive
 * an unavailable backend and can continue with the normal language adapters.
 */
export async function loadTreeSitterWasmBackend(options = {}) {
  if (options.forceUnavailable) return unavailableBackend("disabled by configuration");

  const runtime = await loadRuntime(options).catch((error) => ({
    available: false,
    reason: error instanceof Error ? error.message : String(error)
  }));
  if (!runtime.available) return unavailableBackend(runtime.reason);

  const grammars = new Map();
  const missing = [];
  const definitions = [...new Map(
    [...FILE_GRAMMARS.values()].map((definition) => [`${definition.packageName}/${definition.wasmFile}`, definition])
  ).values()];
  for (const definition of definitions) {
    const wasmPath = resolveGrammarPath(definition, options);
    if (!wasmPath) {
      missing.push(`${definition.packageName}/${definition.wasmFile}`);
      continue;
    }
    grammars.set(`${definition.packageName}/${definition.wasmFile}`, {
      ...definition,
      wasmPath,
      language: null
    });
  }

  if (grammars.size === 0) {
    return unavailableBackend(`no Tree-sitter grammar WASM files were found${missing.length ? ` (${missing.join(", ")})` : ""}`);
  }

  const versions = {
    runtime: packageVersion("web-tree-sitter"),
    grammars: Object.fromEntries([...grammars.values()].map((grammar) => [grammar.packageName, packageVersion(grammar.packageName)]))
  };
  const fingerprint = [
    `backend:${TREE_SITTER_WASM_BACKEND_VERSION}`,
    `runtime:${versions.runtime || "unknown"}`,
    `missing:${missing.sort().join(",") || "none"}`,
    ...Object.entries(versions.grammars).sort().map(([name, version]) => `${name}:${version || "unknown"}`)
  ].join("|");

  return new TreeSitterWasmBackend({
    Parser: runtime.Parser,
    Language: runtime.Language,
    grammars,
    missing,
    versions,
    fingerprint
  });
}

class TreeSitterWasmBackend {
  constructor({ Parser, Language, grammars, missing, versions, fingerprint }) {
    this.id = "tree-sitter-wasm";
    this.Parser = Parser;
    this.Language = Language;
    this.grammars = grammars;
    this.missing = missing;
    this.versions = versions;
    this.fingerprint = fingerprint;
    this.available = true;
  }

  metadata() {
    return {
      id: this.id,
      version: TREE_SITTER_WASM_BACKEND_VERSION,
      runtime: this.versions.runtime || null,
      grammars: this.versions.grammars,
      missing: this.missing,
      fallback: false,
      partialFallback: this.missing.length > 0
    };
  }

  supportsFile(file) {
    return Boolean(FILE_GRAMMARS.get(file.extension));
  }

  async scanFiles(files) {
    const byFile = new Map();
    const warnings = [];
    let parsedFiles = 0;
    let skippedFiles = 0;
    let syntaxErrors = 0;
    let syntaxNodes = 0;

    for (const file of files.filter((candidate) => this.supportsFile(candidate))) {
      const definition = FILE_GRAMMARS.get(file.extension);
      const grammar = this.grammars.get(`${definition.packageName}/${definition.wasmFile}`);
      if (!grammar) {
        skippedFiles += 1;
        warnings.push(`${file.relative}: missing ${definition.packageName}/${definition.wasmFile}`);
        continue;
      }
      try {
        const source = await readFileAsync(file.absolute, "utf8");
        const result = await this.parseSource(source, grammar, definition.language);
        byFile.set(file.relative, result);
        parsedFiles += 1;
        syntaxErrors += result.errorCount;
        syntaxNodes += result.namedNodeCount;
      } catch (error) {
        skippedFiles += 1;
        warnings.push(`${file.relative}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return {
      byFile,
      diagnostics: {
        parser: this.id,
        available: true,
        runtime: this.versions.runtime || null,
        grammars: this.versions.grammars,
        missingGrammars: this.missing,
        filesConsidered: files.filter((candidate) => this.supportsFile(candidate)).length,
        parsedFiles,
        skippedFiles,
        syntaxErrors,
        syntaxNodes,
        warnings,
        fallback: false,
        partialFallback: this.missing.length > 0 || skippedFiles > 0
      }
    };
  }

  async parseSource(source, grammar, language, base = null) {
    if (!grammar.language) grammar.language = await this.Language.load(grammar.wasmPath);
    const parser = new this.Parser();
    try {
      parser.setLanguage(grammar.language);
      const tree = parser.parse(source);
      if (!tree) throw new Error("Tree-sitter returned no syntax tree.");
      try {
        const summary = summarizeTree(tree.rootNode, language, base);
        if (language === "html") {
          summary.embedded = await this.parseEmbeddedHtml(tree.rootNode);
          const embeddedErrors = summary.embedded.reduce((total, item) => total + item.errorCount, 0);
          summary.errorCount += embeddedErrors;
          summary.hasError = summary.hasError || embeddedErrors > 0;
        }
        return summary;
      } finally {
        tree.delete();
      }
    } finally {
      parser.delete();
    }
  }

  async parseEmbeddedHtml(root) {
    const embedded = [];
    for (const node of root.descendantsOfType(["script_element", "style_element"])) {
      const rawText = node.namedChildren.find((child) => child.type === "raw_text");
      if (!rawText || !rawText.text.trim()) continue;
      const isScript = node.type === "script_element";
      const definition = isScript
        ? FILE_GRAMMARS.get(".js")
        : FILE_GRAMMARS.get(".css");
      const grammar = this.grammars.get(`${definition.packageName}/${definition.wasmFile}`);
      if (!grammar) continue;
      const summary = await this.parseSource(rawText.text, grammar, definition.language, {
        startIndex: rawText.startIndex,
        startPosition: rawText.startPosition
      });
      embedded.push({
        ...summary,
        language: definition.language,
        containerType: node.type,
        range: rangeForNode(node)
      });
    }
    return embedded;
  }
}

function unavailableBackend(reason) {
  return {
    id: "tree-sitter-wasm",
    version: TREE_SITTER_WASM_BACKEND_VERSION,
    available: false,
    fingerprint: `tree-sitter-wasm:${TREE_SITTER_WASM_BACKEND_VERSION}:unavailable`,
    metadata: () => ({
      id: "tree-sitter-wasm",
      version: TREE_SITTER_WASM_BACKEND_VERSION,
      runtime: null,
      grammars: {},
      missing: [],
      fallback: true,
      partialFallback: false,
      reason
    }),
    supportsFile: () => false,
    scanFiles: async () => ({
      byFile: new Map(),
      diagnostics: {
        parser: "tree-sitter-wasm",
        available: false,
        runtime: null,
        grammars: {},
        missingGrammars: [],
        filesConsidered: 0,
        parsedFiles: 0,
        skippedFiles: 0,
        syntaxErrors: 0,
        syntaxNodes: 0,
        warnings: [reason],
        fallback: true,
        partialFallback: false,
        reason
      }
    })
  };
}

async function loadRuntime(options) {
  if (!runtimePromise) {
    runtimePromise = (async () => {
      const module = await import("web-tree-sitter");
      const Parser = module.Parser || module.default?.Parser || module.default;
      const Language = module.Language || module.default?.Language;
      if (!Parser || !Language) throw new Error("web-tree-sitter did not expose Parser and Language.");
      const runtimePath = options.runtimePath
        || process.env.CODE_UNIVERSE_TREE_SITTER_RUNTIME
        || require.resolve("web-tree-sitter/web-tree-sitter.wasm");
      await Parser.init({ locateFile: () => runtimePath });
      return { available: true, Parser, Language };
    })().catch((error) => {
      runtimePromise = null;
      throw error;
    });
  }
  return runtimePromise;
}

function resolveGrammarPath(definition, options) {
  const customDirectory = options.wasmDirectory || process.env.CODE_UNIVERSE_TREE_SITTER_WASM_DIR;
  if (customDirectory) {
    const candidate = join(customDirectory, definition.wasmFile);
    if (existsSync(candidate)) return candidate;
  }
  try {
    return require.resolve(`${definition.packageName}/${definition.wasmFile}`);
  } catch {
    try {
      const packageEntry = require.resolve(definition.packageName);
      const packageRoot = packageRootFor(packageEntry, definition.packageName);
      const candidate = join(packageRoot, definition.wasmFile);
      return readFileSync(candidate) ? candidate : null;
    } catch {
      return null;
    }
  }
}

function packageRootFor(entry, packageName) {
  let current = dirname(entry);
  while (current !== dirname(current)) {
    try {
      const manifest = JSON.parse(readFileSync(join(current, "package.json"), "utf8"));
      if (manifest.name === packageName) return current;
    } catch {
      // Keep walking toward the package root.
    }
    current = dirname(current);
  }
  return dirname(entry);
}

function packageVersion(packageName) {
  try {
    const entry = require.resolve(packageName);
    const root = packageRootFor(entry, packageName);
    return JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version || null;
  } catch {
    return null;
  }
}

function summarizeTree(root, language, base = null) {
  const interestingNodes = [];
  const errors = [];
  let nodeCount = 0;
  let namedNodeCount = 0;
  const stack = [root];
  while (stack.length) {
    const node = stack.pop();
    nodeCount += 1;
    if (node.isNamed) namedNodeCount += 1;
    if (node.isError || node.isMissing || node.type === "ERROR") {
      errors.push({ type: node.type, range: rangeForNode(node, base) });
    }
    if (node.isNamed && (node === root || INTERESTING_NODE_TYPES.has(node.type))) {
      interestingNodes.push({ type: node.type, range: rangeForNode(node, base), named: true });
    }
    for (const child of node.children) stack.push(child);
  }
  return {
    parser: "tree-sitter-wasm",
    language,
    grammar: language,
    rootType: root.type,
    nodeCount,
    namedNodeCount,
    errorCount: errors.length,
    hasError: root.hasError,
    errors: errors.slice(0, 12),
    nodes: interestingNodes.slice(0, 1200),
    range: rangeForNode(root, base)
  };
}

function rangeForNode(node, base = null) {
  return {
    start: positionFor(node.startPosition, base?.startPosition, base?.startIndex, node.startIndex),
    end: positionFor(node.endPosition, base?.startPosition, base?.startIndex, node.endIndex),
    precision: "exact"
  };
}

function positionFor(position, basePosition = null, baseIndex = 0, index = 0) {
  const row = (basePosition?.row || 0) + position.row;
  const column = position.row === 0
    ? (basePosition?.column || 0) + position.column
    : position.column;
  return {
    line: row + 1,
    column: column + 1,
    index: baseIndex + index
  };
}

export function annotateFragmentWithTreeSitter(fragment, syntaxByFile) {
  if (!fragment || !syntaxByFile?.size) return fragment;
  return {
    ...fragment,
    nodes: fragment.nodes.map((node) => {
      const syntax = syntaxByFile.get(node.file);
      if (!syntax || !node.file) return node;
      const match = bestSyntaxMatch(node, syntax);
      const embedded = bestEmbeddedMatch(node, syntax.embedded || []);
      const effectiveSyntax = embedded || syntax;
      const effectiveMatch = embedded ? bestSyntaxMatch(node, embedded) : match;
      const treeSitter = {
        parser: "tree-sitter-wasm",
        grammar: effectiveSyntax.grammar,
        nodeType: effectiveMatch?.type || null,
        embeddedLanguage: embedded?.language || null,
        hasError: effectiveSyntax.hasError,
        errorCount: effectiveSyntax.errorCount
      };
      return {
        ...node,
        attributes: { ...(node.attributes || {}), treeSitter },
        provenance: {
          ...(node.provenance || {}),
          parser: "tree-sitter-wasm",
          grammar: effectiveSyntax.grammar
        }
      };
    })
  };
}

function bestSyntaxMatch(node, syntax) {
  if (["file", "html_document", "stylesheet"].includes(node.kind)) {
    return syntax.nodes.find((candidate) => candidate.type === syntax.rootType)
      || syntax.nodes.find((candidate) => candidate.type === syntax.language);
  }
  const isEmbeddedContainer = node.kind === "inline_script"
    || ["script", "style"].includes(node.attributes?.tag);
  if (syntax.containerType && isEmbeddedContainer) {
    return syntax.nodes.find((candidate) => candidate.type === syntax.rootType) || null;
  }
  const target = nodeRange(node);
  if (!target) return null;
  const candidates = syntax.nodes.filter((candidate) => {
    const range = candidate.range;
    return samePosition(range.start, target.start) && samePosition(range.end, target.end)
      || containsRange(range, target);
  });
  return candidates.sort((left, right) => rangeSpan(left.range) - rangeSpan(right.range))[0] || null;
}

function bestEmbeddedMatch(node, embedded) {
  const canUseEmbedded = node.kind === "inline_script"
    || node.kind === "css_rule"
    || node.attributes?.tag === "script"
    || node.attributes?.tag === "style";
  if (!canUseEmbedded) return null;
  const target = nodeRange(node);
  if (!target) return null;
  return embedded
    .filter((candidate) => rangesOverlap(candidate.range, target))
    .sort((left, right) => rangeSpan(left.range) - rangeSpan(right.range))[0] || null;
}

function nodeRange(node) {
  const range = node.location?.range;
  if (range) return range;
  if (!node.file || !node.line) return null;
  return {
    start: { line: node.line, column: node.column || 1 },
    end: { line: node.endLine || node.line, column: node.endColumn || node.column || 1 }
  };
}

function containsRange(container, target) {
  return comparePosition(container.start, target.start) <= 0 && comparePosition(container.end, target.end) >= 0;
}

function rangesOverlap(left, right) {
  return comparePosition(left.start, right.end) < 0 && comparePosition(left.end, right.start) > 0;
}

function samePosition(left, right) {
  return left.line === right.line && left.column === right.column;
}

function comparePosition(left, right) {
  return left.line - right.line || left.column - right.column;
}

function rangeSpan(range) {
  return Math.max(1, (range.end.line - range.start.line) * 100000 + range.end.column - range.start.column);
}
