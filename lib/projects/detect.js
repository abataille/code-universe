import { access, readdir } from "node:fs/promises";
import { join } from "node:path";
import { languageForFile } from "../graph/schema.js";

const MANIFEST_EVIDENCE = [
  { file: "Package.swift", language: "swift", weight: 8, projectKind: "swift-package" },
  { file: "package.json", language: "javascript", weight: 5, projectKind: "node" },
  { file: "tsconfig.json", language: "typescript", weight: 9, projectKind: "typescript" },
  { file: "jsconfig.json", language: "javascript", weight: 7, projectKind: "javascript" },
  { file: "global.json", language: "csharp", weight: 5, projectKind: "dotnet" },
  { file: "Directory.Build.props", language: "csharp", weight: 5, projectKind: "dotnet" },
  { file: "pyproject.toml", language: "python", weight: 8, projectKind: "python" },
  { file: "requirements.txt", language: "python", weight: 5, projectKind: "python" },
  { file: "composer.json", language: "php", weight: 8, projectKind: "php" },
  { file: "pom.xml", language: "java", weight: 8, projectKind: "java" },
  { file: "build.gradle", language: "java", weight: 7, projectKind: "java" },
  { file: "build.gradle.kts", language: "java", weight: 7, projectKind: "java" }
];

export async function detectProjectLanguages(root, files) {
  const scores = new Map();
  const counts = new Map();
  const evidence = [];
  let projectKind = null;

  for (const file of files) {
    const language = languageForFile(file.relative);
    if (!language) continue;
    counts.set(language, (counts.get(language) || 0) + 1);
    scores.set(language, (scores.get(language) || 0) + 1);
  }

  for (const manifest of MANIFEST_EVIDENCE) {
    if (!await exists(join(root, manifest.file))) continue;
    scores.set(manifest.language, (scores.get(manifest.language) || 0) + manifest.weight);
    evidence.push({ kind: "manifest", path: manifest.file, language: manifest.language });
    projectKind ||= manifest.projectKind;
  }
  const rootEntries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const dotnetProject = rootEntries.find((entry) => entry.isFile() && (entry.name.endsWith(".sln") || entry.name.endsWith(".csproj")));
  if (dotnetProject) {
    evidence.push({ kind: "manifest", path: dotnetProject.name, language: "csharp" });
    scores.set("csharp", (scores.get("csharp") || 0) + 10);
    projectKind ||= "dotnet";
  }
  if (rootEntries.some((entry) => entry.isDirectory() && (entry.name.endsWith(".xcodeproj") || entry.name.endsWith(".xcworkspace")))) {
    const xcodeLanguage = counts.has("swift") ? "swift" : counts.has("objective-c") || counts.has("objective-cpp") ? "objective-c" : "swift";
    evidence.push({ kind: "manifest", path: "*.xcodeproj", language: xcodeLanguage });
    scores.set(xcodeLanguage, (scores.get(xcodeLanguage) || 0) + 10);
    projectKind = "xcode";
  }

  const languages = [...counts]
    .map(([id, fileCount]) => ({
      id,
      fileCount,
      score: scores.get(id) || fileCount,
      confidence: Math.min(1, 0.45 + Math.log2(fileCount + 1) / 5)
    }))
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));

  if (!projectKind && languages.some((entry) => entry.id === "html" || entry.id === "css")) projectKind = "static-web";
  return {
    primaryLanguage: languages[0]?.id || null,
    languages,
    evidence,
    projectKind: projectKind || "source"
  };
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
