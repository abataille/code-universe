import { access } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function openSourceInEditor(location, project, options = {}) {
  const editor = await resolveEditor(project, options.editor || process.env.CODE_UNIVERSE_EDITOR);
  const runner = options.execFile || execFileAsync;
  const line = Math.max(1, Number(location.line) || 1);
  const column = Math.max(1, Number(location.column) || 1);

  if (editor === "xcode") {
    await runner("xed", ["--line", String(line), location.file]);
    return { editor, displayName: "Xcode" };
  }
  if (editor === "vscode") {
    await runner("code", ["--goto", `${location.file}:${line}:${column}`]);
    return { editor, displayName: "VS Code" };
  }
  await runner("open", [location.file]);
  return { editor: "system", displayName: "Editor" };
}

export async function resolveEditor(project, configured = null) {
  if (["xcode", "vscode", "system"].includes(configured)) return configured;
  const languages = new Set((project?.languages || []).map((entry) => entry.id));
  const swiftProject = project?.projectKind === "xcode"
    || project?.projectKind === "swift-package"
    || (languages.size === 1 && languages.has("swift"));
  if (swiftProject && await commandExists("/usr/bin/xed", "xed")) return "xcode";
  if (await commandExists("/usr/local/bin/code", "code") || await commandExists("/opt/homebrew/bin/code", "code")) return "vscode";
  return swiftProject ? "xcode" : "system";
}

async function commandExists(path, command) {
  try {
    await access(path);
    return true;
  } catch {
    try {
      await execFileAsync("/usr/bin/which", [command]);
      return true;
    } catch {
      return false;
    }
  }
}
