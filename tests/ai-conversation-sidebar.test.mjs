import assert from "node:assert/strict";
import test from "node:test";

import {
  FORBIDDEN_MESSAGE_KEYS,
  sidebarAgentLine,
  sidebarAgentStageSteps,
  sidebarReasoningLine,
  conversationLoadedForView,
  conversationReadyForDocument,
  sidebarActionBar,
  sidebarFailureRetryable,
  sidebarActorInitial,
  sidebarMessageStream,
  sidebarModePresentation,
  sidebarResolvedIntent,
  sidebarSendState,
  sidebarCopyTaskState,
  sidebarRunProgress,
  sidebarStateFromRun,
  sidebarTimestampLabel,
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

  assert.equal(sidebarActionBar({ state: "preview-ready" }), null);
  assert.equal(sidebarActionBar({ state: "preparing-delivery" }), null);

  const pending = sidebarActionBar({
    state: "ready-to-open",
    candidateVersionLabel: "候选版本 5",
    candidateStatus: "ready",
  });
  assert.equal(pending.kind, "decision");
  assert.equal(pending.title, "候选版本 5 等待你的决定");
  assert.equal(pending.detail, "你可以先看变化，也可以直接采用。");
  assert.deepEqual(pending.actions.map((action) => action.id), ["review", "adopt"]);

  const running = sidebarActionBar({ state: "processing" });
  assert.equal(running.kind, "progress");
  assert.deepEqual(running.actions.map((action) => action.id), ["cancel"]);
});

test("no pending decision means the action bar occupies no space", () => {
  for (const state of ["preview-ready", "preparing-delivery"]) {
    assert.equal(sidebarActionBar({ state }), null);
  }
});

test("an attention candidate is not offered for blind adoption", () => {
  // Before the user has looked, a large change offers only the comparison:
  // adopting it unseen is not a choice PageRoot should present.
  const unseen = sidebarActionBar({
    state: "ready-to-open",
    candidateVersionLabel: "候选版本 7",
    candidateStatus: "attention",
  });
  assert.deepEqual(unseen.actions.map((action) => action.id), ["review"]);
  assert.match(unseen.detail, /变化较大/u);

  // While comparing, the user is looking at it, so adopting is legitimate — and
  // pointing at 「审阅对比」 would point at the screen they are already on.
  const comparing = sidebarActionBar({
    state: "review-view",
    candidateVersionLabel: "候选版本 7",
    candidateStatus: "attention",
  });
  assert.deepEqual(comparing.actions.map((action) => action.id), ["adopt"]);
  assert.match(comparing.detail, /变化较大/u);
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

test("an adoption failure stays on the existing decision bar", () => {
  const bar = sidebarActionBar({
    state: "ready-to-open",
    failureMessage: "最新版暂时无法打开。",
  });
  assert.equal(bar.kind, "decision");
  assert.match(bar.detail, /最新版暂时无法打开/u);
  assert.ok(bar.actions.some((action) => action.id === "adopt"));
});

test("the product state owns the single available modification intent", () => {
  assert.equal(sidebarResolvedIntent("preview-ready"), "modify");
  assert.equal(sidebarResolvedIntent("processing"), "modify");
  assert.equal(sidebarResolvedIntent("ready-to-open"), "continue");
  assert.equal(sidebarResolvedIntent("review-view"), "continue");
});

test("a reveal intent is only written directly where no load can follow it", () => {
  const readyFor = (projectId, documentId) => ({
    status: "ready",
    context: { projectId, documentId, sourcePath: "/tmp/page.html" },
  });
  // Loaded and ready for this very Document: no load ahead of it, so a direct
  // draft-intent write stands.
  assert.equal(conversationReadyForDocument(readyFor("p1", "d1"), "p1", "d1"), true);
  // First open (never loaded) and mid-load both precede a load that restores the
  // stored draft, so the intent must be re-asserted after the load instead.
  assert.equal(conversationReadyForDocument(null, "p1", "d1"), false);
  assert.equal(
    conversationReadyForDocument({
      status: "loading",
      context: { projectId: "p1", documentId: "d1", sourcePath: "/tmp/page.html" },
    }, "p1", "d1"),
    false,
  );
  // A Document switch deactivates the conversation while leaving the sidebar
  // open, and a failed load leaves it closed: both are headed for the load that
  // would quietly drop a plain write.
  assert.equal(
    conversationReadyForDocument({ status: "idle", context: null }, "p1", "d1"),
    false,
  );
  assert.equal(
    conversationReadyForDocument({ status: "failed", context: null }, "p1", "d1"),
    false,
  );
  // Loaded, but for a Document the user is no longer on — the reopen's load
  // would drop the write exactly the same way.
  assert.equal(conversationReadyForDocument(readyFor("p1", "d1"), "p2", "d2"), false);
  assert.equal(conversationReadyForDocument(readyFor("p1", "d1"), "p1", "d2"), false);
});

test("the empty state only appears once a load has settled", () => {
  const context = { projectId: "p1", documentId: "d1", sourcePath: "/tmp/page.html" };
  // Settled loads: one that published a conversation, and one that settled
  // without a conversation while the Document it loaded for is still attached.
  assert.equal(conversationLoadedForView({ status: "ready", context }), true);
  assert.equal(conversationLoadedForView({ status: "idle", context }), true);
  // Not settled: a load in flight; the contextless idle the session publishes
  // on subscribe and on deactivate — a fresh open renders its first frame
  // against it; a failed load; and a null snapshot before the controller has
  // published anything.
  assert.equal(conversationLoadedForView({ status: "loading", context }), false);
  assert.equal(conversationLoadedForView({ status: "idle", context: null }), false);
  assert.equal(conversationLoadedForView({ status: "failed", context }), false);
  assert.equal(conversationLoadedForView(null), false);
  // Fail-safe: a status this version does not know must never unlock the
  // empty state by default, because the session drops draft writes until it
  // has published a conversation.
  assert.equal(conversationLoadedForView({ status: "archived", context }), false);
});

test("a disabled send button always says why", () => {
  const blocked = [
    { catalogStatus: "checking" },
    { catalogStatus: "auth-required" },
    { catalogStatus: "not-installed" },
    { catalogStatus: "unavailable" },
    { state: "preparing-delivery", pendingCommentCount: 1 },
    { state: "processing", hasText: true },
    { state: "promoting", hasText: true },
    { state: "preview-ready", queued: true, pendingCommentCount: 1 },
  ];
  for (const options of blocked) {
    const send = sidebarSendState({
      state: "preview-ready",
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

test("Agent connection recovery is an explicit sidebar action, not a send", () => {
  const checking = sidebarSendState({
    state: "preview-ready",
    catalogStatus: "checking",
    hasText: true,
  });
  assert.deepEqual(checking, {
    kind: "open-agent-settings",
    canSend: false,
    label: "设置 Agent",
    reason: null,
  });

  const login = sidebarSendState({
    state: "preview-ready",
    catalogStatus: "auth-required",
    hasText: true,
  });
  assert.deepEqual(login, {
    kind: "open-agent-settings",
    canSend: false,
    label: "登录 Agent",
    reason: null,
  });

  const connect = sidebarSendState({
    state: "preview-ready",
    catalogStatus: "auth-required",
    credentialKind: "api-token",
    agentSettingsName: "源页 Agent",
  });
  assert.equal(connect.label, "连接 源页 Agent");

  const install = sidebarSendState({
    state: "preview-ready",
    catalogStatus: "not-installed",
    hasText: true,
  });
  assert.equal(install.kind, "open-agent-settings");
  assert.equal(install.label, "设置 Agent");

  const unavailable = sidebarSendState({
    state: "preview-ready",
    catalogStatus: "unavailable",
    hasText: true,
  });
  assert.equal(unavailable.kind, "open-agent-settings");
  assert.equal(unavailable.label, "设置 Agent");

  const capacity = sidebarSendState({
    state: "preview-ready",
    catalogStatus: "unavailable",
    catalogReason: "account-capacity",
    hasText: true,
  });
  assert.equal(capacity.kind, "open-agent-settings");
  assert.equal(capacity.label, "额度已用完");

  const timeout = sidebarSendState({
    state: "preview-ready",
    catalogStatus: "unavailable",
    catalogReason: "timeout",
    hasText: true,
  });
  assert.equal(timeout.kind, "open-agent-settings");
  assert.equal(timeout.label, "设置 Agent");

  const codexLogin = sidebarSendState({
    state: "preview-ready",
    catalogStatus: "auth-required",
    hasText: true,
    agentName: "Codex",
    agentSettingsName: "Codex",
    agentSettingsSupported: true,
  });
  assert.deepEqual(codexLogin, {
    kind: "open-agent-settings",
    canSend: false,
    label: "登录 Codex",
    reason: null,
  });

  const codexModify = sidebarSendState({
    state: "preview-ready",
    catalogStatus: "ready",
    intent: "modify",
    pendingCommentCount: 1,
    agentName: "Codex",
    agentSettingsName: "Codex",
    agentSettingsSupported: false,
  });
  assert.equal(codexModify.label, "交给 Codex 修改");
});

test("Candidate decisions and in-flight delivery win over Agent setup", () => {
  for (const catalogStatus of ["checking", "auth-required", "not-installed", "unavailable"]) {
    const decision = sidebarSendState({
      state: "ready-to-open",
      catalogStatus,
      intent: "continue",
      pendingCommentCount: 2,
    });
    assert.deepEqual(decision, {
      kind: "status",
      canSend: false,
      label: "",
      reason: null,
    });

    const preparing = sidebarSendState({
      state: "preparing-delivery",
      catalogStatus,
      intent: "modify",
      pendingCommentCount: 2,
    });
    assert.equal(preparing.kind, "send");
    assert.equal(preparing.canSend, false);
    assert.equal(preparing.reason, "正在冻结本轮评论和页面内容");
  }
});

test("mode copy stays short and names only the current user-facing state", () => {
  assert.equal(sidebarModePresentation("preview-ready").label, "待发送");
  assert.equal(sidebarModePresentation("processing").label, "处理中");
  assert.equal(sidebarModePresentation("ready-to-open").label, "待决定");
  assert.equal(sidebarModePresentation("review-view").label, "审阅中");
  assert.equal(sidebarModePresentation("unknown-state").label, "待发送");
});

test("the Composer names the current model and opens only for a real choice", () => {
  assert.deepEqual(sidebarAgentLine({ catalogStatus: "checking" }), {
    kind: "checking", text: "正在连接…", choosable: false,
  });
  assert.deepEqual(sidebarAgentLine({
    catalogStatus: "checking",
    modelDisplayName: "PageRoot-E2E",
    modelChoiceCount: 2,
  }), {
    kind: "checking", text: "PageRoot-E2E", choosable: true,
  });

  assert.equal(sidebarAgentLine({ catalogStatus: "ready" }), null);
  assert.equal(sidebarAgentLine({ catalogStatus: "ready", modelDisplayName: "   " }), null);
  assert.equal(sidebarAgentLine({ catalogStatus: "auth-required" }), null);
  assert.equal(sidebarAgentLine({ catalogStatus: "not-installed" }), null);
  assert.equal(sidebarAgentLine({ catalogStatus: "unavailable" }), null);

  const single = sidebarAgentLine({ modelDisplayName: "PageRoot-E2E", modelChoiceCount: 1 });
  assert.equal(single.text, "PageRoot-E2E");
  assert.equal(single.choosable, false);

  const many = sidebarAgentLine({ modelDisplayName: "gpt-5", modelChoiceCount: 3 });
  assert.equal(many.choosable, true);
});

test("the Composer names thinking depth only when the Agent actually offers it", () => {
  assert.equal(sidebarReasoningLine({}), null);
  assert.equal(sidebarReasoningLine({ choices: [] }), null);

  const defaults = sidebarReasoningLine({
    choices: [
      { id: "auto", label: "自动" },
      { id: "none", label: "关闭" },
      { id: "low", label: "低" },
      { id: "high", label: "高" },
      { id: "max", label: "最深" },
    ],
  });
  assert.equal(defaults.text, "思考 · 自动");
  assert.equal(defaults.selectedId, "auto");
  assert.equal(defaults.choosable, true);

  const explicit = sidebarReasoningLine({
    choices: [
      { id: "none", label: "关闭" },
      { id: "low", label: "低" },
      { id: "high", label: "高" },
    ],
    selectedId: "none",
  });
  assert.equal(explicit.text, "思考 · 关闭");
  assert.equal(explicit.selectedId, "none");
});

test("managed Agent progress exposes the four public execution stages", () => {
  const generating = sidebarAgentStageSteps({
    state: "processing",
    phase: "generating-modification",
  });
  assert.deepEqual(generating.map((step) => [step.label, step.state]), [
    ["正在发送任务", "completed"],
    ["正在生成修改", "current"],
    ["正在校验 HTML", "pending"],
    ["正在准备审阅", "pending"],
  ]);
  const ready = sidebarAgentStageSteps({ state: "ready-to-open", phase: "completed" });
  assert.equal(ready.every((step) => step.state === "completed"), true);
  const cancelling = sidebarAgentStageSteps({ state: "processing", phase: "cancelling" });
  assert.deepEqual(cancelling.map((step) => step.state), [
    "completed", "current", "pending", "pending",
  ]);
});

test("the header's mode is derived from Request authority, not guessed", () => {
  assert.equal(sidebarStateFromRun(), "preview-ready");
  assert.equal(sidebarStateFromRun({ activeRun: { status: "editing" } }), "preview-ready");
  assert.equal(sidebarStateFromRun({ activeRun: { status: "ready" } }), "preview-ready");

  // A durable execution run must stay bound to Request authority.
  assert.equal(sidebarStateFromRun({ activeRun: { status: "processing" } }), "processing");
  assert.equal(sidebarStateFromRun({ activeRun: { status: "validating" } }), "validating");
  assert.equal(
    sidebarModePresentation(
      sidebarStateFromRun({ activeRun: { status: "processing" } }),
    ).label,
    "处理中",
  );

  assert.equal(sidebarStateFromRun({ activeRun: { status: "submitting" } }), "preparing-delivery");
  assert.equal(sidebarStateFromRun({ submissionPending: true }), "preparing-delivery");
  assert.equal(sidebarStateFromRun({ activeRun: { status: "ready-to-open" } }), "ready-to-open");
  assert.equal(
    sidebarStateFromRun({ activeRun: { status: "awaiting-conflict-resolution" } }),
    "ready-to-open",
  );
  assert.equal(sidebarStateFromRun({ activeRun: { status: "committing" } }), "promoting");
  assert.equal(
    sidebarStateFromRun({ activeRun: { status: "recovering-transaction" } }),
    "promoting",
  );

  // A settled round with no effective change keeps its own state: falling back
  // to preview-ready would hide the no-change decision copy in the bar.
  assert.equal(sidebarStateFromRun({ activeRun: { status: "no-change" } }), "no-change");
  assert.equal(
    sidebarModePresentation(
      sidebarStateFromRun({ activeRun: { status: "no-change" } }),
    ).label,
    "无变化",
  );
  assert.equal(sidebarStateFromRun({ activeRun: { status: "error" } }), "run-error");

  // Reviewing wins: the review surface is read-only whatever the run says.
  assert.equal(
    sidebarStateFromRun({ activeRun: { status: "processing" }, reviewing: true }),
    "review-view",
  );
});

test("conflict and failed results keep their recovery decisions in the conversation", () => {
  const conflict = sidebarActionBar({
    state: "ready-to-open",
    runStatus: "awaiting-conflict-resolution",
  });
  assert.deepEqual(
    conflict.actions.map((action) => action.id),
    ["adopt-ai", "keep-external"],
  );

  const failure = sidebarActionBar({
    state: "run-error",
    runStatus: "error",
    failureMessage: "Candidate validation failed",
  });
  assert.equal(failure.title, "Candidate validation failed");
  assert.deepEqual(failure.actions.map((action) => action.id), [
    "resend-agent", "switch-agent", "copy-task", "return-editing",
  ]);

  const nonRetryable = sidebarActionBar({
    state: "run-error",
    runStatus: "error",
    failureCode: "AGENT_RESTART_RECOVERY_REQUIRED",
    failureRetryable: false,
  });
  assert.deepEqual(nonRetryable.actions.map((action) => action.id), [
    "switch-agent", "copy-task", "return-editing",
  ]);
});

test("a pending submission error without a handoff cannot offer a dead resend", () => {
  assert.equal(sidebarFailureRetryable({ requestId: "pending" }, null), false);
  assert.equal(
    sidebarFailureRetryable(
      { requestId: "request_001", attemptId: "attempt_001" },
      { requestId: "request_001", attemptId: "attempt_001", retryable: true },
    ),
    true,
  );
  assert.equal(
    sidebarFailureRetryable(
      { requestId: "request_001", attemptId: "attempt_001" },
      { requestId: "request_001", attemptId: "attempt_001", retryable: false },
    ),
    false,
  );
  assert.equal(
    sidebarFailureRetryable(
      { requestId: "pending", attemptId: "attempt_002" },
      { requestId: "request_old", attemptId: "attempt_001", retryable: true },
    ),
    false,
  );
  const actionBar = sidebarActionBar({
    state: "run-error",
    runStatus: "error",
    failureRetryable: sidebarFailureRetryable({ requestId: "pending" }, null),
  });
  assert.equal(actionBar.actions.some((action) => action.id === "resend-agent"), false);
});

test("the Composer sends only the page-comment modification", () => {
  // Modify is driven by the comments already on the page, not by the Composer,
  // so it sends without a typed sentence and nothing can be silently dropped.
  const modify = sidebarSendState({
    state: "preview-ready",
    catalogStatus: "ready",
    hasText: false,
    intent: "modify",
    pendingCommentCount: 2,
  });
  assert.equal(modify.canSend, true);
  assert.equal(modify.label, "交给 Agent 修改");
  assert.equal(modify.reason, null);

  // With nothing written there is nothing for the Agent to act on, and the
  // button says where to write it rather than only greying out.
  const empty = sidebarSendState({
    state: "preview-ready",
    catalogStatus: "ready",
    intent: "modify",
    pendingCommentCount: 0,
  });
  assert.equal(empty.canSend, false);
  assert.equal(empty.reason, "先在编辑模式写下评论，AI 会按评论改");

  const continued = sidebarSendState({
    state: "ready-to-open",
    catalogStatus: "ready",
    hasText: true,
    intent: "continue",
  });
  assert.equal(continued.canSend, false);
  assert.equal(continued.kind, "status");
  assert.equal(continued.label, "");
  assert.equal(continued.reason, null);
});

test("copying the task stays available when the model catalog is not", () => {
  // The send button needs Qoder; the clipboard beside it does not. A host
  // without the CLI is the common case, and PRD §10.2 keeps the copy path
  // open through every catalog status rather than greying out both buttons.
  for (const catalogStatus of ["checking", "auth-required", "not-installed", "unavailable"]) {
    const send = sidebarSendState({
      state: "preview-ready",
      catalogStatus,
      intent: "modify",
      pendingCommentCount: 1,
    });
    assert.equal(send.canSend, false, `${catalogStatus} must still block the send button`);
    const copy = sidebarCopyTaskState({
      state: "preview-ready",
      pendingCommentCount: 1,
    });
    assert.deepEqual(
      copy,
      { canCopy: true, reason: null },
      `${catalogStatus} must not take the clipboard path down with the catalog`,
    );
  }
});

test("copying still needs a quiet round with comments to freeze", () => {
  // With nothing written there is nothing to hand to any Agent.
  const empty = sidebarCopyTaskState({ state: "preview-ready", pendingCommentCount: 0 });
  assert.equal(empty.canCopy, false);
  assert.equal(empty.reason, "先在编辑模式写下评论，AI 会按评论改");

  // A round already in flight owns the comments; a second delivery of the
  // same round must wait for it.
  const queued = sidebarCopyTaskState({ state: "preview-ready", queued: true, pendingCommentCount: 2 });
  assert.equal(queued.canCopy, false);
  assert.equal(queued.reason, "正在等待上一个任务完成");
  for (const state of ["preparing-delivery", "processing", "validating", "promoting"]) {
    const running = sidebarCopyTaskState({ state, pendingCommentCount: 2 });
    assert.equal(running.canCopy, false, `${state} must block copying`);
    assert.ok(running.reason, `${state} must say why copying is unavailable`);
  }
  assert.deepEqual(
    sidebarCopyTaskState({ state: "ready-to-open", pendingCommentCount: 2 }),
    { canCopy: false, reason: null },
  );

  // Review is read-only: the decision bar owns the next step there.
  const reviewing = sidebarCopyTaskState({ state: "review-view", pendingCommentCount: 2 });
  assert.equal(reviewing.canCopy, false);
  assert.equal(reviewing.reason, null);

  // Settled without a change keeps the comments, so the user may re-send.
  const settled = sidebarCopyTaskState({ state: "no-change", pendingCommentCount: 2 });
  assert.equal(settled.canCopy, true);
});

test("the review Canvas keeps the thread on screen but refuses a new round", () => {
  // The candidate on screen is not a new modification source. State is the
  // single owner of that fact, so a reviewing run and an explicit review state agree.
  assert.equal(sidebarStateFromRun({ reviewing: true }), "review-view");

  const send = sidebarSendState({
    state: "review-view",
    catalogStatus: "ready",
    hasText: true,
  });
  assert.equal(send.canSend, false);
  assert.equal(send.reason, null);

  const mode = sidebarModePresentation("review-view");
  assert.equal(mode.label, "审阅中");
});

test("review refuses a round even when the model catalog is still checking", () => {
  // Reviewing outranks every other disabled reason, so the user never sees the
  // Composer blame the model catalog for something the Canvas decided.
  const send = sidebarSendState({
    state: "review-view",
    catalogStatus: "checking",
    hasText: true,
  });
  assert.equal(send.reason, null);
});

test("a queued round blocks the modify intent instead of stacking a second Request", () => {
  const send = sidebarSendState({
    state: "preview-ready",
    catalogStatus: "ready",
    intent: "modify",
    pendingCommentCount: 3,
    queued: true,
  });
  assert.equal(send.canSend, false);
  assert.equal(send.reason, "正在等待上一个任务完成");
});

test("a round in flight reads inside the thread instead of only in the drawer", () => {
  const steps = [
    { key: "handoff", label: "启动 Qoder CLI", detail: "已建立会话", state: "done" },
    { key: "agent", label: "AI 正在修改", detail: "正在写入候选", state: "current" },
    { key: "verify", label: "核对结果", detail: "尚未开始", state: "pending" },
  ];
  const progress = sidebarRunProgress({ state: "processing", steps });

  // The list already shows which step is live, so no headline repeats its label and
  // the detail rides on the stage it belongs to.
  assert.equal(progress.headline, null);
  assert.equal(progress.steps[1].detail, "正在写入候选");
  assert.equal(progress.tone, "quiet");
  assert.equal(progress.steps.length, 3);

  // Details ride along only for the live step; otherwise a short status turns
  // into a wall of text.
  assert.equal(progress.steps[0].detail, null);
  assert.equal(progress.steps[2].detail, null);
});

test("a failed step is what the progress entry leads with", () => {
  const progress = sidebarRunProgress({
    state: "processing",
    steps: [
      { key: "handoff", label: "启动 Qoder CLI", state: "done" },
      { key: "agent", label: "AI 正在修改", detail: "仍在进行", state: "current" },
      { key: "verify", label: "核对失败", state: "failed" },
    ],
  });
  assert.equal(progress.headline, "核对失败");
  assert.equal(progress.tone, "attention");
});

test("progress belongs to a moving round only", () => {
  const steps = [{ key: "handoff", label: "启动 Qoder CLI", state: "done" }];
  // The result states keep the record: with the process drawer gone, the thread is
  // the only place the round's stages exist while the user decides.
  assert.ok(sidebarRunProgress({ state: "ready-to-open", steps }));
  assert.ok(sidebarRunProgress({ state: "review-view", steps }));
  // A surface with no round at all still says nothing.
  assert.equal(sidebarRunProgress({ state: "preview-ready", steps }), null);
  // No steps means nothing to say.
  assert.equal(sidebarRunProgress({ state: "processing", steps: [] }), null);
  // Malformed entries are dropped rather than rendered as blanks.
  assert.equal(sidebarRunProgress({ state: "processing", steps: [{ label: "无 key" }] }), null);
});

test("the idle mode describes the only available modification action", () => {
  const pending = sidebarModePresentation("preview-ready");
  assert.equal(pending.label, "待发送");

  // Once a round exists, its durable status wins again — the intent cannot dress
  // a running execution up as something pending.
  assert.equal(sidebarModePresentation("processing").label, "处理中");
  assert.equal(sidebarModePresentation("review-view").label, "审阅中");
});

test("the clipboard round says what is actually happening and keeps the task reachable", () => {
  // Nothing is being processed by Qoder here: the user pasted the task into an
  // Agent of their own. Claiming otherwise would describe something that is not
  // happening, and re-copying is the one action a failed paste needs.
  const clipboard = sidebarActionBar({ state: "processing", deliveryMode: "clipboard" });
  assert.equal(clipboard.title, "任务已复制，等你的 AI 改完");
  assert.deepEqual(clipboard.actions.map((action) => action.id), ["recopy", "cancel"]);
  // Nothing here advances the round, so nothing takes the accent.
  assert.deepEqual(clipboard.actions.map((action) => action.tone), ["quiet", "quiet"]);

  // The clipboard instruction is not narration: the timeline cannot say "now go
  // paste it". The managed path has nothing of that kind to add, so it says nothing
  // and leaves the narration to the timeline above it.
  const managed = sidebarActionBar({ state: "processing", deliveryMode: "managed-agent" });
  assert.equal(managed.title, null);
  assert.equal(managed.detail, null);
  assert.deepEqual(managed.actions.map((action) => action.id), ["cancel"]);

  // And the clipboard detail no longer repeats the header sentence either.
  assert.equal(clipboard.detail, "粘贴给任意能读写本机文件的 AI。");

  const copyFailure = sidebarActionBar({
    state: "processing",
    deliveryMode: "clipboard",
    handoffStatus: "failed",
  });
  assert.equal(copyFailure.title, "任务还没复制成功");
  assert.equal(copyFailure.detail, "本轮要求已保留，可以重新复制。");
  assert.deepEqual(copyFailure.actions.map((action) => action.id), ["recopy", "cancel"]);

  // The decision is the same for both destinations: a candidate is a candidate.
  for (const mode of ["clipboard", "managed-agent"]) {
    const decision = sidebarActionBar({
      state: "ready-to-open",
      deliveryMode: mode,
      candidateVersionLabel: "版本 2",
    });
    assert.equal(decision.title, "版本 2 等待你的决定");
    assert.deepEqual(decision.actions.map((action) => action.id), ["review", "adopt"]);
  }
});

test("the selected Agent narrates the round while PageRoot states the stage", () => {
  const steps = [
    { key: "handoff", label: "Qoder CLI 已启动", state: "done" },
    { key: "agent", label: "等待 AI 完成", detail: "正在执行本轮要求", state: "current" },
  ];
  const progress = sidebarRunProgress({
    state: "processing",
    steps,
    agentText: "  正在把标题换成 2026 Q2 产品健康度回顾  ",
  });

  // ADR 0037 §4: the Agent's words are an annotation, and the stage still comes from
  // the run's own status — the prose cannot claim a stage is finished.
  assert.equal(progress.narration, "正在把标题换成 2026 Q2 产品健康度回顾");
  assert.equal(progress.liveLabel, "等待 AI 完成");
  assert.equal(progress.steps[1].state, "current");

  // Nothing said means no narration block, so the view never renders an empty shell
  // with a toggle that opens onto nothing.
  assert.equal(sidebarRunProgress({ state: "processing", steps }).narration, null);
  assert.equal(
    sidebarRunProgress({ state: "processing", steps, agentText: "   " }).narration,
    null,
  );
});

test("live Agent narration carries its bounded-text fact and local timestamp", () => {
  const progress = sidebarRunProgress({
    state: "processing",
    steps: [{ key: "agent", label: "Codex 正在修改", state: "current" }],
    agentText: "已读取冻结的任务。",
    agentTextTruncated: true,
  });
  assert.equal(progress.narrationTruncated, true);
  assert.equal(progress.liveLabel, "Codex 正在修改");
  const eventTimestamp = "2026-08-26T12:04:00.000Z";
  const now = Date.parse("2026-08-26T12:14:00.000Z");
  const localEvent = new Date(eventTimestamp);
  const expectedLocalTime = `${String(localEvent.getHours()).padStart(2, "0")}:${String(localEvent.getMinutes()).padStart(2, "0")}`;
  assert.equal(
    sidebarTimestampLabel(eventTimestamp, { now }),
    expectedLocalTime,
  );
  assert.equal(sidebarTimestampLabel("not-a-date"), null);
});

test("public Agent narration remains available with the completed Candidate decision", () => {
  const progress = sidebarRunProgress({
    state: "ready-to-open",
    steps: [
      { key: "agent", label: "Codex 已完成", state: "done" },
      { key: "result", label: "AI 修改已完成，可以审阅", state: "current" },
    ],
    agentText: "Candidate 已交给 PageRoot 校验。",
  });
  assert.equal(progress.narration, "Candidate 已交给 PageRoot 校验。");
  assert.equal(progress.liveLabel, null);
});

test("canonical Agent updates render as stable rows under one Agent identity", () => {
  const steps = [{ key: "agent", label: "等待 AI 完成", state: "current" }];
  const progress = sidebarRunProgress({
    state: "processing",
    steps,
    agentText: "先读清单和依赖文件。再写候选 HTML。",
    agentUpdates: [
      { id: "update-1", sequence: 1, text: "先读清单和依赖文件。" },
      { id: "update-2", sequence: 2, text: "再写候选 HTML。" },
    ],
  });

  assert.deepEqual(progress.narrationUpdates, [
    { id: "update-1", text: "先读清单和依赖文件。" },
    { id: "update-2", text: "再写候选 HTML。" },
  ]);

  assert.deepEqual(
    sidebarRunProgress({ state: "processing", steps, agentText: "只有一句。" }).narrationUpdates,
    [{ id: "legacy:0", text: "只有一句。" }],
  );
  assert.equal(sidebarRunProgress({ state: "processing", steps }).narrationUpdates, null);
});

test("every speaker has an avatar mark, so the thread reads as a chat", () => {
  // The thread had no avatars at all, which is why the run activity looked like a
  // panel parked in the sidebar instead of someone speaking in it.
  assert.equal(sidebarActorInitial("user"), "你");
  assert.equal(sidebarActorInitial("qoder"), "Q");
  assert.equal(sidebarActorInitial("pageroot"), "P");
  // An unknown actor still gets a mark rather than an empty square.
  assert.equal(sidebarActorInitial("someone-else"), "P");
});
