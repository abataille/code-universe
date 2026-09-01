import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { generateCommercialLicenseKeyPair } from "../lib/licensing/issuer.js";

const options = parseOptions(process.argv.slice(2));
const repositoryRoot = resolve(new URL("..", import.meta.url).pathname);
const privateKeyPath = requiredPath(options["private-key"], "--private-key");
const publicKeyPath = resolve(options["public-key"] || "config/license-public-key.pem");
assertOutsideRepository(privateKeyPath, repositoryRoot, "The private key");
await ensureMissing(privateKeyPath);
await ensureMissing(publicKeyPath);

const keys = generateCommercialLicenseKeyPair();
await mkdir(dirname(privateKeyPath), { recursive: true });
await mkdir(dirname(publicKeyPath), { recursive: true });
await writeFile(privateKeyPath, keys.privateKey, { flag: "wx", mode: 0o600 });
try {
  await writeFile(publicKeyPath, keys.publicKey, { flag: "wx", mode: 0o644 });
} catch (error) {
  console.error(`Public key was not written: ${error.message}`);
  console.error(`The new private key remains at ${privateKeyPath}; remove it securely if you will retry.`);
  process.exitCode = 1;
  throw error;
}

console.log(`Private signing key: ${privateKeyPath}`);
console.log(`Public verification key: ${publicKeyPath}`);
console.log("Back up the private key securely. Never commit or copy it into a release bundle.");

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

async function ensureMissing(path) {
  try {
    await access(path);
    throw new Error(`Refusing to overwrite existing file: ${path}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}
