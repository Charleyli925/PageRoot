export const CANONICAL_LIFECYCLE_STATES = Object.freeze([
  "editing",
  "submitting",
  "processing",
  "validating",
  "committing",
  "ready-to-open",
  "awaiting-conflict-resolution",
  "recovering-transaction",
  "ready",
  "no-change",
  "complete",
  "cancelled",
  "error",
]);

const CANONICAL = new Set(CANONICAL_LIFECYCLE_STATES);
const LOCKED = new Set([
  "submitting",
  "processing",
  "validating",
  "committing",
  "ready-to-open",
  "awaiting-conflict-resolution",
  "recovering-transaction",
]);
const COMPLETION_OBSERVED = new Set([
  "validating",
  "committing",
  "ready-to-open",
  "awaiting-conflict-resolution",
  "recovering-transaction",
  "no-change",
  "complete",
]);
const LEGACY_DECODER = new Map([
  ["waiting", "processing"],
  ["importing", "validating"],
  ["result-ready", "validating"],
  ["awaiting-check-decision", "validating"],
  ["version-created", "complete"],
  ["completed", "complete"],
  ["canceled", "cancelled"],
]);

export function canonicalLifecycleState(
  value,
  { readyVersion = false, fallback = "processing" } = {},
) {
  const raw = String(value || "");
  if (
    readyVersion
    && ["version-created", "completed", "complete", "ready"].includes(raw)
  ) {
    return "ready-to-open";
  }
  const decoded = LEGACY_DECODER.get(raw) ?? raw;
  if (CANONICAL.has(decoded)) return decoded;
  return CANONICAL.has(fallback) ? fallback : "processing";
}

export function isLockedLifecycleState(value) {
  return LOCKED.has(value);
}

export function hasObservedCompletion(run) {
  return run?.completionObserved === true
    || COMPLETION_OBSERVED.has(run?.status);
}

export function validationReviewFromRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const rawStatus = String(value.status || "");
  if (
    rawStatus !== "observed"
    && rawStatus !== "pending"
    && rawStatus !== "waived"
  ) {
    return null;
  }
  return {
    // Compatibility belongs at the domain decoder boundary. The renderer only
    // sees the current model and cannot accidentally restore a retired choice.
    status: rawStatus === "pending" ? "pending" : "observed",
    hardViolationCodes: Array.isArray(value.hardViolationCodes)
      ? value.hardViolationCodes.map(String)
      : [],
    softViolationCodes: Array.isArray(value.softViolationCodes)
      ? value.softViolationCodes.map(String)
      : [],
  };
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function displayVersionLabel(ordinal) {
  return Number.isSafeInteger(ordinal) && ordinal > 0
    ? `版本 ${ordinal}`
    : "下一版";
}

function safeVersionLabel(versionId) {
  const match = String(versionId || "").match(/(\d+)$/);
  return match ? `版本 ${Number(match[1])}` : String(versionId || "");
}

export function activeRunFromRecord(raw) {
  if (!isRecord(raw)) return null;
  const conflict = isRecord(raw.conflict) ? raw.conflict : raw;
  const requestId = String(raw.requestId || "");
  if (!requestId) return null;
  const candidateVersionId = String(raw.candidateVersionId || "");
  const candidateVersionOrdinal = Number(raw.candidateVersionOrdinal);
  return {
    projectId: String(raw.projectId || ""),
    documentId: String(raw.documentId || ""),
    requestId,
    attemptId: String(raw.attemptId || "attempt_001"),
    requestPath: String(raw.requestPath || ""),
    attemptPath: String(raw.attemptPath || ""),
    handoffMessage: String(raw.handoffMessage || ""),
    status: canonicalLifecycleState(
      raw.status || raw.lifecycleState || "processing",
    ),
    sourcePath: String(raw.sourcePath || ""),
    baseSnapshotSha256: String(raw.baseSnapshotSha256 || raw.sourceSha256 || ""),
    previousVersionId: raw.previousVersionId
      ? String(raw.previousVersionId)
      : null,
    basedOnVersionId: raw.basedOnVersionId
      ? String(raw.basedOnVersionId)
      : null,
    freezeCutoffRevision: Number(raw.freezeCutoffRevision || 0),
    candidateVersionId,
    candidateVersionLabel: String(
      raw.candidateDisplayVersionLabel
      || (
        Number.isSafeInteger(candidateVersionOrdinal)
        && candidateVersionOrdinal > 0
          ? displayVersionLabel(candidateVersionOrdinal)
          : null
      )
      || raw.candidateVersionLabel
      || (candidateVersionId ? safeVersionLabel(candidateVersionId) : "下一版"),
    ),
    submittedAt: String(raw.submittedAt || ""),
    ...(raw.summary ? { summary: String(raw.summary) } : {}),
    ...(Number.isFinite(Number(raw.commentCount))
      ? { commentCount: Number(raw.commentCount) }
      : {}),
    ...(Number.isFinite(Number(raw.changeEventCount))
      ? { changeEventCount: Number(raw.changeEventCount) }
      : {}),
    ...(raw.error
      ? {
          error: isRecord(raw.error)
            ? String(raw.error.message || "")
            : String(raw.error),
        }
      : {}),
    ...(raw.completionObserved === true ? { completionObserved: true } : {}),
    ...(raw.conflictId || conflict.conflictId
      ? { conflictId: String(raw.conflictId || conflict.conflictId) }
      : {}),
    ...(conflict.externalSourceSha256
      ? { externalSourceSha256: String(conflict.externalSourceSha256) }
      : {}),
    ...(conflict.candidateOutputSha256 || conflict.candidateSha256
      ? {
          candidateOutputSha256: String(
            conflict.candidateOutputSha256 || conflict.candidateSha256,
          ),
        }
      : {}),
    ...(conflict.detectedAt
      ? { conflictDetectedAt: String(conflict.detectedAt) }
      : {}),
    ...(isRecord(raw.readyPayload) ? { readyPayload: raw.readyPayload } : {}),
    ...(validationReviewFromRecord(raw.validationReview)
      ? { validationReview: validationReviewFromRecord(raw.validationReview) }
      : {}),
    ...(isRecord(raw.scopeReport) ? { scopeReport: raw.scopeReport } : {}),
  };
}
