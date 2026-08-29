export const PAGEROOT_ELEMENT_ID_ATTRIBUTE = "data-pageroot-id";
export const PAGEROOT_ELEMENT_ID_SCHEMA_VERSION = 1;
export const PAGEROOT_ELEMENT_ID_PREFIX = "pr1_";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const PAGEROOT_ELEMENT_ID = /^pr1_[0-9a-f]{12}4[0-9a-f]{3}[89ab][0-9a-f]{15}$/u;

export class PagerootElementIdentityError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "PagerootElementIdentityError";
    this.code = code;
    this.details = details;
  }
}

export function isValidPagerootElementId(value) {
  return typeof value === "string" && PAGEROOT_ELEMENT_ID.test(value);
}

export function generatePagerootElementId(
  randomUUID = globalThis.crypto?.randomUUID?.bind(globalThis.crypto),
) {
  if (typeof randomUUID !== "function") {
    throw new PagerootElementIdentityError(
      "PAGEROOT_ID_GENERATOR_UNAVAILABLE",
      "A cryptographically secure UUID v4 generator is required.",
    );
  }
  const uuid = String(randomUUID()).toLowerCase();
  if (!UUID_V4.test(uuid)) {
    throw new PagerootElementIdentityError(
      "PAGEROOT_ID_GENERATOR_INVALID_OUTPUT",
      "The element identity generator did not return a canonical UUID v4.",
      { uuid },
    );
  }
  return `${PAGEROOT_ELEMENT_ID_PREFIX}${uuid.replaceAll("-", "")}`;
}

export function isPersistentPagerootAttribute(name) {
  return String(name ?? "").toLowerCase() === PAGEROOT_ELEMENT_ID_ATTRIBUTE;
}

export function isEphemeralPagerootAttribute(name) {
  const normalized = String(name ?? "").toLowerCase();
  return normalized.startsWith("data-pageroot-")
    && normalized !== PAGEROOT_ELEMENT_ID_ATTRIBUTE;
}
