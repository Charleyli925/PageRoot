import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createConversation,
  ensureCurrentConversation,
  mutateConversation,
  newContextId,
  readConversation,
  readConversationDraft,
  readConversationIndex,
  writeConversationDraft,
  conversationIndexPath,
  conversationRecordPath,
} from "../scripts/conversation-repository.mjs";
import { appendConversationContext } from "../shared/conversation.mjs";

// These pins lock the forward-compatibility contract the platform now relies on:
// a mutable record preserves a member added by a newer build, and the write-back
// order is {...read, ...authoritative} — authoritative recomputed fields win, a
// stale member from disk can never overwrite them or pin the schema version.
// Adding a field must therefore need no schema bump and no migration.

const projectId = "project_forward_compat";
const documentId = "doc_forward_compat";
const sourceSha256 = `sha256:${"a".repeat(64)}`;

async function projectContext() {
  const root = await mkdtemp(path.join(tmpdir(), "pageroot-forward-compat-"));
  return { projectRoot: path.join(root, ".pageroot"), projectId, documentId };
}

async function injectMember(filePath, mutate) {
  const record = JSON.parse(await readFile(filePath, "utf8"));
  await writeFile(filePath, JSON.stringify(mutate(record)), "utf8");
}

test("a conversation preserves an unknown member across a disk read-edit-write round trip", async () => {
  const context = await projectContext();
  const conversation = await ensureCurrentConversation(context);

  // A newer build wrote members this build does not know, at the root and on a
  // nested context. It also left a stale revision on disk.
  const contextId = newContextId();
  const advanced = await mutateConversation(context, conversation.conversationId, (current) => (
    appendConversationContext(
      current,
      { contextId, sourceSha256, side: "working-copy" },
      { now: () => new Date().toISOString() },
    )
  ));

  const filePath = conversationRecordPath(context, conversation.conversationId);
  await injectMember(filePath, (record) => ({
    ...record,
    futureRootMember: { note: "from a newer build" },
    revision: 999,
    contexts: record.contexts.map((entry) => ({
      ...entry,
      futureContextMember: 7,
    })),
  }));

  // A subsequent edit by this build must keep both unknown members and must
  // recompute revision authoritatively rather than trusting the stale 999.
  const nextContextId = newContextId();
  const edited = await mutateConversation(context, conversation.conversationId, (current) => {
    assert.equal(current.futureRootMember.note, "from a newer build");
    assert.equal(current.contexts[0].futureContextMember, 7);
    return appendConversationContext(
      current,
      { contextId: nextContextId, sourceSha256, side: "candidate" },
      { now: () => new Date().toISOString() },
    );
  });

  assert.deepEqual(edited.futureRootMember, { note: "from a newer build" });
  assert.equal(edited.contexts[0].futureContextMember, 7);
  // Authoritative wins: revision is the stored-count + 1, never the stale 999.
  assert.equal(edited.revision, 1000);
  assert.equal(edited.schemaVersion, "2.0.0");

  const reread = await readConversation(context, conversation.conversationId);
  assert.deepEqual(reread.futureRootMember, { note: "from a newer build" });
  assert.equal(reread.contexts[0].futureContextMember, 7);
  assert.equal(advanced.contexts.length, 1);
});

test("an unknown member on a stored message survives a round trip", async () => {
  const context = await projectContext();
  const conversation = await ensureCurrentConversation(context);
  const filePath = conversationRecordPath(context, conversation.conversationId);

  // Inject a message-shaped record carrying an unknown member. It must survive
  // read normalization unchanged (an immutable append record still preserves
  // unknown members even though it is otherwise strictly validated).
  await injectMember(filePath, (record) => ({
    ...record,
    contexts: [{
      contextId: "context_seededforward1",
      projectId,
      documentId,
      sourceSha256,
      side: "working-copy",
      createdAt: "2026-08-21T00:00:00.000Z",
    }],
    turns: [{
      turnId: "turn_seededforward12",
      contextId: "context_seededforward1",
      mode: "discussion",
      status: "completed",
      startedAt: "2026-08-21T00:00:00.000Z",
    }],
    messages: [{
      messageId: "message_seededforward12",
      turnId: "turn_seededforward12",
      sequence: 1,
      actor: "qoder",
      kind: "text",
      status: "completed",
      text: "保留我",
      contextId: "context_seededforward1",
      createdAt: "2026-08-21T00:00:00.000Z",
      futureMessageMember: "carried",
    }],
    lastSequence: 1,
  }));

  const reread = await readConversation(context, conversation.conversationId);
  assert.equal(reread.messages.length, 1);
  assert.equal(reread.messages[0].futureMessageMember, "carried");
  assert.equal(reread.messages[0].text, "保留我");
});

test("the conversation index preserves unknown members and recomputes its own revision", async () => {
  const context = await projectContext();
  await ensureCurrentConversation(context);
  const indexPath = conversationIndexPath(context);

  await injectMember(indexPath, (record) => ({
    ...record,
    futureIndexMember: ["kept"],
    revision: 999,
    documents: record.documents.map((entry) => ({
      ...entry,
      futureDocumentMember: true,
      conversations: entry.conversations.map((summary) => ({
        ...summary,
        futureSummaryMember: 5,
      })),
    })),
  }));

  // A second conversation forces an index rewrite through the authoritative path.
  await createConversation(context, { title: "第二条" });

  const index = await readConversationIndex(context);
  assert.deepEqual(index.futureIndexMember, ["kept"]);
  const entry = index.documents.find((value) => value.documentId === documentId);
  assert.equal(entry.futureDocumentMember, true);
  assert.equal(entry.conversations[0].futureSummaryMember, 5);
  // Authoritative revision advanced past the stale 999 rather than reusing it.
  assert.ok(index.revision > 999);
});

test("the conversation draft preserves unknown members and recomputes its own revision", async () => {
  const context = await projectContext();
  const conversation = await ensureCurrentConversation(context);
  const draftPath = path.join(
    path.dirname(conversationRecordPath(context, conversation.conversationId)),
    "draft.json",
  );
  await writeConversationDraft(context, conversation.conversationId, {
    text: "初稿",
    intent: "discuss",
  });

  await injectMember(draftPath, (record) => ({
    ...record,
    futureDraftMember: { editor: "newer build" },
    revision: 999,
  }));

  const saved = await writeConversationDraft(context, conversation.conversationId, {
    text: "改稿",
    intent: "modify",
  });
  assert.deepEqual(saved.futureDraftMember, { editor: "newer build" });
  assert.equal(saved.text, "改稿");
  assert.equal(saved.intent, "modify");
  // Authoritative revision advanced past the stale 999.
  assert.ok(saved.revision > 999);

  const reread = await readConversationDraft(context, conversation.conversationId);
  assert.deepEqual(reread.futureDraftMember, { editor: "newer build" });
});
