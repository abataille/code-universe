import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { createWebAssetNode } from "./web-asset-utils.js";

const IMAGE_EXTENSIONS = new Set([".apng", ".avif", ".bmp", ".gif", ".ico", ".jpeg", ".jpg", ".png", ".svg", ".webp"]);
const SUPPORTED_LANGUAGES = ["swift", "javascript", "typescript", "html", "css", "csharp", "objective-c", "objective-cpp"];

export const projectAssetsAdapter = {
  id: "project-assets",
  displayName: "Project image assets",
  version: 1,
  languages: SUPPORTED_LANGUAGES,
  extensions: [...IMAGE_EXTENSIONS],
  fingerprintExtensions: [...IMAGE_EXTENSIONS, ".json", ".swift"],
  profiles: ["fast", "balanced", "accurate", "indexed"],
  async scan(context) {
    const imageFiles = context.files.filter((file) => IMAGE_EXTENSIONS.has(file.extension));
    const nodes = new Map();
    const edges = [];
    const assetsByName = new Map();

    for (const group of groupImageFiles(imageFiles)) {
      const variants = await Promise.all(group.files.map((file) =>
        createWebAssetNode(context.root, "", file.relative, { hint: "image", source: "project-assets" })
      ));
      const manifestFile = context.files.find((file) => file.relative === `${group.key}/Contents.json`);
      const manifest = manifestFile
        ? JSON.parse(await readFile(manifestFile.absolute, "utf8"))
        : {};
      const node = group.catalog ? catalogAssetNode(group, variants, manifest) : variants[0];
      nodes.set(node.id, node);
      edges.push({
        from: node.attributes.catalogPath
          ? `directory:${node.attributes.catalogPath}`
          : directoryNodeId(node.attributes.path) || "repo:root",
        to: node.id,
        kind: "contains",
        source: "project-assets",
        confidence: 1,
        inferred: false
      });
      for (const key of new Set(group.files.flatMap((file) => [...assetKeys(file.relative)]))) {
        if (!assetsByName.has(key)) assetsByName.set(key, []);
        assetsByName.get(key).push(node);
      }
    }

    for (const file of context.files.filter((candidate) => candidate.extension === ".swift")) {
      const source = await readFile(file.absolute, "utf8");
      for (const reference of swiftImageReferences(source)) {
        const candidates = lookupAssetKeys(reference.name)
          .flatMap((key) => assetsByName.get(key) || [])
          .filter((candidate, index, all) => all.findIndex((item) => item.id === candidate.id) === index);
        for (const asset of candidates) {
          edges.push({
            from: `file:${file.relative}`,
            to: asset.id,
            kind: "displays",
            source: "swift-image-reference",
            confidence: candidates.length === 1 ? 0.99 : 0.82,
            inferred: candidates.length !== 1,
            reference: reference.name,
            location: {
              file: file.relative,
              range: { start: reference.start, end: reference.end, precision: "exact" }
            }
          });
        }
      }
      for (const reference of swiftSystemImageReferences(source)) {
        const id = `asset:image:system:${encodeURIComponent(reference.name)}`;
        if (!nodes.has(id)) nodes.set(id, referencedImageNode(id, reference.name, {
          system: true,
          external: true,
          source: "sf-symbol"
        }));
        edges.push({ from: "repo:root", to: id, kind: "contains", source: "project-assets", confidence: 1, inferred: false });
        edges.push(swiftReferenceEdge(file.relative, reference, id, 1, false));
      }
      for (const reference of swiftDynamicImageReferences(source)) {
        const id = `asset:image:dynamic:${encodeURIComponent(file.relative)}:${reference.start.line}:${reference.start.column}`;
        nodes.set(id, referencedImageNode(id, reference.expression, {
          dynamic: true,
          unresolved: true,
          expression: reference.expression
        }));
        edges.push({ from: "repo:root", to: id, kind: "contains", source: "project-assets", confidence: 1, inferred: false });
        edges.push(swiftReferenceEdge(file.relative, reference, id, 0.45, true));
      }
    }

    return {
      fragment: { nodes: [...nodes.values()], edges: uniqueEdges(edges) },
      diagnostics: {
        adapter: "project-assets",
        filesScanned: imageFiles.length,
        nodesByKind: { image_asset: nodes.size },
        edgesByKind: countBy(edges, "kind")
      }
    };
  }
};

function logicalAssetName(path) {
  const parts = path.split("/");
  const imageSet = parts.find((part) => part.endsWith(".imageset"));
  return imageSet ? imageSet.slice(0, -".imageset".length) : basename(path, extname(path));
}

function assetKeys(path) {
  return new Set([
    logicalAssetName(path).toLowerCase(),
    normalizedAssetKey(logicalAssetName(path)),
    basename(path).toLowerCase(),
    basename(path, extname(path)).toLowerCase(),
    normalizedAssetKey(basename(path, extname(path)))
  ]);
}

function swiftImageReferences(source) {
  const patterns = [
    /\bImage\s*\(\s*(?:decorative\s*:\s*)?"([^"]+)"/g,
    /\b(?:UIImage|NSImage)\s*\(\s*named\s*:\s*"([^"]+)"/g
  ];
  const references = [];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const stringOffset = match.index + match[0].lastIndexOf(match[1]);
      references.push({
        name: match[1],
        start: lineColumn(source, stringOffset),
        end: lineColumn(source, stringOffset + match[1].length)
      });
    }
  }
  const symbolPatterns = [
    /\b(?:Image|UIImage|NSImage)\s*\(\s*(?:resource\s*:\s*)?\.([A-Za-z_]\w*)/g,
    /\bImageResource\.([A-Za-z_]\w*)/g
  ];
  for (const pattern of symbolPatterns) {
    for (const match of source.matchAll(pattern)) {
      const identifierOffset = match.index + match[0].lastIndexOf(match[1]);
      references.push({
        name: match[1],
        start: lineColumn(source, identifierOffset),
        end: lineColumn(source, identifierOffset + match[1].length)
      });
    }
  }
  return references;
}

function groupImageFiles(files) {
  const groups = new Map();
  for (const file of files) {
    const parts = file.relative.split("/");
    const imageSetIndex = parts.findIndex((part) => part.endsWith(".imageset"));
    const key = imageSetIndex >= 0 ? parts.slice(0, imageSetIndex + 1).join("/") : file.relative;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        catalog: imageSetIndex >= 0,
        name: imageSetIndex >= 0 ? parts[imageSetIndex].slice(0, -".imageset".length) : logicalAssetName(file.relative),
        files: []
      });
    }
    groups.get(key).files.push(file);
  }
  return [...groups.values()];
}

function catalogAssetNode(group, variants, manifest) {
  const catalogImages = manifest.images || [];
  const preview = [...variants].sort((left, right) =>
    Number(right.attributes.pixelWidth || 0) * Number(right.attributes.pixelHeight || 0)
      - Number(left.attributes.pixelWidth || 0) * Number(left.attributes.pixelHeight || 0)
  )[0];
  return {
    ...preview,
    id: `asset:image:xcasset:${encodeURIComponent(group.key)}`,
    name: group.name,
    qualifiedName: group.key,
    metrics: { bytes: variants.reduce((sum, item) => sum + Number(item.metrics?.bytes || 0), 0) },
    attributes: {
      ...preview.attributes,
      assetName: group.name,
      catalog: true,
      catalogPath: group.key,
      variants: variants.map((item) => {
        const catalogEntry = catalogImages.find((entry) => entry.filename === basename(item.attributes.path));
        return {
        path: item.attributes.path,
        bytes: item.metrics?.bytes || null,
        pixelWidth: item.attributes.pixelWidth || null,
        pixelHeight: item.attributes.pixelHeight || null,
        scale: catalogEntry?.scale || null,
        idiom: catalogEntry?.idiom || null,
        appearances: catalogEntry?.appearances || []
      };
      }),
      catalogProperties: {
        preservesVectorRepresentation: Boolean(manifest.properties?.["preserves-vector-representation"]),
        templateRenderingIntent: manifest.properties?.["template-rendering-intent"] || null
      }
    }
  };
}

function swiftSystemImageReferences(source) {
  return collectReferenceMatches(source, [
    /\bImage\s*\(\s*systemName\s*:\s*"([^"]+)"/g,
    /\b(?:UIImage|NSImage)\s*\(\s*systemName\s*:\s*"([^"]+)"/g
  ], (match) => ({ name: match[1] }));
}

function swiftDynamicImageReferences(source) {
  return collectReferenceMatches(source, [
    /\bImage\s*\(\s*(?![".])([A-Za-z_]\w*)\s*\)/g,
    /\b(?:UIImage|NSImage)\s*\(\s*named\s*:\s*(?!")([^,)]+)\s*\)/g
  ], (match) => ({ name: match[1].trim(), expression: match[1].trim() }));
}

function collectReferenceMatches(source, patterns, transform) {
  const references = [];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const value = transform(match);
      const offset = match.index + match[0].lastIndexOf(match[1]);
      references.push({
        ...value,
        start: lineColumn(source, offset),
        end: lineColumn(source, offset + match[1].length)
      });
    }
  }
  return references;
}

function referencedImageNode(id, name, attributes) {
  return {
    id,
    kind: "image_asset",
    category: "asset",
    language: null,
    name,
    qualifiedName: name,
    file: "",
    line: 1,
    column: 1,
    metrics: {},
    attributes: {
      path: null,
      exists: null,
      mediaType: "image",
      ...attributes
    },
    source: "swift-image-reference",
    confidence: attributes.dynamic ? 0.45 : 1
  };
}

function swiftReferenceEdge(file, reference, target, confidence, inferred) {
  return {
    from: `file:${file}`,
    to: target,
    kind: "displays",
    source: "swift-image-reference",
    confidence,
    inferred,
    reference: reference.name,
    location: { file, range: { start: reference.start, end: reference.end, precision: "exact" } }
  };
}

function lookupAssetKeys(name) {
  return [...new Set([String(name).toLowerCase(), normalizedAssetKey(name)])];
}

function normalizedAssetKey(name) {
  return String(name).replace(/[^A-Za-z0-9]/g, "").toLowerCase();
}

function directoryNodeId(path) {
  const value = String(path || "");
  if (!value.includes("/")) return null;
  const directory = value.slice(0, value.lastIndexOf("/"));
  return directory ? `directory:${directory}` : null;
}

function lineColumn(source, offset) {
  const lines = source.slice(0, offset).split(/\r\n|\r|\n/);
  return { line: lines.length, column: lines.at(-1).length + 1 };
}

function uniqueEdges(edges) {
  const seen = new Set();
  return edges.filter((edge) => {
    const key = `${edge.from}|${edge.kind}|${edge.to}|${edge.location?.range?.start?.line || 0}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function countBy(items, key) {
  return items.reduce((counts, item) => {
    counts[item[key]] = (counts[item[key]] || 0) + 1;
    return counts;
  }, {});
}
