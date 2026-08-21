import { LifecycleError } from "./lifecycle-core.mjs";
import {
  normalizeAuthoritativeDraft,
} from "./draft-aggregate.mjs";
import { decodeDraftCommandOperationId } from "./draft-command-decoder.mjs";

const COMMENT_ID_PATTERN = /^comment_[A-Za-z0-9_-]+$/;
const APPLIED_OPERATION_LIMIT = 256;

// Forward compatibility. Every member this build owns is rebuilt from the
// authoritative aggregate, and every member a newer PageRoot added is carried
// through read -> modify -> write unchanged. `editEvents` is the retired alias
// of `changeEvents`, so it counts as known and is not carried twice.
//
// The five envelope members are known for a different reason. The repository
// stores a Draft as `{ schemaVersion, projectId, documentId, workingCopyId,
// basedOnVersionId, ...snapshot }` and rebuilds all five from the loaded
// project on every save. Carrying them back from disk as if they were unknown
// would let the snapshot spread a stale identity over the authoritative one and
// pin the schema version forever.
const KNOWN_DRAFT_KEYS = new Set([
  "schemaVersion",
  "projectId",
  "documentId",
  "workingCopyId",
  "basedOnVersionId",
  "annotationsRelativePath",
  "annotationsSha256",
  "commentIds",
  "editEventIds",
  "draftRevision",
  "updatedAt",
  "comments",
  "changeEvents",
  "editEvents",
  "deletedCommentIds",
  "appliedOperationIds",
]);

function preserveUnknownDraftMembers(snapshot, draft) {
  let preserved = null;
  for (const key of Object.keys(draft)) {
    if (KNOWN_DRAFT_KEYS.has(key)) continue;
    preserved ??= {};
    preserved[key] = draft[key];
  }
  return preserved ? { ...snapshot, ...preserved } : snapshot;
}

function cleanIdentity(value) {
  return String(value ?? "").trim().slice(0, 180);
}

function mergeRecords(values, idKeys, randomUUID) {
  const byId = new Map();
  for (const value of Array.isArray(values) ? values : []) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const id = idKeys.map((key) => cleanIdentity(value[key])).find(Boolean)
      ?? randomUUID();
    byId.set(id, { ...value });
  }
  return [...byId.values()];
}

function draftError(status, code, message, details) {
  return new LifecycleError(code, message, details, status);
}

export function activeDraftSnapshot(runtimeDraft, now = () => (
  new Date().toISOString()
)) {
  const draft = runtimeDraft && typeof runtimeDraft === "object"
    ? runtimeDraft
    : {};
  const authoritative = normalizeAuthoritativeDraft(draft);
  return preserveUnknownDraftMembers({
    annotationsRelativePath:
      draft.annotationsRelativePath ?? "draft/annotations.json",
    annotationsSha256: draft.annotationsSha256 ?? "",
    commentIds: Array.isArray(draft.commentIds)
      ? draft.commentIds
      : authoritative.comments.map((comment) => comment.commentId).filter(Boolean),
    editEventIds: Array.isArray(draft.editEventIds)
      ? draft.editEventIds
      : authoritative.changeEvents.map((event) => event.eventId).filter(Boolean),
    draftRevision: authoritative.draftRevision,
    updatedAt: draft.updatedAt ?? now(),
    comments: authoritative.comments,
    changeEvents: authoritative.changeEvents,
    deletedCommentIds: authoritative.deletedCommentIds,
    appliedOperationIds: authoritative.appliedOperationIds,
  }, draft);
}

export function applyDraftCommand(
  runtimeDraft,
  body,
  {
    randomUUID = globalThis.crypto?.randomUUID?.bind(globalThis.crypto),
    now = () => new Date().toISOString(),
  } = {},
) {
  if (typeof randomUUID !== "function") {
    throw new TypeError("applyDraftCommand requires a UUID generator.");
  }
  const current = activeDraftSnapshot(runtimeDraft, now);
  let decodedOperation;
  try {
    decodedOperation = decodeDraftCommandOperationId(body?.operationId, {
      randomUUID,
    });
  } catch {
    throw draftError(
      400,
      "INVALID_DRAFT_OPERATION_ID",
      "operationId must be a stable draftop_ identifier.",
    );
  }
  const operationId = decodedOperation.operationId;
  if (current.appliedOperationIds.includes(operationId)) {
    return {
      replayed: true,
      operationId,
      current,
      next: current,
    };
  }

  const expectedDraftRevision = Number(body?.expectedDraftRevision);
  if (
    !Number.isSafeInteger(expectedDraftRevision)
    || expectedDraftRevision < 0
  ) {
    throw draftError(
      400,
      "INVALID_DRAFT_REVISION",
      "expectedDraftRevision must be a non-negative integer.",
    );
  }
  if (expectedDraftRevision !== current.draftRevision) {
    throw draftError(
      409,
      "DRAFT_REVISION_CONFLICT",
      "The draft changed after this client snapshot was created.",
      {
        expectedDraftRevision,
        currentDraftRevision: current.draftRevision,
        activeDraft: current,
      },
    );
  }

  const requestedDeletedCommentIds = Array.isArray(body?.deletedCommentIds)
    ? [...new Set(body.deletedCommentIds.map((value) => String(value)))]
    : [];
  if (requestedDeletedCommentIds.some(
    (commentId) => !COMMENT_ID_PATTERN.test(commentId),
  )) {
    throw draftError(
      400,
      "INVALID_DELETED_COMMENT_ID",
      "deletedCommentIds must contain valid comment identifiers.",
    );
  }

  const deletedCommentIds = body?.clear === true
    ? []
    : [...new Set([
        ...current.deletedCommentIds,
        ...requestedDeletedCommentIds,
      ])];
  const deleted = new Set(deletedCommentIds);
  const comments = body?.clear === true
    ? []
    : mergeRecords(body?.comments, ["commentId", "id"], randomUUID)
        .filter((comment) => !deleted.has(
          String(comment.commentId || comment.id || ""),
        ));
  const changeEvents = body?.clear === true
    ? []
    : mergeRecords(body?.changeEvents, ["eventId", "id"], randomUUID);
  const appliedOperationIds = [
    ...current.appliedOperationIds,
    operationId,
  ].slice(-APPLIED_OPERATION_LIMIT);

  return {
    replayed: false,
    operationId,
    current,
    next: {
      ...current,
      draftRevision: current.draftRevision + 1,
      updatedAt: now(),
      comments,
      changeEvents,
      deletedCommentIds,
      appliedOperationIds,
    },
  };
}
