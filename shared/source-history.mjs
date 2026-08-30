const SOURCE_HISTORY_SCHEMA_VERSION = "1.0.0";
const SOURCE_HISTORY_ENTRY_LIMIT = 100;
const SOURCE_HISTORY_ACTION_LIMIT = 256;
const SOURCE_HISTORY_PATCH_LIMIT = 2_048;
const SOURCE_HISTORY_TEXT_LIMIT = 4 * 1024 * 1024;
const SOURCE_HISTORY_JOURNAL_BYTE_LIMIT = 32 * 1024 * 1024;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const OPERATION_ID_PATTERN = /^sourceop_[A-Za-z0-9_-]{12,180}$/;
const ACTION_ID_PATTERN = /^sourceaction_[A-Za-z0-9_-]{12,180}$/;
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

function jsonByteLength(value) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function requiredIdentity(value, label) {
  const identity = String(value || "");
  if (!identity || identity.length > 200) {
    throw historyError(
      "INVALID_SOURCE_HISTORY_IDENTITY",
      `${label} must be a non-empty project identity.`,
    );
  }
  return identity;
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

function boundedJsonRecord(value, label) {
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
  if (!serialized || serialized.length > 64 * 1024) {
    throw historyError(
      "INVALID_SOURCE_HISTORY_TARGET",
      `${label} is too large or cannot be serialized.`,
    );
  }
  return JSON.parse(serialized);
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
const KNOWN_ACTION_KEYS = new Set([
  "actionId",
  "direction",
  "operationId",
  "cursor",
  "revision",
  "sourceSha256",
  "appliedAt",
]);
const KNOWN_HISTORY_KEYS = new Set([
  "schemaVersion",
  "projectId",
  "documentId",
  "baseSourceSha256",
  "cursor",
  "revision",
  "entries",
  "appliedActions",
  "updatedAt",
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
          semanticOperation: boundedJsonRecord(
            raw.semanticOperation,
            "entry.semanticOperation",
          ),
        }
      : {}),
    ...(raw.identityDelta !== undefined
      ? {
          identityDelta: boundedJsonRecord(
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

function cleanAppliedAction(raw) {
  if (!isRecord(raw)) {
    throw historyError(
      "INVALID_SOURCE_HISTORY_ACTION",
      "An applied source history action must be an object.",
    );
  }
  const actionId = String(raw.actionId || "");
  const direction = String(raw.direction || "");
  const operationId = String(raw.operationId || "");
  const cursor = Number(raw.cursor);
  const revision = Number(raw.revision);
  if (!ACTION_ID_PATTERN.test(actionId)) {
    throw historyError(
      "INVALID_SOURCE_HISTORY_ACTION_ID",
      "actionId must be a stable sourceaction_ identifier.",
    );
  }
  if (direction !== "undo" && direction !== "redo") {
    throw historyError(
      "INVALID_SOURCE_HISTORY_DIRECTION",
      "History direction must be undo or redo.",
    );
  }
  if (!OPERATION_ID_PATTERN.test(operationId)) {
    throw historyError(
      "INVALID_SOURCE_HISTORY_OPERATION_ID",
      "Applied history operationId is invalid.",
    );
  }
  if (
    !Number.isSafeInteger(cursor)
    || cursor < 0
    || !Number.isSafeInteger(revision)
    || revision < 1
  ) {
    throw historyError(
      "INVALID_SOURCE_HISTORY_ACTION",
      "Applied history action has an invalid cursor or revision.",
    );
  }
  return preserveUnknown({
    actionId,
    direction,
    operationId,
    cursor,
    revision,
    sourceSha256: requiredSha256(
      raw.sourceSha256,
      "appliedAction.sourceSha256",
    ),
    appliedAt: requiredTimestamp(raw.appliedAt, "appliedAction.appliedAt"),
  }, raw, KNOWN_ACTION_KEYS);
}

function currentHistorySha256(history) {
  return history.cursor === 0
    ? history.baseSourceSha256
    : history.entries[history.cursor - 1].afterSourceSha256;
}

function validateEntryChain(baseSourceSha256, entries) {
  let expected = baseSourceSha256;
  for (const entry of entries) {
    if (entry.beforeSourceSha256 !== expected) {
      throw historyError(
        "SOURCE_HISTORY_CHAIN_BROKEN",
        "Source history entries do not form one exact hash chain.",
        {
          operationId: entry.operationId,
          expectedSourceSha256: expected,
          actualSourceSha256: entry.beforeSourceSha256,
        },
      );
    }
    expected = entry.afterSourceSha256;
  }
}

function validateAppliedActionLedger(history) {
  const entryIndexes = new Map(
    history.entries.map((entry, index) => [entry.operationId, index]),
  );
  const actionIds = new Set();
  let previousRevision = 0;
  for (const action of history.appliedActions) {
    const entryIndex = entryIndexes.get(action.operationId);
    const expectedCursor = action.direction === "undo"
      ? entryIndex
      : entryIndex === undefined ? undefined : entryIndex + 1;
    const entry = entryIndex === undefined
      ? null
      : history.entries[entryIndex];
    const expectedSourceSha256 = !entry
      ? null
      : action.direction === "undo"
        ? entry.beforeSourceSha256
        : entry.afterSourceSha256;
    if (
      actionIds.has(action.actionId)
      || entryIndex === undefined
      || action.cursor !== expectedCursor
      || action.sourceSha256 !== expectedSourceSha256
      || action.revision <= previousRevision
      || action.revision > history.revision
    ) {
      throw historyError(
        "INVALID_SOURCE_HISTORY_ACTION_LEDGER",
        "Applied source history actions do not match the retained operation journal.",
        { actionId: action.actionId, operationId: action.operationId },
      );
    }
    actionIds.add(action.actionId);
    previousRevision = action.revision;
  }
}

function emptyHistory({
  projectId,
  documentId,
  sourceSha256,
  now,
}) {
  return {
    schemaVersion: SOURCE_HISTORY_SCHEMA_VERSION,
    projectId: requiredIdentity(projectId, "projectId"),
    documentId: requiredIdentity(documentId, "documentId"),
    baseSourceSha256: requiredSha256(sourceSha256, "sourceSha256"),
    cursor: 0,
    revision: 0,
    entries: [],
    appliedActions: [],
    updatedAt: now(),
  };
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

export function createSourceActionId(randomUUID) {
  return createStableId("sourceaction_", randomUUID);
}

export function createEmptySourceHistory({
  projectId,
  documentId,
  sourceSha256,
  now = () => new Date().toISOString(),
}) {
  return emptyHistory({ projectId, documentId, sourceSha256, now });
}

export function normalizeSourceHistory(
  value,
  {
    projectId,
    documentId,
    sourceSha256,
    now = () => new Date().toISOString(),
    resetOnSourceMismatch = true,
  },
) {
  if (!isRecord(value)) {
    return emptyHistory({ projectId, documentId, sourceSha256, now });
  }
  if (value.schemaVersion !== SOURCE_HISTORY_SCHEMA_VERSION) {
    throw historyError(
      "UNSUPPORTED_SOURCE_HISTORY_SCHEMA",
      `Source history must use schema ${SOURCE_HISTORY_SCHEMA_VERSION}.`,
    );
  }
  const normalized = preserveUnknown({
    schemaVersion: SOURCE_HISTORY_SCHEMA_VERSION,
    projectId: requiredIdentity(value.projectId, "projectId"),
    documentId: requiredIdentity(value.documentId, "documentId"),
    baseSourceSha256: requiredSha256(
      value.baseSourceSha256,
      "baseSourceSha256",
    ),
    cursor: Number(value.cursor),
    revision: Number(value.revision),
    entries: Array.isArray(value.entries) ? value.entries.map(cleanEntry) : [],
    appliedActions: Array.isArray(value.appliedActions)
      ? value.appliedActions.map(cleanAppliedAction)
      : [],
    updatedAt: requiredTimestamp(value.updatedAt, "updatedAt"),
  }, value, KNOWN_HISTORY_KEYS);
  if (
    normalized.projectId !== requiredIdentity(projectId, "projectId")
    || normalized.documentId !== requiredIdentity(documentId, "documentId")
  ) {
    throw historyError(
      "SOURCE_HISTORY_IDENTITY_MISMATCH",
      "Source history does not belong to the active document.",
    );
  }
  if (
    !Number.isSafeInteger(normalized.cursor)
    || normalized.cursor < 0
    || normalized.cursor > normalized.entries.length
    || !Number.isSafeInteger(normalized.revision)
    || normalized.revision < 0
    || normalized.entries.length > SOURCE_HISTORY_ENTRY_LIMIT
    || normalized.appliedActions.length > SOURCE_HISTORY_ACTION_LIMIT
    || jsonByteLength(normalized.entries)
      > SOURCE_HISTORY_JOURNAL_BYTE_LIMIT
  ) {
    throw historyError(
      "INVALID_SOURCE_HISTORY_STATE",
      "Source history cursor, revision, or retained depth is invalid.",
    );
  }
  validateEntryChain(normalized.baseSourceSha256, normalized.entries);
  validateAppliedActionLedger(normalized);
  const activeSourceSha256 = requiredSha256(sourceSha256, "sourceSha256");
  if (currentHistorySha256(normalized) !== activeSourceSha256) {
    if (!resetOnSourceMismatch) {
      throw historyError(
        "SOURCE_HISTORY_SOURCE_MISMATCH",
        "Source history cursor does not match the active source.",
      );
    }
    return emptyHistory({
      projectId,
      documentId,
      sourceSha256: activeSourceSha256,
      now,
    });
  }
  return normalized;
}

export function sourceHistoryCapabilities(history) {
  return {
    canUndo: history.cursor > 0,
    canRedo: history.cursor < history.entries.length,
    cursor: history.cursor,
    depth: history.entries.length,
    revision: history.revision,
    sourceSha256: currentHistorySha256(history),
  };
}

export function appendSourceHistoryOperations(
  currentValue,
  operations,
  {
    projectId,
    documentId,
    sourceSha256,
    targetSourceSha256,
    now = () => new Date().toISOString(),
  },
) {
  const history = normalizeSourceHistory(currentValue, {
    projectId,
    documentId,
    sourceSha256,
    now,
  });
  const requested = Array.isArray(operations)
    ? operations.map(cleanEntry)
    : [];
  if (requested.length === 0) {
    if (currentHistorySha256(history) !== targetSourceSha256) {
      return emptyHistory({
        projectId,
        documentId,
        sourceSha256: targetSourceSha256,
        now,
      });
    }
    return history;
  }
  let entries = history.entries.slice(0, history.cursor);
  const knownEntries = new Map(
    history.entries.map((entry) => [entry.operationId, entry]),
  );
  let expectedSourceSha256 = currentHistorySha256({
    ...history,
    entries,
    cursor: entries.length,
  });
  for (const entry of requested) {
    const known = knownEntries.get(entry.operationId);
    if (known) {
      if (JSON.stringify(known) !== JSON.stringify(entry)) {
        throw historyError(
          "SOURCE_HISTORY_OPERATION_REUSED",
          "A source history operationId was reused with different content.",
        );
      }
      if (entry.afterSourceSha256 === expectedSourceSha256) continue;
    }
    if (entry.beforeSourceSha256 !== expectedSourceSha256) {
      throw historyError(
        "SOURCE_HISTORY_OPERATION_CHAIN_MISMATCH",
        "Pending source operations do not begin at the active history cursor.",
        {
          operationId: entry.operationId,
          expectedSourceSha256,
          actualSourceSha256: entry.beforeSourceSha256,
        },
      );
    }
    entries.push(entry);
    expectedSourceSha256 = entry.afterSourceSha256;
  }
  const expectedTarget = requiredSha256(
    targetSourceSha256,
    "targetSourceSha256",
  );
  if (expectedSourceSha256 !== expectedTarget) {
    throw historyError(
      "SOURCE_HISTORY_TARGET_MISMATCH",
      "Pending source operations do not produce the autosave target.",
      { expectedSourceSha256, targetSourceSha256: expectedTarget },
    );
  }
  let baseSourceSha256 = history.baseSourceSha256;
  let removedFromHead = 0;
  if (entries.length > SOURCE_HISTORY_ENTRY_LIMIT) {
    const removedCount = entries.length - SOURCE_HISTORY_ENTRY_LIMIT;
    baseSourceSha256 = entries[removedCount - 1].afterSourceSha256;
    entries = entries.slice(removedCount);
    removedFromHead += removedCount;
  }
  let retainedBytes = entries.reduce(
    (total, entry) => total + jsonByteLength(entry),
    0,
  ) + (entries.length > 0 ? entries.length + 1 : 2);
  while (
    entries.length > 1
    && retainedBytes > SOURCE_HISTORY_JOURNAL_BYTE_LIMIT
  ) {
    const removed = entries.shift();
    retainedBytes -= jsonByteLength(removed) + 1;
    baseSourceSha256 = removed.afterSourceSha256;
    removedFromHead += 1;
  }
  if (retainedBytes > SOURCE_HISTORY_JOURNAL_BYTE_LIMIT) {
    throw historyError(
      "SOURCE_HISTORY_JOURNAL_TOO_LARGE",
      "A single source operation exceeds the retained history byte limit.",
    );
  }
  const retainedOperationIds = new Set(
    entries.map((entry) => entry.operationId),
  );
  const appliedActions = history.appliedActions
    .filter((action) => retainedOperationIds.has(action.operationId))
    .map((action) => ({
      ...action,
      cursor: action.cursor - removedFromHead,
    }))
    .filter((action) => (
      action.cursor >= 0 && action.cursor <= entries.length
    ));
  return {
    ...history,
    baseSourceSha256,
    cursor: entries.length,
    revision: history.revision + 1,
    entries,
    appliedActions,
    updatedAt: now(),
  };
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

export function applySourceHistoryAction(
  currentValue,
  source,
  {
    projectId,
    documentId,
    direction,
    actionId,
    expectedRevision,
    expectedCursor,
    sha256,
    now = () => new Date().toISOString(),
  },
) {
  if (typeof sha256 !== "function") {
    throw new TypeError("applySourceHistoryAction requires a sha256 function.");
  }
  if (direction !== "undo" && direction !== "redo") {
    throw historyError(
      "INVALID_SOURCE_HISTORY_DIRECTION",
      "History direction must be undo or redo.",
    );
  }
  if (!ACTION_ID_PATTERN.test(String(actionId || ""))) {
    throw historyError(
      "INVALID_SOURCE_HISTORY_ACTION_ID",
      "actionId must be a stable sourceaction_ identifier.",
    );
  }
  const sourceSha256 = requiredSha256(sha256(source), "sourceSha256");
  const history = normalizeSourceHistory(currentValue, {
    projectId,
    documentId,
    sourceSha256,
    now,
    resetOnSourceMismatch: false,
  });
  const replayedAction = history.appliedActions.find(
    (action) => action.actionId === actionId,
  );
  if (replayedAction) {
    if (replayedAction.direction !== direction) {
      throw historyError(
        "SOURCE_HISTORY_ACTION_REUSED",
        "A source history actionId was reused for another direction.",
      );
    }
    const replayedEntry = history.entries.find(
      (entry) => entry.operationId === replayedAction.operationId,
    ) ?? null;
    return {
      changed: false,
      replayed: true,
      html: source,
      sourceSha256,
      history,
      entry: replayedEntry,
      target: replayedEntry
        ? direction === "undo"
          ? replayedEntry.beforeTarget
          : replayedEntry.afterTarget
        : null,
      selection: replayedEntry
        ? direction === "undo"
          ? replayedEntry.beforeSelection ?? null
          : replayedEntry.afterSelection ?? null
        : null,
      targetTransition: replayedEntry
        ? {
            fromTarget: direction === "undo"
              ? replayedEntry.afterTarget
              : replayedEntry.beforeTarget,
            toTarget: direction === "undo"
              ? replayedEntry.beforeTarget
              : replayedEntry.afterTarget,
          }
        : null,
    };
  }
  if (
    Number(expectedRevision) !== history.revision
    || Number(expectedCursor) !== history.cursor
  ) {
    throw historyError(
      "SOURCE_HISTORY_REVISION_CONFLICT",
      "Source history changed before this action was applied.",
      {
        expectedRevision,
        currentRevision: history.revision,
        expectedCursor,
        currentCursor: history.cursor,
      },
    );
  }
  const entry = direction === "undo"
    ? history.entries[history.cursor - 1]
    : history.entries[history.cursor];
  if (!entry) {
    return {
      changed: false,
      replayed: false,
      html: source,
      sourceSha256,
      history,
      entry: null,
      target: null,
      selection: null,
      targetTransition: null,
    };
  }
  const patches = direction === "undo"
    ? entry.reversePatches
    : entry.forwardPatches;
  const expectedBeforeSha256 = direction === "undo"
    ? entry.afterSourceSha256
    : entry.beforeSourceSha256;
  const expectedAfterSha256 = direction === "undo"
    ? entry.beforeSourceSha256
    : entry.afterSourceSha256;
  if (sourceSha256 !== expectedBeforeSha256) {
    throw historyError(
      "SOURCE_HISTORY_SOURCE_MISMATCH",
      "The active source does not match the selected history entry.",
      { expectedSourceSha256: expectedBeforeSha256, actualSourceSha256: sourceSha256 },
    );
  }
  const html = renderExactPatches(source, patches);
  const nextSourceSha256 = requiredSha256(sha256(html), "nextSourceSha256");
  if (nextSourceSha256 !== expectedAfterSha256) {
    throw historyError(
      "SOURCE_HISTORY_RESULT_MISMATCH",
      "The retained source patches did not reproduce their recorded hash.",
      { expectedSourceSha256: expectedAfterSha256, actualSourceSha256: nextSourceSha256 },
    );
  }
  const cursor = direction === "undo"
    ? history.cursor - 1
    : history.cursor + 1;
  const revision = history.revision + 1;
  const appliedAction = {
    actionId,
    direction,
    operationId: entry.operationId,
    cursor,
    revision,
    sourceSha256: nextSourceSha256,
    appliedAt: now(),
  };
  const appliedActions = [
    ...history.appliedActions,
    appliedAction,
  ].slice(-SOURCE_HISTORY_ACTION_LIMIT);
  return {
    changed: true,
    replayed: false,
    html,
    sourceSha256: nextSourceSha256,
    history: {
      ...history,
      cursor,
      revision,
      appliedActions,
      updatedAt: appliedAction.appliedAt,
    },
    entry,
    target: direction === "undo" ? entry.beforeTarget : entry.afterTarget,
    selection: direction === "undo"
      ? entry.beforeSelection ?? null
      : entry.afterSelection ?? null,
    targetTransition: {
      fromTarget: direction === "undo"
        ? entry.afterTarget
        : entry.beforeTarget,
      toTarget: direction === "undo"
        ? entry.beforeTarget
        : entry.afterTarget,
    },
  };
}

export {
  SOURCE_HISTORY_ACTION_LIMIT,
  SOURCE_HISTORY_ENTRY_LIMIT,
  SOURCE_HISTORY_JOURNAL_BYTE_LIMIT,
  SOURCE_HISTORY_SCHEMA_VERSION,
};
