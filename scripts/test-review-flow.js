import { execFile, spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const port = 4397;
const repositoryRoot = resolve(import.meta.dirname, "..");
const sourceRoot = join(repositoryRoot, "examples", "SampleSwiftApp");
const dataRoot = await mkdtemp(join(tmpdir(), "code-universe-review-test-"));
const codexHome = await mkdtemp(join(tmpdir(), "code-universe-codex-home-test-"));
const patchRoot = await mkdtemp(join(tmpdir(), "code-universe-patch-test-"));
await writeFile(join(codexHome, "config.toml"), "model = \"gpt-5.6-sol\"\nmodel_reasoning_effort = \"high\"\n");
await writeFile(join(patchRoot, "Feature.swift"), "struct Feature {\n    let value = 1\n}\n");
await writeFile(join(patchRoot, "Other.swift"), "struct Other {}\n");
await execFileAsync("git", ["init", "-q"], { cwd: patchRoot });
await execFileAsync("git", ["add", "Feature.swift", "Other.swift"], { cwd: patchRoot });
await execFileAsync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.com", "commit", "-qm", "Initial fixture"], { cwd: patchRoot });
const server = spawn(process.execPath, ["server.js"], {
  cwd: repositoryRoot,
  env: {
    ...process.env,
    PORT: String(port),
    CODEX_HOME: codexHome,
    CODE_UNIVERSE_DATA_ROOT: dataRoot,
    CODE_UNIVERSE_CODEX_PATH: join(repositoryRoot, "scripts", "mock-codex-review.js")
  },
  stdio: ["ignore", "pipe", "pipe"]
});

try {
  await waitForServer();
  const settingsResponse = await fetch(`http://127.0.0.1:${port}/api/codex-settings`);
  const settings = await settingsResponse.json();
  assert(settings.defaults.model === "gpt-5.6-sol", "Codex settings should expose the configured default model");
  assert(settings.defaults.reasoningEffort === "high", "Codex settings should expose the configured reasoning effort");
  assert(settings.models.includes("gpt-5.6-terra"), "Codex settings should provide model choices");

  const source = await post("/api/source", {
    sourceRoot,
    file: "Services.swift",
    line: 3,
    fullFile: true
  });
  assert(source.file === "Services.swift", "source endpoint should resolve project-relative files");
  assert(source.line === 3 && source.startLine === 1, "source endpoint should retain the selected line");
  assert(source.code.length >= 19, "full source view should return the complete Swift file");
  assert(source.code.some((line) => line.content.includes("struct AnalyticsService")), "full source view should include code beyond the selected symbol");

  const started = await post("/api/reviews/start", {
    sourceRoot,
    title: "Review API fixture"
  });
  assert(started.review.status === "running", "review should start in running state");
  assert(started.review.git && "before" in started.review.git, "review should capture a Git evidence slot");

  const appended = await post("/api/reviews/event", {
    sourceRoot,
    event: {
      kind: "inspect",
      file: "Services.swift",
      line: 4,
      summary: "Inspect service"
    }
  });
  assert(appended.event.sequence === 1, "first event should have sequence 1");
  assert(appended.review.events.length === 1, "event should be persisted");

  const activeResponse = await fetch(`http://127.0.0.1:${port}/api/reviews/active?sourceRoot=${encodeURIComponent(sourceRoot)}`);
  const active = await activeResponse.json();
  assert(active.review.id === started.review.id, "active endpoint should return the running review");

  const finished = await post("/api/reviews/finish", {
    sourceRoot,
    outcome: "passed",
    summary: "Behavior verified"
  });
  assert(finished.review.status === "completed", "review should finish as completed");
  assert(finished.review.events.at(-1).kind === "conclusion", "finish summary should create a conclusion event");
  const latestResponse = await fetch(`http://127.0.0.1:${port}/api/reviews/active?sourceRoot=${encodeURIComponent(sourceRoot)}`);
  const latest = await latestResponse.json();
  assert(latest.review.status === "completed", "latest review endpoint should expose the finished state");

  const launched = await post("/api/reviews/launch", {
    sourceRoot,
    title: "Automatic Codex fixture",
    behavior: "Authentication service behavior",
    mode: "inspect",
    model: "gpt-5.6-terra",
    reasoningEffort: "low"
  });
  assert(launched.review.codex.status === "running", "automatic review should launch Codex");
  assert(launched.review.codex.model === "gpt-5.6-terra", "selected model should be stored with the trace");
  assert(launched.review.codex.reasoningEffort === "low", "selected reasoning effort should be stored with the trace");
  assert(launched.review.codex.modelOverride === true && launched.review.codex.reasoningOverride === true, "explicit settings should be marked as overrides");
  const automatic = await waitForReview(launched.review.id);
  assert(automatic.status === "completed", "automatic Codex review should complete");
  assert(automatic.codex.threadId === "fixture-thread", "Codex thread metadata should be captured");
  assert(automatic.codex.lastMessage.length > 2000, "complete Codex reports should not be truncated at the old limit");
  assert(automatic.codex.lastMessage.endsWith("END OF COMPLETE REVIEW"), "complete Codex reports should retain their ending");
  assert(automatic.codex.usage.inputTokens === 120, "input tokens should be captured");
  assert(automatic.codex.usage.cachedInputTokens === 50, "cached input tokens should be captured");
  assert(automatic.codex.usage.uncachedInputTokens === 70, "uncached input tokens should be derived without double counting");
  assert(automatic.codex.usage.outputTokens === 30, "output tokens should be captured");
  assert(automatic.codex.usage.reasoningOutputTokens === 5, "reasoning output tokens should be captured");
  assert(automatic.codex.usage.visibleOutputTokens === 25, "visible output tokens should exclude reasoning output");
  assert(automatic.codex.usage.totalTokens === 150, "total tokens should combine input and output");
  assert(automatic.events.filter((event) => event.kind === "search" && event.file === "Services.swift").length === 1, "duplicate searches should collapse within a phase");
  assert(automatic.events.some((event) => event.kind === "inspect" && event.file === "Services.swift"), "inspection event should be inferred from Codex JSONL");
  assert(automatic.events.some((event) => event.kind === "edit" && event.file === "Services.swift"), "absolute changed paths should normalize to the project");
  assert(automatic.events.some((event) => event.kind === "test" && event.outcome === "passed" && event.summary === "Swift package tests passed"), "real test execution should use a concise outcome");
  assert(!automatic.events.some((event) => event.file?.includes(".build") || event.file?.startsWith("n./")), "generated and malformed paths should be filtered");
  assert(!automatic.events.some((event) => event.command === "swift test --help"), "test help should not be classified as a test run");
  assert(automatic.events.some((event) => event.kind === "suspect" && event.file === "Services.swift"), "conclusion file should become a suspected source event");
  assert(automatic.events.at(-1).kind === "conclusion", "Codex final message should become the conclusion");
  assert(automatic.events.at(-1).summary === "Final review result", "timeline conclusion should remain concise");

  const patchReview = await post("/api/reviews/start", {
    sourceRoot: patchRoot,
    title: "Patch capture fixture"
  });
  await writeFile(join(patchRoot, "Feature.swift"), "struct Feature {\n    let value = 2\n    let enabled = true\n}\n");
  await post("/api/reviews/event", {
    reviewId: patchReview.review.id,
    event: { kind: "edit", file: "Feature.swift", line: 2, summary: "Changed feature" }
  });
  const patched = await post("/api/reviews/finish", {
    reviewId: patchReview.review.id,
    outcome: "passed",
    summary: "Patch captured"
  });
  const featureDiff = patched.review.git.diff.files.find((file) => file.file === "Feature.swift");
  assert(featureDiff, "finished reviews should include a file-level patch");
  assert(featureDiff.added === 2 && featureDiff.deleted === 1, "patch should report exact added and removed lines");
  assert(featureDiff.patch.includes("-    let value = 1") && featureDiff.patch.includes("+    let value = 2"), "patch should preserve changed source lines");
  await writeFile(join(patchRoot, "Other.swift"), "struct Other { let laterChange = true }\n");

  const legacyImport = await post("/api/reviews/import", {
    sourceRoot: patchRoot,
    review: {
      id: "legacy-clean-review",
      title: "Legacy clean review",
      status: "completed",
      events: [{ kind: "edit", file: "Feature.swift", line: 2, summary: "Changed feature" }],
      git: {
        before: { commit: patchReview.review.git.before.commit, status: [], changes: [] },
        after: patched.review.git.after,
        baseline: null,
        diff: null
      }
    }
  });
  assert(legacyImport.review.git.diff === null, "legacy import should initially have no patch");
  const backfilledResponse = await fetch(`http://127.0.0.1:${port}/api/reviews/active?sourceRoot=${encodeURIComponent(patchRoot)}`);
  const backfilled = await backfilledResponse.json();
  assert(backfilled.review.git.diff.files.some((file) => file.file === "Feature.swift"), "clean legacy reviews should safely backfill their patch");
  assert(!backfilled.review.git.diff.files.some((file) => file.file === "Other.swift"), "backfill should exclude unrelated files changed after the review");
  console.log("Review flow fixture passed.");
} finally {
  server.kill("SIGTERM");
  await rm(dataRoot, { recursive: true, force: true });
  await rm(codexHome, { recursive: true, force: true });
  await rm(patchRoot, { recursive: true, force: true });
}

async function waitForServer() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) return;
    } catch {
      await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    }
  }
  throw new Error("Review test server did not start.");
}

async function post(path, body) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || `request failed (${response.status})`);
  return payload;
}

async function waitForReview(reviewId) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const response = await fetch(`http://127.0.0.1:${port}/api/reviews/active?sourceRoot=${encodeURIComponent(sourceRoot)}`);
    const payload = await response.json();
    if (payload.review?.id === reviewId && payload.review.status !== "running") return payload.review;
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  throw new Error("Automatic Codex review did not finish.");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
