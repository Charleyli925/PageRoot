import assert from "node:assert/strict";
import test from "node:test";

import {
  FORBIDDEN_MESSAGE_KEYS,
  conversationLoadedForView,
  conversationReadyForDocument,
  sidebarActionBar,
  sidebarActorInitial,
  sidebarDiscussionNotice,
  sidebarDeliveryDisclosure,
  sidebarDraftNotice,
  sidebarIntentOptions,
  sidebarLiveReply,
  sidebarMessageStream,
  sidebarModelLine,
  sidebarModePresentation,
  sidebarResolvedIntent,
  sidebarSendState,
  sidebarCopyTaskState,
  sidebarRunProgress,
  sidebarStateFromRun,
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

test("the intent switch is one control whose second option follows the state", () => {
  assert.deepEqual(
    sidebarIntentOptions("preview-discussion").map((option) => option.value),
    ["discuss", "modify"],
  );
  assert.deepEqual(
    sidebarIntentOptions("preview-discussion").map((option) => option.label),
    // The tab names the kind of round; the destination is named on the button below.
    ["讨论", "修改"],
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

test("the model line names a model only when one is actually known", () => {
  // Reading: say so.
  assert.deepEqual(sidebarModelLine({ catalogStatus: "checking" }), {
    kind: "checking", text: "正在读取模型…", choosable: false,
  });

  // Nothing read yet: stay silent rather than assert a fact about the account.
  assert.equal(sidebarModelLine({ catalogStatus: "ready" }), null);
  assert.equal(sidebarModelLine({ catalogStatus: "ready", modelDisplayName: "   " }), null);
  // The unavailable cases explain themselves on the send button.
  assert.equal(sidebarModelLine({ catalogStatus: "auth-required" }), null);
  assert.equal(sidebarModelLine({ catalogStatus: "not-installed" }), null);
  assert.equal(sidebarModelLine({ catalogStatus: "unavailable" }), null);

  // One known model is plain text: a dropdown onto a single item is forbidden.
  const single = sidebarModelLine({ modelDisplayName: "Qoder-Default", modelChoiceCount: 1 });
  assert.equal(single.text, "Qoder-Default");
  assert.equal(single.choosable, false);

  // A picker is only offered when there is a real choice.
  const many = sidebarModelLine({ modelDisplayName: "Qoder-Default", modelChoiceCount: 3 });
  assert.equal(many.choosable, true);
});

test("the live reply reuses the stored message shape and marks what is incomplete", () => {
  // Nothing to show until words arrive: an empty shell would make the stream
  // jump for no information.
  assert.equal(sidebarLiveReply(null), null);
  assert.equal(sidebarLiveReply({ status: "running", replyText: "" }), null);
  assert.equal(sidebarLiveReply({ status: "running", replyText: "   " }), null);

  const streaming = sidebarLiveReply({ status: "running", replyText: "标题可以更具体" });
  // The same fields a stored message carries, so the view needs one treatment.
  assert.equal(streaming.actor, "qoder");
  assert.equal(streaming.actorLabel, "Qoder CLI");
  assert.equal(streaming.text, "标题可以更具体");
  assert.equal(streaming.streaming, true);
  assert.equal(streaming.truncated, false);
  assert.equal(streaming.interrupted, false);

  const truncated = sidebarLiveReply({
    status: "completed",
    replyText: "很长的回复",
    replyTruncated: true,
  });
  assert.equal(truncated.truncated, true);
  assert.equal(truncated.streaming, false);

  // An interrupted reply is marked on the reply itself, because the text is what
  // the user reads.
  const interrupted = sidebarLiveReply({
    status: "interrupted",
    replyText: "说到一半",
    interrupted: true,
  });
  assert.equal(interrupted.interrupted, true);
  assert.equal(interrupted.streaming, false);
  assert.equal(interrupted.text, "说到一半");
});

test("the header's mode is derived from Request authority, not guessed", () => {
  // No run: read-only discussion.
  assert.equal(sidebarStateFromRun(), "preview-discussion");
  assert.equal(sidebarStateFromRun({ activeRun: { status: "editing" } }), "preview-discussion");
  assert.equal(sidebarStateFromRun({ activeRun: { status: "ready" } }), "preview-discussion");

  // A durable execution run must never be shown as read-only discussion.
  assert.equal(sidebarStateFromRun({ activeRun: { status: "processing" } }), "processing");
  assert.equal(sidebarStateFromRun({ activeRun: { status: "validating" } }), "validating");
  assert.equal(
    sidebarModePresentation(
      sidebarStateFromRun({ activeRun: { status: "processing" } }),
    ).label,
    "执行 · 写入候选",
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
  // to preview-discussion would hide the no-change decision copy in the bar.
  assert.equal(sidebarStateFromRun({ activeRun: { status: "no-change" } }), "no-change");
  assert.equal(
    sidebarModePresentation(
      sidebarStateFromRun({ activeRun: { status: "no-change" } }),
    ).label,
    "结果 · 无变化",
  );

  // Reviewing wins: the review surface is read-only whatever the run says.
  assert.equal(
    sidebarStateFromRun({ activeRun: { status: "processing" }, reviewing: true }),
    "review-view",
  );
});

test("a live discussion turn blocks a second send and says why", () => {
  const busy = sidebarSendState({
    state: "preview-discussion",
    catalogStatus: "ready",
    hasText: true,
    discussionBusy: true,
  });
  assert.equal(busy.canSend, false);
  // The streaming notice above the Composer carries that sentence already.
  assert.equal(busy.reason, null);

  // Once the turn settles the Composer is usable again.
  const settled = sidebarSendState({
    state: "preview-discussion",
    catalogStatus: "ready",
    hasText: true,
    discussionBusy: false,
  });
  assert.equal(settled.canSend, true);
});

test("the Composer sends discussion only and points modify at its real entry", () => {
  const discuss = sidebarSendState({
    state: "preview-discussion",
    catalogStatus: "ready",
    hasText: true,
    intent: "discuss",
  });
  assert.equal(discuss.canSend, true);

  // Modify is driven by the comments already on the page, not by the Composer,
  // so it sends without a typed sentence and nothing can be silently dropped.
  const modify = sidebarSendState({
    state: "preview-discussion",
    catalogStatus: "ready",
    hasText: false,
    intent: "modify",
    pendingCommentCount: 2,
  });
  assert.equal(modify.canSend, true);
  assert.equal(modify.label, "交给 Qoder 修改");
  assert.equal(modify.reason, null);

  // With nothing written there is nothing for the Agent to act on, and the
  // button says where to write it rather than only greying out.
  const empty = sidebarSendState({
    state: "preview-discussion",
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
  assert.equal(continued.reason, "先采用当前结果才能继续修改");
});

test("copying the task stays available when the model catalog is not", () => {
  // The send button needs Qoder; the clipboard beside it does not. A host
  // without the CLI is the common case, and PRD §10.2 keeps the copy path
  // open through every catalog status rather than greying out both buttons.
  for (const catalogStatus of ["checking", "auth-required", "not-installed", "unavailable"]) {
    const send = sidebarSendState({
      state: "preview-discussion",
      catalogStatus,
      intent: "modify",
      pendingCommentCount: 1,
    });
    assert.equal(send.canSend, false, `${catalogStatus} must still block the send button`);
    const copy = sidebarCopyTaskState({
      state: "preview-discussion",
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
  const empty = sidebarCopyTaskState({ state: "preview-discussion", pendingCommentCount: 0 });
  assert.equal(empty.canCopy, false);
  assert.equal(empty.reason, "先在编辑模式写下评论，AI 会按评论改");

  // A round already in flight owns the comments; a second delivery of the
  // same round must wait for it.
  const queued = sidebarCopyTaskState({ state: "preview-discussion", queued: true, pendingCommentCount: 2 });
  assert.equal(queued.canCopy, false);
  assert.equal(queued.reason, "正在等待上一个任务完成");
  for (const state of ["processing", "validating", "promoting"]) {
    const running = sidebarCopyTaskState({ state, pendingCommentCount: 2 });
    assert.equal(running.canCopy, false, `${state} must block copying`);
    assert.ok(running.reason, `${state} must say why copying is unavailable`);
  }

  // Review is read-only: the decision bar owns the next step there.
  const reviewing = sidebarCopyTaskState({ state: "review-view", pendingCommentCount: 2 });
  assert.equal(reviewing.canCopy, false);
  assert.ok(reviewing.reason);

  // Settled without a change keeps the comments, so the user may re-send.
  const settled = sidebarCopyTaskState({ state: "no-change", pendingCommentCount: 2 });
  assert.equal(settled.canCopy, true);
});

test("an interrupted discussion turn is never presented as a complete answer", () => {
  assert.equal(sidebarDiscussionNotice(null), null);
  assert.equal(sidebarDiscussionNotice({ status: "idle" }), null);
  assert.equal(sidebarDiscussionNotice({ status: "completed" }), null);

  assert.equal(
    sidebarDiscussionNotice({ status: "running" }).tone,
    "progress",
  );
  assert.equal(
    sidebarDiscussionNotice({ status: "cancelling" }).text,
    "正在结束这轮讨论…",
  );

  const timedOut = sidebarDiscussionNotice({
    status: "interrupted",
    interrupted: true,
    interruptedReason: "timeout",
  });
  assert.equal(timedOut.tone, "attention");
  assert.match(timedOut.text, /超时中断/u);
  assert.match(timedOut.text, /不是完整回复/u);

  const cancelled = sidebarDiscussionNotice({
    status: "cancelled",
    interrupted: true,
    interruptedReason: "cancelled",
  });
  assert.equal(cancelled.tone, "attention");
  assert.match(cancelled.text, /不是完整回复/u);

  const failed = sidebarDiscussionNotice({ status: "failed" });
  assert.equal(failed.tone, "attention");
  assert.match(failed.text, /没有完成/u);
});

test("the review Canvas keeps the thread on screen but refuses a new round", () => {
  // The candidate on screen is not the page a discussion would read, so the
  // Composer must not accept a question there. State is the single owner of that
  // fact, so a reviewing run and an explicit review state agree.
  assert.equal(sidebarStateFromRun({ reviewing: true }), "review-view");

  const send = sidebarSendState({
    state: "review-view",
    catalogStatus: "ready",
    hasText: true,
  });
  assert.equal(send.canSend, false);
  assert.equal(send.reason, "正在审阅 AI 候选，采纳或返回后可继续对话");

  // Being unable to type is not the same as being told nothing: the mode line
  // still explains what this surface is.
  const mode = sidebarModePresentation("review-view");
  assert.equal(mode.label, "审阅 · 只读");
  assert.equal(mode.detail, "讨论不会改变候选。");
});

test("review refuses a round even when the model catalog is still checking", () => {
  // Reviewing outranks every other disabled reason, so the user never sees the
  // Composer blame the model catalog for something the Canvas decided.
  const send = sidebarSendState({
    state: "review-view",
    catalogStatus: "checking",
    hasText: true,
  });
  assert.equal(send.reason, "正在审阅 AI 候选，采纳或返回后可继续对话");
});

test("the delivery disclosure moves out of the dialog and onto the modify intent", () => {
  // The sentence the old modal used to carry now sits beside the button that acts
  // on it, so the user is informed without being interrupted first.
  assert.equal(
    sidebarDeliveryDisclosure("modify"),
    "Qoder 会读取本轮 HTML、评论和附件；结果先进入审阅。",
  );

  // Discussion reads the page without writing it, so that sentence would be a
  // false statement of scope there.
  assert.equal(sidebarDeliveryDisclosure("discuss"), null);
  assert.equal(sidebarDeliveryDisclosure("continue"), null);
});

test("a queued round blocks the modify intent instead of stacking a second Request", () => {
  const send = sidebarSendState({
    state: "preview-discussion",
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
  assert.equal(sidebarRunProgress({ state: "preview-discussion", steps }), null);
  // No steps means nothing to say.
  assert.equal(sidebarRunProgress({ state: "processing", steps: [] }), null);
  // Malformed entries are dropped rather than rendered as blanks.
  assert.equal(sidebarRunProgress({ state: "processing", steps: [{ label: "无 key" }] }), null);
});

test("preparing a modification renames the mode instead of still claiming discussion", () => {
  // No run exists yet, so run status alone cannot tell these apart. The header has
  // to follow the intent, or it contradicts the Composer right below it.
  const pending = sidebarModePresentation("preview-discussion", "modify");
  assert.equal(pending.label, "修改 · 待发送");
  assert.equal(pending.detail, "按你写的评论改，结果先进入审阅。");

  // Discussion keeps its own honest label.
  assert.equal(sidebarModePresentation("preview-discussion", "discuss").label, "讨论 · 只读");

  // Once a round exists, its durable status wins again — the intent cannot dress
  // a running execution up as something pending.
  assert.equal(sidebarModePresentation("processing", "modify").label, "执行 · 写入候选");
  assert.equal(sidebarModePresentation("review-view", "modify").label, "审阅 · 只读");
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
  const managed = sidebarActionBar({ state: "processing", deliveryMode: "qoder-acp" });
  assert.equal(managed.title, null);
  assert.equal(managed.detail, null);
  assert.deepEqual(managed.actions.map((action) => action.id), ["cancel"]);

  // And the clipboard detail no longer repeats the header sentence either.
  assert.equal(clipboard.detail, "粘贴给任意能读写本机文件的 AI。");

  // The decision is the same for both destinations: a candidate is a candidate.
  for (const mode of ["clipboard", "qoder-acp"]) {
    const decision = sidebarActionBar({
      state: "ready-to-open",
      deliveryMode: mode,
      candidateVersionLabel: "版本 2",
    });
    assert.equal(decision.title, "版本 2 等待你的决定");
    assert.deepEqual(decision.actions.map((action) => action.id), ["review", "adopt"]);
  }
});

test("Qoder narrates the round while PageRoot states the stage", () => {
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

test("the Agent's chunks read as the paragraphs it wrote, not one wall of text", () => {
  const steps = [{ key: "agent", label: "等待 AI 完成", state: "current" }];
  const progress = sidebarRunProgress({
    state: "processing",
    steps,
    agentText: "先读清单和依赖文件。\n\n再写候选 HTML。\n\n\n最后调用 finalizer。",
  });

  // PageRoot concatenates the Agent's chunks, so the blank lines it wrote are the
  // only paragraph boundaries there are. Blank runs of any length collapse to one.
  assert.deepEqual(progress.narrationBlocks, [
    "先读清单和依赖文件。",
    "再写候选 HTML。",
    "最后调用 finalizer。",
  ]);

  // A single paragraph is still one block, so the view has one shape to render.
  assert.deepEqual(
    sidebarRunProgress({ state: "processing", steps, agentText: "只有一句。" }).narrationBlocks,
    ["只有一句。"],
  );
  assert.equal(sidebarRunProgress({ state: "processing", steps }).narrationBlocks, null);
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
