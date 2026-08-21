// Record provenance answers "who produced this fact" for every record PageRoot
// writes. It is authored by the writer and never accepted from a caller, so a
// renderer or an AI attempt cannot claim an identity it does not have.
//
// The device identifier here is deliberately not the pseudonymous telemetry
// installation identity. That identifier is transmitted to the analytics
// endpoint, and telemetry already avoids sending raw project identity by
// hashing it; embedding the analytics identity inside user project files would
// invert that boundary and let anyone who reads a project file correlate it to
// the analytics stream. See docs/decisions/0006-pseudonymous-usage-telemetry.md.
//
// Provenance carries an actor and a device, not a per-device sequence number. A
// missing sequence can be introduced later because the records are already
// attributable; a missing actor or device can never be recovered, which is why
// both are captured from the first write.

export const PROVENANCE_ACTOR_KINDS = Object.freeze(["human", "agent"]);
export const LOCAL_HUMAN_ACTOR_ID = "local";

const DEVICE_ID_PATTERN =
  /^device_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ACTOR_ID_PATTERN = /^[A-Za-z0-9_-]{1,180}$/u;

function provenanceError(code, message) {
  const error = new Error(message);
  error.name = "ProvenanceError";
  error.code = code;
  return error;
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isDeviceIdentifier(value) {
  return DEVICE_ID_PATTERN.test(String(value ?? ""));
}

export function createDeviceIdentifier(randomUUID = globalThis.crypto?.randomUUID?.bind(
  globalThis.crypto,
)) {
  if (typeof randomUUID !== "function") {
    throw provenanceError(
      "PROVENANCE_UUID_UNAVAILABLE",
      "A UUID generator is required to create a device identifier.",
    );
  }
  const identifier = `device_${randomUUID()}`;
  if (!isDeviceIdentifier(identifier)) {
    throw provenanceError(
      "INVALID_DEVICE_IDENTIFIER",
      "The UUID generator did not produce a version 4 UUID.",
    );
  }
  return identifier;
}

export function createProvenance({
  actorKind = "human",
  actorId = LOCAL_HUMAN_ACTOR_ID,
  deviceId,
} = {}) {
  return normalizeProvenance({
    actor: { kind: actorKind, id: actorId },
    device: deviceId,
  });
}

export function normalizeProvenance(value, label = "provenance") {
  if (!isRecord(value)) {
    throw provenanceError(
      "INVALID_PROVENANCE",
      `${label} must be an object.`,
    );
  }
  const actor = value.actor;
  if (!isRecord(actor)) {
    throw provenanceError(
      "INVALID_PROVENANCE_ACTOR",
      `${label}.actor must be an object.`,
    );
  }
  const kind = String(actor.kind ?? "");
  const id = String(actor.id ?? "");
  if (!PROVENANCE_ACTOR_KINDS.includes(kind)) {
    throw provenanceError(
      "INVALID_PROVENANCE_ACTOR",
      `${label}.actor.kind must be human or agent.`,
    );
  }
  if (!ACTOR_ID_PATTERN.test(id)) {
    throw provenanceError(
      "INVALID_PROVENANCE_ACTOR",
      `${label}.actor.id must be a bounded identifier.`,
    );
  }
  const device = String(value.device ?? "");
  if (!isDeviceIdentifier(device)) {
    throw provenanceError(
      "INVALID_PROVENANCE_DEVICE",
      `${label}.device must be a device_ identifier.`,
    );
  }
  return { actor: { kind, id }, device };
}
