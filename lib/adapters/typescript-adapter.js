import ts from "typescript";
import { readFile } from "node:fs/promises";
import { basename, dirname, extname, join, normalize, relative, resolve } from "node:path";

const SCRIPT_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".jsx", ".ts", ".mts", ".cts", ".tsx"]);

export const typescriptAdapter = {
  id: "typescript",
  displayName: "JavaScript / TypeScript",
  version: 1,
  languages: ["javascript", "typescript"],
  extensions: [...SCRIPT_EXTENSIONS],
  profiles: ["fast", "balanced", "accurate"],
  async scan(context) {
    const files = context.files.filter((file) => SCRIPT_EXTENSIONS.has(file.extension));
    const nodes = new Map();
    const edges = [];
    const declarationsByName = new Map();
    const pendingCalls = [];
    const pendingTypeUses = [];
    const sourceFiles = [];

    for (const file of files) {
      const source = await readFile(file.absolute, "utf8");
      const sourceFile = ts.createSourceFile(
        file.relative,
        source,
        ts.ScriptTarget.Latest,
        true,
        scriptKindFor(file.extension)
      );
      sourceFiles.push({ file, sourceFile });
      const fileId = fileNodeId(file.relative);
      addNode(nodes, sourceNode(fileId, "file", basename(file.relative), file.relative, sourceFile, sourceFile, {
        metrics: { lines: lineCount(source) }
      }));
      addEdge(edges, "repo:root", fileId, "contains", "typescript-compiler");
      const moduleId = sourceModuleId(file.relative);
      addNode(nodes, sourceNode(moduleId, "source_module", basename(file.relative), file.relative, sourceFile, sourceFile, {
        category: "type",
        qualifiedName: file.relative,
        metrics: { lines: lineCount(source), methods: 0, properties: 0 }
      }));
      addEdge(edges, fileId, moduleId, "defines", "typescript-compiler");
    }

    for (const { file, sourceFile } of sourceFiles) {
      const fileId = fileNodeId(file.relative);
      collectImports(sourceFile, file, context.root, files, nodes, edges);
      visitStatements(sourceFile.statements, {
        file,
        sourceFile,
        parentId: sourceModuleId(file.relative),
        parentName: file.relative,
        nodes,
        edges,
        declarationsByName,
        pendingCalls,
        pendingTypeUses
      });
    }

    for (const pending of pendingCalls) {
      const target = bestDeclaration(declarationsByName.get(pending.name), pending.file);
      if (target && target !== pending.from) addEdge(edges, pending.from, target, "calls", "typescript-compiler", 0.82);
    }
    for (const pending of pendingTypeUses) {
      const target = bestDeclaration(declarationsByName.get(pending.name), pending.file);
      if (target && target !== pending.from) addEdge(edges, pending.from, target, pending.kind, "typescript-compiler", 0.8);
    }

    return {
      fragment: { nodes: [...nodes.values()], edges: uniqueEdges(edges) },
      diagnostics: {
        adapter: "typescript",
        filesScanned: files.length,
        nodesByKind: countBy([...nodes.values()], "kind"),
        edgesByKind: countBy(edges, "kind"),
        warnings: sourceFiles.flatMap(({ sourceFile }) =>
          sourceFile.parseDiagnostics.map((diagnostic) => `${sourceFile.fileName}: ${diagnostic.messageText}`)
        )
      }
    };
  }
};

function visitStatements(statements, context) {
  for (const statement of statements) visitDeclaration(statement, context);
}

function visitDeclaration(node, context) {
  const { file, sourceFile, parentId, parentName, nodes, edges, declarationsByName, pendingCalls, pendingTypeUses } = context;
  if (ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isEnumDeclaration(node) || ts.isTypeAliasDeclaration(node)) {
    const name = node.name?.text || `anonymous@${locationFor(sourceFile, node).line}`;
    const kind = ts.isClassDeclaration(node)
      ? (isReactClass(node) ? "react_component" : "class")
      : ts.isInterfaceDeclaration(node) ? "interface"
        : ts.isEnumDeclaration(node) ? "enum"
          : "type_alias";
    const id = symbolNodeId(file.relative, parentName, name, kind, sourceFile, node);
    addNode(nodes, sourceNode(id, kind, name, file.relative, sourceFile, node, {
      qualifiedName: qualified(parentName, name),
      declarationKind: kind,
      metrics: { lines: sourceLineSpan(sourceFile, node), methods: 0, properties: 0 }
    }));
    addEdge(edges, parentId, id, "defines", "typescript-compiler");
    registerDeclaration(declarationsByName, name, id, file.relative);
    collectHeritage(node, id, file.relative, pendingTypeUses);
    for (const member of node.members || []) {
      visitClassMember(member, { ...context, parentId: id, parentName: qualified(parentName, name) });
    }
    return;
  }

  if (ts.isFunctionDeclaration(node)) {
    const name = node.name?.text || `anonymous@${locationFor(sourceFile, node).line}`;
    const react = /^[A-Z]/.test(name) && containsJsx(node);
    const kind = react ? "react_component" : "function";
    const id = symbolNodeId(file.relative, parentName, name, kind, sourceFile, node);
    addNode(nodes, sourceNode(id, kind, name, file.relative, sourceFile, node, {
      qualifiedName: qualified(parentName, name),
      metrics: callableMetrics(sourceFile, node)
    }));
    addEdge(edges, parentId, id, "defines", "typescript-compiler");
    registerDeclaration(declarationsByName, name, id, file.relative);
    collectCallsAndTypes(node.body, id, file.relative, pendingCalls, pendingTypeUses);
    return;
  }

  if (ts.isVariableStatement(node)) {
    for (const declaration of node.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name)) continue;
      const name = declaration.name.text;
      const react = /^[A-Z]/.test(name) && declaration.initializer && containsJsx(declaration.initializer);
      const initializerFunction = declaration.initializer
        && (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer));
      const kind = react ? "react_component" : initializerFunction ? "function" : "variable";
      const id = symbolNodeId(file.relative, parentName, name, kind, sourceFile, declaration);
      addNode(nodes, sourceNode(id, kind, name, file.relative, sourceFile, declaration, {
        qualifiedName: qualified(parentName, name),
        metrics: initializerFunction ? callableMetrics(sourceFile, declaration.initializer) : {}
      }));
      addEdge(edges, parentId, id, "defines", "typescript-compiler");
      registerDeclaration(declarationsByName, name, id, file.relative);
      collectCallsAndTypes(declaration.initializer, id, file.relative, pendingCalls, pendingTypeUses);
    }
  }
}

function visitClassMember(node, context) {
  const name = propertyName(node.name) || (ts.isConstructorDeclaration(node) ? "constructor" : null);
  if (!name) return;
  const callable = ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node)
    || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node);
  const kind = ts.isConstructorDeclaration(node) ? "constructor" : callable ? "method" : "property";
  const id = symbolNodeId(context.file.relative, context.parentName, name, kind, context.sourceFile, node);
  addNode(context.nodes, sourceNode(id, kind, name, context.file.relative, context.sourceFile, node, {
    qualifiedName: qualified(context.parentName, name),
    metrics: callable ? callableMetrics(context.sourceFile, node) : {}
  }));
  addEdge(context.edges, context.parentId, id, "defines", "typescript-compiler");
  const parent = context.nodes.get(context.parentId);
  if (parent) {
    const metric = callable ? "methods" : "properties";
    parent.metrics[metric] = (parent.metrics[metric] || 0) + 1;
  }
  collectCallsAndTypes(node.body || node.initializer, id, context.file.relative, context.pendingCalls, context.pendingTypeUses);
}

function collectImports(sourceFile, file, root, files, nodes, edges) {
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
    const specifier = statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
      ? statement.moduleSpecifier.text
      : null;
    if (!specifier) continue;
    const resolvedFile = resolveLocalModule(file.relative, specifier, files);
    if (resolvedFile) {
      addEdge(edges, fileNodeId(file.relative), fileNodeId(resolvedFile), ts.isExportDeclaration(statement) ? "exports" : "imports", "typescript-compiler");
    } else {
      const moduleId = `module:${specifier}`;
      addNode(nodes, {
        id: moduleId, kind: "module", category: "module", language: null, name: specifier,
        qualifiedName: specifier, file: "", line: 1, column: 1, metrics: {}, attributes: {}
      });
      addEdge(edges, fileNodeId(file.relative), moduleId, ts.isExportDeclaration(statement) ? "exports" : "imports", "typescript-compiler");
    }
  }
}

function collectHeritage(node, from, file, pending) {
  for (const clause of node.heritageClauses || []) {
    const kind = clause.token === ts.SyntaxKind.ExtendsKeyword ? "extends" : "implements";
    for (const type of clause.types) {
      const name = rootIdentifier(type.expression);
      if (name) pending.push({ from, file, name, kind });
    }
  }
}

function collectCallsAndTypes(node, from, file, calls, typeUses) {
  if (!node) return;
  const visit = (child) => {
    if (ts.isCallExpression(child) || ts.isNewExpression(child)) {
      const name = rootIdentifier(child.expression);
      if (name) calls.push({ from, file, name });
    }
    if (ts.isTypeReferenceNode(child)) {
      const name = rootIdentifier(child.typeName);
      if (name) typeUses.push({ from, file, name, kind: "uses" });
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
}

function sourceNode(id, kind, name, file, sourceFile, node, extra = {}) {
  const start = locationFor(sourceFile, node);
  const end = endLocationFor(sourceFile, node);
  const language = file.match(/\.(?:ts|tsx|mts|cts)$/i) ? "typescript" : "javascript";
  return {
    id, kind, category: extra.category, language, name,
    qualifiedName: extra.qualifiedName || name,
    declarationKind: extra.declarationKind,
    file, line: start.line, column: start.column, endLine: end.line, endColumn: end.column,
    metrics: extra.metrics || {}, attributes: extra.attributes || {},
    source: "typescript-compiler", confidence: 0.95
  };
}

function symbolNodeId(file, parent, name, kind, sourceFile, node) {
  const line = locationFor(sourceFile, node).line;
  return `symbol:${languageId(file)}:${file}#${qualified(parent, name)}:${kind}:${line}`;
}

function fileNodeId(file) {
  return `file:${file}`;
}

function sourceModuleId(file) {
  return `symbol:${languageId(file)}:${file}#module`;
}

function registerDeclaration(map, name, id, file) {
  if (!map.has(name)) map.set(name, []);
  map.get(name).push({ id, file });
}

function bestDeclaration(candidates, sourceFile) {
  if (!candidates?.length) return null;
  return candidates.find((candidate) => candidate.file === sourceFile)?.id || candidates[0].id;
}

function resolveLocalModule(sourceFile, specifier, files) {
  if (!specifier.startsWith(".")) return null;
  const base = normalize(join(dirname(sourceFile), specifier)).replaceAll("\\", "/");
  const candidates = [base, ...[...SCRIPT_EXTENSIONS].map((extension) => `${base}${extension}`)];
  for (const extension of SCRIPT_EXTENSIONS) candidates.push(`${base}/index${extension}`);
  return candidates.find((candidate) => files.some((file) => file.relative === candidate)) || null;
}

function scriptKindFor(extension) {
  if (extension === ".tsx") return ts.ScriptKind.TSX;
  if (extension === ".jsx") return ts.ScriptKind.JSX;
  if ([".ts", ".mts", ".cts"].includes(extension)) return ts.ScriptKind.TS;
  return ts.ScriptKind.JS;
}

function callableMetrics(sourceFile, node) {
  let branches = 0;
  let calls = 0;
  const visit = (child) => {
    if (ts.isCallExpression(child) || ts.isNewExpression(child)) calls += 1;
    if (ts.isIfStatement(child) || ts.isConditionalExpression(child) || ts.isForStatement(child)
      || ts.isForOfStatement(child) || ts.isForInStatement(child) || ts.isWhileStatement(child)
      || ts.isCaseClause(child) || ts.isCatchClause(child)) branches += 1;
    ts.forEachChild(child, visit);
  };
  visit(node);
  return { lines: sourceLineSpan(sourceFile, node), calls, branches, complexity: 1 + branches };
}

function containsJsx(node) {
  let found = false;
  const visit = (child) => {
    if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child) || ts.isJsxFragment(child)) found = true;
    if (!found) ts.forEachChild(child, visit);
  };
  visit(node);
  return found;
}

function isReactClass(node) {
  return (node.heritageClauses || []).some((clause) =>
    clause.types.some((type) => /\b(?:React\.)?(?:Pure)?Component\b/.test(type.expression.getText()))
  );
}

function rootIdentifier(node) {
  if (!node) return null;
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node) || ts.isQualifiedName(node)) return rootIdentifier(node.name || node.right);
  return null;
}

function propertyName(node) {
  if (!node) return null;
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) return node.text;
  return node.getText?.() || null;
}

function qualified(parent, name) {
  return parent ? `${parent}.${name}` : name;
}

function locationFor(sourceFile, node) {
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return { line: position.line + 1, column: position.character + 1 };
}

function endLocationFor(sourceFile, node) {
  const position = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
  return { line: position.line + 1, column: position.character + 1 };
}

function sourceLineSpan(sourceFile, node) {
  const start = locationFor(sourceFile, node).line;
  return Math.max(1, endLocationFor(sourceFile, node).line - start + 1);
}

function languageId(file) {
  return /\.(?:ts|tsx|mts|cts)$/i.test(file) ? "typescript" : "javascript";
}

function lineCount(source) {
  return source.split(/\r?\n/).length;
}

function addNode(nodes, node) {
  if (!nodes.has(node.id)) nodes.set(node.id, node);
}

function addEdge(edges, from, to, kind, source, confidence = 0.95) {
  edges.push({ from, to, kind, source, confidence, inferred: false });
}

function uniqueEdges(edges) {
  const seen = new Set();
  return edges.filter((edge) => {
    const key = `${edge.from}|${edge.kind}|${edge.to}`;
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
