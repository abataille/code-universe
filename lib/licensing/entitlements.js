import { createPublicKey, verify } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export const PRODUCT_ID = "code-universe";
export const COMMERCIAL_EDITIONS = new Set(["pro", "team"]);

export function canonicalLicensePayload(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalLicensePayload).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalLicensePayload(value[key])}`).join(",")}}`;
}

export function verifyLicenseDocument(document, { publicKey, now = new Date() } = {}) {
  if (!publicKey) return invalid("Commercial license verification is not configured.", "unconfigured");
  if (!document || typeof document !== "object" || !document.payload || typeof document.signature !== "string") {
    return invalid("The license document is malformed.", "malformed");
  }

  const payload = document.payload;
  if (payload.version !== 1 || payload.product !== PRODUCT_ID) {
    return invalid("The license is not for this version of Code Universe.", "wrong-product");
  }
  if (!COMMERCIAL_EDITIONS.has(payload.edition)) {
    return invalid("The license edition must be Pro or Team.", "wrong-edition");
  }
  if (!nonEmptyString(payload.licenseId) || !nonEmptyString(payload.customer)) {
    return invalid("The license is missing its identifier or customer.", "malformed");
  }

  let signatureIsValid = false;
  try {
    signatureIsValid = verify(
      null,
      Buffer.from(canonicalLicensePayload(payload), "utf8"),
      createPublicKey(publicKey),
      Buffer.from(document.signature, "base64")
    );
  } catch {
    return invalid("The license signature could not be verified.", "invalid-signature");
  }
  if (!signatureIsValid) return invalid("The license signature is invalid.", "invalid-signature");

  const nowMs = now.getTime();
  const notBeforeMs = optionalDate(payload.notBefore);
  const expiresAtMs = optionalDate(payload.expiresAt);
  if (notBeforeMs === null || expiresAtMs === null) return invalid("The license contains an invalid date.", "malformed");
  if (notBeforeMs !== undefined && nowMs < notBeforeMs) return invalid("The license is not active yet.", "not-active");
  if (expiresAtMs !== undefined && nowMs >= expiresAtMs) return invalid("The license has expired.", "expired");

  const features = Array.isArray(payload.features)
    ? [...new Set(payload.features.filter(nonEmptyString))].sort()
    : [];
  return {
    valid: true,
    configured: true,
    edition: payload.edition,
    licenseId: payload.licenseId,
    customer: payload.customer,
    features,
    expiresAt: payload.expiresAt || null
  };
}

export async function readLicenseStatus({ licensePath, publicKey, now } = {}) {
  if (!publicKey) return invalid("Commercial license verification is not configured.", "unconfigured");
  try {
    const document = JSON.parse(await readFile(licensePath, "utf8"));
    return verifyLicenseDocument(document, { publicKey, now });
  } catch (error) {
    if (error?.code === "ENOENT") return invalid("No commercial license is activated.", "missing", true);
    return invalid("The activated license could not be read.", "malformed", true);
  }
}

export async function activateLicenseDocument(document, { licensePath, publicKey, now } = {}) {
  const status = verifyLicenseDocument(document, { publicKey, now });
  if (!status.valid) return status;

  await mkdir(dirname(licensePath), { recursive: true });
  const temporaryPath = `${licensePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600 });
  await rename(temporaryPath, licensePath);
  return status;
}

function invalid(message, reason, configured = Boolean(reason !== "unconfigured")) {
  return {
    valid: false,
    configured,
    edition: "unlicensed",
    features: [],
    reason,
    message,
    productionUseRequiresCommercialLicense: true
  };
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function optionalDate(value) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}
