// Preflight submission receipts are not Requests and grant no execution authority.
// ProjectFileRepository invokes these helpers under its existing serial writer.
import path from "node:path";
import { readFile } from "node:fs/promises";
import { ensureCurrentConversation, readConversation, mutateConversation } from "../conversation-repository.mjs";
import { appendConversationContext, startConversationTurn, appendConversationTurnMessage, sealConversationTurn } from "../../shared/conversation.mjs";
import { sha256 } from "../lifecycle-core.mjs";
import { normalizeAgentDelivery } from "../../shared/agent-delivery.mjs";
import { compileTaskSpec } from "../../shared/task-spec.mjs";
import { atomicWriteProjectJson, readJsonFile } from "./path-safety.mjs";
import { ProjectFileRepositoryError } from "./errors.mjs";

function receiptPath(loaded, operationId) {
  if (!/^submission_[a-f0-9]{32}$/u.test(String(operationId || ""))) {
    throw new ProjectFileRepositoryError("SUBMISSION_ID_INVALID", "Submission identity is invalid.");
  }
  return path.join(loaded.paths.projectRootPath, ".pageroot", "submissions", `${operationId}.json`);
}

export async function readSubmissionReceipt(loaded, operationId) {
  const value = await readJsonFile(receiptPath(loaded, operationId), "submission", { projectRootPath: loaded.paths.projectRootPath });
  if (value && (value.operationId !== operationId || value.projectId !== loaded.project.projectId
    || value.documentId !== loaded.project.documentId || value.workingCopyId !== loaded.workingCopy.workingCopyId)) {
    throw new ProjectFileRepositoryError("SUBMISSION_IDENTITY_MISMATCH", "Submission belongs to another document.");
  }
  if (value && (value.schemaVersion !== "1.0.0"
    || !["accepted", "not-started", "request-created"].includes(value.status)
    || value.snapshotSha256 !== sha256(JSON.stringify(value.snapshot))
    || value.requestId !== `req_${operationId.slice(11)}` || value.turnId !== `turn_${operationId.slice(11)}`)) {
    throw new ProjectFileRepositoryError("SUBMISSION_RECORD_INVALID", "Submission receipt failed integrity checks.");
  }
  return value;
}

export async function saveSubmissionReceipt(loaded, { operationId, input, projectRulesPath }, now) {
  const filePath = receiptPath(loaded, operationId);
  const comments = Array.isArray(input.comments) ? input.comments : [];
  const taskSpec = compileTaskSpec({ comments, targets: Array.isArray(input.targets) ? input.targets : [] });
  const snapshot = {
    sourceSha256: input.expectedSourceSha256,
    comments,
    changeEvents: Array.isArray(input.changeEvents) ? input.changeEvents : [],
    taskSpec,
    agentDelivery: normalizeAgentDelivery(input.agentDelivery, { allowLegacy: false }),
    projectRulesSha256: sha256(await readFile(projectRulesPath)),
  };
  if (snapshot.sourceSha256 !== loaded.source.sha256) {
    throw new ProjectFileRepositoryError("SOURCE_HASH_CONFLICT", "Source changed before submission was recorded.");
  }
  const snapshotSha256 = sha256(JSON.stringify(snapshot));
  const existing = await readSubmissionReceipt(loaded, operationId);
  if (existing) {
    if (existing.snapshotSha256 !== snapshotSha256) {
      throw new ProjectFileRepositoryError("SUBMISSION_COLLISION", "Submission identity cannot be reused with different requirements.");
    }
    await projectSubmissionReceipt(loaded, existing);
    return existing;
  }
  const suffix = operationId.slice("submission_".length);
  const receipt = {
    schemaVersion: "1.0.0", operationId,
    conversationId: (await ensureCurrentConversation({ projectRoot: path.join(loaded.paths.projectRootPath, ".pageroot"),
      projectId: loaded.project.projectId, documentId: loaded.project.documentId })).conversationId,
    projectId: loaded.project.projectId, documentId: loaded.project.documentId,
    workingCopyId: loaded.workingCopy.workingCopyId,
    turnId: `turn_${suffix}`, requestId: `req_${suffix}`, attemptId: "attempt_001",
    createdAt: now, status: "accepted", snapshotSha256, snapshot,
  };
  await atomicWriteProjectJson(loaded.paths.projectRootPath, filePath, receipt, "submission");
  await projectSubmissionReceipt(loaded, receipt);
  return receipt;
}

export async function finishSubmissionReceipt(loaded, { operationId, status, errorCode = null }, now) {
  const current = await readSubmissionReceipt(loaded, operationId);
  if (!current) throw new ProjectFileRepositoryError("SUBMISSION_MISSING", "Submission receipt is missing.");
  if (!["not-started", "request-created"].includes(status)) throw new ProjectFileRepositoryError("SUBMISSION_STATE_INVALID", "Invalid submission state.");
  if (current.status === "request-created" || current.status === status) {
    await projectSubmissionReceipt(loaded, current);
    return current;
  }
  if (current.status !== "accepted") throw new ProjectFileRepositoryError("SUBMISSION_ALREADY_ENDED", "Create a new submission to retry.");
  const receipt = { ...current, status, completedAt: now,
    errorCode: /^[A-Za-z0-9_-]{1,80}$/u.test(String(errorCode || "")) ? errorCode : null };
  await atomicWriteProjectJson(loaded.paths.projectRootPath, receiptPath(loaded, operationId), receipt, "submission");
  await projectSubmissionReceipt(loaded, receipt);
  return receipt;
}

// The receipt is the recovery record. If projection fails, replay this same
// record; never infer that the Agent should run again.
export async function projectSubmissionReceipt(loaded, receipt) {
  const context = { projectRoot: path.join(loaded.paths.projectRootPath, ".pageroot"),
    projectId: receipt.projectId, documentId: receipt.documentId };
  const conversation = await readConversation(context, receipt.conversationId);
  if (!conversation) throw new ProjectFileRepositoryError("SUBMISSION_CONVERSATION_MISSING", "Submission history requires recovery.");
  const suffix = receipt.operationId.slice(11);
  const contextId = `context_${suffix}`;
  const now = () => receipt.createdAt;
  await mutateConversation(context, conversation.conversationId, (current) => {
    let next = current;
    if (!next.contexts.some((entry) => entry.contextId === contextId)) {
      next = appendConversationContext(next, { contextId, sourceSha256: receipt.snapshot.sourceSha256,
        side: "working-copy", createdAt: receipt.createdAt }, { now });
    }
    if (!next.turns.some((entry) => entry.turnId === receipt.turnId)) {
      const selection = receipt.snapshot.agentDelivery.selection || null;
      next = startConversationTurn(next, { turnId: receipt.turnId, contextId, mode: "execution", status: "queued",
        providerSelection: selection, providerBinding: selection ? { providerId: selection.providerId, runtimeId: selection.runtimeId } : null,
        startedAt: receipt.createdAt, submissionOperationId: receipt.operationId,
      }, { now });
    }
    next = appendConversationTurnMessage(next, { turnId: receipt.turnId, message: {
      messageId: `message_${suffix}_submitted`, actor: "user", kind: "text", status: "completed",
      text: receipt.snapshot.comments.map((comment) => String(comment.text || comment.content || "")).join("\n\n")
        || receipt.snapshot.taskSpec.objective,
    } }, { now });
    const turn = next.turns.find((entry) => entry.turnId === receipt.turnId);
    if (receipt.status === "not-started" && ["queued", "running"].includes(turn.status)) {
      next = sealConversationTurn(next, { turnId: receipt.turnId, status: "failed", messages: [{
        messageId: `message_${suffix}_not_started`, actor: "pageroot", kind: "error", status: "completed",
        text: "本次未开始，修改要求已保留。请修复服务后重新尝试。", errorCode: receipt.errorCode,
      }] }, { now: () => receipt.completedAt });
    }
    return next;
  });
}
