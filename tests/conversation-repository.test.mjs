import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  appendConversationContext,
  appendConversationFact,
  archiveConversation,
  conversationAtMessageLimit,
  conversationHasInFlightTurn,
  conversationTitleFromMessage,
  conversationsForDocument,
  createEmptyConversation,
  createEmptyConversationIndex,
  currentConversationIdForDocument,
  normalizeConversation,
  recordConversationInIndex,
  sealConversationTurn,
  startConversationTurn,
} from "../shared/conversation.mjs";
import {
  conversationListResponse,
  createConversation,
  ensureCurrentConversation,
  mutateConversation,
  newContextId,
  newMessageId,
  newTurnId,
  readConversation,
  readConversationDraft,
  readConversationIndex,
  rotateConversationAtLimit,
  writeConversationDraft,
} from "../scripts/conversation-repository.mjs";

const projectId = "project_conversation_test";
const documentId = "doc_conversation_test";
const sourceSha256 = `sha256:${"a".repeat(64)}`;
const otherSha256 = `sha256:${"b".repeat(64)}`;

let clock = 0;
const now = () => new Date(Date.UTC(2026, 7, 21, 0, 0, clock++)).toISOString();

function fixedNow() {
  return "2026-08-21T00:00:00.000Z";
}

async function projectContext(overrides = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "pageroot-conversation-"));
  return {
    projectRoot: path.join(root, ".pageroot"),
    projectId,
    documentId,
    ...overrides,
  };
}

function seededConversation() {
  const conversation = createEmptyConversation({
    conversationId: "conversation_seed12345678",
    projectId,
    documentId,
    now: fixedNow,
  });
  return appendConversationContext(
    conversation,
    { contextId: "context_seed123456789", sourceSha256, side: "working-copy" },
    { now: fixedNow },
  );
}

function userMessage(text, overrides = {}) {
  return {
    messageId: newMessageId(),
    actor: "user",
    kind: "text",
    status: "completed",
    text,
    ...overrides,
  };
}

test("a conversation belongs to exactly one document and refuses a cross-document read", () => {
  const conversation = seededConversation();
  assert.equal(conversation.documentId, documentId);
  assert.throws(
    () => normalizeConversation(conversation, { projectId, documentId: "doc_other" }),
    (error) => error.code === "CONVERSATION_IDENTITY_MISMATCH",
  );
  assert.throws(
    () => normalizeConversation(conversation, { projectId: "project_other", documentId }),
    (error) => error.code === "CONVERSATION_IDENTITY_MISMATCH",
  );
});

test("sealing a turn assigns a strictly increasing sequence from the record itself", () => {
  let conversation = seededConversation();
  const firstTurn = "turn_first1234567890";
  conversation = startConversationTurn(
    conversation,
    { turnId: firstTurn, contextId: "context_seed123456789", mode: "discussion" },
    { now: fixedNow },
  );
  conversation = sealConversationTurn(
    conversation,
    {
      turnId: firstTurn,
      status: "completed",
      messages: [userMessage("one"), userMessage("two", { actor: "qoder" })],
    },
    { now: fixedNow },
  );
  assert.deepEqual(conversation.messages.map((value) => value.sequence), [1, 2]);
  assert.equal(conversation.lastSequence, 2);

  const secondTurn = "turn_second123456789";
  conversation = startConversationTurn(
    conversation,
    { turnId: secondTurn, contextId: "context_seed123456789", mode: "discussion" },
    { now: fixedNow },
  );
  conversation = sealConversationTurn(
    conversation,
    { turnId: secondTurn, status: "completed", messages: [userMessage("three")] },
    { now: fixedNow },
  );
  assert.deepEqual(conversation.messages.map((value) => value.sequence), [1, 2, 3]);
  assert.equal(conversation.lastSequence, 3);
});

test("a stored message must be terminal, so a streaming fragment is never written", () => {
  let conversation = seededConversation();
  const turnId = "turn_stream123456789";
  conversation = startConversationTurn(
    conversation,
    { turnId, contextId: "context_seed123456789", mode: "discussion" },
    { now: fixedNow },
  );
  for (const status of ["draft", "queued", "streaming"]) {
    assert.throws(
      () => sealConversationTurn(
        conversation,
        {
          turnId,
          status: "completed",
          messages: [userMessage("half", { actor: "qoder", status })],
        },
        { now: fixedNow },
      ),
      (error) => error.code === "CONVERSATION_MESSAGE_NOT_TERMINAL",
      `status ${status} must be refused`,
    );
  }
});

test("a stored message refuses an interface or interaction member", () => {
  let conversation = seededConversation();
  const turnId = "turn_action123456789";
  conversation = startConversationTurn(
    conversation,
    { turnId, contextId: "context_seed123456789", mode: "discussion" },
    { now: fixedNow },
  );
  for (const key of ["actions", "buttons", "cardState", "disabled", "pending", "controls"]) {
    assert.throws(
      () => sealConversationTurn(
        conversation,
        {
          turnId,
          status: "completed",
          messages: [userMessage("decide", {
            actor: "pageroot",
            kind: "decision-outcome",
            [key]: ["adopt"],
          })],
        },
        { now: fixedNow },
      ),
      (error) => error.code === "CONVERSATION_MESSAGE_CARRIES_INTERACTION",
      `member ${key} must be refused`,
    );
  }
});

test("one conversation carries at most one in-flight turn", () => {
  let conversation = seededConversation();
  conversation = startConversationTurn(
    conversation,
    { turnId: "turn_alpha1234567890", contextId: "context_seed123456789", mode: "discussion" },
    { now: fixedNow },
  );
  assert.equal(conversationHasInFlightTurn(conversation), true);
  assert.throws(
    () => startConversationTurn(
      conversation,
      { turnId: "turn_beta12345678901", contextId: "context_seed123456789", mode: "discussion" },
      { now: fixedNow },
    ),
    (error) => error.code === "CONVERSATION_TURN_IN_FLIGHT",
  );
  const sealed = sealConversationTurn(
    conversation,
    { turnId: "turn_alpha1234567890", status: "interrupted", messages: [] },
    { now: fixedNow },
  );
  assert.equal(conversationHasInFlightTurn(sealed), false);
  assert.equal(sealed.turns[0].status, "interrupted");
  assert.equal(sealed.turns[0].interruptedAt, fixedNow());
});

test("a sealed turn cannot be sealed twice", () => {
  let conversation = seededConversation();
  const turnId = "turn_once12345678901";
  conversation = startConversationTurn(
    conversation,
    { turnId, contextId: "context_seed123456789", mode: "discussion" },
    { now: fixedNow },
  );
  conversation = sealConversationTurn(
    conversation,
    { turnId, status: "completed", messages: [] },
    { now: fixedNow },
  );
  assert.throws(
    () => sealConversationTurn(
      conversation,
      { turnId, status: "completed", messages: [] },
      { now: fixedNow },
    ),
    (error) => error.code === "CONVERSATION_TURN_ALREADY_SEALED",
  );
});

test("an unknown member survives read, edit and write unchanged", () => {
  const conversation = seededConversation();
  const withFutureMembers = {
    ...conversation,
    futureConversationMember: { note: "added by a newer build" },
    contexts: [{ ...conversation.contexts[0], futureContextMember: 7 }],
  };
  const normalized = normalizeConversation(withFutureMembers, {
    projectId,
    documentId,
  });
  assert.deepEqual(
    normalized.futureConversationMember,
    { note: "added by a newer build" },
  );
  assert.equal(normalized.contexts[0].futureContextMember, 7);

  const edited = appendConversationContext(
    normalized,
    { contextId: "context_next12345678", sourceSha256: otherSha256, side: "candidate" },
    { now: fixedNow },
  );
  assert.deepEqual(
    edited.futureConversationMember,
    { note: "added by a newer build" },
  );
  assert.equal(edited.contexts[0].futureContextMember, 7);
});

test("a context, turn or message must reference records inside its own conversation", () => {
  const conversation = seededConversation();
  assert.throws(
    () => startConversationTurn(
      conversation,
      { turnId: "turn_orphan123456789", contextId: "context_absent123456", mode: "discussion" },
      { now: fixedNow },
    ),
    (error) => error.code === "CONVERSATION_TURN_CONTEXT_MISSING",
  );
  assert.throws(
    () => normalizeConversation(
      {
        ...conversation,
        turns: [{
          turnId: "turn_dangling1234567",
          contextId: "context_absent123456",
          mode: "discussion",
          status: "completed",
          startedAt: fixedNow(),
        }],
      },
      { projectId, documentId },
    ),
    (error) => error.code === "CONVERSATION_TURN_CONTEXT_MISSING",
  );
});

test("an unbound turn does not invent provider reasoning", () => {
  let conversation = seededConversation();
  const turnId = "turn_effort123456789";
  conversation = startConversationTurn(
    conversation,
    { turnId, contextId: "context_seed123456789", mode: "discussion" },
    { now: fixedNow },
  );
  assert.equal(conversation.turns[0].providerSelection, null);
  assert.equal(conversation.turns[0].providerBinding, null);
});

test("a conversation title is a bounded safe summary of the first user message", () => {
  assert.equal(conversationTitleFromMessage("  调整   搜索大盘页面 "), "调整 搜索大盘页面");
  assert.equal(conversationTitleFromMessage(""), "");
  assert.equal(conversationTitleFromMessage("x".repeat(80)).length, 25);
  assert.ok(conversationTitleFromMessage("x".repeat(80)).endsWith("…"));
});

test("the index keeps each document's conversations separate", () => {
  let index = createEmptyConversationIndex({ projectId, now: fixedNow });
  const first = createEmptyConversation({
    conversationId: "conversation_docA12345678",
    projectId,
    documentId: "doc_a",
    now: fixedNow,
  });
  const second = createEmptyConversation({
    conversationId: "conversation_docB12345678",
    projectId,
    documentId: "doc_b",
    now: fixedNow,
  });
  index = recordConversationInIndex(index, first, { current: true, now: fixedNow });
  index = recordConversationInIndex(index, second, { current: true, now: fixedNow });

  assert.deepEqual(
    conversationsForDocument(index, "doc_a").map((value) => value.conversationId),
    ["conversation_docA12345678"],
  );
  assert.deepEqual(
    conversationsForDocument(index, "doc_b").map((value) => value.conversationId),
    ["conversation_docB12345678"],
  );
  assert.equal(currentConversationIdForDocument(index, "doc_a"), "conversation_docA12345678");
  assert.equal(currentConversationIdForDocument(index, "doc_b"), "conversation_docB12345678");
  assert.deepEqual(conversationsForDocument(index, "doc_absent"), []);
});

test("archiving keeps every record and links the replacement", () => {
  const conversation = seededConversation();
  const archived = archiveConversation(
    conversation,
    { reason: "message-limit", supersededByConversationId: "conversation_next12345678" },
    { now: fixedNow },
  );
  assert.equal(archived.status, "archived");
  assert.equal(archived.archivedReason, "message-limit");
  assert.equal(archived.supersededByConversationId, "conversation_next12345678");
  assert.equal(archived.contexts.length, conversation.contexts.length);
  assert.throws(
    () => appendConversationContext(
      archived,
      { contextId: "context_after12345678", sourceSha256: otherSha256, side: "working-copy" },
      { now: fixedNow },
    ),
    (error) => error.code === "CONVERSATION_ARCHIVED",
  );
});

test("a PageRoot fact seals immediately as its own terminal message", () => {
  const conversation = appendConversationFact(
    seededConversation(),
    {
      turnId: "turn_fact1234567890",
      messageId: "message_fact12345678",
      kind: "permission-boundary",
      text: "本轮已冻结",
    },
    { now: fixedNow },
  );
  assert.equal(conversation.messages.length, 1);
  assert.equal(conversation.messages[0].actor, "pageroot");
  assert.equal(conversation.messages[0].status, "completed");
  assert.equal(conversation.turns[0].status, "completed");
  assert.equal(conversationHasInFlightTurn(conversation), false);
});

test("the repository establishes, restores and isolates a document's conversation", async () => {
  const context = await projectContext();
  const created = await ensureCurrentConversation(context);
  const restored = await ensureCurrentConversation(context);
  assert.equal(restored.conversationId, created.conversationId);

  const otherDocument = { ...context, documentId: "doc_second" };
  const otherConversation = await ensureCurrentConversation(otherDocument);
  assert.notEqual(otherConversation.conversationId, created.conversationId);

  const index = await readConversationIndex(context);
  const first = conversationListResponse(index, context.documentId);
  const second = conversationListResponse(index, "doc_second");
  assert.deepEqual(
    first.conversations.map((value) => value.conversationId),
    [created.conversationId],
  );
  assert.deepEqual(
    second.conversations.map((value) => value.conversationId),
    [otherConversation.conversationId],
  );

  // Reading document A's conversation under document B fails closed.
  await assert.rejects(
    readConversation(otherDocument, created.conversationId),
    (error) => error.code === "CONVERSATION_IDENTITY_MISMATCH",
  );
});

test("the repository refuses a stale expected revision", async () => {
  const context = await projectContext();
  const conversation = await ensureCurrentConversation(context);
  const contextId = newContextId();
  const advanced = await mutateConversation(
    context,
    conversation.conversationId,
    (current) => appendConversationContext(
      current,
      { contextId, sourceSha256, side: "working-copy" },
      { now },
    ),
    { expectedRevision: conversation.revision },
  );
  assert.equal(advanced.revision, conversation.revision + 1);
  await assert.rejects(
    mutateConversation(
      context,
      conversation.conversationId,
      (current) => current,
      { expectedRevision: conversation.revision },
    ),
    (error) => error.code === "CONVERSATION_REVISION_CONFLICT",
  );
});

test("a persisted conversation restores after a reopen with its terminal messages", async () => {
  const context = await projectContext();
  const conversation = await ensureCurrentConversation(context);
  const contextId = newContextId();
  const turnId = newTurnId();
  await mutateConversation(context, conversation.conversationId, (current) => (
    appendConversationContext(
      current,
      { contextId, sourceSha256, side: "working-copy" },
      { now },
    )
  ));
  await mutateConversation(context, conversation.conversationId, (current) => (
    startConversationTurn(
      current,
      { turnId, contextId, mode: "discussion", modelId: "m1", modelDisplayName: "Model One" },
      { now },
    )
  ));
  await mutateConversation(context, conversation.conversationId, (current) => (
    sealConversationTurn(
      current,
      {
        turnId,
        status: "completed",
        messages: [userMessage("恢复我"), userMessage("好的", { actor: "qoder" })],
      },
      { now },
    )
  ));

  const reopened = await readConversation(context, conversation.conversationId);
  assert.equal(reopened.messages.length, 2);
  assert.deepEqual(reopened.messages.map((value) => value.text), ["恢复我", "好的"]);
  assert.ok(reopened.messages.every((value) => value.status === "completed"));
  assert.equal(reopened.messages[1].modelDisplayName, "Model One");
});

test("a draft is stored apart from the message history", async () => {
  const context = await projectContext();
  const conversation = await ensureCurrentConversation(context);
  const empty = await readConversationDraft(context, conversation.conversationId);
  assert.equal(empty.text, "");
  assert.equal(empty.intent, "modify");

  const saved = await writeConversationDraft(context, conversation.conversationId, {
    text: "下一轮想法",
    intent: "modify",
  });
  assert.equal(saved.text, "下一轮想法");
  assert.equal(saved.intent, "modify");
  assert.equal(saved.revision, 1);

  const unchanged = await readConversation(context, conversation.conversationId);
  assert.equal(unchanged.revision, conversation.revision);
  assert.equal(unchanged.messages.length, 0);
});

test("reaching the message limit archives and replaces without deleting a record", async () => {
  const context = await projectContext();
  const conversation = await ensureCurrentConversation(context);
  const contextId = newContextId();
  let current = await mutateConversation(
    context,
    conversation.conversationId,
    (value) => appendConversationContext(
      value,
      { contextId, sourceSha256, side: "working-copy" },
      { now },
    ),
  );

  while (current.messages.length < 500) {
    const turnId = newTurnId();
    const remaining = 500 - current.messages.length;
    const batch = Math.min(50, remaining);
    current = await mutateConversation(context, current.conversationId, (value) => (
      sealConversationTurn(
        startConversationTurn(
          value,
          { turnId, contextId, mode: "discussion" },
          { now },
        ),
        {
          turnId,
          status: "completed",
          messages: Array.from({ length: batch }, () => userMessage("filler")),
        },
        { now },
      )
    ));
  }

  assert.equal(conversationAtMessageLimit(current), true);
  const replacement = await rotateConversationAtLimit(context, current);
  assert.notEqual(replacement.conversationId, current.conversationId);
  assert.equal(replacement.messages.length, 0);
  assert.equal(replacement.supersedesConversationId, current.conversationId);

  const archived = await readConversation(context, current.conversationId);
  assert.equal(archived.status, "archived");
  assert.equal(archived.archivedReason, "message-limit");
  assert.equal(archived.messages.length, 500);
  assert.equal(archived.supersededByConversationId, replacement.conversationId);

  const index = await readConversationIndex(context);
  const listed = conversationListResponse(index, context.documentId);
  assert.equal(listed.currentConversationId, replacement.conversationId);
  assert.equal(listed.conversations.length, 2);
});

test("a conversation identity that is not a safe managed identity never reaches the filesystem", async () => {
  const context = await projectContext();
  for (const unsafe of ["../escape", "conversation_../escape", "", "conversation_short"]) {
    await assert.rejects(
      readConversation(context, unsafe),
      (error) => error.code === "INVALID_CONVERSATION",
      `identity ${JSON.stringify(unsafe)} must be refused`,
    );
  }
});

test("creating a second conversation for the same document keeps the older one", async () => {
  const context = await projectContext();
  const first = await ensureCurrentConversation(context);
  const second = await createConversation(context, { title: "第二条" });
  assert.notEqual(second.conversationId, first.conversationId);

  const index = await readConversationIndex(context);
  const listed = conversationListResponse(index, context.documentId);
  assert.equal(listed.currentConversationId, second.conversationId);
  assert.equal(listed.conversations.length, 2);
  assert.ok(await readConversation(context, first.conversationId));
});
