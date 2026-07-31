import path from "node:path";

import {
  appendSourceHistoryOperations,
  applySourceHistoryAction,
  createEmptySourceHistory,
  normalizeSourceHistory,
  sourceHistoryCapabilities,
  validateSourceHistoryOperationBytes,
} from "../shared/source-history.mjs";
import {
  LifecycleError,
  atomicWriteJson,
  ensureDirectory,
  exists,
  nowIso,
  readJson,
  sha256,
} from "./lifecycle-core.mjs";

const SOURCE_HISTORY_RELATIVE_PATH = "history/source-operations.json";

function serviceError(error) {
  if (error instanceof LifecycleError) return error;
  const code = String(error?.code || "SOURCE_HISTORY_INVALID");
  const conflict = [
    "SOURCE_HISTORY_CHAIN_BROKEN",
    "SOURCE_HISTORY_ACTION_REUSED",
    "SOURCE_HISTORY_IDENTITY_MISMATCH",
    "SOURCE_HISTORY_OPERATION_CHAIN_MISMATCH",
    "SOURCE_HISTORY_OPERATION_REUSED",
    "SOURCE_HISTORY_REVISION_CONFLICT",
    "SOURCE_HISTORY_SOURCE_MISMATCH",
    "SOURCE_HISTORY_TARGET_MISMATCH",
  ].includes(code);
  return new LifecycleError(
    code,
    error instanceof Error ? error.message : "Source history is invalid.",
    error?.details,
    conflict ? 409 : 422,
  );
}

export function sourceHistoryPath(context) {
  return path.join(context.projectRoot, "history", "source-operations.json");
}

export async function readSourceHistory(
  context,
  sourceSha256,
  { resetOnSourceMismatch = true } = {},
) {
  try {
    const filePath = sourceHistoryPath(context);
    if (!await exists(filePath)) {
      return createEmptySourceHistory({
        projectId: context.projectId,
        documentId: context.documentId,
        sourceSha256,
        now: nowIso,
      });
    }
    return normalizeSourceHistory(
      await readJson(filePath, SOURCE_HISTORY_RELATIVE_PATH),
      {
        projectId: context.projectId,
        documentId: context.documentId,
        sourceSha256,
        now: nowIso,
        resetOnSourceMismatch,
      },
    );
  } catch (error) {
    throw serviceError(error);
  }
}

export async function writeSourceHistory(context, history) {
  try {
    await ensureDirectory(path.dirname(sourceHistoryPath(context)));
    await atomicWriteJson(sourceHistoryPath(context), history);
    return history;
  } catch (error) {
    throw serviceError(error);
  }
}

export function normalizeSourceHistoryCandidate(
  value,
  context,
  sourceSha256,
) {
  try {
    return normalizeSourceHistory(value, {
      projectId: context.projectId,
      documentId: context.documentId,
      sourceSha256,
      now: nowIso,
      resetOnSourceMismatch: false,
    });
  } catch (error) {
    throw serviceError(error);
  }
}

export function prepareAutosaveSourceHistory(
  currentHistory,
  operations,
  {
    context,
    sourceHtml,
    sourceSha256,
    targetHtml,
    targetSourceSha256,
  },
) {
  try {
    validateSourceHistoryOperationBytes(
      operations,
      sourceHtml,
      targetHtml,
      (value) => sha256(Buffer.from(value, "utf8")),
    );
    return appendSourceHistoryOperations(currentHistory, operations, {
      projectId: context.projectId,
      documentId: context.documentId,
      sourceSha256,
      targetSourceSha256,
      now: nowIso,
    });
  } catch (error) {
    throw serviceError(error);
  }
}

export function applySourceHistoryCommand(
  currentHistory,
  sourceHtml,
  body,
  context,
) {
  try {
    return applySourceHistoryAction(currentHistory, sourceHtml, {
      projectId: context.projectId,
      documentId: context.documentId,
      direction: body.direction,
      actionId: body.actionId,
      expectedRevision: body.expectedHistoryRevision,
      expectedCursor: body.expectedHistoryCursor,
      sha256: (value) => sha256(Buffer.from(value, "utf8")),
      now: nowIso,
    });
  } catch (error) {
    throw serviceError(error);
  }
}

export function sourceHistoryResponse(history) {
  return {
    ...history,
    capabilities: sourceHistoryCapabilities(history),
  };
}

export { SOURCE_HISTORY_RELATIVE_PATH };
