import { parse } from "parse5";
import postcss from "postcss";
import { readFile } from "node:fs/promises";
import { basename, normalize } from "node:path";
import {
  assetKindForReference,
  createWebAssetNode,
  isStaticAssetReference,
  parseSrcset,
  relationshipForAssetKind,
  resolveWebPath
} from "./web-asset-utils.js";

const WEB_EXTENSIONS = new Set([".html", ".htm", ".css"]);
const WEB_ASSET_FINGERPRINT_EXTENSIONS = [
  ".apng", ".avif", ".bmp", ".gif", ".ico", ".jpeg", ".jpg", ".png", ".svg", ".webp",
  ".mp4", ".m4v", ".mov", ".ogv", ".webm", ".aac", ".flac", ".m4a", ".mp3", ".oga", ".ogg", ".wav",
  ".eot", ".otf", ".ttf", ".woff", ".woff2", ".json", ".pdf", ".webmanifest"
];
const ARCHITECTURAL_TAGS = new Set(["main", "nav", "header", "footer", "section", "article", "form", "template", "dialog"]);
const CONTROL_TAGS = new Set(["button", "input", "select", "textarea", "details", "summary"]);
const MEDIA_TAGS = new Set(["img", "picture", "source", "video", "audio"]);
const EMBED_TAGS = new Set(["iframe", "embed", "object"]);
const SEMANTIC_TAGS = new Set([
  ...ARCHITECTURAL_TAGS, ...CONTROL_TAGS, ...MEDIA_TAGS, ...EMBED_TAGS,
  "a", "label", "svg", "script", "style", "link"
]);

export const webAssetsAdapter = {
  id: "web-assets",
  displayName: "HTML / CSS",
  version: 4,
  languages: ["html", "css"],
  extensions: [...WEB_EXTENSIONS],
  fingerprintExtensions: [...WEB_EXTENSIONS, ...WEB_ASSET_FINGERPRINT_EXTENSIONS],
  profiles: ["fast", "balanced", "accurate", "indexed"],
  async scan(context) {
    const files = context.files.filter((file) => WEB_EXTENSIONS.has(file.extension));
    const nodes = new Map();
    const edges = [];
    const htmlTargets = [];
    const cssSelectors = [];
    const linkedAssets = [];
    const navigationLinks = [];
    const webAssets = [];
    const warnings = [];

    for (const file of files) {
      const source = await readFile(file.absolute, "utf8");
      if (file.extension === ".css") {
        try {
          scanCss(file, source, nodes, edges, cssSelectors, webAssets);
        } catch (error) {
          warnings.push(`${file.relative}: ${error.reason || error.message}`);
        }
      } else {
        scanHtml(file, source, nodes, edges, htmlTargets, cssSelectors, linkedAssets, navigationLinks, webAssets, warnings);
      }
    }

    const knownFiles = new Set(files.map((file) => file.relative));
    for (const asset of linkedAssets) {
      const target = resolveWebPath(asset.file, asset.href, asset.baseHref);
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
    resolveNavigationLinks(files, nodes, edges, htmlTargets, navigationLinks);
    await resolveWebAssets(context.root, nodes, edges, webAssets, warnings);

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
        const targetNode = nodes.get(target.id);
        if (targetNode && (selector.cssWidth || selector.cssHeight)) {
          targetNode.attributes.cssWidth = selector.cssWidth || targetNode.attributes.cssWidth || null;
          targetNode.attributes.cssHeight = selector.cssHeight || targetNode.attributes.cssHeight || null;
        }
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

function scanHtml(file, source, nodes, edges, targets, cssSelectors, assets, navigationLinks, webAssets, warnings) {
  const document = parse(source, { sourceCodeLocationInfo: true });
  const baseHref = findHtmlBaseHref(document);
  const documentMetrics = htmlMetrics(document);
  const lines = physicalLineCount(source);
  const finalLine = source.split(/\r\n|\r|\n/)[Math.max(0, lines - 1)] || "";
  const fileId = fileNodeId(file.relative);
  addNode(nodes, sourceNode(fileId, "file", basename(file.relative), "html", file.relative, 1, 1, {
    endLine: Math.max(1, lines),
    endColumn: finalLine.length + 1,
    metrics: { lines, ...documentMetrics }
  }));
  edges.push(edge("repo:root", fileId, "contains", "html-parser"));
  const documentId = `symbol:html:${file.relative}#document`;
  addNode(nodes, sourceNode(documentId, "html_document", basename(file.relative), "html", file.relative, 1, 1, {
    endLine: Math.max(1, lines),
    endColumn: finalLine.length + 1,
    metrics: { lines, ...documentMetrics },
    attributes: {
      analyzedElements: documentMetrics.elements,
      metricModel: "full-dom"
    }
  }));
  edges.push(edge(fileId, documentId, "defines", "html-parser"));

  const emittedNodeIds = new Map();
  walkHtml(document, (node, parent) => {
    if (!node.tagName) return;
    const attributes = Object.fromEntries((node.attrs || []).map((attribute) => [attribute.name, attribute.value]));
    const location = node.sourceCodeLocation?.startTag || node.sourceCodeLocation;
    if (node.tagName === "script" && attributes.src) {
      assets.push({ from: documentId, file: file.relative, href: attributes.src, kind: "loads", baseHref });
      if (/^(?:https?:|\/\/)/i.test(attributes.src)) {
        webAssets.push({ from: documentId, file: file.relative, reference: attributes.src, context: "load", baseHref });
      }
    }
    if (node.tagName === "link" && attributes.rel?.split(/\s+/).includes("stylesheet") && attributes.href) {
      assets.push({ from: documentId, file: file.relative, href: attributes.href, kind: "loads", baseHref });
      if (/^(?:https?:|\/\/)/i.test(attributes.href)) {
        webAssets.push({ from: documentId, file: file.relative, reference: attributes.href, context: "load", baseHref });
      }
    }
    const tag = node.tagName.toLowerCase();
    const isAnchor = tag === "a" && Boolean(attributes.href);
    const mediaRole = mediaRoleForNode(node, parent);
    const isMediaElement = MEDIA_TAGS.has(tag);
    if (!attributes.id && !attributes.class && !SEMANTIC_TAGS.has(tag) && !isAnchor) return;
    const linkText = isAnchor ? textContent(node).replace(/\s+/g, " ").trim() : "";
    const mediaName = isMediaElement ? mediaElementName(tag, attributes, mediaRole) : "";
    const identity = attributes.id
      ? `#${attributes.id}`
      : attributes.class
        ? `.${attributes.class.trim().split(/\s+/)[0]}`
        : isAnchor
          ? linkText || attributes.href
          : isMediaElement
            ? mediaName
            : semanticElementName(tag, attributes, linkText);
    const line = location?.startLine || 1;
    const column = location?.startCol || 1;
    const endLocation = node.sourceCodeLocation?.endTag || node.sourceCodeLocation || location;
    const endLine = endLocation?.endLine || location?.endLine || line;
    const endColumn = endLocation?.endCol || location?.endCol || column;
    const metrics = htmlMetrics(node);
    const id = isAnchor
      ? `symbol:html:${file.relative}#link:${line}:${column}`
      : isMediaElement
        ? `symbol:html:${file.relative}#media:${tag}:${line}:${column}`
        : `symbol:html:${file.relative}#${tag}${identity}:${line}:${column}`;
    addNode(nodes, sourceNode(id, "html_element", identity, "html", file.relative, line, column, {
      endLine,
      endColumn,
      qualifiedName: `${basename(file.relative)} ${node.tagName}${identity}`,
      metrics: { lines: Math.max(1, endLine - line + 1), ...metrics },
      attributes: {
        tag,
        id: attributes.id || null,
        classes: attributes.class?.trim().split(/\s+/).filter(Boolean) || [],
        href: isAnchor ? attributes.href : null,
        linkText: isAnchor ? linkText : null,
        navigation: isAnchor,
        image: mediaRole === "image",
        imageRole: mediaRole === "image" ? tag : null,
        media: isMediaElement,
        mediaRole,
        src: attributes.src || null,
        srcset: attributes.srcset || null,
        sizes: attributes.sizes || null,
        alt: tag === "img" ? attributes.alt ?? null : null,
        altStatus: tag === "img" ? imageAltStatus(attributes) : null,
        width: numericAttribute(attributes.width),
        height: numericAttribute(attributes.height),
        loading: ["img", "iframe"].includes(tag) ? attributes.loading || null : null,
        poster: tag === "video" ? attributes.poster || null : null,
        action: tag === "form" ? attributes.action || null : null,
        download: tag === "a" && Object.hasOwn(attributes, "download"),
        subtreeElements: metrics.elements,
        metricModel: "full-dom-subtree"
      }
    }));
    emittedNodeIds.set(node, id);
    const parentId = nearestEmittedParent(parent, emittedNodeIds) || documentId;
    edges.push(edge(parentId, id, "contains", "html-parser"));
    targets.push({
      id,
      file: file.relative,
      tag: node.tagName,
      htmlId: attributes.id || null,
      classes: attributes.class?.trim().split(/\s+/).filter(Boolean) || []
    });
    if (isAnchor) navigationLinks.push({ from: id, file: file.relative, href: attributes.href, baseHref });
    if (tag === "form" && attributes.action) {
      navigationLinks.push({ from: id, file: file.relative, href: attributes.action, kind: "submits_to", baseHref });
    }
    if (isMediaElement) {
      if (attributes.src) webAssets.push({
        from: id, file: file.relative, reference: attributes.src, hint: mediaRole, baseHref
      });
      for (const candidate of parseSrcset(attributes.srcset)) {
        webAssets.push({
          from: id,
          file: file.relative,
          reference: candidate.source,
          hint: mediaRole,
          descriptor: candidate.descriptor,
          responsive: true,
          baseHref
        });
      }
    }
    if (tag === "video" && attributes.poster) {
      webAssets.push({ from: id, file: file.relative, reference: attributes.poster, hint: "image", context: "poster", baseHref });
    }
    if (EMBED_TAGS.has(tag)) {
      const reference = attributes.src || attributes.data;
      if (reference) webAssets.push({ from: id, file: file.relative, reference, context: "embed", baseHref });
    }
    if (tag === "a" && attributes.download !== undefined && attributes.href) {
      webAssets.push({ from: id, file: file.relative, reference: attributes.href, context: "download", baseHref });
    }
    if (tag === "input" && attributes.type?.toLowerCase() === "image" && attributes.src) {
      webAssets.push({ from: id, file: file.relative, reference: attributes.src, hint: "image", baseHref });
    }
    if (tag === "link" && attributes.href && /\b(?:icon|manifest|preload)\b/i.test(attributes.rel || "")) {
      webAssets.push({ from: documentId, file: file.relative, reference: attributes.href, baseHref });
    }
    if (tag === "style") {
      const inlineCss = textContent(node);
      if (inlineCss.trim()) {
        try {
          scanCssRules(file, inlineCss, id, nodes, edges, cssSelectors, webAssets, line - 1, "inline-css");
        } catch (error) {
          warnings.push(`${file.relative}:${line}: ${error.reason || error.message}`);
        }
      }
    }
  });
}

async function resolveWebAssets(root, nodes, edges, assets, warnings) {
  for (const asset of assets) {
    if (!isStaticAssetReference(asset.reference) && !asset.context) continue;
    const node = await createWebAssetNode(root, asset.file, asset.reference, {
      hint: asset.hint,
      baseHref: asset.baseHref,
      responsive: asset.responsive,
      descriptor: asset.descriptor,
      source: "html-asset"
    });
    addNode(nodes, node);
    if (node.attributes.broken) warnings.push(`${asset.file}: missing asset ${node.attributes.path}`);
    edges.push({
      ...edge(asset.from, node.id, relationshipForAssetKind(node.kind, asset.context), "html-asset"),
      descriptor: asset.descriptor || null,
      responsive: asset.responsive === true,
      role: asset.context || asset.hint || null
    });
  }
}

function resolveNavigationLinks(files, nodes, edges, targets, navigationLinks) {
  const knownFiles = new Set(files.map((file) => file.relative));
  const targetsByFragment = new Map(
    targets.filter((target) => target.htmlId).map((target) => [`${target.file}#${target.htmlId}`, target.id])
  );
  for (const link of navigationLinks) {
    const rawHref = String(link.href || "").trim();
    const href = link.baseHref && /^(?:https?:)?\/\//i.test(link.baseHref) && !/^(?:[a-z]+:|\/\/|#)/i.test(rawHref)
      ? new URL(rawHref, link.baseHref.startsWith("//") ? `https:${link.baseHref}` : link.baseHref).href
      : rawHref;
    if (!href) continue;
    if (href.startsWith("#")) {
      const target = targetsByFragment.get(`${link.file}${href}`);
      if (target) {
        edges.push(edge(link.from, target, link.kind || "links_to", "html-link"));
      } else {
        const routeId = addWebDestination(nodes, href, false);
        edges.push(edge(link.from, routeId, link.kind || "links_to", "html-link"));
      }
      continue;
    }
    if (/^(?:https?:|mailto:|tel:|\/\/)/i.test(href)) {
      const moduleId = addWebDestination(nodes, href, true);
      edges.push(edge(link.from, moduleId, link.kind || "links_to", "html-link"));
      continue;
    }
    const [pathPart, fragment] = href.split("#", 2);
    const targetFile = pathPart
      ? pathPart.startsWith("/")
        ? normalize(pathPart).replaceAll("\\", "/").replace(/^\/+/, "")
        : resolveWebPath(link.file, pathPart, link.baseHref)
      : link.file;
    if (!targetFile || !knownFiles.has(targetFile)) {
      const routeId = addWebDestination(nodes, href, false);
      edges.push(edge(link.from, routeId, link.kind || "links_to", "html-link"));
      continue;
    }
    const fragmentTarget = fragment ? targetsByFragment.get(`${targetFile}#${fragment}`) : null;
    edges.push(edge(link.from, fragmentTarget || fileNodeId(targetFile), link.kind || "links_to", "html-link"));
  }
}

function addWebDestination(nodes, href, external) {
  const moduleId = `module:web-${external ? "link" : "route"}:${encodeURIComponent(href)}`;
  addNode(nodes, {
    id: moduleId,
    kind: "module",
    category: "module",
    language: null,
    name: external ? externalLinkName(href) : href,
    qualifiedName: href,
    file: "",
    line: 1,
    column: 1,
    metrics: {},
    attributes: { external, href, route: !external },
    source: "html-link",
    confidence: external ? 0.99 : 0.9
  });
  return moduleId;
}

function scanCss(file, source, nodes, edges, selectors, webAssets) {
  const root = postcss.parse(source, { from: file.relative });
  const fileId = fileNodeId(file.relative);
  addNode(nodes, sourceNode(fileId, "file", basename(file.relative), "css", file.relative, 1, 1, {
    metrics: { lines: source.split(/\r?\n/).length }
  }));
  edges.push(edge("repo:root", fileId, "contains", "postcss"));
  const sheetId = `symbol:css:${file.relative}#stylesheet`;
  addNode(nodes, sourceNode(sheetId, "stylesheet", basename(file.relative), "css", file.relative, 1, 1));
  edges.push(edge(fileId, sheetId, "defines", "postcss"));
  scanCssRules(file, source, sheetId, nodes, edges, selectors, webAssets, 0, "postcss", root);
}

function scanCssRules(file, source, ownerId, nodes, edges, selectors, webAssets, lineOffset = 0, sourceName = "postcss", parsedRoot = null) {
  const root = parsedRoot || postcss.parse(source, { from: file.relative });
  root.walkRules((rule) => {
    const line = (rule.source?.start?.line || 1) + lineOffset;
    const column = rule.source?.start?.column || 1;
    const id = `symbol:css:${file.relative}#${sourceName}:${rule.selector}:${line}`;
    addNode(nodes, sourceNode(id, "css_rule", rule.selector, "css", file.relative, line, column, {
      qualifiedName: `${basename(file.relative)} ${rule.selector}`,
      metrics: { properties: rule.nodes?.filter((node) => node.type === "decl").length || 0 },
      attributes: {
        selector: rule.selector,
        classes: [...rule.selector.matchAll(/\.([A-Za-z_][\w-]*)/g)].map((match) => match[1]),
        ids: [...rule.selector.matchAll(/#([A-Za-z_][\w-]*)/g)].map((match) => match[1])
      }
    }));
    edges.push(edge(ownerId, id, "defines", sourceName));
    const declarationMap = Object.fromEntries(
      (rule.nodes?.filter((node) => node.type === "decl") || []).map((declaration) => [declaration.prop, declaration.value])
    );
    selectors.push({
      id,
      selector: rule.selector,
      cssWidth: declarationMap.width || null,
      cssHeight: declarationMap.height || null
    });
    for (const declaration of rule.nodes?.filter((node) => node.type === "decl") || []) {
      if (declaration.prop.startsWith("--")) {
        const propertyLine = (declaration.source?.start?.line || rule.source?.start?.line || 1) + lineOffset;
        const propertyId = `symbol:css:${file.relative}#custom-property:${declaration.prop}:${propertyLine}`;
        addNode(nodes, sourceNode(propertyId, "css_custom_property", declaration.prop, "css", file.relative, propertyLine, declaration.source?.start?.column || 1, {
          attributes: { value: declaration.value }
        }));
        edges.push(edge(id, propertyId, "defines", sourceName));
      }
      for (const match of declaration.value.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi)) {
        if (match[2]) webAssets.push({ from: id, file: file.relative, reference: match[2], hint: declaration.prop === "src" ? "font" : null });
      }
    }
  });

  root.walkAtRules("keyframes", (rule) => {
    const line = (rule.source?.start?.line || 1) + lineOffset;
    const id = `symbol:css:${file.relative}#keyframes:${rule.params}:${line}`;
    addNode(nodes, sourceNode(id, "keyframes", rule.params, "css", file.relative, line, rule.source?.start?.column || 1));
    edges.push(edge(ownerId, id, "defines", sourceName));
  });
  root.walkAtRules("import", (rule) => {
    const reference = rule.params.match(/^(?:url\()?['"]?([^'")\s]+)/)?.[1];
    if (reference) webAssets.push({ from: ownerId, file: file.relative, reference, context: "load" });
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

function sourceNode(id, kind, name, language, file, line, column, extra = {}) {
  return {
    id, kind, language, name, qualifiedName: extra.qualifiedName || name,
    file, line, column, endLine: extra.endLine || line, endColumn: extra.endColumn || column,
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

function walkHtml(node, visitor, parent = null) {
  visitor(node, parent);
  for (const child of node.childNodes || []) walkHtml(child, visitor, node);
  if (node.content) walkHtml(node.content, visitor, node);
}

function textContent(node) {
  if (node.nodeName === "#text") return node.value || "";
  const children = [...(node.childNodes || []), ...(node.content ? [node.content] : [])];
  return children.map(textContent).join(" ");
}

function externalLinkName(href) {
  try {
    return new URL(href.startsWith("//") ? `https:${href}` : href).hostname || href;
  } catch {
    return href;
  }
}

function mediaElementName(tag, attributes, mediaRole) {
  if (["picture", "video", "audio"].includes(tag)) return tag;
  const source = attributes.src || parseSrcset(attributes.srcset)[0]?.source || "";
  if (tag === "img" && attributes.alt?.trim()) return attributes.alt.trim();
  return basename(String(source).split(/[?#]/)[0]) || mediaRole || tag;
}

function imageAltStatus(attributes) {
  if (!Object.hasOwn(attributes, "alt")) return "missing";
  return attributes.alt.trim() === "" ? "decorative" : "described";
}

function numericAttribute(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function mediaRoleForNode(node, parent) {
  const tag = node.tagName?.toLowerCase();
  if (tag === "img" || tag === "picture") return "image";
  if (tag === "video" || tag === "audio") return tag;
  if (tag !== "source") return null;
  let ancestor = parent;
  while (ancestor) {
    const ancestorTag = ancestor.tagName?.toLowerCase();
    if (ancestorTag === "picture") return "image";
    if (ancestorTag === "video" || ancestorTag === "audio") return ancestorTag;
    ancestor = ancestor.parentNode;
  }
  return assetKindForReference(
    Object.fromEntries((node.attrs || []).map((attribute) => [attribute.name, attribute.value])).src || ""
  ).replace(/_asset$/, "");
}

function semanticElementName(tag, attributes, text) {
  if (tag === "label" && text) return text;
  if (tag === "script") return attributes.src ? basename(attributes.src) : "inline script";
  if (tag === "style") return "inline style";
  if (tag === "link") return attributes.rel || "link";
  if (tag === "iframe") return attributes.title || basename(attributes.src || "") || "iframe";
  if (tag === "form") return attributes.name || attributes.action || "form";
  if (CONTROL_TAGS.has(tag)) return attributes.name || attributes.type || text || tag;
  return tag;
}

function nearestEmittedParent(parent, emittedNodeIds) {
  let current = parent;
  while (current) {
    const id = emittedNodeIds.get(current);
    if (id) return id;
    current = current.parentNode;
  }
  return null;
}

function findHtmlBaseHref(document) {
  let href = null;
  walkHtml(document, (node) => {
    if (href || node.tagName?.toLowerCase() !== "base") return;
    href = (node.attrs || []).find((attribute) => attribute.name === "href")?.value || null;
  });
  return href;
}

function htmlMetrics(root) {
  const metrics = {
    elements: 0,
    divs: 0,
    spans: 0,
    attributes: 0,
    eventHandlers: 0,
    conditionals: 0,
    templates: 0,
    controls: 0,
    images: 0,
    videos: 0,
    audios: 0,
    embeds: 0,
    missingAlt: 0,
    responsiveSources: 0,
    maxDepth: 0,
    nestingScore: 0
  };
  visitHtmlForMetrics(root, 0, metrics);
  const complexity = 1
    + metrics.elements * 0.45
    + metrics.nestingScore * 0.2
    + metrics.attributes * 0.08
    + metrics.eventHandlers * 0.75
    + metrics.conditionals * 0.9
    + metrics.templates * 0.8
    + metrics.controls * 0.35
    + metrics.images * 0.25
    + metrics.videos * 0.35
    + metrics.audios * 0.25
    + metrics.embeds * 0.4
    + metrics.missingAlt * 0.6
    + metrics.responsiveSources * 0.25;
  return { ...metrics, complexity: Math.round(complexity * 100) / 100 };
}

function visitHtmlForMetrics(node, depth, metrics) {
  const nextDepth = node.tagName ? depth + 1 : depth;
  if (node.tagName) {
    const tag = node.tagName.toLowerCase();
    const attributes = node.attrs || [];
    metrics.elements += 1;
    metrics.divs += tag === "div" ? 1 : 0;
    metrics.spans += tag === "span" ? 1 : 0;
    metrics.templates += tag === "template" ? 1 : 0;
    metrics.controls += CONTROL_TAGS.has(tag) ? 1 : 0;
    metrics.images += tag === "img" ? 1 : 0;
    metrics.videos += tag === "video" ? 1 : 0;
    metrics.audios += tag === "audio" ? 1 : 0;
    metrics.embeds += EMBED_TAGS.has(tag) ? 1 : 0;
    metrics.missingAlt += tag === "img" && !attributes.some((attribute) => attribute.name === "alt") ? 1 : 0;
    metrics.responsiveSources += (tag === "img" || tag === "source")
      && attributes.some((attribute) => attribute.name === "srcset") ? 1 : 0;
    metrics.attributes += attributes.length;
    metrics.eventHandlers += attributes.filter((attribute) => /^on/i.test(attribute.name)).length;
    metrics.conditionals += attributes.filter((attribute) =>
      /^(?:v-if|v-else-if|v-else|ng-if|\*ngif|x-if|data-if)$/i.test(attribute.name)
    ).length;
    metrics.maxDepth = Math.max(metrics.maxDepth, nextDepth);
    metrics.nestingScore += Math.max(0, nextDepth - 1);
  }
  for (const child of node.childNodes || []) visitHtmlForMetrics(child, nextDepth, metrics);
  if (node.content) visitHtmlForMetrics(node.content, nextDepth, metrics);
}

function physicalLineCount(source) {
  if (!source) return 0;
  const lines = source.split(/\r\n|\r|\n/).length;
  return /(?:\r\n|\r|\n)$/.test(source) ? lines - 1 : lines;
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
