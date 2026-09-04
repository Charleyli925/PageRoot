const VERSION_ID_PATTERN = /^ver_(\d{4,})$/;
const DIRECT_EDIT_FIELDS = new Set([
  "eventId",
  "createdAt",
  "revision",
  "basedOnVersionId",
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
 * Reads the current persisted Version identity on a direct-edit record.
 * Draft freeze may supply trusted fallbacks for an unsaved Working Copy;
 * immutable Version archives must carry their own complete identity.
 */
export function decodeDirectEditIdentity(value, {
  fallbackBasedOnVersionId,
  fallbackRevision: revisionFallback,
  preserveUnassignedVersion = false,
  allowUnassignedRevision = false,
  label = "direct edit",
} = {}) {
  const record = assertKnownFields(value, label);
  const rawVersion = Object.hasOwn(record, "basedOnVersionId")
    ? record.basedOnVersionId
    : undefined;
  const basedOnVersionId = rawVersion === undefined
    || rawVersion === null
    || rawVersion === ""
    ? preserveUnassignedVersion
      ? null
      : fallbackVersionId(fallbackBasedOnVersionId, label)
    : decodeVersionId(rawVersion, `${label}.basedOnVersionId`);

  const rawRevision = Object.hasOwn(record, "revision")
    ? record.revision
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
