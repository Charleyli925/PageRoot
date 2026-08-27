/**
 * SourceTransaction is the only Bridge-side owner of the current-source
 * commit/recovery state machine. Route adapters retain request decoding and
 * response encoding; this service owns the WAL, same-directory replacement,
 * source-history settlement, audit outbox, and restart replay.
 */

import { randomUUID } from "node:crypto";
import {
  chmod,
  open,
  readFile,
  rename,
  rm,
} from "node:fs/promises";
import path from "node:path";

import {
  atomicWriteFile,
  exists,
  jsonText,
  nowIso,
  requireCompleteHtml,
  sha256,
  syncDirectory,
} from "./lifecycle-core.mjs";
import {
  normalizeSourceHistoryCandidate,
  readSourceHistory,
  writeSourceHistory,
} from "./source-history-service.mjs";

const AUTOSAVE_RECOVERY_LOG = "recovery/autosave-log.json";

function auditEventId(value) {
  if (typeof value !== "string") return "";
  return value.replaceAll("\0", "").trim().slice(0, 180);
}

function autosaveUpdated(sourceSha256) {
  return {
    status: "updated",
    expectedSourceSha256: sourceSha256,
    lastPersistedAt: nowIso(),
    recoveryLogRelativePath: AUTOSAVE_RECOVERY_LOG,
  };
}

function autosaveError(expectedSourceSha256, error) {
  return {
    status: "error",
    expectedSourceSha256,
    recoveryLogRelativePath: AUTOSAVE_RECOVERY_LOG,
    errorCode: error.code,
    errorMessage: error.message,
  };
}

function recoveryPaths(context, recoveryId) {
  const relativeHtmlPath = `recovery/${recoveryId}.html`;
  const relativeHistoryPath = `recovery/${recoveryId}.source-history.json`;
  return {
    relativeHtmlPath,
    relativeHistoryPath,
    htmlPath: path.join(context.projectRoot, ...relativeHtmlPath.split("/")),
    historyPath: path.join(
      context.projectRoot,
      ...relativeHistoryPath.split("/"),
    ),
  };
}

function pendingWrite({
  editRevision,
  expectedSourceSha256,
  targetSha256,
  paths,
  historyRecoverySha256,
  auditEvents,
}) {
  return {
    revision: editRevision,
    expectedSourceSha256,
    targetHtmlSha256: targetSha256,
    recoveryHtmlRelativePath: paths.relativeHtmlPath,
    recoveryHtmlSha256: targetSha256,
    recoverySourceHistoryRelativePath: paths.relativeHistoryPath,
    recoverySourceHistorySha256: historyRecoverySha256,
    auditEvents,
    queuedAt: nowIso(),
  };
}

function settledView(project, sourceSha256) {
  return {
    viewMode: "current",
    latestVersionId: project.latestVersionId,
    currentBasedOnVersionId: project.currentBasedOnVersionId,
    currentExactVersionId: project.currentExactVersionId,
    viewingVersionId: null,
    renderedContentSha256: sourceSha256,
  };
}

function failedRuntime(runtime, expectedSourceSha256, code, message) {
  runtime.pendingWrite = null;
  runtime.lifecycleState = "editing";
  runtime.lastWriteError = {
    code,
    message,
    at: nowIso(),
  };
  runtime.autosave = autosaveError(expectedSourceSha256, runtime.lastWriteError);
}

/**
 * Create an audit record before it enters the durable outbox. The same record
 * is replayed exactly once after a process crash, regardless of whether it
 * originated from autosave or a source-history action.
 */
export function sourceTransactionAuditEvent(
  context,
  project,
  editRevision,
  rawEvent,
) {
  return {
    ...rawEvent,
    eventId: auditEventId(rawEvent?.eventId)
      || `edit_${editRevision}_${randomUUID()}`,
    editRevision,
    projectId: context.projectId,
    documentId: context.documentId,
    basedOnVersionId: project.currentBasedOnVersionId,
    persistedAt: nowIso(),
  };
}

async function atomicReplaceSource({
  sourcePath,
  expectedSourceSha256,
  content,
  adapters,
}) {
  const before = await adapters.readSourceFile(sourcePath);
  if (before.sha256 !== expectedSourceSha256) {
    throw adapters.createHttpError(
      409,
      "SOURCE_HASH_CONFLICT",
      "The source HTML changed outside the workbench.",
      { expectedSha256: expectedSourceSha256, actualSha256: before.sha256 },
    );
  }
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
  requireCompleteHtml(buffer.toString("utf8"), "replacement source HTML");
  const targetSha256 = sha256(buffer);
  const parent = path.dirname(sourcePath);
  const temporary = path.join(
    parent,
    `.${path.basename(sourcePath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  const mode = before.information.mode & 0o777;
  const handle = await open(temporary, "wx", mode || 0o600);
  try {
    await handle.writeFile(buffer);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    const justBeforeReplace = await adapters.readSourceFile(sourcePath);
    if (justBeforeReplace.sha256 !== expectedSourceSha256) {
      throw adapters.createHttpError(
        409,
        "SOURCE_HASH_CONFLICT",
        "The source HTML changed before the atomic replacement.",
        {
          expectedSha256: expectedSourceSha256,
          actualSha256: justBeforeReplace.sha256,
        },
      );
    }
    await rename(temporary, sourcePath);
    await syncDirectory(parent);
    await chmod(sourcePath, mode || 0o600);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  const verified = await adapters.readSourceFile(sourcePath);
  if (verified.sha256 !== targetSha256) {
    throw adapters.createHttpError(
      500,
      "SOURCE_WRITE_VERIFICATION_FAILED",
      "The source HTML did not match the intended content after replacement.",
      { targetSha256, actualSha256: verified.sha256 },
    );
  }
  return verified;
}

async function writePreparedTransaction({
  context,
  runtime,
  editRevision,
  expectedSourceSha256,
  targetBuffer,
  targetSha256,
  nextSourceHistory,
  auditEvents,
  recoveryId,
  revisionMode,
  adapters,
}) {
  const paths = recoveryPaths(context, recoveryId);
  const historyRecoveryBuffer = Buffer.from(
    jsonText(nextSourceHistory),
    "utf8",
  );
  const historyRecoverySha256 = sha256(historyRecoveryBuffer);
  await atomicWriteFile(paths.htmlPath, targetBuffer);
  await atomicWriteFile(paths.historyPath, historyRecoveryBuffer);
  runtime.editRevision = revisionMode === "max"
    ? Math.max(runtime.editRevision, editRevision)
    : editRevision;
  runtime.pendingWrite = pendingWrite({
    editRevision,
    expectedSourceSha256,
    targetSha256,
    paths,
    historyRecoverySha256,
    auditEvents,
  });
  runtime.autosave = {
    status: "updating",
    expectedSourceSha256,
    recoveryLogRelativePath: AUTOSAVE_RECOVERY_LOG,
  };
  runtime.lastWriteError = null;
  await adapters.writeRuntime(context.projectRoot, runtime);
  await adapters.maybeFailpoint(
    "after-autosave-prepared",
    path.join(context.projectRoot, "recovery"),
  );
  return paths;
}

async function settleCommittedTransaction({
  context,
  project,
  runtime,
  written,
  editRevision,
  auditEvents,
  paths,
  adapters,
}) {
  runtime.lastPersistedRevision = editRevision;
  await adapters.syncCurrentSourceIdentity(context, written);
  project.currentHtmlSha256 = written.sha256;
  project.currentExactVersionId = await adapters.exactVersionForHash(
    context,
    written.sha256,
  );
  project.lastModifiedAt = written.lastModifiedAt;
  await adapters.writeProject(context, project);
  runtime.view = settledView(project, written.sha256);
  // pendingWrite remains the audit outbox until both metadata and every audit
  // event have reached durable storage.
  await adapters.writeRuntime(context.projectRoot, runtime);
  await adapters.maybeFailpoint(
    "after-autosave-project-applied",
    path.join(context.projectRoot, "recovery"),
  );
  for (const event of auditEvents) {
    await adapters.appendAuditOnce(context, event);
  }
  await adapters.maybeFailpoint(
    "after-autosave-audit-applied",
    path.join(context.projectRoot, "recovery"),
  );
  runtime.pendingWrite = null;
  runtime.lifecycleState = "editing";
  runtime.lastWriteError = null;
  runtime.autosave = autosaveUpdated(written.sha256);
  await adapters.writeRuntime(context.projectRoot, runtime);
  await rm(paths.htmlPath, { force: true });
  await rm(paths.historyPath, { force: true });
}

async function recordCommitFailure({
  kind,
  error,
  context,
  runtime,
  expectedSourceSha256,
  targetSha256,
  recoveryHtmlRelativePath,
  editRevision,
  adapters,
}) {
  if (error?.code === "INJECTED_FAILPOINT" && kind === "autosave") {
    runtime.lastWriteError = {
      code: error.code,
      message: error.message,
      at: nowIso(),
    };
    await adapters.writeRuntime(context.projectRoot, runtime);
    throw error;
  }

  let responseError = error;
  if (error?.code === "SOURCE_HASH_CONFLICT" && kind === "autosave") {
    const latestSource = await adapters.readSourceFile(context.sourcePath);
    runtime.conflict = {
      conflictId: `conflict_${randomUUID()}`,
      type: "autosave-source",
      expectedSourceSha256,
      externalSourceSha256: latestSource.sha256,
      candidateContentSha256: targetSha256,
      candidateRecoveryRelativePath: recoveryHtmlRelativePath,
      editRevision,
      detectedAt: nowIso(),
    };
    runtime.lifecycleState = "awaiting-conflict-resolution";
    runtime.autosave = {
      status: "external-conflict",
      expectedSourceSha256,
      recoveryLogRelativePath: AUTOSAVE_RECOVERY_LOG,
      errorCode: "SOURCE_HASH_CONFLICT",
      errorMessage:
        "The source changed outside the workbench and was not overwritten.",
    };
    responseError = adapters.createHttpError(
      409,
      "SOURCE_CHANGED",
      "The source HTML changed before the atomic replacement and was not overwritten.",
      runtime.conflict,
    );
  }
  runtime.lastWriteError = {
    code: error?.code ?? (
      kind === "history" ? "SOURCE_HISTORY_WRITE_FAILED" : "SOURCE_WRITE_FAILED"
    ),
    message: error instanceof Error
      ? error.message
      : kind === "history"
        ? "Source history write failed."
        : "Source write failed.",
    at: nowIso(),
  };
  if (!runtime.conflict) {
    runtime.autosave = autosaveError(
      expectedSourceSha256,
      runtime.lastWriteError,
    );
  }
  await adapters.writeRuntime(context.projectRoot, runtime);
  if (error?.code === "SOURCE_HASH_CONFLICT" && kind === "history") {
    throw adapters.createHttpError(
      409,
      "SOURCE_CHANGED",
      "The source HTML changed during the history action.",
    );
  }
  throw responseError;
}

/**
 * Commit a validated source mutation. The caller supplies the already-decoded
 * route semantics, but no caller may perform a partial source transaction.
 */
export async function commitSourceTransaction({
  kind,
  context,
  project,
  runtime,
  source,
  editRevision,
  expectedSourceSha256,
  targetBuffer,
  nextSourceHistory,
  auditEvents,
  recoveryId,
  revisionMode,
  skipSourceReplacementWhenTargetMatches = false,
  adapters,
}) {
  const targetSha256 = sha256(targetBuffer);
  const paths = await writePreparedTransaction({
    context,
    runtime,
    editRevision,
    expectedSourceSha256,
    targetBuffer,
    targetSha256,
    nextSourceHistory,
    auditEvents,
    recoveryId,
    revisionMode,
    adapters,
  });
  let written;
  try {
    written = skipSourceReplacementWhenTargetMatches && targetSha256 === source.sha256
      ? source
      : await atomicReplaceSource({
          sourcePath: context.sourcePath,
          expectedSourceSha256,
          content: targetBuffer,
          adapters,
        });
    await writeSourceHistory(context, nextSourceHistory);
    await adapters.maybeFailpoint(
      "after-autosave-source-applied",
      path.join(context.projectRoot, "recovery"),
    );
  } catch (error) {
    await recordCommitFailure({
      kind,
      error,
      context,
      runtime,
      expectedSourceSha256,
      targetSha256,
      recoveryHtmlRelativePath: paths.relativeHtmlPath,
      editRevision,
      adapters,
    });
  }
  await settleCommittedTransaction({
    context,
    project,
    runtime,
    written,
    editRevision,
    auditEvents,
    paths,
    adapters,
  });
  return { source: written, targetSha256 };
}

/**
 * Replay the durable SourceTransaction outbox after any Bridge restart. It
 * intentionally reads only the runtime envelope so unrelated display
 * artifacts cannot strand recovery or cancellation.
 */
export async function recoverPendingSourceTransaction(context, adapters) {
  const runtime = await adapters.readRuntime(context, { hydrateArtifacts: false });
  const pending = runtime.pendingWrite;
  if (!pending) return null;
  const revision = pending.revision;
  const expectedSourceSha256 = pending.expectedSourceSha256;
  const targetSha256 = pending.targetHtmlSha256;
  const recoveryRelativePath = pending.recoveryHtmlRelativePath;
  const recoveryPath = recoveryRelativePath
    ? path.join(context.projectRoot, ...recoveryRelativePath.split("/"))
    : null;
  const historyRecoveryRelativePath = pending.recoverySourceHistoryRelativePath;
  const historyRecoveryPath = historyRecoveryRelativePath
    ? path.join(context.projectRoot, ...historyRecoveryRelativePath.split("/"))
    : null;
  const source = await adapters.readSourceFile(context.sourcePath);
  let candidateBuffer = null;
  let historyCandidate = null;
  let historyRecoveryFailure = null;

  if (recoveryPath && await exists(recoveryPath)) {
    candidateBuffer = await readFile(recoveryPath);
    if (sha256(candidateBuffer) !== targetSha256) {
      failedRuntime(
        runtime,
        expectedSourceSha256,
        "RECOVERY_CANDIDATE_HASH_MISMATCH",
        "The durable autosave recovery candidate was corrupted.",
      );
      await adapters.writeRuntime(context.projectRoot, runtime);
      return { status: "rolled-back", reason: "candidate-hash-mismatch" };
    }
  }
  if (historyRecoveryPath) {
    const expectedHistorySha256 = pending.recoverySourceHistorySha256;
    if (!await exists(historyRecoveryPath)) {
      historyRecoveryFailure = {
        code: "RECOVERY_SOURCE_HISTORY_MISSING",
        message: "The durable source history recovery candidate is missing.",
        reason: "history-candidate-missing",
      };
    } else {
      const historyBuffer = await readFile(historyRecoveryPath);
      if (sha256(historyBuffer) !== expectedHistorySha256) {
        historyRecoveryFailure = {
          code: "RECOVERY_SOURCE_HISTORY_HASH_MISMATCH",
          message: "The durable source history recovery candidate was corrupted.",
          reason: "history-candidate-hash-mismatch",
        };
      } else {
        try {
          historyCandidate = normalizeSourceHistoryCandidate(
            JSON.parse(historyBuffer.toString("utf8")),
            context,
            targetSha256,
          );
        } catch {
          historyRecoveryFailure = {
            code: "RECOVERY_SOURCE_HISTORY_INVALID",
            message: "The durable source history recovery candidate is invalid.",
            reason: "history-candidate-invalid",
          };
        }
      }
    }
  }
  if (
    historyRecoveryFailure
    && source.sha256 === expectedSourceSha256
    && source.sha256 !== targetSha256
  ) {
    failedRuntime(
      runtime,
      expectedSourceSha256,
      historyRecoveryFailure.code,
      historyRecoveryFailure.message,
    );
    await adapters.writeRuntime(context.projectRoot, runtime);
    if (recoveryPath) await rm(recoveryPath, { force: true });
    if (historyRecoveryPath) await rm(historyRecoveryPath, { force: true });
    return { status: "rolled-back", reason: historyRecoveryFailure.reason };
  }
  if (historyRecoveryFailure && source.sha256 === targetSha256) {
    // Source commit has already passed. Never roll the user's HTML back via an
    // unverified candidate; retain an existing valid history or create a new
    // boundary at the bytes that are already committed.
    historyCandidate = await readSourceHistory(context, targetSha256);
  }
  if (source.sha256 !== targetSha256 && source.sha256 !== expectedSourceSha256) {
    if (!candidateBuffer) {
      failedRuntime(
        runtime,
        expectedSourceSha256,
        "RECOVERY_CANDIDATE_MISSING",
        "The autosave did not reach the source and its recovery candidate is missing.",
      );
      await adapters.writeRuntime(context.projectRoot, runtime);
      return { status: "rolled-back", reason: "candidate-missing" };
    }
    runtime.conflict = {
      conflictId: `conflict_recovery_${randomUUID()}`,
      type: "autosave-source",
      expectedSourceSha256,
      externalSourceSha256: source.sha256,
      candidateContentSha256: targetSha256,
      candidateRecoveryRelativePath: recoveryRelativePath,
      editRevision: revision,
      detectedAt: nowIso(),
    };
    runtime.lifecycleState = "awaiting-conflict-resolution";
    runtime.lastWriteError = {
      code: "SOURCE_HASH_CONFLICT",
      message: "External source changes require explicit conflict resolution.",
      at: nowIso(),
    };
    runtime.autosave = {
      status: "external-conflict",
      expectedSourceSha256,
      recoveryLogRelativePath: AUTOSAVE_RECOVERY_LOG,
      errorCode: "SOURCE_HASH_CONFLICT",
      errorMessage: runtime.lastWriteError.message,
    };
    await adapters.writeRuntime(context.projectRoot, runtime);
    return { status: "awaiting-conflict-resolution", conflict: runtime.conflict };
  }

  let written = source;
  if (source.sha256 === expectedSourceSha256 && source.sha256 !== targetSha256) {
    if (!candidateBuffer) {
      failedRuntime(
        runtime,
        expectedSourceSha256,
        "RECOVERY_CANDIDATE_MISSING",
        "The interrupted autosave was rolled back because its recovery candidate is missing.",
      );
      await adapters.writeRuntime(context.projectRoot, runtime);
      return { status: "rolled-back", reason: "candidate-missing" };
    }
    written = await atomicReplaceSource({
      sourcePath: context.sourcePath,
      expectedSourceSha256,
      content: candidateBuffer,
      adapters,
    });
  }
  if (historyCandidate) {
    await writeSourceHistory(context, historyCandidate);
  }
  await adapters.syncCurrentSourceIdentity(context, written);
  runtime.editRevision = Math.max(runtime.editRevision, revision);
  runtime.lastPersistedRevision = Math.max(runtime.lastPersistedRevision, revision);
  const project = await adapters.readProject(context);
  project.currentHtmlSha256 = written.sha256;
  project.currentExactVersionId = await adapters.exactVersionForHash(
    context,
    written.sha256,
  );
  project.lastModifiedAt = written.lastModifiedAt;
  await adapters.writeProject(context, project);
  runtime.autosave = autosaveUpdated(written.sha256);
  runtime.view = settledView(project, written.sha256);
  // The outbox remains durable until all audit records acknowledge.
  await adapters.writeRuntime(context.projectRoot, runtime);
  const auditEvents = Array.isArray(pending.auditEvents)
    ? pending.auditEvents
    : [sourceTransactionAuditEvent(context, project, revision, {
        eventId: `edit_${revision}`,
        kind: "document",
        before: { sha256: expectedSourceSha256 },
        after: { sha256: written.sha256 },
        summary: "自动写回当前 HTML",
      })];
  for (const event of auditEvents) {
    await adapters.appendAuditOnce(context, event);
  }
  runtime.pendingWrite = null;
  runtime.lifecycleState = "editing";
  runtime.lastWriteError = null;
  runtime.autosave = autosaveUpdated(written.sha256);
  await adapters.writeRuntime(context.projectRoot, runtime);
  if (recoveryPath) await rm(recoveryPath, { force: true });
  if (historyRecoveryPath) await rm(historyRecoveryPath, { force: true });
  return {
    status: "source-updated",
    recovered: true,
    editRevision: revision,
    sourceSha256: written.sha256,
  };
}
