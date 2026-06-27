import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { scanSwiftFolder } from "./scan-swift-core.js";

const [, , inputRoot, outputPath = "public/sample-graph.json"] = process.argv;

if (!inputRoot) {
  console.error("Usage: node scripts/scan-swift.js <swift-source-folder> [output.json]");
  process.exit(1);
}

const { graph, diagnostics } = await scanSwiftFolder(inputRoot);

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(graph, null, 2)}\n`);
console.log(`Wrote ${graph.nodes.length} nodes and ${graph.edges.length} edges to ${outputPath}`);
console.log(`Scanned ${diagnostics.swiftFileCount} Swift files with ${diagnostics.typeCount} types.`);
