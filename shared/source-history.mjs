const SOURCE_HISTORY_PATCH_LIMIT = 2_048;
const SOURCE_HISTORY_TEXT_LIMIT = 4 * 1024 * 1024;
const SOURCE_HISTORY_TARGET_BYTE_LIMIT = 64 * 1024;
const SOURCE_HISTORY_SEMANTIC_EVIDENCE_BYTE_LIMIT = 8 * 1024 * 1024;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const OPERATION_ID_PATTERN = /^sourceop_[A-Za-z0-9_-]{12,180}$/;
const HISTORY_KINDS = new Set(["text", "style", "structure", "reorder"]);

function historyError(code, message, details) {
  const error = new Error(message);
  error.name = "SourceHistoryError";
  error.code = code;
  error.details = details;
  return error;
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requiredSha256(value, label) {
  const hash = String(value || "");
  if (!SHA256_PATTERN.test(hash)) {
    throw historyError(
      "INVALID_SOURCE_HISTORY_HASH",
      `${label} must be a sha256: hash.`,
    );
  }
  return hash;
}

function requiredTimestamp(value, label) {
  const timestamp = String(value || "");
  if (!timestamp || Number.isNaN(Date.parse(timestamp))) {
    throw historyError(
      "INVALID_SOURCE_HISTORY_TIMESTAMP",
      `${label} must be an ISO timestamp.`,
    );
  }
  return timestamp;
}

function boundedJsonRecord(value, label, {
  maxBytes = SOURCE_HISTORY_TARGET_BYTE_LIMIT,
  errorCode = "INVALID_SOURCE_HISTORY_TARGET",
} = {}) {
  if (value === null || value === undefined) return null;
  if (!isRecord(value)) {
    throw historyError(
      "INVALID_SOURCE_HISTORY_TARGET",
      `${label} must be an object or null.`,
    );
  }
  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch {
    serialized = "";
  }
  if (!serialized || new TextEncoder().encode(serialized).byteLength > maxBytes) {
    throw historyError(
      errorCode,
      `${label} is too large or cannot be serialized.`,
    );
  }
  return JSON.parse(serialized);
}

function boundedSemanticEvidence(value, label) {
  return boundedJsonRecord(value, label, {
    maxBytes: SOURCE_HISTORY_SEMANTIC_EVIDENCE_BYTE_LIMIT,
    errorCode: "SOURCE_HISTORY_SEMANTIC_EVIDENCE_TOO_LARGE",
  });
}

// Forward compatibility. A newer PageRoot may add members to any of these
// records. Every known member stays strictly validated, and every unknown
// member is carried through read -> modify -> write unchanged so an older
// build never silently deletes a newer build's data. Preserved members take
// no part in validation and still count against the journal byte budget.
const KNOWN_SELECTION_KEYS = new Set(["anchor", "focus", "affinity"]);
const KNOWN_PATCH_KEYS = new Set([
  "startOffset",
  "endOffset",
  "before",
  "after",
  "kind",
]);
const KNOWN_ENTRY_KEYS = new Set([
  "operationId",
  "kind",
  "property",
  "editRevision",
  "createdAt",
  "beforeSourceSha256",
  "afterSourceSha256",
  "forwardPatches",
  "reversePatches",
  "beforeTarget",
  "afterTarget",
  "beforeSelection",
  "afterSelection",
  "semanticDirection",
  "semanticOperation",
  "identityDelta",
]);
function preserveUnknown(validated, raw, knownKeys) {
  if (!isRecord(raw)) return validated;
  let preserved = null;
  for (const key of Object.keys(raw)) {
    if (knownKeys.has(key)) continue;
    preserved ??= {};
    preserved[key] = raw[key];
  }
  return preserved ? { ...validated, ...preserved } : validated;
}

function cleanSelection(value, label) {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    throw historyError(
      "INVALID_SOURCE_HISTORY_SELECTION",
      `${label} must be an object when present.`,
    );
  }
  const anchor = Number(value.anchor);
  const focus = Number(value.focus);
  const affinity = String(value.affinity || "");
  if (
    !Number.isSafeInteger(anchor)
    || !Number.isSafeInteger(focus)
    || anchor < 0
    || focus < 0
    || (affinity !== "left" && affinity !== "right")
  ) {
    throw historyError(
      "INVALID_SOURCE_HISTORY_SELECTION",
      `${label} must contain safe logical offsets and affinity.`,
    );
  }
  return preserveUnknown(
    { anchor, focus, affinity },
    value,
    KNOWN_SELECTION_KEYS,
  );
}

function cleanPatch(raw, label) {
  if (!isRecord(raw)) {
    throw historyError(
      "INVALID_SOURCE_HISTORY_PATCH",
      `${label} must be an object.`,
    );
  }
  const startOffset = Number(raw.startOffset);
  const endOffset = Number(raw.endOffset);
  const before = typeof raw.before === "string" ? raw.before : null;
  const after = typeof raw.after === "string" ? raw.after : null;
  const kind = String(raw.kind || "").slice(0, 200);
  if (
    !Number.isSafeInteger(startOffset)
    || !Number.isSafeInteger(endOffset)
    || startOffset < 0
    || endOffset < startOffset
    || before === null
    || after === null
    || !kind
  ) {
    throw historyError(
      "INVALID_SOURCE_HISTORY_PATCH",
      `${label} is not an exact source patch.`,
    );
  }
  return preserveUnknown(
    { startOffset, endOffset, before, after, kind },
    raw,
    KNOWN_PATCH_KEYS,
  );
}

function cleanPatches(value, label) {
  if (
    !Array.isArray(value)
    || value.length < 1
    || value.length > SOURCE_HISTORY_PATCH_LIMIT
  ) {
    throw historyError(
      "INVALID_SOURCE_HISTORY_PATCHES",
      `${label} must contain a bounded non-empty patch list.`,
    );
  }
  const patches = value.map((patch, index) => (
    cleanPatch(patch, `${label}[${index}]`)
  ));
  const sorted = [...patches].sort(
    (left, right) => left.startOffset - right.startOffset
      || left.endOffset - right.endOffset,
  );
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index].startOffset < sorted[index - 1].endOffset) {
      throw historyError(
        "OVERLAPPING_SOURCE_HISTORY_PATCHES",
        `${label} contains overlapping source ranges.`,
      );
    }
  }
  const textSize = patches.reduce(
    (total, patch) => total + patch.before.length + patch.after.length,
    0,
  );
  if (textSize > SOURCE_HISTORY_TEXT_LIMIT) {
    throw historyError(
      "SOURCE_HISTORY_PATCHES_TOO_LARGE",
      `${label} exceeds the source history text limit.`,
    );
  }
  return patches;
}

function cleanEntry(raw) {
  if (!isRecord(raw)) {
    throw historyError(
      "INVALID_SOURCE_HISTORY_ENTRY",
      "A source history entry must be an object.",
    );
  }
  const operationId = String(raw.operationId || "");
  const kind = String(raw.kind || "");
  const editRevision = Number(raw.editRevision);
  if (!OPERATION_ID_PATTERN.test(operationId)) {
    throw historyError(
      "INVALID_SOURCE_HISTORY_OPERATION_ID",
      "operationId must be a stable sourceop_ identifier.",
    );
  }
  if (!HISTORY_KINDS.has(kind)) {
    throw historyError(
      "INVALID_SOURCE_HISTORY_KIND",
      "Source history kind is not supported.",
    );
  }
  if (!Number.isSafeInteger(editRevision) || editRevision < 1) {
    throw historyError(
      "INVALID_SOURCE_HISTORY_EDIT_REVISION",
      "editRevision must be a positive integer.",
    );
  }
  const property = raw.property === undefined
    ? undefined
    : String(raw.property || "").slice(0, 200);
  const semanticDirection = raw.semanticDirection === undefined
    ? undefined
    : String(raw.semanticDirection || "");
  if (
    semanticDirection !== undefined
    && !["forward", "undo", "redo"].includes(semanticDirection)
  ) {
    throw historyError(
      "INVALID_SOURCE_HISTORY_SEMANTIC_DIRECTION",
      "Semantic history direction is invalid.",
    );
  }
  return preserveUnknown({
    operationId,
    kind,
    ...(property ? { property } : {}),
    editRevision,
    createdAt: requiredTimestamp(raw.createdAt, "entry.createdAt"),
    beforeSourceSha256: requiredSha256(
      raw.beforeSourceSha256,
      "entry.beforeSourceSha256",
    ),
    afterSourceSha256: requiredSha256(
      raw.afterSourceSha256,
      "entry.afterSourceSha256",
    ),
    forwardPatches: cleanPatches(raw.forwardPatches, "entry.forwardPatches"),
    reversePatches: cleanPatches(raw.reversePatches, "entry.reversePatches"),
    beforeTarget: boundedJsonRecord(raw.beforeTarget, "entry.beforeTarget"),
    afterTarget: boundedJsonRecord(raw.afterTarget, "entry.afterTarget"),
    ...(semanticDirection ? { semanticDirection } : {}),
    ...(raw.semanticOperation !== undefined
      ? {
          semanticOperation: boundedSemanticEvidence(
            raw.semanticOperation,
            "entry.semanticOperation",
          ),
        }
      : {}),
    ...(raw.identityDelta !== undefined
      ? {
          identityDelta: boundedSemanticEvidence(
            raw.identityDelta,
            "entry.identityDelta",
          ),
        }
      : {}),
    ...(raw.beforeSelection !== undefined
      ? {
          beforeSelection: cleanSelection(
            raw.beforeSelection,
            "entry.beforeSelection",
          ),
        }
      : {}),
    ...(raw.afterSelection !== undefined
      ? {
          afterSelection: cleanSelection(
            raw.afterSelection,
            "entry.afterSelection",
          ),
        }
      : {}),
  }, raw, KNOWN_ENTRY_KEYS);
}

function createStableId(prefix, randomUUID) {
  const random = typeof randomUUID === "function"
    ? randomUUID()
    : globalThis.crypto?.randomUUID?.();
  if (!random) {
    throw historyError(
      "SOURCE_HISTORY_UUID_UNAVAILABLE",
      "A UUID generator is required for source history identifiers.",
    );
  }
  return `${prefix}${String(random).replaceAll("-", "_")}`;
}

export function createSourceOperationId(randomUUID) {
  return createStableId("sourceop_", randomUUID);
}

function renderExactPatches(source, patches) {
  let output = source;
  const descending = [...patches].sort(
    (left, right) => right.startOffset - left.startOffset
      || right.endOffset - left.endOffset,
  );
  for (const patch of descending) {
    if (patch.endOffset > output.length) {
      throw historyError(
        "SOURCE_HISTORY_PATCH_OUT_OF_RANGE",
        "A retained source patch is outside the current source.",
        { patch },
      );
    }
    const actual = output.slice(patch.startOffset, patch.endOffset);
    if (actual !== patch.before) {
      throw historyError(
        "SOURCE_HISTORY_PATCH_CONTENT_MISMATCH",
        "The exact retained source range no longer matches history.",
        { patch, actual },
      );
    }
    output = `${output.slice(0, patch.startOffset)}${patch.after}${
      output.slice(patch.endOffset)
    }`;
  }
  return output;
}

export function validateSourceHistoryOperationBytes(
  operations,
  source,
  target,
  sha256,
) {
  if (typeof sha256 !== "function") {
    throw new TypeError(
      "validateSourceHistoryOperationBytes requires a sha256 function.",
    );
  }
  const requested = Array.isArray(operations)
    ? operations.map(cleanEntry)
    : [];
  if (requested.length === 0) return [];
  let current = String(source);
  const steps = [];
  for (const entry of requested) {
    const currentSha256 = requiredSha256(sha256(current), "sourceSha256");
    if (currentSha256 !== entry.beforeSourceSha256) {
      throw historyError(
        "SOURCE_HISTORY_OPERATION_CHAIN_MISMATCH",
        "A pending source operation does not begin at the exact current bytes.",
        {
          operationId: entry.operationId,
          expectedSourceSha256: entry.beforeSourceSha256,
          actualSourceSha256: currentSha256,
        },
      );
    }
    const next = renderExactPatches(current, entry.forwardPatches);
    const nextSha256 = requiredSha256(sha256(next), "nextSourceSha256");
    if (nextSha256 !== entry.afterSourceSha256) {
      throw historyError(
        "SOURCE_HISTORY_RESULT_MISMATCH",
        "A pending forward patch did not reproduce its recorded source hash.",
        { operationId: entry.operationId },
      );
    }
    const restored = renderExactPatches(next, entry.reversePatches);
    if (restored !== current) {
      throw historyError(
        "SOURCE_HISTORY_RESULT_MISMATCH",
        "A pending inverse patch did not exactly restore its source bytes.",
        { operationId: entry.operationId },
      );
    }
    steps.push({
      operation: entry,
      beforeHtml: current,
      afterHtml: next,
    });
    current = next;
  }
  if (current !== String(target)) {
    throw historyError(
      "SOURCE_HISTORY_TARGET_MISMATCH",
      "Pending source patches do not reproduce the autosave target bytes.",
    );
  }
  return steps;
}
