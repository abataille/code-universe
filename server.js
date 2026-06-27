import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, dirname, join, normalize, relative, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { scanSwiftFolder } from "./scripts/scan-swift-core.js";

const execFileAsync = promisify(execFile);
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "127.0.0.1";
const root = join(process.cwd(), "public");

const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"]
]);

createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${host}:${port}`);

  try {
    if (url.pathname === "/api/pick-project" && request.method === "POST") {
      const payload = await pickAndScanProject();
      sendJson(response, 200, payload);
      return;
    }

    if (url.pathname === "/api/scan-path" && request.method === "POST") {
      const body = await readJsonBody(request);
      const payload = await scanExplicitPath(body?.path);
      sendJson(response, 200, payload);
      return;
    }

    if (url.pathname === "/api/source" && request.method === "POST") {
      const body = await readJsonBody(request);
      const payload = await readSourceSnippet(body);
      sendJson(response, 200, payload);
      return;
    }

    await serveStatic(url, response);
  } catch (error) {
    sendJson(response, 500, { error: error.message });
  }
}).listen(port, host, () => {
  console.log(`Code Universe prototype: http://${host}:${port}`);
});

async function serveStatic(url, response) {
  const requestedPath = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = normalize(join(root, requestedPath));

  if (!filePath.startsWith(root)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const body = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": contentTypes.get(extname(filePath)) || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
}

async function pickAndScanProject() {
  const pickedPath = await showNativeProjectPicker();
  return scanResolvedPath(pickedPath);
}

async function scanExplicitPath(inputPath) {
  if (!inputPath || typeof inputPath !== "string") {
    throw new Error("Missing path.");
  }
  return scanResolvedPath(inputPath);
}

async function scanResolvedPath(inputPath) {
  const resolvedInput = resolve(inputPath);
  const projectRoot = await resolveProjectRoot(resolvedInput);
  const { graph, diagnostics } = await scanSwiftFolder(projectRoot);

  return {
    graph: {
      ...graph,
      project: {
        ...graph.project,
        pickedPath: resolvedInput,
        sourceRoot: projectRoot
      }
    },
    diagnostics: {
      ...diagnostics,
      pickedPath: resolvedInput,
      sourceRoot: projectRoot
    }
  };
}

async function readSourceSnippet(body) {
  const sourceRoot = body?.sourceRoot;
  const file = body?.file;
  const line = Number(body?.line || 1);

  if (!sourceRoot || !file || typeof sourceRoot !== "string" || typeof file !== "string") {
    throw new Error("Missing source location.");
  }

  const resolvedRoot = resolve(sourceRoot);
  const resolvedFile = resolve(resolvedRoot, file);
  const relativeFile = relative(resolvedRoot, resolvedFile);

  if (relativeFile.startsWith("..") || relativeFile === "" || relativeFile.startsWith("/")) {
    throw new Error("Source file is outside the scanned project.");
  }

  const source = await readFile(resolvedFile, "utf8");
  const lines = source.split(/\r?\n/);
  const targetLine = Math.max(1, Math.min(lines.length, Number.isFinite(line) ? line : 1));
  const startLine = Math.max(1, targetLine - 8);
  const endLine = Math.min(lines.length, targetLine + 18);

  return {
    file: relativeFile,
    line: targetLine,
    startLine,
    endLine,
    code: lines.slice(startLine - 1, endLine).map((content, index) => ({
      number: startLine + index,
      content
    }))
  };
}

async function resolveProjectRoot(inputPath) {
  const entry = await stat(inputPath);
  if (entry.isDirectory() && inputPath.endsWith(".xcodeproj")) {
    return dirname(inputPath);
  }
  if (entry.isDirectory()) {
    return inputPath;
  }
  if (inputPath.endsWith(".xcodeproj/project.pbxproj")) {
    return dirname(dirname(inputPath));
  }
  return dirname(inputPath);
}

async function showNativeProjectPicker() {
  const script = `
set chosenItem to choose file with prompt "Choose an .xcodeproj or project.pbxproj file"
POSIX path of chosenItem
`;

  const { stdout } = await execFileAsync("osascript", ["-e", script]);
  const pickedPath = stdout.trim();
  if (!pickedPath) {
    throw new Error("No project selected.");
  }
  return pickedPath;
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  if (chunks.length === 0) return null;
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(payload));
}
