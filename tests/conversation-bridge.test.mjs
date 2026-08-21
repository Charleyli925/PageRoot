import assert from "node:assert/strict";
import test from "node:test";

import {
  createBridgeTestEnvironment,
} from "./helpers/bridge-test-environment.mjs";

const HTML = `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>对话测试</title></head>
<body><main><h1 id="title">标题</h1></main></body>
</html>
`;

async function startedProject(t, prefix, name = "conversation.html") {
  const environment = await createBridgeTestEnvironment(t, { prefix });
  const sourcePath = await environment.createSource(name, HTML);
  await environment.start();
  const ensured = await environment.ensureProject(sourcePath);
  assert.equal(ensured.response.status, 200);
  const activePath = ensured.body?.openTarget?.exactSourcePath
    || ensured.body?.sourcePath
    || sourcePath;
  return { environment, sourcePath: activePath };
}

function conversationQuery(sourcePath) {
  return `/conversation?sourcePath=${encodeURIComponent(sourcePath)}`;
}

test("GET /conversation establishes and then restores the document's conversation", async (t) => {
  const { environment, sourcePath } = await startedProject(
    t,
    "pageroot-bridge-conversation-",
  );

  const created = await environment.requestJson(conversationQuery(sourcePath));
  assert.equal(created.response.status, 200);
  assert.equal(created.body.ok, true);
  assert.match(created.body.conversation.conversationId, /^conversation_/u);
  assert.equal(created.body.conversation.messages.length, 0);
  assert.equal(created.body.atMessageLimit, false);
  assert.equal(created.body.draft.text, "");
  assert.equal(created.body.draft.intent, "discuss");

  // Opening the sidebar again restores the same conversation rather than
  // starting a second one.
  const restored = await environment.requestJson(conversationQuery(sourcePath));
  assert.equal(
    restored.body.conversation.conversationId,
    created.body.conversation.conversationId,
  );

  const listed = await environment.requestJson(
    `/conversation/list?sourcePath=${encodeURIComponent(sourcePath)}`,
  );
  assert.equal(listed.response.status, 200);
  assert.equal(
    listed.body.currentConversationId,
    created.body.conversation.conversationId,
  );
  assert.equal(listed.body.conversations.length, 1);
});

test("a draft round trips without touching the message history", async (t) => {
  const { environment, sourcePath } = await startedProject(
    t,
    "pageroot-bridge-conversation-draft-",
  );
  const opened = await environment.requestJson(conversationQuery(sourcePath));
  const { conversationId } = opened.body.conversation;

  const saved = await environment.postJson("/conversation/draft", {
    sourcePath,
    projectId: opened.body.projectId,
    documentId: opened.body.documentId,
    conversationId,
    text: "下一轮想法",
    intent: "modify",
  });
  assert.equal(saved.response.status, 200);
  assert.equal(saved.body.draft.text, "下一轮想法");
  assert.equal(saved.body.draft.intent, "modify");

  const reopened = await environment.requestJson(conversationQuery(sourcePath));
  assert.equal(reopened.body.draft.text, "下一轮想法");
  assert.equal(reopened.body.draft.intent, "modify");
  // A draft write must not advance the conversation record itself.
  assert.equal(
    reopened.body.conversation.revision,
    opened.body.conversation.revision,
  );
  assert.equal(reopened.body.conversation.messages.length, 0);
});

test("a draft for a conversation this document does not own is refused", async (t) => {
  const { environment, sourcePath } = await startedProject(
    t,
    "pageroot-bridge-conversation-foreign-",
  );
  const opened = await environment.requestJson(conversationQuery(sourcePath));

  const refused = await environment.postJson("/conversation/draft", {
    sourcePath,
    projectId: opened.body.projectId,
    documentId: opened.body.documentId,
    conversationId: "conversation_notmine12345",
    text: "不该被接受",
    intent: "discuss",
  });
  assert.equal(refused.response.status, 404);
  assert.equal(refused.body.error.code, "CONVERSATION_MISSING");
});

test("an unsafe conversation identity never reaches the filesystem", async (t) => {
  const { environment, sourcePath } = await startedProject(
    t,
    "pageroot-bridge-conversation-unsafe-",
  );
  const opened = await environment.requestJson(conversationQuery(sourcePath));

  for (const conversationId of [
    "../escape",
    "conversation_../escape",
    "conversation_short",
    "",
  ]) {
    const refused = await environment.postJson("/conversation/draft", {
      sourcePath,
      projectId: opened.body.projectId,
      documentId: opened.body.documentId,
      conversationId,
      text: "逃逸尝试",
      intent: "discuss",
    });
    assert.ok(
      refused.response.status >= 400,
      `identity ${JSON.stringify(conversationId)} must be refused`,
    );
    assert.notEqual(refused.body?.ok, true);
  }
});

test("a draft whose project identity does not match the source is refused", async (t) => {
  const { environment, sourcePath } = await startedProject(
    t,
    "pageroot-bridge-conversation-identity-",
  );
  const opened = await environment.requestJson(conversationQuery(sourcePath));

  const refused = await environment.postJson("/conversation/draft", {
    sourcePath,
    projectId: "project_someone_else",
    documentId: opened.body.documentId,
    conversationId: opened.body.conversation.conversationId,
    text: "身份不符",
    intent: "discuss",
  });
  assert.equal(refused.response.status, 409);
  assert.equal(refused.body.error.code, "PROJECT_CONTEXT_IDENTITY_MISMATCH");
});

test("two documents in one project keep separate conversations", async (t) => {
  const environment = await createBridgeTestEnvironment(t, {
    prefix: "pageroot-bridge-conversation-documents-",
  });
  const firstSource = await environment.createSource("first.html", HTML);
  const secondSource = await environment.createSource("second.html", HTML);
  await environment.start();

  const firstEnsured = await environment.ensureProject(firstSource);
  assert.equal(firstEnsured.response.status, 200);
  const firstPath = firstEnsured.body?.openTarget?.exactSourcePath || firstSource;
  const secondEnsured = await environment.ensureProject(secondSource);
  assert.equal(secondEnsured.response.status, 200);
  const secondPath = secondEnsured.body?.openTarget?.exactSourcePath || secondSource;

  const first = await environment.requestJson(conversationQuery(firstPath));
  const second = await environment.requestJson(conversationQuery(secondPath));

  assert.notEqual(
    first.body.conversation.conversationId,
    second.body.conversation.conversationId,
  );
  assert.notEqual(first.body.documentId, second.body.documentId);

  // Each document's list contains only its own conversation.
  const firstList = await environment.requestJson(
    `/conversation/list?sourcePath=${encodeURIComponent(firstPath)}`,
  );
  const secondList = await environment.requestJson(
    `/conversation/list?sourcePath=${encodeURIComponent(secondPath)}`,
  );
  assert.deepEqual(
    firstList.body.conversations.map((value) => value.conversationId),
    [first.body.conversation.conversationId],
  );
  assert.deepEqual(
    secondList.body.conversations.map((value) => value.conversationId),
    [second.body.conversation.conversationId],
  );
});
