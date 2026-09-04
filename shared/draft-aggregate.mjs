const COMMENT_ID_KEYS = ["commentId"];
const EVENT_ID_KEYS = ["eventId"];
const OPERATION_ID_PATTERN = /^draftop_[A-Za-z0-9_-]{12,160}$/;

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function recordId(record, keys) {
  if (!isRecord(record)) return "";
  for (const key of keys) {
    const value = String(record[key] || "");
    if (value) return value;
  }
  return "";
}

function updatedAt(record) {
  if (!isRecord(record)) return "";
  return String(record.updatedAt || record.createdAt || "");
}

function uniqueStrings(values) {
  return [...new Set(
    Array.isArray(values)
      ? values.map((value) => String(value)).filter(Boolean)
      : [],
  )];
}

function mergeByIdentity(authoritative, pending, idKeys, preferNewer) {
  const merged = new Map();
  for (const record of authoritative) {
    const id = recordId(record, idKeys);
    if (id) merged.set(id, record);
  }
  for (const record of pending) {
    const id = recordId(record, idKeys);
    if (!id) continue;
    const current = merged.get(id);
    if (!current || !preferNewer || updatedAt(record) >= updatedAt(current)) {
      merged.set(id, record);
    }
  }
  return [...merged.values()];
}

export function createDraftOperationId(randomUUID = globalThis.crypto?.randomUUID?.bind(
  globalThis.crypto,
)) {
  const random = typeof randomUUID === "function"
    ? randomUUID()
    : `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  return `draftop_${String(random).replaceAll("-", "_")}`;
}

export function isDraftOperationId(value) {
  return OPERATION_ID_PATTERN.test(String(value || ""));
}

export function normalizeAuthoritativeDraft(value) {
  const raw = isRecord(value) ? value : {};
  const revision = Number(raw.draftRevision);
  return {
    draftRevision:
      Number.isSafeInteger(revision) && revision >= 0 ? revision : 0,
    comments: Array.isArray(raw.comments) ? raw.comments : [],
    changeEvents: Array.isArray(raw.changeEvents)
      ? raw.changeEvents
      : [],
    deletedCommentIds: uniqueStrings(raw.deletedCommentIds),
    appliedOperationIds: uniqueStrings(raw.appliedOperationIds),
  };
}

export function rebaseDraftMutation(pending, authoritativeValue) {
  const authoritative = normalizeAuthoritativeDraft(authoritativeValue);
  const deletedCommentIds = uniqueStrings([
    ...authoritative.deletedCommentIds,
    ...(Array.isArray(pending.deletedCommentIds)
      ? pending.deletedCommentIds
      : []),
  ]);
  const deleted = new Set(deletedCommentIds);
  const comments = mergeByIdentity(
    authoritative.comments,
    Array.isArray(pending.comments) ? pending.comments : [],
    COMMENT_ID_KEYS,
    true,
  ).filter((comment) => !deleted.has(recordId(comment, COMMENT_ID_KEYS)));
  const changeEvents = mergeByIdentity(
    authoritative.changeEvents,
    Array.isArray(pending.changeEvents) ? pending.changeEvents : [],
    EVENT_ID_KEYS,
    false,
  );
  return {
    ...pending,
    expectedDraftRevision: authoritative.draftRevision,
    comments,
    changeEvents,
    deletedCommentIds,
  };
}

export function operationWasApplied(authoritativeValue, operationId) {
  if (!isDraftOperationId(operationId)) return false;
  return normalizeAuthoritativeDraft(authoritativeValue)
    .appliedOperationIds
    .includes(operationId);
}
