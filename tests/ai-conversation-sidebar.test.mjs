import assert from "node:assert/strict";
import test from "node:test";

import {
  FORBIDDEN_MESSAGE_KEYS,
  sidebarActionBar,
  sidebarDraftNotice,
  sidebarIntentOptions,
  sidebarMessageStream,
  sidebarModePresentation,
  sidebarResolvedIntent,
  sidebarSendState,
} from "../app/workbench/ai-conversation-model.js";

function factMessage(overrides = {}) {
  return {
    messageId: "message_fact12345678",
    actor: "pageroot",
    kind: "result-summary",
    status: "completed",
    text: "候选版本 5 已准备好",
    sequence: 1,
    createdAt: "2026-08-21T00:00:00.000Z",
    ...overrides,
  };
}

test("the message stream projects immutable facts and never an action", () => {
  const stream = sidebarMessageStream([
    factMessage({ actor: "user", text: "把这块结构再简化一些" }),
    factMessage({ messageId: "message_reply1234567", actor: "qoder", sequence: 2 }),
  ]);

  assert.equal(stream.length, 2);
  assert.deepEqual(stream.map((message) => message.actorLabel), ["你", "Qoder CLI"]);
  for (const message of stream) {
    for (const key of FORBIDDEN_MESSAGE_KEYS) {
      assert.ok(
        !(key in message),
        `a projected message must not expose ${key}`,
      );
    }
  }
});

test("a message carrying an interface member is dropped, not rendered", () => {
  for (const key of FORBIDDEN_MESSAGE_KEYS) {
    const stream = sidebarMessageStream([
      factMessage({ [key]: ["adopt"] }),
      factMessage({ messageId: "message_clean12345678", sequence: 2 }),
    ]);
    assert.equal(stream.length, 1, `a message with ${key} must be dropped`);
    assert.equal(stream[0].messageId, "message_clean12345678");
  }
});

test("the action bar is derived from product state, never from a message", () => {
  // The same message stream produces a different bar in each state, which is
  // only possible because the bar never reads the stream.
  const messages = [factMessage()];
  assert.equal(sidebarMessageStream(messages).length, 1);

  assert.equal(sidebarActionBar({ state: "preview-discussion" }), null);
  assert.equal(sidebarActionBar({ state: "preparing-delivery" }), null);

  const pending = sidebarActionBar({
    state: "ready-to-open",
    candidateVersionLabel: "候选版本 5",
    candidateStatus: "ready",
  });
  assert.equal(pending.kind, "decision");
  assert.equal(pending.title, "候选版本 5 等待你的决定");
  assert.deepEqual(pending.actions.map((action) => action.id), ["review", "adopt"]);

  const running = sidebarActionBar({ state: "processing" });
  assert.equal(running.kind, "progress");
  assert.deepEqual(running.actions.map((action) => action.id), ["cancel"]);
});

test("no pending decision means the action bar occupies no space", () => {
  for (const state of ["preview-discussion", "preparing-delivery"]) {
    assert.equal(sidebarActionBar({ state }), null);
  }
});

test("an attention candidate offers review only", () => {
  const bar = sidebarActionBar({
    state: "review-view",
    candidateVersionLabel: "候选版本 7",
    candidateStatus: "attention",
  });
  assert.deepEqual(bar.actions.map((action) => action.id), ["review"]);
  assert.match(bar.detail, /变化较大/u);
});

test("a blocked candidate offers recovery instead of adoption", () => {
  const bar = sidebarActionBar({
    state: "ready-to-open",
    candidateStatus: "blocked",
    failureMessage: "本轮没有可用结果",
  });
  assert.equal(bar.kind, "blocked");
  assert.equal(bar.title, "本轮没有可用结果");
  assert.ok(!bar.actions.some((action) => action.id === "adopt"));
});

test("the intent switch is one control whose second option follows the state", () => {
  assert.deepEqual(
    sidebarIntentOptions("preview-discussion").map((option) => option.value),
    ["discuss", "modify"],
  );
  assert.deepEqual(
    sidebarIntentOptions("preview-discussion").map((option) => option.label),
    ["讨论", "交给 AI 修改"],
  );
  for (const state of ["ready-to-open", "review-view"]) {
    assert.deepEqual(
      sidebarIntentOptions(state).map((option) => option.value),
      ["discuss", "continue"],
      `${state} keeps the same control with a different second option`,
    );
    assert.deepEqual(
      sidebarIntentOptions(state).map((option) => option.label),
      ["讨论结果", "继续修改"],
    );
  }
});

test("an intent that the current state does not offer falls back to discussion", () => {
  // Continuing requires an adopted candidate, so it can never be reached from
  // the preview state by carrying a stale draft intent forward.
  assert.equal(sidebarResolvedIntent("preview-discussion", "continue"), "discuss");
  assert.equal(sidebarResolvedIntent("ready-to-open", "modify"), "discuss");
  assert.equal(sidebarResolvedIntent("preview-discussion", "modify"), "modify");
  assert.equal(sidebarResolvedIntent("review-view", "continue"), "continue");
});

test("a disabled send button always says why", () => {
  const blocked = [
    { catalogStatus: "checking" },
    { catalogStatus: "auth-required" },
    { catalogStatus: "not-installed" },
    { catalogStatus: "unavailable" },
    { state: "processing", hasText: true },
    { state: "promoting", hasText: true },
    { state: "preview-discussion", hasText: true, queued: true },
  ];
  for (const options of blocked) {
    const send = sidebarSendState({
      state: "preview-discussion",
      catalogStatus: "ready",
      ...options,
    });
    assert.equal(send.canSend, false, `${JSON.stringify(options)} must block sending`);
    const explained = send.reason || send.label !== "发送";
    assert.ok(
      explained,
      `${JSON.stringify(options)} must explain why sending is unavailable`,
    );
  }
});

test("an empty composer simply cannot send and needs no explanation", () => {
  const send = sidebarSendState({
    state: "preview-discussion",
    catalogStatus: "ready",
    hasText: false,
  });
  assert.equal(send.canSend, false);
  assert.equal(send.reason, null);
});

test("a ready catalog with text can send", () => {
  const send = sidebarSendState({
    state: "preview-discussion",
    catalogStatus: "ready",
    hasText: true,
  });
  assert.deepEqual(send, { canSend: true, label: "发送", reason: null });
});

test("a draft written while a round runs says it will not be sent", () => {
  for (const state of ["processing", "validating", "promoting"]) {
    assert.equal(sidebarDraftNotice(state), "仅保存草稿，不会发送给当前任务");
  }
  assert.equal(sidebarDraftNotice("preview-discussion"), null);
  assert.equal(sidebarDraftNotice("ready-to-open"), null);
});

test("mode copy separates who may write from who may only read", () => {
  assert.equal(sidebarModePresentation("preview-discussion").label, "讨论 · 只读");
  assert.equal(sidebarModePresentation("processing").label, "执行 · 写入候选");
  assert.equal(sidebarModePresentation("ready-to-open").label, "结果 · 等待决定");
  assert.equal(sidebarModePresentation("review-view").label, "审阅 · 只读");
  // An unknown state falls back to the most restrictive copy.
  assert.equal(sidebarModePresentation("unknown-state").label, "讨论 · 只读");
});
