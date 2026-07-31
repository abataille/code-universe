import ts from "typescript";
import { parse } from "parse5";
import { readFile } from "node:fs/promises";
import { basename, dirname, join, normalize, relative, resolve } from "node:path";
import { frameworkAttributes } from "./framework-detectors.js";
import {
  createWebAssetNode,
  isStaticAssetReference,
  parseSrcset,
  relationshipForAssetKind
} from "./web-asset-utils.js";

const SCRIPT_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".jsx", ".ts", ".mts", ".cts", ".tsx"]);
const SCRIPT_ASSET_FINGERPRINT_EXTENSIONS = [
  ".apng", ".avif", ".bmp", ".gif", ".ico", ".jpeg", ".jpg", ".png", ".svg", ".webp",
  ".mp4", ".m4v", ".mov", ".ogv", ".webm", ".aac", ".flac", ".m4a", ".mp3", ".oga", ".ogg", ".wav",
  ".eot", ".otf", ".ttf", ".woff", ".woff2", ".json", ".pdf", ".webmanifest"
];

export const typescriptAdapter = {
  id: "typescript",
  displayName: "JavaScript / TypeScript",
  version: 3,
  languages: ["javascript", "typescript", "html"],
  extensions: [...SCRIPT_EXTENSIONS],
  fingerprintExtensions: [...SCRIPT_EXTENSIONS, ".html", ".htm", ".css", ...SCRIPT_ASSET_FINGERPRINT_EXTENSIONS],
  profiles: ["fast", "balanced", "accurate", "indexed"],
  async scan(context) {
    const files = context.files.filter((file) => SCRIPT_EXTENSIONS.has(file.extension));
    const nodes = new Map();
    const edges = [];
    const declarationsByName = new Map();
    const pendingCalls = [];
    const pendingTypeUses = [];
    const sourceFiles = [];
    const pendingAssets = [];
    const semanticIds = new Map();
    const project = loadTypeScriptProject(context.root, files);
    const checker = project.program.getTypeChecker();

    for (const file of files) {
      const source = await readFile(file.absolute, "utf8");
      const sourceFile = project.program.getSourceFile(file.absolute) || ts.createSourceFile(
        file.absolute, source, ts.ScriptTarget.Latest, true, scriptKindFor(file.extension)
      );
      sourceFiles.push({ file, sourceFile, moduleId: sourceModuleId(file.relative) });
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
    for (const file of context.files.filter((candidate) => [".html", ".htm"].includes(candidate.extension))) {
      const html = await readFile(file.absolute, "utf8");
      for (const inline of extractInlineScripts(file, html)) {
        const paddedSource = `${"\n".repeat(Math.max(0, inline.line - 1))}${inline.source}`;
        const sourceFile = ts.createSourceFile(
          `${file.absolute}#inline-${inline.line}.js`,
          paddedSource,
          ts.ScriptTarget.Latest,
          true,
          inline.module ? ts.ScriptKind.JS : ts.ScriptKind.JS
        );
        const moduleId = `symbol:javascript:${file.relative}#inline-script:${inline.line}`;
        addNode(nodes, sourceNode(moduleId, "inline_script", `inline script @${inline.line}`, file.relative, sourceFile, sourceFile, {
          category: "module",
          qualifiedName: `${file.relative} inline script @${inline.line}`,
          metrics: { lines: lineCount(inline.source), methods: 0, properties: 0 },
          attributes: { inline: true, module: inline.module }
        }));
        addEdge(edges, fileNodeId(file.relative), moduleId, "defines", "typescript-inline");
        sourceFiles.push({ file, sourceFile, moduleId, inline: true });
      }
    }

    for (const { file, sourceFile, moduleId, inline } of sourceFiles) {
      const fileId = fileNodeId(file.relative);
      const cssModuleImports = collectImports(
        sourceFile,
        file,
        context.root,
        context.files,
        nodes,
        edges,
        project.options
      );
      visitStatements(sourceFile.statements, {
        file,
        sourceFile,
        parentId: moduleId,
        parentName: inline ? `${file.relative}.inline` : file.relative,
        nodes,
        edges,
        declarationsByName,
        pendingCalls,
        pendingTypeUses,
        semanticIds,
        checker,
        cssModuleImports,
        pendingAssets
      });
      collectModuleLevelBehavior(sourceFile, moduleId, file.relative, pendingCalls, pendingTypeUses);
      collectStaticAssets(sourceFile, moduleId, file.relative, pendingAssets);
    }

    for (const pending of pendingCalls) {
      const semanticTarget = resolveSemanticNodeId(checker, pending.expression, semanticIds);
      const target = semanticTarget || bestDeclaration(declarationsByName.get(pending.name), pending.file);
      if (target && target !== pending.from) {
        addEdge(edges, pending.from, target, "calls", semanticTarget ? "typescript-checker" : "typescript-compiler", semanticTarget ? 0.98 : 0.82);
      } else if (!target && pending.name) {
        const externalId = `external:javascript:${encodeURIComponent(pending.name)}`;
        addNode(nodes, {
          id: externalId,
          kind: "external_symbol",
          category: "callable",
          language: "javascript",
          name: pending.name,
          qualifiedName: pending.name,
          file: "",
          line: 1,
          column: 1,
          metrics: {},
          attributes: { external: true, unresolved: true },
          source: "typescript-compiler",
          confidence: 0.6
        });
        edges.push({
          from: pending.from,
          to: externalId,
          kind: "calls",
          source: "typescript-unresolved",
          confidence: 0.6,
          inferred: true
        });
      }
    }
    for (const pending of pendingTypeUses) {
      const semanticTarget = resolveSemanticNodeId(checker, pending.expression, semanticIds);
      const target = semanticTarget || bestDeclaration(declarationsByName.get(pending.name), pending.file);
      if (target && target !== pending.from) {
        addEdge(edges, pending.from, target, pending.kind, semanticTarget ? "typescript-checker" : "typescript-compiler", semanticTarget ? 0.98 : 0.8);
      }
    }
    for (const asset of pendingAssets) {
      if (asset.dynamic) {
        const node = dynamicImageAssetNode(asset);
        addNode(nodes, node);
        addEdge(edges, "repo:root", node.id, "contains", asset.source || "javascript-dynamic-asset", 1);
        addEdge(edges, asset.from, node.id, "displays", asset.source || "javascript-dynamic-asset", 0.45, {
          inferred: true,
          expression: asset.expression
        });
        continue;
      }
      const node = await createWebAssetNode(context.root, asset.file, asset.reference, {
        hint: asset.hint,
        responsive: asset.responsive,
        descriptor: asset.descriptor,
        source: asset.source || "javascript-asset"
      });
      addNode(nodes, node);
      addEdge(edges, asset.from, node.id, relationshipForAssetKind(node.kind), asset.source || "javascript-asset", 0.96, {
        role: asset.role || null,
        broken: node.attributes.broken,
        responsive: asset.responsive === true,
        descriptor: asset.descriptor || null
      });
    }

    return {
      fragment: { nodes: [...nodes.values()], edges: uniqueEdges(edges) },
      diagnostics: {
        adapter: "typescript",
        filesScanned: files.length,
        nodesByKind: countBy([...nodes.values()], "kind"),
        edgesByKind: countBy(edges, "kind"),
        semanticIndex: "typescript-program",
        semanticEdges: edges.filter((edge) => edge.source === "typescript-checker").length,
        configFile: project.configFile,
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
  const {
    file, sourceFile, parentId, parentName, nodes, edges, declarationsByName,
    pendingCalls, pendingTypeUses, semanticIds, checker, cssModuleImports
  } = context;
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
      metrics: { lines: sourceLineSpan(sourceFile, node), methods: 0, properties: 0 },
      attributes: {
        ...frameworkAttributes(file.relative, sourceFile, kind === "react_component"),
        semanticName: semanticName(checker, node.name)
      }
    }));
    addEdge(edges, parentId, id, "defines", "typescript-compiler");
    if (isExported(node)) addEdge(edges, parentId, id, "exports", "typescript-compiler");
    registerDeclaration(declarationsByName, name, id, file.relative);
    registerSemanticDeclaration(semanticIds, node, id);
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
      metrics: callableMetrics(sourceFile, node),
      attributes: {
        ...frameworkAttributes(file.relative, sourceFile, react),
        semanticName: semanticName(checker, node.name),
        cssModuleClasses: cssModuleClassReferences(node, cssModuleImports)
      }
    }));
    addEdge(edges, parentId, id, "defines", "typescript-compiler");
    if (isExported(node)) addEdge(edges, parentId, id, "exports", "typescript-compiler");
    registerDeclaration(declarationsByName, name, id, file.relative);
    registerSemanticDeclaration(semanticIds, node, id);
    collectCallsAndTypes(node.body, id, file.relative, pendingCalls, pendingTypeUses);
    analyzeJavaScriptBody(node, id, context);
    visitNestedDeclarations(node.body, { ...context, parentId: id, parentName: qualified(parentName, name) });
    return;
  }

  if (ts.isVariableStatement(node)) {
    for (const declaration of node.declarationList.declarations) {
      for (const nameNode of bindingIdentifiers(declaration.name)) {
      const name = nameNode.text;
      const react = /^[A-Z]/.test(name) && declaration.initializer && containsJsx(declaration.initializer);
      const initializerFunction = declaration.initializer
        && (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer));
      const kind = react ? "react_component" : initializerFunction ? "function" : "variable";
      const id = symbolNodeId(file.relative, parentName, name, kind, sourceFile, declaration);
      addNode(nodes, sourceNode(id, kind, name, file.relative, sourceFile, declaration, {
        qualifiedName: qualified(parentName, name),
        metrics: initializerFunction ? callableMetrics(sourceFile, declaration.initializer) : {},
        attributes: {
          ...frameworkAttributes(file.relative, sourceFile, react),
          semanticName: semanticName(checker, nameNode),
          cssModuleClasses: cssModuleClassReferences(declaration.initializer, cssModuleImports)
        }
      }));
      addEdge(edges, parentId, id, "defines", "typescript-compiler");
      if (isExported(node)) addEdge(edges, parentId, id, "exports", "typescript-compiler");
      registerDeclaration(declarationsByName, name, id, file.relative);
      registerSemanticDeclaration(semanticIds, nameNode, id);
      collectCallsAndTypes(declaration.initializer, id, file.relative, pendingCalls, pendingTypeUses);
      analyzeJavaScriptBody(declaration.initializer, id, context);
      visitObjectMembers(declaration.initializer, { ...context, parentId: id, parentName: qualified(parentName, name) });
      if (initializerFunction) {
        visitNestedDeclarations(declaration.initializer.body, { ...context, parentId: id, parentName: qualified(parentName, name) });
      }
      }
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
    metrics: callable ? callableMetrics(context.sourceFile, node) : {},
    attributes: {
      semanticName: semanticName(context.checker, node.name),
      cssModuleClasses: cssModuleClassReferences(node, context.cssModuleImports)
    }
  }));
  addEdge(context.edges, context.parentId, id, "defines", "typescript-compiler");
  registerSemanticDeclaration(context.semanticIds, node, id);
  const parent = context.nodes.get(context.parentId);
  if (parent) {
    const metric = callable ? "methods" : "properties";
    parent.metrics[metric] = (parent.metrics[metric] || 0) + 1;
  }
  collectCallsAndTypes(node.body || node.initializer, id, context.file.relative, context.pendingCalls, context.pendingTypeUses);
  analyzeJavaScriptBody(node, id, context);
  visitNestedDeclarations(node.body, { ...context, parentId: id, parentName: qualified(context.parentName, name) });
}

function collectImports(sourceFile, file, root, files, nodes, edges, compilerOptions) {
  const cssModuleImports = new Map();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
    const specifier = statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
      ? statement.moduleSpecifier.text
      : null;
    if (!specifier) continue;
    const resolvedFile = resolveProjectModule(file, specifier, files, compilerOptions);
    if (resolvedFile) {
      addEdge(edges, fileNodeId(file.relative), fileNodeId(resolvedFile), ts.isExportDeclaration(statement) ? "exports" : "imports", "typescript-compiler");
      if (/\.module\.css$/i.test(resolvedFile) && ts.isImportDeclaration(statement)) {
        importBindingNames(statement.importClause).forEach((name) => cssModuleImports.set(name, resolvedFile));
      }
    } else {
      const moduleId = `module:${specifier}`;
      addNode(nodes, {
        id: moduleId, kind: "module", category: "module", language: null, name: specifier,
        qualifiedName: specifier, file: "", line: 1, column: 1, metrics: {}, attributes: {}
      });
      addEdge(edges, fileNodeId(file.relative), moduleId, ts.isExportDeclaration(statement) ? "exports" : "imports", "typescript-compiler");
    }
  }
  const visit = (node) => {
    const dynamicImport = ts.isCallExpression(node)
      && (node.expression.kind === ts.SyntaxKind.ImportKeyword
        || (ts.isIdentifier(node.expression) && node.expression.text === "require"))
      && node.arguments.length > 0
      && ts.isStringLiteralLike(node.arguments[0]);
    if (dynamicImport) {
      addResolvedModuleEdge(
        file,
        node.arguments[0].text,
        files,
        compilerOptions,
        nodes,
        edges,
        "imports",
        node.expression.kind === ts.SyntaxKind.ImportKeyword ? "typescript-dynamic-import" : "commonjs"
      );
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return cssModuleImports;
}

function addResolvedModuleEdge(file, specifier, files, compilerOptions, nodes, edges, kind, source) {
  const resolvedFile = resolveProjectModule(file, specifier, files, compilerOptions);
  if (resolvedFile) {
    addEdge(edges, fileNodeId(file.relative), fileNodeId(resolvedFile), kind, source);
    return;
  }
  const moduleId = `module:${specifier}`;
  addNode(nodes, {
    id: moduleId, kind: "module", category: "module", language: null, name: specifier,
    qualifiedName: specifier, file: "", line: 1, column: 1, metrics: {}, attributes: {}
  });
  addEdge(edges, fileNodeId(file.relative), moduleId, kind, source);
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
      if (name) calls.push({ from, file, name, expression: child.expression });
    }
    if (ts.isTypeReferenceNode(child)) {
      const name = rootIdentifier(child.typeName);
      if (name) typeUses.push({ from, file, name, kind: "uses", expression: child.typeName });
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
}

function collectModuleLevelBehavior(sourceFile, from, file, calls, typeUses) {
  for (const statement of sourceFile.statements) {
    if (ts.isExpressionStatement(statement)) collectCallsAndTypes(statement, from, file, calls, typeUses);
  }
}

function collectStaticAssets(node, from, file, pendingAssets, source = "javascript-asset") {
  if (!node) return;
  const seen = new Set();
  const visit = (child) => {
    if (child !== node && ts.isFunctionLike(child)) return;
    if ((ts.isStringLiteralLike(child) || ts.isNoSubstitutionTemplateLiteral(child))
      && isStaticAssetReference(child.text)
      && !seen.has(child.text)) {
      seen.add(child.text);
      pendingAssets.push({ from, file, reference: child.text, source });
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
}

function analyzeJavaScriptBody(node, ownerId, context) {
  if (!node) return;
  const owner = context.nodes.get(ownerId);
  if (!owner) return;
  const domReferences = collectDomReferences(node);
  if (domReferences.length) owner.attributes.domReferences = domReferences;
  collectStaticAssets(node, ownerId, context.file.relative, context.pendingAssets);
  collectDynamicImageAssets(node, ownerId, context);
  collectJsxElements(node, ownerId, context);
}

function collectDynamicImageAssets(node, ownerId, context) {
  const visit = (child) => {
    let expression = null;
    if (ts.isBinaryExpression(child)
      && child.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && ts.isPropertyAccessExpression(child.left)
      && ["src", "poster"].includes(child.left.name.text)
      && !ts.isStringLiteralLike(child.right)) {
      expression = child.right;
    }
    if (ts.isCallExpression(child)
      && ts.isPropertyAccessExpression(child.expression)
      && child.expression.name.text === "setAttribute"
      && ts.isStringLiteralLike(child.arguments[0])
      && ["src", "poster"].includes(child.arguments[0].text)
      && child.arguments[1]
      && !ts.isStringLiteralLike(child.arguments[1])) {
      expression = child.arguments[1];
    }
    if (expression) {
      const location = locationFor(context.sourceFile, expression);
      context.pendingAssets.push({
        from: ownerId,
        file: context.file.relative,
        dynamic: true,
        expression: expression.getText(context.sourceFile),
        line: location.line,
        column: location.column,
        source: "javascript-dynamic-asset"
      });
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
}

function collectDomReferences(node) {
  const references = new Map();
  const selectorBindings = new Map();
  const add = (operation, selector, event = null) => {
    if (!selector) return;
    const key = `${operation}|${selector}|${event || ""}`;
    references.set(key, { operation, selector, event });
  };
  const visit = (child) => {
    if (ts.isVariableDeclaration(child) && ts.isIdentifier(child.name)) {
      const selector = selectorFromExpression(child.initializer);
      if (selector) selectorBindings.set(child.name.text, selector);
    }
    if (ts.isCallExpression(child) && ts.isPropertyAccessExpression(child.expression)) {
      const method = child.expression.name.text;
      const first = child.arguments[0];
      const value = first && ts.isStringLiteralLike(first) ? first.text : null;
      if (method === "getElementById") add("select", `#${value}`);
      if (method === "getElementsByClassName") add("select", value ? `.${value.trim().split(/\s+/)[0]}` : null);
      if (method === "getElementsByTagName") add("select", value);
      if (["querySelector", "querySelectorAll", "matches", "closest"].includes(method)) add("select", value);
      if (method === "createElement") add("create", value);
      if (method === "addEventListener") {
        const receiver = child.expression.expression;
        const receiverSelector = selectorFromExpression(receiver)
          || (ts.isIdentifier(receiver) ? selectorBindings.get(receiver.text) : null);
        add("listen", receiverSelector, value);
      }
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  return [...references.values()];
}

function selectorFromExpression(expression) {
  if (!expression) return null;
  if (!ts.isCallExpression(expression) || !ts.isPropertyAccessExpression(expression.expression)) return null;
  const method = expression.expression.name.text;
  const value = expression.arguments[0] && ts.isStringLiteralLike(expression.arguments[0])
    ? expression.arguments[0].text
    : null;
  if (method === "getElementById") return value ? `#${value}` : null;
  if (method === "getElementsByClassName") return value ? `.${value.trim().split(/\s+/)[0]}` : null;
  if (["querySelector", "querySelectorAll", "matches", "closest"].includes(method)) return value;
  return null;
}

function collectJsxElements(root, ownerId, context) {
  if (!root) return;
  const jsxIds = new Map();
  const visit = (node, jsxParentId = null, jsxParentTag = null) => {
    if (node !== root && ts.isFunctionLike(node)) return;
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const opening = ts.isJsxElement(node) ? node.openingElement : node;
      const tag = opening.tagName.getText(context.sourceFile);
      const location = locationFor(context.sourceFile, opening);
      const id = `symbol:${languageId(context.file.relative)}:${context.file.relative}#jsx:${tag}:${location.line}:${location.column}`;
      const attributes = jsxAttributes(opening.attributes, context.sourceFile);
      const intrinsic = /^[a-z]/.test(tag);
      const mediaRole = ["img", "picture"].includes(tag)
        ? "image"
        : ["video", "audio"].includes(tag)
          ? tag
          : tag === "source" && ["picture", "video", "audio"].includes(jsxParentTag)
            ? jsxParentTag === "picture" ? "image" : jsxParentTag
            : null;
      addNode(context.nodes, sourceNode(id, "jsx_element", jsxElementName(tag, attributes), context.file.relative, context.sourceFile, node, {
        category: intrinsic ? "markup" : "component",
        qualifiedName: `${context.file.relative} JSX ${tag}@${location.line}`,
        attributes: {
          tag,
          intrinsic,
          component: !intrinsic,
          id: attributes.id || null,
          classes: String(attributes.className || attributes.class || "").split(/\s+/).filter(Boolean),
          href: attributes.href || null,
          navigation: tag === "a" && Boolean(attributes.href),
          src: attributes.src || null,
          srcset: attributes.srcSet || attributes.srcset || null,
          alt: tag === "img" ? attributes.alt ?? null : null,
          altStatus: tag === "img"
            ? attributes.alt == null ? "missing" : String(attributes.alt).trim() ? "described" : "decorative"
            : null,
          image: mediaRole === "image",
          media: ["img", "picture", "source", "video", "audio"].includes(tag),
          mediaRole
        }
      }));
      addEdge(context.edges, jsxParentId || ownerId, id, "contains", "typescript-jsx");
      jsxIds.set(node, id);
      for (const [attributeName, hint] of [["src", null], ["poster", "image"]]) {
        if (attributes[attributeName] && isStaticAssetReference(attributes[attributeName])) {
          context.pendingAssets.push({
            from: id,
            file: context.file.relative,
            reference: attributes[attributeName],
            hint,
            source: "typescript-jsx"
          });
        }
        if (attributes[`${attributeName}Expression`]) {
          context.pendingAssets.push({
            from: id,
            file: context.file.relative,
            dynamic: true,
            expression: attributes[`${attributeName}Expression`],
            line: location.line,
            column: location.column,
            hint: hint || mediaRole,
            source: "typescript-jsx-dynamic"
          });
        }
      }
      for (const candidate of parseSrcset(attributes.srcSet || attributes.srcset)) {
        context.pendingAssets.push({
          from: id,
          file: context.file.relative,
          reference: candidate.source,
          hint: mediaRole,
          descriptor: candidate.descriptor,
          responsive: true,
          source: "typescript-jsx"
        });
      }
      const nextParentId = id;
      if (ts.isJsxElement(node)) {
        for (const child of node.children) visit(child, nextParentId, tag);
      }
      return;
    }
    ts.forEachChild(node, (child) => visit(child, jsxParentId, jsxParentTag));
  };
  visit(root);
}

function jsxAttributes(attributes, sourceFile) {
  const result = {};
  for (const property of attributes.properties || []) {
    if (!ts.isJsxAttribute(property)) continue;
    const name = property.name.text;
    if (!property.initializer) result[name] = "";
    else if (ts.isStringLiteral(property.initializer)) result[name] = property.initializer.text;
    else if (ts.isJsxExpression(property.initializer)
      && property.initializer.expression
      && (ts.isStringLiteralLike(property.initializer.expression)
        || ts.isNoSubstitutionTemplateLiteral(property.initializer.expression))) {
      result[name] = property.initializer.expression.text;
    } else if (ts.isJsxExpression(property.initializer) && property.initializer.expression) {
      result[`${name}Expression`] = property.initializer.expression.getText(sourceFile);
    }
  }
  return result;
}

function dynamicImageAssetNode(asset) {
  const expression = String(asset.expression || "dynamic image");
  return {
    id: `asset:image:dynamic:${encodeURIComponent(asset.file)}:${asset.line || 1}:${asset.column || 1}:${encodeURIComponent(expression).slice(0, 80)}`,
    kind: "image_asset",
    category: "asset",
    language: null,
    name: expression,
    qualifiedName: `${asset.file}:${expression}`,
    file: "",
    line: 1,
    column: 1,
    metrics: {},
    attributes: {
      dynamic: true,
      unresolved: true,
      expression,
      path: null,
      exists: null,
      mediaType: "image"
    },
    source: asset.source || "javascript-dynamic-asset",
    confidence: 0.45
  };
}

function jsxElementName(tag, attributes) {
  if (tag === "img") return String(attributes.alt || "").trim() || basename(String(attributes.src || "")) || "img";
  if (tag === "a") return attributes.href || "link";
  return attributes.id ? `#${attributes.id}` : tag;
}

function visitNestedDeclarations(node, context) {
  if (!node) return;
  const visit = (child) => {
    if (ts.isFunctionDeclaration(child) || ts.isVariableStatement(child)) {
      visitDeclaration(child, context);
      return;
    }
    if (ts.isFunctionLike(child) && child !== node) return;
    ts.forEachChild(child, visit);
  };
  ts.forEachChild(node, visit);
}

function visitObjectMembers(initializer, context) {
  if (!initializer) return;
  if (!ts.isObjectLiteralExpression(initializer)) return;
  for (const property of initializer.properties) {
    const name = propertyName(property.name);
    if (!name) continue;
    const callable = ts.isMethodDeclaration(property)
      || (ts.isPropertyAssignment(property)
        && (ts.isArrowFunction(property.initializer) || ts.isFunctionExpression(property.initializer)));
    const kind = callable ? "method" : "property";
    const id = symbolNodeId(context.file.relative, context.parentName, name, kind, context.sourceFile, property);
    addNode(context.nodes, sourceNode(id, kind, name, context.file.relative, context.sourceFile, property, {
      qualifiedName: qualified(context.parentName, name),
      metrics: callable ? callableMetrics(context.sourceFile, property) : {}
    }));
    addEdge(context.edges, context.parentId, id, "defines", "typescript-compiler");
    if (callable) {
      const body = ts.isMethodDeclaration(property) ? property.body : property.initializer.body;
      collectCallsAndTypes(body, id, context.file.relative, context.pendingCalls, context.pendingTypeUses);
      analyzeJavaScriptBody(body, id, context);
    }
  }
}

function bindingIdentifiers(name) {
  if (ts.isIdentifier(name)) return [name];
  if (!ts.isObjectBindingPattern(name) && !ts.isArrayBindingPattern(name)) return [];
  return name.elements.flatMap((element) =>
    ts.isBindingElement(element) ? bindingIdentifiers(element.name) : []
  );
}

function isExported(node) {
  return (node.modifiers || []).some((modifier) =>
    modifier.kind === ts.SyntaxKind.ExportKeyword || modifier.kind === ts.SyntaxKind.DefaultKeyword
  );
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

function resolveProjectModule(file, specifier, files, compilerOptions) {
  const resolved = ts.resolveModuleName(specifier, file.absolute, compilerOptions, ts.sys).resolvedModule?.resolvedFileName;
  if (resolved) {
    const normalizedResolved = normalize(resolve(resolved));
    const match = files.find((candidate) => normalize(resolve(candidate.absolute)) === normalizedResolved);
    if (match) return match.relative;
  }
  return resolveLocalModule(file.relative, specifier, files);
}

function resolveLocalModule(sourceFile, specifier, files) {
  if (!specifier.startsWith(".")) return null;
  const base = normalize(join(dirname(sourceFile), specifier)).replaceAll("\\", "/");
  const assetExtensions = [...SCRIPT_EXTENSIONS, ".css", ".html", ".htm"];
  const candidates = [base, ...assetExtensions.map((extension) => `${base}${extension}`)];
  for (const extension of SCRIPT_EXTENSIONS) candidates.push(`${base}/index${extension}`);
  return candidates.find((candidate) => files.some((file) => file.relative === candidate)) || null;
}

function loadTypeScriptProject(root, files) {
  const configFile = ts.findConfigFile(root, ts.sys.fileExists, "tsconfig.json")
    || ts.findConfigFile(root, ts.sys.fileExists, "jsconfig.json");
  let options = {
    allowJs: true,
    checkJs: false,
    jsx: ts.JsxEmit.Preserve,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    target: ts.ScriptTarget.ES2022,
    skipLibCheck: true,
    noEmit: true
  };
  if (configFile) {
    const config = ts.readConfigFile(configFile, ts.sys.readFile);
    if (!config.error) {
      const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, dirname(configFile), options, configFile);
      options = { ...options, ...parsed.options, noEmit: true };
    }
  }
  const rootNames = files.map((file) => file.absolute);
  return {
    configFile: configFile ? relative(root, configFile).replaceAll("\\", "/") : null,
    options,
    program: ts.createProgram({ rootNames, options })
  };
}

function extractInlineScripts(file, html) {
  const document = parse(html, { sourceCodeLocationInfo: true });
  const scripts = [];
  const visit = (node) => {
    if (node.tagName?.toLowerCase() === "script") {
      const attributes = Object.fromEntries((node.attrs || []).map((attribute) => [attribute.name, attribute.value]));
      const executable = !attributes.src
        && !attributes.type
          ? true
          : !attributes.src && /^(?:module|text\/javascript|application\/javascript)$/i.test(attributes.type || "");
      if (executable) {
        const textNode = (node.childNodes || []).find((child) => child.nodeName === "#text");
        const source = textNode?.value || "";
        if (source.trim()) {
          scripts.push({
            source,
            line: textNode?.sourceCodeLocation?.startLine || node.sourceCodeLocation?.startTag?.endLine || 1,
            module: attributes.type?.toLowerCase() === "module"
          });
        }
      }
    }
    for (const child of node.childNodes || []) visit(child);
    if (node.content) visit(node.content);
  };
  visit(document);
  return scripts;
}

function registerSemanticDeclaration(map, declaration, id) {
  map.set(declaration, id);
  if (declaration.name) map.set(declaration.name, id);
}

export function resolveSemanticNodeId(checker, expression, semanticIds) {
  if (!expression) return null;
  try {
    let symbol = checker.getSymbolAtLocation(expression);
    if (!symbol && ts.isPropertyAccessExpression(expression)) symbol = checker.getSymbolAtLocation(expression.name);
    if (!symbol) return null;
    if (symbol.flags & ts.SymbolFlags.Alias) {
      symbol = checker.getAliasedSymbol(symbol);
    }
    if (!symbol) return null;
    for (const declaration of symbol.declarations || []) {
      if (semanticIds.has(declaration)) return semanticIds.get(declaration);
      if (declaration.parent && semanticIds.has(declaration.parent)) return semanticIds.get(declaration.parent);
    }
  } catch {
    return null;
  }
  return null;
}

export function semanticName(checker, nameNode) {
  if (!nameNode) return null;
  try {
    const symbol = checker.getSymbolAtLocation(nameNode);
    if (!symbol) return null;
    return checker.getFullyQualifiedName(symbol).replace(/^".*"\./, "");
  } catch {
    return null;
  }
}

function importBindingNames(importClause) {
  if (!importClause) return [];
  const names = [];
  if (importClause.name) names.push(importClause.name.text);
  if (importClause.namedBindings && ts.isNamespaceImport(importClause.namedBindings)) {
    names.push(importClause.namedBindings.name.text);
  }
  if (importClause.namedBindings && ts.isNamedImports(importClause.namedBindings)) {
    names.push(...importClause.namedBindings.elements.map((element) => element.name.text));
  }
  return names;
}

function cssModuleClassReferences(node, cssModuleImports) {
  if (!node || !cssModuleImports?.size) return [];
  const references = new Map();
  const visit = (child) => {
    if (ts.isPropertyAccessExpression(child) && ts.isIdentifier(child.expression)) {
      const file = cssModuleImports.get(child.expression.text);
      if (file) references.set(`${file}|${child.name.text}`, { file, className: child.name.text });
    }
    if (ts.isElementAccessExpression(child) && ts.isIdentifier(child.expression) && ts.isStringLiteral(child.argumentExpression)) {
      const file = cssModuleImports.get(child.expression.text);
      if (file) references.set(`${file}|${child.argumentExpression.text}`, { file, className: child.argumentExpression.text });
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  return [...references.values()];
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

function addEdge(edges, from, to, kind, source, confidence = 0.95, attributes = {}) {
  edges.push({ from, to, kind, source, confidence, inferred: false, ...attributes });
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
