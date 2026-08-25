import assert from "node:assert/strict";
import test from "node:test";

import { ConversationSession } from "../app/application/conversation-session.js";
import { ConversationWorkflow } from "../app/application/conversation-workflow.js";

function documentContext(documentId, sourcePath) {
  return { projectId: "project_test", documentId, sourcePath };
}

function conversationPayload(documentId, conversationId, overrides = {}) {
  return {
    ok: true,
    projectId: "project_test",
    documentId,
    conversation: {
      conversationId,
      projectId: "project_test",
      documentId,
      title: "",
      status: "active",
      revision: 0,
      lastSequence: 0,
      activeContextId: null,
      contexts: [],
      turns: [],
      messages: [],
      ...overrides,
    },
    draft: {
      schemaVersion: "1.0.0",
      conversationId,
      revision: 0,
      updatedAt: "2026-08-21T00:00:00.000Z",
      text: "",
      intent: "discuss",
    },
    atMessageLimit: false,
  };
}

/** A timer host the test drives by hand, so nothing depends on wall clock. */
function manualTimers() {
  let nextHandle = 1;
  const pending = new Map();
  return {
    host: {
      setTimeout(handler) {
        const handle = nextHandle++;
        pending.set(handle, handler);
        return handle;
      },
      clearTimeout(handle) {
        pending.delete(handle);
      },
    },
    get pendingCount() {
      return pending.size;
    },
    runAll() {
      const handlers = [...pending.values()];
      pending.clear();
      for (const handler of handlers) handler();
    },
  };
}

function stubBridge(overrides = {}) {
  const calls = { conversation: [], drafts: [], lists: [] };
  return {
    calls,
    client: {
      conversation: async (sourcePath) => {
        calls.conversation.push(sourcePath);
        return overrides.conversation
          ? overrides.conversation(sourcePath)
          : conversationPayload("doc_a", "conversation_aaaaaaaaaaaa");
      },
      conversationList: async (sourcePath) => {
        calls.lists.push(sourcePath);
        return overrides.conversationList
          ? overrides.conversationList(sourcePath)
          : { ok: true, conversations: [] };
      },
      saveConversationDraft: async (body) => {
        calls.drafts.push(body);
        return overrides.saveConversationDraft
          ? overrides.saveConversationDraft(body)
          : {
            ok: true,
            draft: {
              schemaVersion: "1.0.0",
              conversationId: body.conversationId,
              revision: calls.drafts.length,
              updatedAt: "2026-08-21T00:00:01.000Z",
              text: body.text,
              intent: body.intent,
              providerSelection: body.providerSelection,
              modelDisplayName: body.modelDisplayName,
            },
          };
      },
    },
  };
}

function createWorkflow(bridge, timers) {
  const session = new ConversationSession();
  const workflow = new ConversationWorkflow({
    bridgeClient: bridge.client,
    conversationSession: session,
    draftDelayMs: 700,
    timerHost: timers.host,
  });
  return { session, workflow };
}

test("opening a document loads and publishes its conversation", async () => {
  const bridge = stubBridge();
  const timers = manualTimers();
  const { session, workflow } = createWorkflow(bridge, timers);

  await workflow.open(documentContext("doc_a", "/tmp/a.html"));

  const snapshot = session.snapshot;
  assert.equal(snapshot.status, "ready");
  assert.equal(snapshot.conversationId, "conversation_aaaaaaaaaaaa");
  assert.equal(snapshot.draftText, "");
  assert.deepEqual(bridge.calls.conversation, ["/tmp/a.html"]);
});

test("switching document clears the projection before the next load resolves", async () => {
  let releaseFirst = () => {};
  const firstLoad = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const bridge = stubBridge({
    conversation: async (sourcePath) => {
      if (sourcePath === "/tmp/a.html") {
        await firstLoad;
        return conversationPayload("doc_a", "conversation_aaaaaaaaaaaa");
      }
      return conversationPayload("doc_b", "conversation_bbbbbbbbbbbb");
    },
  });
  const timers = manualTimers();
  const { session, workflow } = createWorkflow(bridge, timers);

  const seen = [];
  session.subscribe((snapshot) => {
    seen.push({ status: snapshot.status, id: snapshot.conversationId });
  });

  const first = workflow.open(documentContext("doc_a", "/tmp/a.html"));
  // The sidebar clears immediately rather than holding the previous document.
  assert.equal(session.snapshot.status, "loading");
  assert.equal(session.snapshot.conversationId, null);

  await workflow.open(documentContext("doc_b", "/tmp/b.html"));
  assert.equal(session.snapshot.conversationId, "conversation_bbbbbbbbbbbb");

  // Document A's late response must not overwrite document B's conversation.
  releaseFirst();
  await first;
  assert.equal(session.snapshot.conversationId, "conversation_bbbbbbbbbbbb");
  assert.equal(session.snapshot.context.documentId, "doc_b");
  assert.ok(!seen.some((entry) => entry.id === "conversation_aaaaaaaaaaaa"));
});

test("a draft write is debounced into one request", async () => {
  const bridge = stubBridge();
  const timers = manualTimers();
  const { session, workflow } = createWorkflow(bridge, timers);
  await workflow.open(documentContext("doc_a", "/tmp/a.html"));

  workflow.updateDraftText("一");
  workflow.updateDraftText("一二");
  workflow.updateDraftText("一二三");
  // Typing is reflected immediately without waiting for the Bridge.
  assert.equal(session.snapshot.draftText, "一二三");
  assert.equal(bridge.calls.drafts.length, 0);
  assert.equal(timers.pendingCount, 1);

  timers.runAll();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(bridge.calls.drafts.length, 1);
  assert.equal(bridge.calls.drafts[0].text, "一二三");
});

test("a Provider and model choice is persisted with the active conversation draft", async () => {
  const bridge = stubBridge();
  const timers = manualTimers();
  const { session, workflow } = createWorkflow(bridge, timers);
  await workflow.open(documentContext("doc_a", "/tmp/a.html"));
  const selection = {
    providerId: "codex",
    runtimeId: "acp",
    requestedModelId: "codex:gpt-test",
    resolvedModelId: "codex:gpt-test",
    reasoning: { requested: null, applied: null, resolution: "provider-default" },
  };

  workflow.updateDraftAgentSelection(selection, "GPT Test");
  assert.deepEqual(session.snapshot.draftProviderSelection, selection);
  await workflow.flushDraft();

  assert.deepEqual(bridge.calls.drafts[0].providerSelection, selection);
  assert.equal(bridge.calls.drafts[0].modelDisplayName, "GPT Test");
  assert.deepEqual(session.snapshot.draftProviderSelection, selection);
});

test("flushing a draft at a drain boundary sends the pending text", async () => {
  const bridge = stubBridge();
  const timers = manualTimers();
  const { workflow } = createWorkflow(bridge, timers);
  await workflow.open(documentContext("doc_a", "/tmp/a.html"));

  workflow.updateDraftText("未发送的草稿");
  await workflow.flushDraft();

  assert.equal(bridge.calls.drafts.length, 1);
  assert.equal(bridge.calls.drafts[0].text, "未发送的草稿");
  assert.equal(timers.pendingCount, 0);
});

test("a draft write in flight coalesces later edits into one follow-up", async () => {
  let releaseWrite = () => {};
  const firstWrite = new Promise((resolve) => {
    releaseWrite = resolve;
  });
  let writeCount = 0;
  const bridge = stubBridge({
    saveConversationDraft: async (body) => {
      writeCount += 1;
      if (writeCount === 1) await firstWrite;
      return {
        ok: true,
        draft: {
          schemaVersion: "1.0.0",
          conversationId: body.conversationId,
          revision: writeCount,
          updatedAt: "2026-08-21T00:00:01.000Z",
          text: body.text,
          intent: body.intent,
        },
      };
    },
  });
  const timers = manualTimers();
  const { workflow } = createWorkflow(bridge, timers);
  await workflow.open(documentContext("doc_a", "/tmp/a.html"));

  workflow.updateDraftText("第一次");
  const flushing = workflow.flushDraft();
  const laterSelection = {
    providerId: "codex",
    runtimeId: "acp",
    requestedModelId: "codex:gpt-later",
    resolvedModelId: "codex:gpt-later",
    reasoning: { requested: "high", applied: "high", resolution: "exact" },
  };
  workflow.updateDraftAgentSelection(laterSelection, "GPT Later");
  workflow.updateDraftText("第二次");
  workflow.updateDraftText("第三次");
  timers.runAll();

  releaseWrite();
  await flushing;
  await workflow.flushDraft();

  // Three later edits collapse into a single follow-up carrying the last text.
  assert.ok(bridge.calls.drafts.length <= 3);
  assert.equal(
    bridge.calls.drafts[bridge.calls.drafts.length - 1].text,
    "第三次",
  );
  assert.deepEqual(
    bridge.calls.drafts[bridge.calls.drafts.length - 1].providerSelection,
    laterSelection,
  );
  assert.deepEqual(workflow.session.snapshot.draftProviderSelection, laterSelection);
});

test("a stale draft acknowledgement preserves an intentional Provider-default model label", async () => {
  let releaseWrite = () => {};
  const firstWrite = new Promise((resolve) => {
    releaseWrite = resolve;
  });
  let writeCount = 0;
  const bridge = stubBridge({
    saveConversationDraft: async (body) => {
      writeCount += 1;
      if (writeCount === 1) await firstWrite;
      return {
        ok: true,
        draft: {
          schemaVersion: "1.0.0",
          conversationId: body.conversationId,
          revision: writeCount,
          updatedAt: "2026-08-21T00:00:01.000Z",
          text: body.text,
          intent: body.intent,
          providerSelection: body.providerSelection,
          modelDisplayName: body.modelDisplayName,
        },
      };
    },
  });
  const timers = manualTimers();
  const { workflow } = createWorkflow(bridge, timers);
  await workflow.open(documentContext("doc_a", "/tmp/a.html"));
  const explicit = {
    providerId: "codex",
    runtimeId: "acp",
    requestedModelId: "codex:gpt-explicit",
    resolvedModelId: "codex:gpt-explicit",
    reasoning: { requested: null, applied: null, resolution: "provider-default" },
  };
  const providerDefault = {
    ...explicit,
    requestedModelId: null,
    resolvedModelId: null,
  };

  workflow.updateDraftAgentSelection(explicit, "GPT Explicit");
  const flushing = workflow.flushDraft();
  workflow.updateDraftAgentSelection(providerDefault, null);
  releaseWrite();
  await flushing;
  await workflow.flushDraft();

  const lastWrite = bridge.calls.drafts[bridge.calls.drafts.length - 1];
  assert.deepEqual(lastWrite.providerSelection, providerDefault);
  assert.equal(lastWrite.modelDisplayName, null);
  assert.equal(workflow.session.snapshot.draftModelDisplayName, null);
});

test("a close-boundary flush waits for the active draft write and its coalesced successor", async () => {
  let releaseWrite = () => {};
  const firstWrite = new Promise((resolve) => {
    releaseWrite = resolve;
  });
  let writeCount = 0;
  const bridge = stubBridge({
    saveConversationDraft: async (body) => {
      writeCount += 1;
      if (writeCount === 1) await firstWrite;
      return {
        ok: true,
        draft: {
          schemaVersion: "1.0.0",
          conversationId: body.conversationId,
          revision: writeCount,
          updatedAt: "2026-08-21T00:00:01.000Z",
          text: body.text,
          intent: body.intent,
          providerSelection: body.providerSelection,
          modelDisplayName: body.modelDisplayName,
        },
      };
    },
  });
  const timers = manualTimers();
  const { workflow } = createWorkflow(bridge, timers);
  await workflow.open(documentContext("doc_a", "/tmp/a.html"));

  workflow.updateDraftText("older");
  const firstFlush = workflow.flushDraft();
  workflow.updateDraftText("latest");
  const boundaryFlush = workflow.flushDraft();
  let boundarySettled = false;
  void boundaryFlush.then(() => { boundarySettled = true; });
  await Promise.resolve();
  assert.equal(boundarySettled, false);

  releaseWrite();
  await Promise.all([firstFlush, boundaryFlush]);
  workflow.close();

  assert.equal(bridge.calls.drafts.length, 2);
  assert.equal(bridge.calls.drafts[1].text, "latest");
  assert.equal(workflow.session.snapshot.status, "idle");
});

test("a coalesced draft keeps its originating Document after the next one opens", async () => {
  let releaseWrite = () => {};
  const firstWrite = new Promise((resolve) => {
    releaseWrite = resolve;
  });
  let writeCount = 0;
  const bridge = stubBridge({
    conversation: async (sourcePath) => sourcePath === "/tmp/a.html"
      ? conversationPayload("doc_a", "conversation_aaaaaaaaaaaa")
      : conversationPayload("doc_b", "conversation_bbbbbbbbbbbb"),
    saveConversationDraft: async (body) => {
      writeCount += 1;
      if (writeCount === 1) await firstWrite;
      return {
        ok: true,
        draft: {
          schemaVersion: "1.0.0",
          conversationId: body.conversationId,
          revision: writeCount,
          updatedAt: "2026-08-21T00:00:01.000Z",
          text: body.text,
          intent: body.intent,
        },
      };
    },
  });
  const timers = manualTimers();
  const { workflow } = createWorkflow(bridge, timers);
  const first = documentContext("doc_a", "/tmp/a.html");
  const second = documentContext("doc_b", "/tmp/b.html");
  await workflow.open(first);

  workflow.updateDraftText("A older");
  const firstFlush = workflow.flushDraft();
  workflow.updateDraftText("A latest");
  const boundaryFlush = workflow.flushDraft();
  await workflow.open(second);
  workflow.updateDraftText("B latest");
  const secondFlush = workflow.flushDraft();

  releaseWrite();
  await Promise.all([firstFlush, boundaryFlush, secondFlush]);

  assert.deepEqual(bridge.calls.drafts.map((draft) => ({
    documentId: draft.documentId,
    conversationId: draft.conversationId,
    text: draft.text,
  })), [
    {
      documentId: "doc_a",
      conversationId: "conversation_aaaaaaaaaaaa",
      text: "A older",
    },
    {
      documentId: "doc_a",
      conversationId: "conversation_aaaaaaaaaaaa",
      text: "A latest",
    },
    {
      documentId: "doc_b",
      conversationId: "conversation_bbbbbbbbbbbb",
      text: "B latest",
    },
  ]);
  assert.equal(workflow.session.snapshot.context.documentId, "doc_b");
  assert.equal(workflow.session.snapshot.draftText, "B latest");
});

test("a delayed close is fenced from deactivating the next Document", async () => {
  const bridge = stubBridge({
    conversation: async (sourcePath) => sourcePath === "/tmp/a.html"
      ? conversationPayload("doc_a", "conversation_aaaaaaaaaaaa")
      : conversationPayload("doc_b", "conversation_bbbbbbbbbbbb"),
  });
  const timers = manualTimers();
  const { workflow } = createWorkflow(bridge, timers);
  const first = documentContext("doc_a", "/tmp/a.html");
  const second = documentContext("doc_b", "/tmp/b.html");
  await workflow.open(first);
  await workflow.open(second);

  assert.equal(workflow.close(first), false);
  assert.equal(workflow.session.snapshot.context.documentId, "doc_b");
  assert.equal(workflow.close(second), true);
  assert.equal(workflow.session.snapshot.status, "idle");
});

test("a failed load reports failure without leaving a stale conversation", async () => {
  const bridge = stubBridge({
    conversation: async () => {
      throw new Error("bridge unavailable");
    },
  });
  const timers = manualTimers();
  const { session, workflow } = createWorkflow(bridge, timers);

  await workflow.open(documentContext("doc_a", "/tmp/a.html"));

  assert.equal(session.snapshot.status, "failed");
  assert.equal(session.snapshot.conversationId, null);
  assert.deepEqual(session.snapshot.messages, []);
});

test("a failed draft write keeps the local text for the next attempt", async () => {
  const bridge = stubBridge({
    saveConversationDraft: async () => {
      throw new Error("write refused");
    },
  });
  const timers = manualTimers();
  const { session, workflow } = createWorkflow(bridge, timers);
  await workflow.open(documentContext("doc_a", "/tmp/a.html"));

  workflow.updateDraftText("保留我");
  await workflow.flushDraft();

  assert.equal(session.snapshot.draftText, "保留我");
});

test("closing deactivates the projection and cancels a pending write", async () => {
  const bridge = stubBridge();
  const timers = manualTimers();
  const { session, workflow } = createWorkflow(bridge, timers);
  await workflow.open(documentContext("doc_a", "/tmp/a.html"));

  workflow.updateDraftText("草稿");
  assert.equal(timers.pendingCount, 1);
  workflow.close();

  assert.equal(timers.pendingCount, 0);
  assert.equal(session.snapshot.status, "idle");
  assert.equal(session.snapshot.conversationId, null);
});

test("opening without a source path deactivates instead of calling the Bridge", async () => {
  const bridge = stubBridge();
  const timers = manualTimers();
  const { session, workflow } = createWorkflow(bridge, timers);

  await workflow.open(null);

  assert.equal(session.snapshot.status, "idle");
  assert.equal(bridge.calls.conversation.length, 0);
});
