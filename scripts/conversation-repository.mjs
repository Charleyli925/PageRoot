import path from "node:path";
import { randomUUID } from "node:crypto";

import {
  appendConversationContext,
  appendConversationFact,
  archiveConversation,
  conversationAtMessageLimit,
  conversationSummary,
  conversationTitleFromMessage,
  conversationTurnById,
  conversationsForDocument,
  createEmptyConversation,
  createEmptyConversationDraft,
  createEmptyConversationIndex,
  currentConversationIdForDocument,
  normalizeConversation,
  normalizeConversationDraft,
  normalizeConversationIndex,
  recordConversationInIndex,
  sealConversationTurn,
  startConversationTurn,
  updateConversationDraft,
} from "../shared/conversation.mjs";
import {
  LifecycleError,
  atomicWriteJson,
  ensureDirectory,
  exists,
  nowIso,
  readJson,
} from "./lifecycle-core.mjs";

// The Bridge owns every conversation write. The renderer reads a projection and
// never touches these files, so `sequence` needs no coordination beyond this
// single writer.

const CONVERSATIONS_DIRECTORY = "conversations";
const CONVERSATION_INDEX_RELATIVE_PATH = "conversations/index.json";
const CONVERSATION_RECORD_FILE = "conversation.json";
const CONVERSATION_DRAFT_FILE = "draft.json";

const CONVERSATION_ID_PATTERN = /^conversation_[A-Za-z0-9_-]{12,180}$/;

const CONFLICT_CODES = new Set([
  "CONVERSATION_ACTIVE_CONTEXT_MISSING",
  "CONVERSATION_ARCHIVED",
  "CONVERSATION_CONTEXT_LIMIT",
  "CONVERSATION_CONTEXT_REUSED",
  "CONVERSATION_IDENTITY_MISMATCH",
  "CONVERSATION_INDEX_CURRENT_MISSING",
  "CONVERSATION_INDEX_DOCUMENT_LIMIT",
  "CONVERSATION_INDEX_DOCUMENT_REUSED",
  "CONVERSATION_MESSAGE_LIMIT",
  "CONVERSATION_REVISION_CONFLICT",
  "CONVERSATION_SEQUENCE_NOT_INCREASING",
  "CONVERSATION_TURN_ALREADY_SEALED",
  "CONVERSATION_TURN_IN_FLIGHT",
  "CONVERSATION_TURN_LIMIT",
  "CONVERSATION_TURN_MISSING",
  "CONVERSATION_TURN_REUSED",
]);

function serviceError(error) {
  if (error instanceof LifecycleError) return error;
  const code = String(error?.code || "INVALID_CONVERSATION");
  return new LifecycleError(
    code,
    error instanceof Error ? error.message : "The conversation record is invalid.",
    error?.details,
    CONFLICT_CODES.has(code) ? 409 : 422,
  );
}

function opaqueSuffix() {
  return randomUUID().replaceAll("-", "");
}

export function newConversationId() {
  return `conversation_${opaqueSuffix()}`;
}

export function newContextId() {
  return `context_${opaqueSuffix()}`;
}

export function newTurnId() {
  return `turn_${opaqueSuffix()}`;
}

export function newMessageId() {
  return `message_${opaqueSuffix()}`;
}

// A conversation identity is also a directory name. It is validated before it
// ever reaches the filesystem so a crafted identity cannot escape the managed
// conversations directory.
function assertConversationId(conversationId) {
  const identity = String(conversationId || "");
  if (!CONVERSATION_ID_PATTERN.test(identity)) {
    throw new LifecycleError(
      "INVALID_CONVERSATION",
      "The conversation identity is not a safe managed identity.",
      undefined,
      422,
    );
  }
  return identity;
}

export function conversationIndexPath(context) {
  return path.join(context.projectRoot, CONVERSATIONS_DIRECTORY, "index.json");
}

export function conversationDirectory(context, conversationId) {
  return path.join(
    context.projectRoot,
    CONVERSATIONS_DIRECTORY,
    assertConversationId(conversationId),
  );
}

export function conversationRecordPath(context, conversationId) {
  return path.join(
    conversationDirectory(context, conversationId),
    CONVERSATION_RECORD_FILE,
  );
}

export function conversationDraftPath(context, conversationId) {
  return path.join(
    conversationDirectory(context, conversationId),
    CONVERSATION_DRAFT_FILE,
  );
}

export async function readConversationIndex(context) {
  try {
    const filePath = conversationIndexPath(context);
    if (!await exists(filePath)) {
      return createEmptyConversationIndex({
        projectId: context.projectId,
        now: nowIso,
      });
    }
    return normalizeConversationIndex(
      await readJson(filePath, CONVERSATION_INDEX_RELATIVE_PATH),
      { projectId: context.projectId },
    );
  } catch (error) {
    throw serviceError(error);
  }
}

export async function writeConversationIndex(context, index) {
  try {
    const filePath = conversationIndexPath(context);
    await ensureDirectory(path.dirname(filePath));
    await atomicWriteJson(filePath, index);
    return index;
  } catch (error) {
    throw serviceError(error);
  }
}

export async function readConversation(context, conversationId) {
  try {
    const filePath = conversationRecordPath(context, conversationId);
    if (!await exists(filePath)) return null;
    return normalizeConversation(
      await readJson(filePath, CONVERSATION_RECORD_FILE),
      {
        projectId: context.projectId,
        documentId: context.documentId,
      },
    );
  } catch (error) {
    throw serviceError(error);
  }
}

export async function writeConversation(context, conversation) {
  try {
    const filePath = conversationRecordPath(
      context,
      conversation.conversationId,
    );
    await ensureDirectory(path.dirname(filePath));
    await atomicWriteJson(filePath, conversation);
    return conversation;
  } catch (error) {
    throw serviceError(error);
  }
}

// Every mutation goes through here: it re-reads the authoritative record, checks
// the caller's expected revision, applies one pure change and writes the record
// and its index projection together.
export async function mutateConversation(
  context,
  conversationId,
  mutate,
  { expectedRevision } = {},
) {
  try {
    const current = await readConversation(context, conversationId);
    if (!current) {
      throw new LifecycleError(
        "CONVERSATION_MISSING",
        "That conversation does not exist for this document.",
        undefined,
        404,
      );
    }
    if (
      expectedRevision !== undefined
      && expectedRevision !== null
      && Number(expectedRevision) !== current.revision
    ) {
      throw new LifecycleError(
        "CONVERSATION_REVISION_CONFLICT",
        "The conversation changed since it was read.",
        { revision: current.revision },
        409,
      );
    }
    const next = mutate(current);
    await writeConversation(context, next);
    const index = await readConversationIndex(context);
    await writeConversationIndex(
      context,
      recordConversationInIndex(index, next, {
        current: currentConversationIdForDocument(index, next.documentId)
          === next.conversationId,
        now: nowIso,
      }),
    );
    return next;
  } catch (error) {
    throw serviceError(error);
  }
}

// A discussion round is recorded in two steps, because sealing a Turn is the
// only path that writes a message.
//
// Step one seals the user's question in its own Turn. PRD §9 forbids sending to
// Qoder before that question is durable, and a question is a fact the moment the
// user sends it, so it does not wait for a reply. It also records the round's
// Context: the discussed bytes' Hash, which is the snapshot Hash (PRD §9.2).
// Step one then opens the Agent's Turn as running, so a crash leaves a visibly
// unfinished round rather than a silent gap.
export async function recordDiscussionQuestion(context, {
  conversationId,
  turnId,
  sourceSha256,
  question,
}) {
  const contextId = newContextId();
  const questionTurnId = newTurnId();
  const questionMessageId = newMessageId();
  return mutateConversation(context, conversationId, (current) => {
    const withContext = appendConversationContext(
      current,
      { contextId, sourceSha256, side: "working-copy" },
      { now: nowIso },
    );
    const questionStarted = startConversationTurn(
      withContext,
      { turnId: questionTurnId, contextId, mode: "discussion", status: "running" },
      { now: nowIso },
    );
    const questionSealed = sealConversationTurn(
      questionStarted,
      {
        turnId: questionTurnId,
        status: "completed",
        messages: [{
          messageId: questionMessageId,
          actor: "user",
          kind: "text",
          status: "completed",
          text: question,
          contextId,
        }],
      },
      { now: nowIso },
    );
    return startConversationTurn(
      questionSealed,
      { turnId, contextId, mode: "discussion", status: "running" },
      { now: nowIso },
    );
  });
}

// Step two seals the Agent's Turn with whatever it actually said (ADR 0036). An
// interrupted or failed round seals with that status, so a partial reply is
// stored as partial and never reads as a finished answer. A round with no text
// seals with no message rather than an empty one.
export async function sealDiscussionReply(context, {
  conversationId,
  turnId,
  status,
  replyText = "",
  replyTruncated = false,
}) {
  return mutateConversation(context, conversationId, (current) => {
    const turn = conversationTurnById(current, turnId);
    // A round that never opened, or a late duplicate for one already sealed, is
    // left exactly as it is instead of being sealed twice.
    if (!turn || (turn.status !== "queued" && turn.status !== "running")) return current;
    const text = String(replyText || "").trim();
    return sealConversationTurn(
      current,
      {
        turnId,
        status,
        messages: text
          ? [{
            messageId: newMessageId(),
            actor: "qoder",
            kind: "text",
            status,
            text,
            truncated: replyTruncated === true,
            contextId: turn.contextId,
          }]
          : [],
      },
      { now: nowIso },
    );
  });
}

export async function createConversation(
  context,
  { title = "", supersedesConversationId = null } = {},
) {
  try {
    const conversation = createEmptyConversation({
      conversationId: newConversationId(),
      projectId: context.projectId,
      documentId: context.documentId,
      title,
      now: nowIso,
      supersedesConversationId,
    });
    await writeConversation(context, conversation);
    const index = await readConversationIndex(context);
    await writeConversationIndex(
      context,
      recordConversationInIndex(index, conversation, {
        current: true,
        now: nowIso,
      }),
    );
    return conversation;
  } catch (error) {
    throw serviceError(error);
  }
}

// Opening the sidebar establishes or restores the current Conversation for the
// active Document. It never runs Qoder, contacts the network or creates a
// Request.
export async function ensureCurrentConversation(context) {
  try {
    const index = await readConversationIndex(context);
    const currentId = currentConversationIdForDocument(
      index,
      context.documentId,
    );
    if (currentId) {
      const existing = await readConversation(context, currentId);
      if (existing) return existing;
    }
    return await createConversation(context);
  } catch (error) {
    throw serviceError(error);
  }
}

// A conversation that reached its message limit is archived and replaced. No
// record is deleted: the new conversation points back at the archived one so
// the user can still read it.
export async function rotateConversationAtLimit(context, conversation) {
  try {
    if (!conversationAtMessageLimit(conversation)) return conversation;
    const replacement = createEmptyConversation({
      conversationId: newConversationId(),
      projectId: context.projectId,
      documentId: context.documentId,
      title: conversation.title,
      now: nowIso,
      supersedesConversationId: conversation.conversationId,
    });
    const archived = archiveConversation(
      conversation,
      {
        reason: "message-limit",
        supersededByConversationId: replacement.conversationId,
      },
      { now: nowIso },
    );
    await writeConversation(context, archived);
    await writeConversation(context, replacement);
    let index = await readConversationIndex(context);
    index = recordConversationInIndex(index, archived, {
      current: false,
      now: nowIso,
    });
    index = recordConversationInIndex(index, replacement, {
      current: true,
      now: nowIso,
    });
    await writeConversationIndex(context, index);
    return replacement;
  } catch (error) {
    throw serviceError(error);
  }
}

export async function readConversationDraft(context, conversationId) {
  try {
    const filePath = conversationDraftPath(context, conversationId);
    if (!await exists(filePath)) {
      return createEmptyConversationDraft({ conversationId, now: nowIso });
    }
    return normalizeConversationDraft(
      await readJson(filePath, CONVERSATION_DRAFT_FILE),
      { conversationId },
    );
  } catch (error) {
    throw serviceError(error);
  }
}

export async function writeConversationDraft(context, conversationId, changes) {
  try {
    const current = await readConversationDraft(context, conversationId);
    const next = updateConversationDraft(current, changes, { now: nowIso });
    const filePath = conversationDraftPath(context, conversationId);
    await ensureDirectory(path.dirname(filePath));
    await atomicWriteJson(filePath, next);
    return next;
  } catch (error) {
    throw serviceError(error);
  }
}

// The renderer receives this projection. It contains no filesystem path and no
// Agent transport identity.
export function conversationResponse(conversation, draft) {
  return {
    conversation,
    draft: draft ?? null,
    atMessageLimit: conversationAtMessageLimit(conversation),
  };
}

export function conversationListResponse(index, documentId) {
  return {
    documentId,
    currentConversationId: currentConversationIdForDocument(index, documentId),
    conversations: conversationsForDocument(index, documentId),
  };
}

export {
  CONVERSATIONS_DIRECTORY,
  CONVERSATION_INDEX_RELATIVE_PATH,
  appendConversationContext,
  appendConversationFact,
  archiveConversation,
  conversationSummary,
  conversationTitleFromMessage,
  sealConversationTurn,
  startConversationTurn,
};
