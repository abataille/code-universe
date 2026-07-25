import { readdir } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";

export const SOURCE_EXTENSIONS = new Set([
  ".swift", ".js", ".mjs", ".cjs", ".jsx", ".ts", ".mts", ".cts", ".tsx", ".html", ".htm", ".css"
]);

const EXCLUDED_DIRECTORIES = new Set([
  ".git", ".build", ".swiftpm", ".cache", ".next", ".nuxt", ".svelte-kit",
  "DerivedData", "Build", "build", "dist", "coverage", "node_modules", "Pods",
  "Carthage", "SourcePackages", "vendor", "Generated", "generated"
]);

export async function discoverProjectFiles(root, options = {}) {
  const resolvedRoot = resolve(root);
  const extensions = options.extensions || SOURCE_EXTENSIONS;
  const files = [];
  await visit(resolvedRoot, resolvedRoot, files, extensions);
  return files.sort((left, right) => left.relative.localeCompare(right.relative));
}

export function isSupportedSourceFile(path) {
  return SOURCE_EXTENSIONS.has(extname(String(path)).toLowerCase());
}

export function shouldExcludeDirectory(name) {
  return EXCLUDED_DIRECTORIES.has(name)
    || name.endsWith(".xcodeproj")
    || name.endsWith(".xcworkspace");
}

async function visit(root, directory, files, extensions) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") && ![".github"].includes(entry.name)) {
      if (entry.isDirectory()) continue;
    }
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!shouldExcludeDirectory(entry.name)) await visit(root, absolute, files, extensions);
    } else if (entry.isFile() && extensions.has(extname(entry.name).toLowerCase())) {
      files.push({
        absolute,
        relative: relative(root, absolute).replaceAll("\\", "/"),
        extension: extname(entry.name).toLowerCase()
      });
    }
  }
}
