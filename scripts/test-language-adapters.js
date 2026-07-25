import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { scanProject } from "../lib/projects/scan-project.js";
import { detectProjectLanguages } from "../lib/projects/detect.js";
import { discoverProjectFiles } from "../lib/projects/discover-files.js";
import { normalizeGraph, validateGraph } from "../lib/graph/schema.js";
import { openSourceInEditor } from "../lib/editors/registry.js";

const root = await mkdtemp(join(tmpdir(), "code-universe-languages-"));

try {
  await write("package.json", JSON.stringify({ name: "mixed-fixture", type: "module" }));
  await write("tsconfig.json", JSON.stringify({ compilerOptions: { jsx: "react-jsx" } }));
  await write("src/model.ts", `
export interface User {
  name: string;
}

export class UserService {
  load(): User {
    return { name: "Ada" };
  }
}
`);
  await write("src/App.tsx", `
import { UserService } from "./model";

export function App() {
  const service = new UserService();
  return <main id="app" className="shell">{service.load().name}</main>;
}
`);
  await write("public/index.html", `
<!doctype html>
<html>
  <head><link rel="stylesheet" href="./styles.css"></head>
  <body><main id="app" class="shell"></main><script src="../src/App.tsx"></script></body>
</html>
`);
  await write("public/styles.css", `
#app { color: red; }
.shell { display: grid; }
@keyframes appear { from { opacity: 0; } to { opacity: 1; } }
`);
  await write("node_modules/ignored.js", "export const ignored = true;");

  const files = await discoverProjectFiles(root);
  assert(!files.some((file) => file.relative.includes("node_modules")), "generated dependency folders must be excluded");
  const detection = await detectProjectLanguages(root, files);
  assert(detection.primaryLanguage === "typescript", "tsconfig and TypeScript sources should select TypeScript as primary");
  assert(["typescript", "html", "css"].every((language) => detection.languages.some((entry) => entry.id === language)), "mixed web languages should all be detected");

  const { graph, diagnostics } = await scanProject(root, {
    profile: "balanced",
    legacyScanner: "merged",
    scanSwift: async () => {
      throw new Error("Swift adapter should not run for this fixture");
    }
  });
  const validation = validateGraph(graph);
  assert(validation.valid, validation.errors.join("; "));
  assert(graph.schemaVersion === 2, "adapter orchestration should emit schema v2");
  assert(graph.project.adapters.some((adapter) => adapter.id === "typescript"), "TypeScript adapter metadata should be recorded");
  assert(graph.project.adapters.some((adapter) => adapter.id === "web-assets"), "web adapter metadata should be recorded");
  assert(graph.nodes.some((node) => node.kind === "react_component" && node.name === "App"), "TSX component should be detected");
  assert(graph.nodes.some((node) => node.kind === "interface" && node.name === "User"), "TypeScript interface should be detected");
  assert(graph.nodes.some((node) => node.kind === "css_rule" && node.name === "#app"), "CSS selector should be detected");
  assert(graph.edges.some((edge) => edge.kind === "imports" && edge.from === "file:src/App.tsx" && edge.to === "file:src/model.ts"), "relative TypeScript imports should resolve to files");
  assert(graph.edges.some((edge) => edge.kind === "loads" && edge.to === "file:public/styles.css"), "HTML stylesheet links should resolve");
  assert(graph.edges.some((edge) => edge.kind === "styles"), "CSS selectors should connect to matching HTML elements");
  assert(diagnostics.filesScanned === 4, `expected 4 source files, got ${diagnostics.filesScanned}`);

  const legacy = normalizeGraph({
    schemaVersion: 1,
    project: { name: "Legacy", scannedAt: new Date().toISOString(), sourceRoot: root },
    nodes: [
      { id: "repo:root", kind: "repository", name: "Legacy", file: "", line: 1 },
      { id: "file:One.swift", kind: "file", name: "One.swift", file: "One.swift", line: 1 }
    ],
    edges: [{ from: "repo:root", to: "file:One.swift", kind: "contains" }]
  });
  assert(legacy.schemaVersion === 2 && legacy.nodes[1].language === "swift", "v1 graphs should normalize without losing Swift compatibility");

  const commands = [];
  const editorResult = await openSourceInEditor(
    { file: join(root, "src/App.tsx"), line: 4, column: 8 },
    graph.project,
    {
      editor: "vscode",
      execFile: async (command, args) => commands.push({ command, args })
    }
  );
  assert(editorResult.editor === "vscode", "configured editor should be honored");
  assert(commands[0].args[1].endsWith(":4:8"), "editor navigation should include line and column");

  console.log(`Language adapter tests passed with ${graph.nodes.length} nodes and ${graph.edges.length} edges.`);
} finally {
  await rm(root, { recursive: true, force: true });
}

async function write(path, source) {
  const destination = join(root, path);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, source.trimStart());
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
