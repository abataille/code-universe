import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { issueCommercialLicense } from "../lib/licensing/issuer.js";

const options = parseOptions(process.argv.slice(2));
const repositoryRoot = resolve(new URL("..", import.meta.url).pathname);
const privateKeyPath = requiredPath(options["private-key"], "--private-key");
const outputPath = requiredPath(options.output, "--output");
assertOutsideRepository(privateKeyPath, repositoryRoot, "The private key");
assertOutsideRepository(outputPath, repositoryRoot, "The customer licence");

const document = issueCommercialLicense({
  privateKey: await readFile(privateKeyPath, "utf8"),
  customer: options.customer,
  edition: options.edition,
  licenseId: options["license-id"],
  features: options.features ? options.features.split(",") : [],
  notBefore: options["not-before"] || new Date().toISOString(),
  expiresAt: options.expires || null
});

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(document, null, 2)}\n`, { flag: "wx", mode: 0o600 });
console.log(`Issued ${document.payload.edition} licence ${document.payload.licenseId} for ${document.payload.customer}.`);
console.log(`Customer licence: ${outputPath}`);

function parseOptions(args) {
  const result = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    if (!key?.startsWith("--") || args[index + 1] === undefined) throw new Error(`Invalid option near ${key || "end of command"}.`);
    result[key.slice(2)] = args[index + 1];
  }
  return result;
}

function requiredPath(value, option) {
  if (!value) throw new Error(`${option} is required.`);
  return resolve(value);
}

function assertOutsideRepository(path, root, label) {
  const candidate = relative(root, path);
  if (!candidate.startsWith("..") && candidate !== "") throw new Error(`${label} must be stored outside the repository.`);
}
