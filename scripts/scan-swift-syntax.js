import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const [, , inputRoot, outputFile] = process.argv;

if (!inputRoot || !outputFile) {
  console.error("Usage: node scripts/scan-swift-syntax.js <input-root> <output-json>");
  process.exit(2);
}

await mkdir(dirname(resolve(outputFile)), { recursive: true });

const packagePath = resolve("scanners/swiftsyntax-scanner");
const cachePath = resolve(".swift-cache/clang-module-cache");
await mkdir(cachePath, { recursive: true });

const swiftEnvironment = {
  ...process.env,
  CLANG_MODULE_CACHE_PATH: cachePath
};
delete swiftEnvironment.SWIFTSYNTAX_BUILD_DYNAMIC_LIBRARY;

const child = spawn(
  "swift",
  [
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
