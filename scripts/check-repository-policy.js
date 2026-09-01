import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";

const requiredFiles = [
  "LICENSE",
  "COMMERCIAL-LICENSE.md",
  "CONTRIBUTING.md",
  "CODE_OF_CONDUCT.md",
  "SECURITY.md",
  "CHANGELOG.md",
  "ROADMAP.md",
  "RELEASING.md",
  "docs/known-limitations.md",
  ".github/ISSUE_TEMPLATE/01-bug-report.yml",
  ".github/ISSUE_TEMPLATE/02-feature-request.yml",
  ".github/ISSUE_TEMPLATE/config.yml",
  ".github/pull_request_template.md",
  ".github/release.yml",
  ".github/workflows/ci.yml",
  "lib/licensing/entitlements.js",
  "lib/licensing/issuer.js",
  "scripts/generate-commercial-license-keys.js",
  "scripts/issue-commercial-license.js"
];

for (const file of requiredFiles) {
  assert((await stat(file)).isFile(), `Required repository file is missing: ${file}`);
}

const packageMetadata = JSON.parse(await readFile("package.json", "utf8"));
assert.equal(packageMetadata.license, "BUSL-1.1", "package.json must identify BUSL-1.1");
assert.equal(packageMetadata.author, "Dr. Raymund Vorwerk", "package.json must identify the legal licensor");

const license = await readFile("LICENSE", "utf8");
assert.match(license, /^Business Source License 1\.1/m);
assert.match(license, /^Licensor: Dr\. Raymund Vorwerk$/m);
assert.match(license, /^Change Date: 2030-09-01$/m);
assert.match(license, /^Change License: Apache License, Version 2\.0$/m);

const trackedFiles = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);
for (const file of trackedFiles) {
  const details = await stat(file);
  if (!details.isFile() || details.size > 2_000_000) continue;
  const contents = await readFile(file, "utf8");
  assert.doesNotMatch(contents, /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, `Tracked private key found in ${file}`);
}

console.log("Repository policy checks passed.");
