import { createPrivateKey, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { canonicalLicensePayload, COMMERCIAL_EDITIONS, PRODUCT_ID } from "./entitlements.js";

export function generateCommercialLicenseKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    publicKey: publicKey.export({ type: "spki", format: "pem" }),
    privateKey: privateKey.export({ type: "pkcs8", format: "pem" })
  };
}

export function issueCommercialLicense({
  privateKey,
  customer,
  edition,
  licenseId = randomUUID(),
  features = [],
  notBefore = new Date().toISOString(),
  expiresAt = null
} = {}) {
  if (typeof customer !== "string" || !customer.trim()) throw new Error("customer is required.");
  if (!COMMERCIAL_EDITIONS.has(edition)) throw new Error("edition must be pro or team.");
  if (typeof licenseId !== "string" || !licenseId.trim()) throw new Error("licenseId is required.");
  if (!validDate(notBefore)) throw new Error("notBefore must be an ISO date.");
  if (expiresAt && !validDate(expiresAt)) throw new Error("expiresAt must be an ISO date.");

  const payload = {
    version: 1,
    product: PRODUCT_ID,
    licenseId: licenseId.trim(),
    customer: customer.trim(),
    edition,
    features: [...new Set(features.filter((feature) => typeof feature === "string" && feature.trim()).map((feature) => feature.trim()))].sort(),
    notBefore: new Date(notBefore).toISOString(),
    expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null
  };
  const signature = sign(
    null,
    Buffer.from(canonicalLicensePayload(payload), "utf8"),
    createPrivateKey(privateKey)
  ).toString("base64");
  return { payload, signature };
}

function validDate(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}
