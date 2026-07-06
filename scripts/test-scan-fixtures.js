import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { scanSwiftFolder } from "./scan-swift-core.js";

const root = await mkdtemp(join(tmpdir(), "code-universe-scan-"));

try {
  await writeFixture("FeatureA/Models.swift", `
import SwiftUI

struct Duplicate: Identifiable {
  let id: String
}

struct UsesTarget {
  let target: Target
}

struct ScopedOnly {
  let value: String
}
`);

  await writeFixture("FeatureB/Models.swift", `
struct Duplicate {
  let title: String
}

struct Target {
  let name: String
}
`);

  await writeFixture("FeatureB/Worker.swift", `
final class WorkerService {
  func load() -> Target {
    Target(name: "one")
  }

  func load(value: String) -> Target {
    Target(name: value)
  }
}
`);

  await writeFixture(".build/Ignored.swift", "struct IgnoredBuildType {}\n");
  await writeFixture("DerivedData/Ignored.swift", "struct IgnoredDerivedDataType {}\n");
  await writeFixture("Pods/Ignored.swift", "struct IgnoredPodsType {}\n");

  const { graph, diagnostics } = await scanSwiftFolder(root);
  const ids = graph.nodes.map((node) => node.id);
  const duplicateTypeIds = graph.nodes.filter((node) => node.kind !== "file" && node.name === "Duplicate").map((node) => node.id);
  const loadFunctionIds = graph.nodes.filter((node) => node.kind === "function" && node.name === "load").map((node) => node.id);
  const usesTarget = graph.nodes.find((node) => node.name === "UsesTarget");
  const target = graph.nodes.find((node) => node.name === "Target");
  const scopedOnly = graph.nodes.find((node) => node.name === "ScopedOnly");

  assert(diagnostics.swiftFileCount === 3, `expected 3 scanned files, got ${diagnostics.swiftFileCount}`);
  assert(duplicateTypeIds.length === 2, `expected duplicate type names to keep 2 IDs, got ${duplicateTypeIds.length}`);
  assert(loadFunctionIds.length === 2, `expected overloaded methods to keep 2 IDs, got ${loadFunctionIds.length}`);
  assert(!ids.some((id) => id.includes("Ignored")), "excluded build folders should not be scanned");
  assert(usesTarget && target, "fixture target nodes should exist");
  assert(graph.edges.some((edge) => edge.from === usesTarget.id && edge.to === target.id && edge.kind === "uses"), "UsesTarget should reference Target");
  assert(!graph.edges.some((edge) => edge.from === scopedOnly?.id && edge.to === target.id), "ScopedOnly should not inherit references from sibling declarations");

  console.log(`Scan fixture tests passed with ${graph.nodes.length} nodes and ${graph.edges.length} edges.`);
} finally {
  await rm(root, { recursive: true, force: true });
}

async function writeFixture(path, source) {
  const fullPath = join(root, path);
  await mkdir(dirname(fullPath), { recursive: true });
  await writeFile(fullPath, source.trimStart());
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
