#!/usr/bin/env node

const endpoint = process.env.CODE_UNIVERSE_URL || "http://127.0.0.1:4173";
const [command, ...args] = process.argv.slice(2);
const sourceRoot = process.env.CODE_UNIVERSE_SOURCE_ROOT || process.env.INIT_CWD || process.cwd();

if (!command || command === "help" || command === "--help") {
  printUsage();
  process.exit(0);
}

try {
  const payload = await runCommand(command, args);
  const review = payload.review;
  const event = payload.event;
  if (event) {
    console.log(`Code Universe review: ${event.sequence}. ${event.kind} — ${event.summary}`);
  } else if (review) {
    console.log(`Code Universe review: ${review.title} (${review.status})`);
    console.log(`Review ID: ${review.id}`);
  }
} catch (error) {
  console.error(`Code Universe review error: ${error.message}`);
  process.exit(1);
}

async function runCommand(name, values) {
  if (name === "start") {
    return post("/api/reviews/start", {
      sourceRoot,
      title: values.join(" ") || "Codex behavior review"
    });
  }

  if (name === "finish") {
    const outcome = values[0] === "failed" ? "failed" : "passed";
    const summaryStart = values[0] === "failed" || values[0] === "passed" ? 1 : 0;
    return post("/api/reviews/finish", {
      sourceRoot,
      outcome,
      summary: values.slice(summaryStart).join(" ") || "Review completed"
    });
  }

  if (!["inspect", "search", "suspect", "edit", "build", "test", "conclusion"].includes(name)) {
    throw new Error(`Unknown command: ${name}`);
  }

  return post("/api/reviews/event", {
    sourceRoot,
    event: parseEvent(name, values)
  });
}

function parseEvent(kind, values) {
  if (kind === "test" || kind === "build") {
    const outcome = values[0] === "failed" ? "failed" : values[0] === "passed" ? "passed" : "info";
    const summaryStart = outcome === "info" ? 0 : 1;
    return {
      kind,
      outcome,
      summary: values.slice(summaryStart).join(" ") || `${kind} ${outcome}`
    };
  }

  if (kind === "conclusion") {
    return { kind, summary: values.join(" ") || "Review concluded" };
  }

  const file = values[0] || null;
  const parsedLine = Number(values[1]);
  const hasLine = Number.isFinite(parsedLine) && parsedLine > 0;
  return {
    kind,
    file,
    line: hasLine ? Math.floor(parsedLine) : null,
    summary: values.slice(hasLine ? 2 : 1).join(" ") || null
  };
}

async function post(path, body) {
  let response;
  try {
    response = await fetch(`${endpoint}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
  } catch {
    throw new Error(`cannot reach ${endpoint}; start Code Universe first`);
  }
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || `request failed (${response.status})`);
  return payload;
}

function printUsage() {
  console.log(`Usage:
  code-universe-review start <title>
  code-universe-review inspect <file> [line] [summary]
  code-universe-review search <file> [line] [summary]
  code-universe-review suspect <file> [line] [summary]
  code-universe-review edit <file> [line] [summary]
  code-universe-review test <passed|failed> [summary]
  code-universe-review build <passed|failed> [summary]
  code-universe-review conclusion <summary>
  code-universe-review finish [passed|failed] [summary]

Environment:
  CODE_UNIVERSE_URL         API URL (default http://127.0.0.1:4173)
  CODE_UNIVERSE_SOURCE_ROOT reviewed project root (default current directory)`);
}
