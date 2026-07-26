import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { basename, dirname, extname, join, normalize } from "node:path";

const ASSET_KIND_BY_EXTENSION = new Map([
  [".apng", "image_asset"], [".avif", "image_asset"], [".bmp", "image_asset"],
  [".gif", "image_asset"], [".ico", "image_asset"], [".jpeg", "image_asset"],
  [".jpg", "image_asset"], [".png", "image_asset"], [".svg", "image_asset"],
  [".webp", "image_asset"],
  [".mp4", "video_asset"], [".m4v", "video_asset"], [".mov", "video_asset"],
  [".ogv", "video_asset"], [".webm", "video_asset"],
  [".aac", "audio_asset"], [".flac", "audio_asset"], [".m4a", "audio_asset"],
  [".mp3", "audio_asset"], [".oga", "audio_asset"], [".ogg", "audio_asset"],
  [".wav", "audio_asset"],
  [".eot", "font_asset"], [".otf", "font_asset"], [".ttf", "font_asset"],
  [".woff", "font_asset"], [".woff2", "font_asset"],
  [".json", "web_asset"], [".pdf", "web_asset"], [".webmanifest", "web_asset"]
]);

export function assetKindForReference(reference, hint = null) {
  if (hint === "image" || String(reference).startsWith("data:image/")) return "image_asset";
  if (hint === "video" || String(reference).startsWith("data:video/")) return "video_asset";
  if (hint === "audio" || String(reference).startsWith("data:audio/")) return "audio_asset";
  if (hint === "font") return "font_asset";
  return ASSET_KIND_BY_EXTENSION.get(extname(cleanReference(reference)).toLowerCase()) || "web_asset";
}

export function isStaticAssetReference(reference) {
  const value = String(reference || "").trim();
  if (!value || value.startsWith("#") || /^(?:javascript:|mailto:|tel:)/i.test(value)) return false;
  if (/^data:(?:image|audio|video)\//i.test(value)) return true;
  return ASSET_KIND_BY_EXTENSION.has(extname(cleanReference(value)).toLowerCase());
}

export async function createWebAssetNode(root, sourceFile, reference, options = {}) {
  const rawSource = String(reference || "").trim();
  const source = options.baseHref && /^(?:https?:)?\/\//i.test(options.baseHref) && !/^(?:[a-z]+:|\/\/)/i.test(rawSource)
    ? new URL(rawSource, options.baseHref.startsWith("//") ? `https:${options.baseHref}` : options.baseHref).href
    : rawSource;
  const external = /^(?:https?:|\/\/)/i.test(source);
  const embedded = source.startsWith("data:");
  const localPath = !external && !embedded
    ? resolveWebPath(sourceFile, source, options.baseHref)
    : null;
  const kind = assetKindForReference(source, options.hint);
  const identity = localPath || source;
  const id = localPath
    ? `asset:${assetFamily(kind)}:${encodeURIComponent(localPath)}`
    : `asset:${assetFamily(kind)}:${embedded ? "embedded" : "external"}:${shortHash(identity)}`;
  let exists = null;
  let bytes = null;
  let intrinsic = {};
  if (localPath) {
    const absolute = join(root, localPath);
    const metadata = await stat(absolute).catch(() => null);
    exists = Boolean(metadata?.isFile());
    bytes = metadata?.size ?? null;
    if (exists && kind === "image_asset") intrinsic = await readImageDimensions(absolute);
  }
  return {
    id,
    kind,
    category: "asset",
    language: null,
    name: assetName(source, localPath, embedded, kind),
    qualifiedName: identity,
    file: "",
    line: 1,
    column: 1,
    metrics: bytes == null ? {} : { bytes },
    attributes: {
      external,
      embedded,
      path: localPath,
      source: embedded ? source.slice(0, source.indexOf(",") + 1) : source,
      exists,
      broken: exists === false,
      mediaType: assetFamily(kind),
      responsive: options.responsive === true,
      descriptor: options.descriptor || null,
      ...intrinsic
    },
    source: options.source || "web-asset",
    confidence: 0.99
  };
}

export function resolveWebPath(sourceFile, reference, baseHref = null) {
  const clean = cleanReference(reference);
  if (!clean || /^(?:https?:)?\/\//i.test(clean) || clean.startsWith("data:")) return null;
  const resolvedBase = baseHref && !/^(?:https?:)?\/\//i.test(baseHref)
    ? resolveWebPath(sourceFile, baseHref)
    : null;
  const baseDirectory = resolvedBase
    ? /\/(?:[?#].*)?$/.test(String(baseHref)) ? resolvedBase : dirname(resolvedBase)
    : dirname(sourceFile);
  const resolved = clean.startsWith("/")
    ? normalize(clean).replaceAll("\\", "/").replace(/^\/+/, "")
    : normalize(join(baseDirectory, clean)).replaceAll("\\", "/").replace(/^\.\//, "");
  return resolved.split("/").includes("..") ? null : resolved;
}

export function parseSrcset(value = "") {
  const input = String(value || "").trim();
  if (!input) return [];
  const candidates = [];
  let position = 0;
  while (position < input.length) {
    while (/[\s,]/.test(input[position] || "")) position += 1;
    if (position >= input.length) break;
    let source = "";
    if (input.slice(position).startsWith("data:")) {
      const whitespace = input.slice(position).search(/\s/);
      const end = whitespace < 0 ? input.length : position + whitespace;
      source = input.slice(position, end);
      position = end;
    } else {
      while (position < input.length && !/[\s,]/.test(input[position])) source += input[position++];
    }
    while (/\s/.test(input[position] || "")) position += 1;
    let descriptor = "";
    while (position < input.length && input[position] !== ",") descriptor += input[position++];
    if (input[position] === ",") position += 1;
    if (source) candidates.push({ source, descriptor: descriptor.trim() || null });
  }
  return candidates;
}

export function relationshipForAssetKind(kind, context = null) {
  if (["image_asset", "video_asset", "audio_asset"].includes(kind)) return "displays";
  if (context === "download") return "downloads";
  if (context === "embed") return "embeds";
  return "loads";
}

function cleanReference(reference) {
  return String(reference || "").trim().split(/[?#]/)[0];
}

function assetFamily(kind) {
  return kind.replace(/_asset$/, "");
}

function assetName(source, localPath, embedded, kind) {
  if (embedded) return `embedded ${assetFamily(kind)}`;
  if (localPath) return basename(localPath);
  try {
    const url = new URL(source.startsWith("//") ? `https:${source}` : source);
    return basename(url.pathname) || url.hostname || `external ${assetFamily(kind)}`;
  } catch {
    return basename(source) || assetFamily(kind);
  }
}

function shortHash(value) {
  return createHash("sha256").update(String(value)).digest("hex").slice(0, 16);
}

async function readImageDimensions(absolute) {
  const buffer = await readFile(absolute).catch(() => null);
  if (!buffer) return {};
  if (buffer.length >= 24 && buffer.subarray(1, 4).toString() === "PNG") {
    return { pixelWidth: buffer.readUInt32BE(16), pixelHeight: buffer.readUInt32BE(20) };
  }
  if (buffer.length >= 10 && ["GIF87a", "GIF89a"].includes(buffer.subarray(0, 6).toString())) {
    return { pixelWidth: buffer.readUInt16LE(6), pixelHeight: buffer.readUInt16LE(8) };
  }
  if (buffer.length >= 30 && buffer.subarray(0, 4).toString() === "RIFF" && buffer.subarray(8, 12).toString() === "WEBP") {
    const format = buffer.subarray(12, 16).toString();
    if (format === "VP8X") {
      return {
        pixelWidth: 1 + buffer.readUIntLE(24, 3),
        pixelHeight: 1 + buffer.readUIntLE(27, 3)
      };
    }
  }
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = buffer[offset + 1];
      const length = buffer.readUInt16BE(offset + 2);
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return { pixelWidth: buffer.readUInt16BE(offset + 7), pixelHeight: buffer.readUInt16BE(offset + 5) };
      }
      if (length < 2) break;
      offset += length + 2;
    }
  }
  if (extname(absolute).toLowerCase() === ".svg") {
    const source = buffer.toString("utf8", 0, Math.min(buffer.length, 64_000));
    const svg = source.match(/<svg\b[^>]*>/i)?.[0] || "";
    const width = numericSvgDimension(svg.match(/\bwidth\s*=\s*["']([^"']+)/i)?.[1]);
    const height = numericSvgDimension(svg.match(/\bheight\s*=\s*["']([^"']+)/i)?.[1]);
    const viewBox = svg.match(/\bviewBox\s*=\s*["'][^"']*?([\d.]+)[,\s]+([\d.]+)["']/i);
    return {
      pixelWidth: width || Number(viewBox?.[1]) || null,
      pixelHeight: height || Number(viewBox?.[2]) || null
    };
  }
  return {};
}

function numericSvgDimension(value) {
  const number = Number.parseFloat(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}
