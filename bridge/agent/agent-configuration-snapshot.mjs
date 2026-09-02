import { sha256 } from "../lifecycle-core.mjs";

export const AGENT_CONFIGURATION_SNAPSHOT_VERSION = "1.0.0";
const DIGEST = /^sha256:[a-f0-9]{64}$/u;

function baseUrlOrigin(value) {
  if (!value) return null;
  try { return new URL(String(value)).origin; } catch { return null; }
}

export function createAgentConfigurationSnapshot({
  providerId,
  runtimeId,
  installation,
  installationDigest,
  selection,
  capabilityRevision = "1",
} = {}) {
  const credentialDigest = DIGEST.test(String(installation?.credentialDigest || ""))
    ? String(installation.credentialDigest)
    : String(installationDigest || "");
  const identity = Object.freeze({
    schemaVersion: AGENT_CONFIGURATION_SNAPSHOT_VERSION,
    providerId: String(providerId || ""),
    runtimeId: String(runtimeId || ""),
    vendorId: installation?.vendorId ? String(installation.vendorId) : null,
    baseUrlOrigin: baseUrlOrigin(installation?.baseUrl),
    modelId: selection?.resolvedModelId || selection?.requestedModelId || null,
    reasoning: selection?.reasoning?.applied || selection?.reasoning?.requested || "auto",
    capabilityRevision: String(capabilityRevision || "1"),
    credentialGeneration: Number.isSafeInteger(installation?.credentialGeneration)
      ? installation.credentialGeneration
      : 0,
    credentialDigest,
  });
  const configurationDigest = sha256(Buffer.from(JSON.stringify(identity), "utf8"));
  return Object.freeze({ ...identity, configurationDigest });
}

export function publicAgentConfigurationSnapshot(snapshot) {
  if (!snapshot || !DIGEST.test(String(snapshot.configurationDigest || ""))) {
    throw new TypeError("Agent configuration snapshot is invalid.");
  }
  return Object.freeze({
    schemaVersion: AGENT_CONFIGURATION_SNAPSHOT_VERSION,
    providerId: String(snapshot.providerId || ""),
    runtimeId: String(snapshot.runtimeId || ""),
    vendorId: snapshot.vendorId ? String(snapshot.vendorId) : null,
    baseUrlOrigin: snapshot.baseUrlOrigin ? String(snapshot.baseUrlOrigin) : null,
    modelId: snapshot.modelId ? String(snapshot.modelId) : null,
    reasoning: String(snapshot.reasoning || "auto"),
    capabilityRevision: String(snapshot.capabilityRevision || "1"),
    credentialGeneration: Number(snapshot.credentialGeneration || 0),
    configurationDigest: snapshot.configurationDigest,
  });
}

export function sameAgentConfiguration(left, right) {
  if (!left?.configurationDigest || !right?.configurationDigest) return false;
  return [
    "schemaVersion",
    "providerId",
    "runtimeId",
    "vendorId",
    "baseUrlOrigin",
    "modelId",
    "reasoning",
    "capabilityRevision",
    "credentialGeneration",
    "configurationDigest",
  ].every((field) => (left[field] ?? null) === (right[field] ?? null));
}
