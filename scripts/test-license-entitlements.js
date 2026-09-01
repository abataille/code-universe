import assert from "node:assert/strict";
import { createPublicKey } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  activateLicenseDocument,
  canonicalLicensePayload,
  readLicenseStatus,
  verifyLicenseDocument
} from "../lib/licensing/entitlements.js";
import { generateCommercialLicenseKeyPair, issueCommercialLicense } from "../lib/licensing/issuer.js";

const { publicKey: publicPem, privateKey: privatePem } = generateCommercialLicenseKeyPair();
const payload = {
  version: 1,
  product: "code-universe",
  licenseId: "test-license",
  customer: "VCLab Test",
  edition: "pro",
  features: ["impact-reports", "impact-reports"],
  notBefore: "2026-01-01T00:00:00.000Z",
  expiresAt: "2027-01-01T00:00:00.000Z"
};
const document = issueCommercialLicense({
  privateKey: privatePem,
  customer: payload.customer,
  edition: payload.edition,
  licenseId: payload.licenseId,
  features: payload.features,
  notBefore: payload.notBefore,
  expiresAt: payload.expiresAt
});
const now = new Date("2026-09-01T12:00:00.000Z");

assert.equal(createPublicKey(publicPem).asymmetricKeyType, "ed25519");
assert.equal(canonicalLicensePayload({ b: 2, a: 1 }), '{"a":1,"b":2}');

const verified = verifyLicenseDocument(document, { publicKey: publicPem, now });
assert.equal(verified.valid, true);
assert.equal(verified.edition, "pro");
assert.deepEqual(verified.features, ["impact-reports"]);

const tampered = structuredClone(document);
tampered.payload.edition = "team";
assert.equal(verifyLicenseDocument(tampered, { publicKey: publicPem, now }).reason, "invalid-signature");

assert.equal(
  verifyLicenseDocument(document, { publicKey: publicPem, now: new Date("2028-01-01T00:00:00.000Z") }).reason,
  "expired"
);

const temporaryRoot = await mkdtemp(join(tmpdir(), "code-universe-license-"));
const licensePath = join(temporaryRoot, "license.json");
try {
  assert.equal((await readLicenseStatus({ licensePath, publicKey: publicPem, now })).reason, "missing");
  assert.equal((await activateLicenseDocument(document, { licensePath, publicKey: publicPem, now })).valid, true);
  assert.equal((await readLicenseStatus({ licensePath, publicKey: publicPem, now })).licenseId, "test-license");
  assert.match(await readFile(licensePath, "utf8"), /test-license/);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

console.log("License entitlement tests passed.");
