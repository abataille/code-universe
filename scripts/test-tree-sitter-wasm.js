import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadTreeSitterWasmBackend } from "../lib/parsers/tree-sitter-wasm.js";
import { clearProjectScanCache, scanProject } from "../lib/projects/scan-project.js";
import { validateGraph } from "../lib/graph/schema.js";

const root = await mkdtemp(join(tmpdir(), "code-universe-tree-sitter-"));

try {
  await mkdir(join(root, "src"), { recursive: true });
  await write("src/App.tsx", `
export function App() {
  return <main id="app">Hello</main>;
}
`);
  await write("index.html", `
<main>
  <script>const answer = 42;</script>
  <style>.hero { color: red; }</style>
</main>
`);
  await write("styles.css", ".hero { color: red; }\n");
  await write("broken.js", "function broken( {\n");

  const backend = await loadTreeSitterWasmBackend();
  const forcedFallback = await loadTreeSitterWasmBackend({ forceUnavailable: true });
  assert(!forcedFallback.available, "forced Tree-sitter fallback should be unavailable");
  assert((await forcedFallback.scanFiles([])).diagnostics.fallback === true, "fallback diagnostics should be explicit");

  const result = await scanProject(root, {
    profile: "tree-sitter",
    legacyScanner: "tree-sitter"
  });
  const validation = validateGraph(result.graph);
  assert(validation.valid, validation.errors.join("; "));
  assert(result.graph.project.scanProfile === "tree-sitter", "Tree-sitter profile should be preserved in graph metadata");
  assert(result.graph.project.parsers?.some((parser) => parser.id === "tree-sitter-wasm"), "Tree-sitter parser metadata should be recorded");
  assert(result.diagnostics.treeSitter?.parser === "tree-sitter-wasm", "Tree-sitter diagnostics should be exposed");

  if (backend.available) {
    assert(result.diagnostics.treeSitter.parsedFiles >= 4, "all web fixture files should be parsed by Tree-sitter");
    assert(result.diagnostics.treeSitter.syntaxErrors > 0, "malformed JavaScript should produce a syntax diagnostic");
    const htmlFile = result.graph.nodes.find((node) => node.kind === "file" && node.file === "index.html");
    assert(htmlFile?.attributes?.treeSitter?.nodeType === "document", "HTML files should retain the Tree-sitter root type");
    const inlineScript = result.graph.nodes.find((node) => node.kind === "inline_script");
    assert(inlineScript?.attributes?.treeSitter?.embeddedLanguage === "javascript", "inline scripts should use the embedded JavaScript grammar");
    const cssRule = result.graph.nodes.find((node) => node.kind === "css_rule" && node.file === "styles.css");
    assert(cssRule?.attributes?.treeSitter?.grammar === "css", "CSS rules should retain Tree-sitter CSS provenance");
    const tsxFile = result.graph.nodes.find((node) => node.kind === "file" && node.file === "src/App.tsx");
    assert(tsxFile?.attributes?.treeSitter?.grammar === "tsx", "TSX files should use the TSX grammar");
  } else {
    assert(result.diagnostics.treeSitter.fallback === true, "missing optional dependencies should use the existing adapters");
    assert(result.diagnostics.treeSitter.parsedFiles === 0, "fallback mode should not claim parsed files");
  }

  const fallbackScan = await scanProject(root, {
    profile: "tree-sitter",
    legacyScanner: "tree-sitter",
    treeSitter: { forceUnavailable: true }
  });
  assert(fallbackScan.diagnostics.treeSitter?.fallback === true, "a runtime failure should remain a graph-level fallback");
  assert(fallbackScan.graph.project.adapters.some((adapter) => adapter.parser?.fallback === true), "adapter metadata should expose the parser fallback");

  console.log(`Tree-sitter WASM tests passed (${backend.available ? "runtime available" : "fallback verified"}).`);
} finally {
  clearProjectScanCache();
  await rm(root, { recursive: true, force: true });
}

async function write(relativePath, source) {
  const target = join(root, relativePath);
  await mkdir(join(target, ".."), { recursive: true });
  await writeFile(target, source);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
