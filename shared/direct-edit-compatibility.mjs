const VERSION_ID_PATTERN = /^ver_(\d{4,})$/;
const DIRECT_EDIT_FIELDS = new Set([
  "eventId",
  "id",
  "createdAt",
  "revision",
  "capturedRevision",
  "basedOnVersionId",
  "baseVersionId",
  "kind",
  "property",
  "historyId",
  "undoesEventId",
  "summary",
  "target",
  "before",
  "after",
]);

export class DirectEditCompatibilityError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "DirectEditCompatibilityError";
    this.code = code;
  }
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function decodeError(code, message) {
  return new DirectEditCompatibilityError(code, message);
}

function assertKnownFields(value, label) {
  if (!isRecord(value)) {
    throw decodeError(
      "INVALID_DIRECT_EDIT_RECORD",
      `${label} must be an object.`,
    );
  }
  const unknown = Object.keys(value).find((key) => !DIRECT_EDIT_FIELDS.has(key));
  if (unknown) {
    throw decodeError(
      "UNKNOWN_DIRECT_EDIT_FIELD",
      `${label}.${unknown} is not supported.`,
    );
  }
  return value;
}

function decodeVersionId(value, label) {
  if (typeof value !== "string") {
    throw decodeError(
      "INVALID_DIRECT_EDIT_VERSION_ID",
      `${label} must be a version identifier.`,
    );
  }
  const match = VERSION_ID_PATTERN.exec(value);
  const ordinal = match ? Number(match[1]) : Number.NaN;
  if (!Number.isSafeInteger(ordinal) || ordinal < 1) {
    throw decodeError(
      "DIRECT_EDIT_VERSION_OUT_OF_RANGE",
      `${label} is outside the supported Version range.`,
    );
  }
  return value;
}

function decodeRevision(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw decodeError(
      "INVALID_DIRECT_EDIT_REVISION",
      `${label} must be a positive safe integer.`,
    );
  }
  return value;
}

function fallbackVersionId(value, label) {
  return decodeVersionId(value, `${label} fallback basedOnVersionId`);
}

function fallbackRevision(value, label) {
  return decodeRevision(value, `${label} fallback revision`);
}

/**
 * Converts both historic direct-edit field names to the persisted v3 identity.
 * A caller may supply trusted freeze fallbacks for an unsaved current Draft;
 * these defaults never apply when decoding an immutable Version archive.
 */
export function decodeDirectEditIdentity(value, {
  fallbackBasedOnVersionId,
  fallbackRevision: revisionFallback,
  allowUnassignedRevision = false,
  label = "direct edit",
} = {}) {
  const record = assertKnownFields(value, label);
  const hasCurrentVersion = Object.hasOwn(record, "basedOnVersionId");
  const hasLegacyVersion = Object.hasOwn(record, "baseVersionId");
  if (hasCurrentVersion && hasLegacyVersion) {
    throw decodeError(
      "DIRECT_EDIT_IDENTITY_AMBIGUOUS",
      `${label} cannot contain both basedOnVersionId and baseVersionId.`,
    );
  }
  const rawVersion = hasCurrentVersion
    ? record.basedOnVersionId
    : hasLegacyVersion
      ? record.baseVersionId
      : undefined;
  const basedOnVersionId = rawVersion === undefined
    || rawVersion === null
    || rawVersion === ""
    ? fallbackVersionId(fallbackBasedOnVersionId, label)
    : decodeVersionId(rawVersion, `${label}.basedOnVersionId`);

  const hasCurrentRevision = Object.hasOwn(record, "revision");
  const hasLegacyRevision = Object.hasOwn(record, "capturedRevision");
  if (hasCurrentRevision && hasLegacyRevision) {
    throw decodeError(
      "DIRECT_EDIT_IDENTITY_AMBIGUOUS",
      `${label} cannot contain both revision and capturedRevision.`,
    );
  }
  const rawRevision = hasCurrentRevision
    ? record.revision
    : hasLegacyRevision
      ? record.capturedRevision
      : undefined;
  const revision = rawRevision === undefined
    || rawRevision === null
    || (
      allowUnassignedRevision
      && Number.isSafeInteger(rawRevision)
      && rawRevision === 0
    )
    ? fallbackRevision(revisionFallback, label)
    : decodeRevision(rawRevision, `${label}.revision`);

  return {
    basedOnVersionId,
    revision,
  };
}
