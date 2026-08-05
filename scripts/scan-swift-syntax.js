import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const [, , inputRoot, outputFile] = process.argv;

if (!inputRoot || !outputFile) {
  console.error("Usage: node scripts/scan-swift-syntax.js <input-root> <output-json>");
  process.exit(2);
}

await mkdir(dirname(resolve(outputFile)), { recursive: true });

const bundledScanner = process.env.CODE_UNIVERSE_SWIFTSYNTAX_SCANNER || null;
const packagePath = resolve("scanners/swiftsyntax-scanner");
const cacheRoot = resolve(process.env.CODE_UNIVERSE_CACHE_ROOT || ".swift-cache");
const cachePath = resolve(cacheRoot, "clang-module-cache");
await mkdir(cachePath, { recursive: true });

const swiftEnvironment = {
  ...process.env,
  CLANG_MODULE_CACHE_PATH: cachePath
};
delete swiftEnvironment.SWIFTSYNTAX_BUILD_DYNAMIC_LIBRARY;

const child = spawn(
  bundledScanner || "swift",
  bundledScanner
    ? [resolve(inputRoot), resolve(outputFile)]
    : [
      "run",
      "--package-path",
      packagePath,
      "scan-swift-syntax",
      resolve(inputRoot),
      resolve(outputFile)
    ],
  {
    stdio: "inherit",
    env: swiftEnvironment
  }
);

["SIGTERM", "SIGINT"].forEach((signal) => {
  process.on(signal, () => {
    child.kill(signal);
    setTimeout(() => process.exit(1), 250).unref();
  });
});

child.on("exit", async (code, signal) => {
  if (signal) {
    console.error(`SwiftSyntax scanner stopped by signal ${signal}`);
    process.exit(1);
  }
  if (code !== 0) {
    process.exit(code ?? 1);
  }

  const graph = JSON.parse(await readFile(resolve(outputFile), "utf8"));
  const swiftFileCount = graph.nodes.filter((node) => node.kind === "file").length;
  const typeCount = graph.nodes.filter((node) => node.id.startsWith("type:")).length;
  console.log(`Wrote ${graph.nodes.length} nodes and ${graph.edges.length} edges to ${outputFile}`);
  console.log(`SwiftSyntax scanned ${swiftFileCount} Swift files with ${typeCount} types.`);
  process.exit(0);
});
