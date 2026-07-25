import { parse } from "parse5";
import postcss from "postcss";
import { readFile } from "node:fs/promises";
import { basename, dirname, join, normalize } from "node:path";

const WEB_EXTENSIONS = new Set([".html", ".htm", ".css"]);
const ARCHITECTURAL_TAGS = new Set(["main", "nav", "header", "footer", "section", "article", "form", "template", "dialog"]);

export const webAssetsAdapter = {
  id: "web-assets",
  displayName: "HTML / CSS",
  version: 1,
  languages: ["html", "css"],
  extensions: [...WEB_EXTENSIONS],
  profiles: ["fast", "balanced", "accurate"],
  async scan(context) {
    const files = context.files.filter((file) => WEB_EXTENSIONS.has(file.extension));
    const nodes = new Map();
    const edges = [];
    const htmlTargets = [];
    const cssSelectors = [];
    const linkedAssets = [];
    const warnings = [];

    for (const file of files) {
      const source = await readFile(file.absolute, "utf8");
      if (file.extension === ".css") {
        try {
          scanCss(file, source, nodes, edges, cssSelectors);
        } catch (error) {
          warnings.push(`${file.relative}: ${error.reason || error.message}`);
        }
      } else {
        scanHtml(file, source, nodes, edges, htmlTargets, linkedAssets);
      }
    }

    const knownFiles = new Set(files.map((file) => file.relative));
    for (const asset of linkedAssets) {
      const target = resolveAsset(asset.file, asset.href);
      if (!target || !knownFiles.has(target)) continue;
      edges.push({
        from: asset.from,
        to: fileNodeId(target),
        kind: asset.kind,
        source: "html-parser",
        confidence: 0.98,
        inferred: false
      });
    }

    for (const selector of cssSelectors) {
      for (const target of htmlTargets) {
        if (!selectorMatches(selector.selector, target)) continue;
        edges.push({
          from: selector.id,
          to: target.id,
          kind: "styles",
          source: "css-selector",
          confidence: selector.selector.includes("#") ? 0.98 : 0.88,
          inferred: false
        });
      }
    }

    return {
      fragment: { nodes: [...nodes.values()], edges: uniqueEdges(edges) },
      diagnostics: {
        adapter: "web-assets",
        filesScanned: files.length,
        nodesByKind: countBy([...nodes.values()], "kind"),
        edgesByKind: countBy(edges, "kind"),
        warnings
      }
    };
  }
};

function scanHtml(file, source, nodes, edges, targets, assets) {
  const document = parse(source, { sourceCodeLocationInfo: true });
  const fileId = fileNodeId(file.relative);
  addNode(nodes, sourceNode(fileId, "file", basename(file.relative), "html", file.relative, 1, 1, {
    metrics: { lines: source.split(/\r?\n/).length }
  }));
  edges.push(edge("repo:root", fileId, "contains", "html-parser"));
  const documentId = `symbol:html:${file.relative}#document`;
  addNode(nodes, sourceNode(documentId, "html_document", basename(file.relative), "html", file.relative, 1, 1));
  edges.push(edge(fileId, documentId, "defines", "html-parser"));

  walkHtml(document, (node) => {
    if (!node.tagName) return;
    const attributes = Object.fromEntries((node.attrs || []).map((attribute) => [attribute.name, attribute.value]));
    const location = node.sourceCodeLocation?.startTag || node.sourceCodeLocation;
    if (node.tagName === "script" && attributes.src) {
      assets.push({ from: documentId, file: file.relative, href: attributes.src, kind: "loads" });
    }
    if (node.tagName === "link" && attributes.rel?.split(/\s+/).includes("stylesheet") && attributes.href) {
      assets.push({ from: documentId, file: file.relative, href: attributes.href, kind: "loads" });
    }
    if (!attributes.id && !attributes.class && !ARCHITECTURAL_TAGS.has(node.tagName)) return;
    const identity = attributes.id
      ? `#${attributes.id}`
      : attributes.class
        ? `.${attributes.class.trim().split(/\s+/)[0]}`
        : node.tagName;
    const line = location?.startLine || 1;
    const id = `symbol:html:${file.relative}#${node.tagName}${identity}:${line}`;
    addNode(nodes, sourceNode(id, "html_element", identity, "html", file.relative, line, location?.startCol || 1, {
      qualifiedName: `${basename(file.relative)} ${node.tagName}${identity}`,
      attributes: { tag: node.tagName, id: attributes.id || null, classes: attributes.class?.trim().split(/\s+/).filter(Boolean) || [] }
    }));
    edges.push(edge(documentId, id, "contains", "html-parser"));
    targets.push({ id, tag: node.tagName, htmlId: attributes.id || null, classes: attributes.class?.trim().split(/\s+/).filter(Boolean) || [] });
  });
}

function scanCss(file, source, nodes, edges, selectors) {
  const root = postcss.parse(source, { from: file.relative });
  const fileId = fileNodeId(file.relative);
  addNode(nodes, sourceNode(fileId, "file", basename(file.relative), "css", file.relative, 1, 1, {
    metrics: { lines: source.split(/\r?\n/).length }
  }));
  edges.push(edge("repo:root", fileId, "contains", "postcss"));
  const sheetId = `symbol:css:${file.relative}#stylesheet`;
  addNode(nodes, sourceNode(sheetId, "stylesheet", basename(file.relative), "css", file.relative, 1, 1));
  edges.push(edge(fileId, sheetId, "defines", "postcss"));

  root.walkRules((rule) => {
    const line = rule.source?.start?.line || 1;
    const column = rule.source?.start?.column || 1;
    const id = `symbol:css:${file.relative}#${rule.selector}:${line}`;
    addNode(nodes, sourceNode(id, "css_rule", rule.selector, "css", file.relative, line, column, {
      qualifiedName: `${basename(file.relative)} ${rule.selector}`,
      metrics: { properties: rule.nodes?.filter((node) => node.type === "decl").length || 0 }
    }));
    edges.push(edge(sheetId, id, "defines", "postcss"));
    selectors.push({ id, selector: rule.selector });
  });

  root.walkAtRules("keyframes", (rule) => {
    const line = rule.source?.start?.line || 1;
    const id = `symbol:css:${file.relative}#keyframes:${rule.params}:${line}`;
    addNode(nodes, sourceNode(id, "keyframes", rule.params, "css", file.relative, line, rule.source?.start?.column || 1));
    edges.push(edge(sheetId, id, "defines", "postcss"));
  });
}

function selectorMatches(selector, target) {
  const alternatives = selector.split(",");
  return alternatives.some((part) => {
    const ids = [...part.matchAll(/#([A-Za-z_][\w-]*)/g)].map((match) => match[1]);
    const classes = [...part.matchAll(/\.([A-Za-z_][\w-]*)/g)].map((match) => match[1]);
    const tagMatch = part.trim().match(/^([A-Za-z][\w-]*)/);
    if (ids.length && !ids.includes(target.htmlId)) return false;
    if (classes.length && !classes.some((name) => target.classes.includes(name))) return false;
    if (tagMatch && tagMatch[1].toLowerCase() !== target.tag) return false;
    return ids.length > 0 || classes.length > 0 || Boolean(tagMatch);
  });
}

function resolveAsset(sourceFile, href) {
  const clean = String(href).split(/[?#]/)[0];
  if (!clean || /^(?:https?:)?\/\//.test(clean) || clean.startsWith("data:")) return null;
  return normalize(join(dirname(sourceFile), clean)).replaceAll("\\", "/").replace(/^\.\//, "");
}

function sourceNode(id, kind, name, language, file, line, column, extra = {}) {
  return {
    id, kind, language, name, qualifiedName: extra.qualifiedName || name,
    file, line, column, endLine: line, endColumn: column,
    metrics: extra.metrics || {}, attributes: extra.attributes || {},
    source: language === "css" ? "postcss" : "html-parser",
    confidence: 0.98
  };
}

function fileNodeId(file) {
  return `file:${file}`;
}

function edge(from, to, kind, source) {
  return { from, to, kind, source, confidence: 0.98, inferred: false };
}

function walkHtml(node, visitor) {
  visitor(node);
  for (const child of node.childNodes || []) walkHtml(child, visitor);
  if (node.content) walkHtml(node.content, visitor);
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
