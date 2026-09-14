export const STEMMIO_ELEMENT_ID_ATTRIBUTE = "data-stemmio-id";
export const STEMMIO_ELEMENT_ID_SCHEMA_VERSION = 1;
export const STEMMIO_ELEMENT_ID_PREFIX = "sm1_";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const STEMMIO_ELEMENT_ID = /^sm1_[0-9a-f]{12}4[0-9a-f]{3}[89ab][0-9a-f]{15}$/u;

export class StemmioElementIdentityError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "StemmioElementIdentityError";
    this.code = code;
    this.details = details;
  }
}

export function isValidStemmioElementId(value) {
  return typeof value === "string" && STEMMIO_ELEMENT_ID.test(value);
}

export function generateStemmioElementId(
  randomUUID = globalThis.crypto?.randomUUID?.bind(globalThis.crypto),
) {
  if (typeof randomUUID !== "function") {
    throw new StemmioElementIdentityError(
      "STEMMIO_ID_GENERATOR_UNAVAILABLE",
      "A cryptographically secure UUID v4 generator is required.",
    );
  }
  const uuid = String(randomUUID()).toLowerCase();
  if (!UUID_V4.test(uuid)) {
    throw new StemmioElementIdentityError(
      "STEMMIO_ID_GENERATOR_INVALID_OUTPUT",
      "The element identity generator did not return a canonical UUID v4.",
      { uuid },
    );
  }
  return `${STEMMIO_ELEMENT_ID_PREFIX}${uuid.replaceAll("-", "")}`;
}

export function isPersistentStemmioAttribute(name) {
  return String(name ?? "").toLowerCase() === STEMMIO_ELEMENT_ID_ATTRIBUTE;
}

export function isEphemeralStemmioAttribute(name) {
  const normalized = String(name ?? "").toLowerCase();
  return normalized.startsWith("data-stemmio-")
    && normalized !== STEMMIO_ELEMENT_ID_ATTRIBUTE;
}
