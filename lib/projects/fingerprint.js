import { createHash } from "node:crypto";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

const CONFIGURATION_FILES = [
  "Package.swift",
  "package.json",
  "tsconfig.json",
  "jsconfig.json",
  "global.json",
  "Directory.Build.props",
  "Directory.Build.targets"
];

export async function projectFingerprint(root, files, adapters, profile, parserFingerprint = "") {
  const hash = createHash("sha256");
  hash.update("orchestrator:2\n");
  hash.update(`profile:${profile}\n`);
  if (parserFingerprint) hash.update(`parser:${parserFingerprint}\n`);
  for (const adapter of adapters) hash.update(`adapter:${adapter.id}@${adapter.version}\n`);
  for (const file of files) {
    hash.update(`${file.relative}\0${file.size || 0}\0${Math.floor(file.mtimeMs || 0)}\n`);
  }
  for (const name of CONFIGURATION_FILES) {
    const metadata = await stat(join(root, name)).catch(() => null);
    if (metadata?.isFile()) hash.update(`config:${name}\0${metadata.size}\0${Math.floor(metadata.mtimeMs)}\n`);
  }
  const rootEntries = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of rootEntries) {
    if (entry.isFile() && (entry.name.endsWith(".sln") || entry.name.endsWith(".csproj"))) {
      const metadata = await stat(join(root, entry.name)).catch(() => null);
      if (metadata?.isFile()) hash.update(`config:${entry.name}\0${metadata.size}\0${Math.floor(metadata.mtimeMs)}\n`);
    }
    if (!entry.isDirectory() || !entry.name.endsWith(".xcodeproj")) continue;
    const projectFile = join(root, entry.name, "project.pbxproj");
    const metadata = await stat(projectFile).catch(() => null);
    if (metadata?.isFile()) hash.update(`config:${entry.name}/project.pbxproj\0${metadata.size}\0${Math.floor(metadata.mtimeMs)}\n`);
  }
  return hash.digest("hex");
}
