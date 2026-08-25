// Presentation rules for the AI conversation sidebar.
//
// Pure and DOM-free so the two load-bearing structure rules can be pinned by a
// Node test instead of only by review:
//
//   - The message stream carries immutable facts only. Nothing here can attach
//     an action to a message, and a stored message that somehow carries an
//     interface member is refused rather than rendered.
//   - The action bar is derived from current product state, never read from a
//     message. Scrolling back through history therefore cannot surface a stale
//     button, and a pending decision cannot scroll out of view.

/**
 * The product state the sidebar reflects. It mirrors the run lifecycle rather
 * than inventing a second one.
 */
const SIDEBAR_STATES = new Set([
  "preview-discussion",
  "preparing-delivery",
  "processing",
  "validating",
  "ready-to-open",
  "review-view",
  "promoting",
]);

const INTENT_DISCUSS = "discuss";
const INTENT_MODIFY = "modify";
const INTENT_CONTINUE = "continue";

// A message must never grow interface state. The repository refuses these on
// write; the view refuses them again on read so a record written by some other
// build can never turn the fact stream into a card surface.
const FORBIDDEN_MESSAGE_KEYS = [
  "actions",
  "buttons",
  "cardState",
  "disabled",
  "pending",
  "controls",
];

const ACTOR_LABELS = Object.freeze({
  user: "你",
  agent: "AI Agent",
  qoder: "Qoder CLI",
  pageroot: "PageRoot",
});

const MODE_PRESENTATION = Object.freeze({
  "preview-discussion": {
    label: "讨论 · 只读",
    detail: "Qoder 可以阅读当前预览，但不能修改 HTML。",
  },
  "preparing-delivery": {
    label: "讨论 · 只读",
    detail: "Qoder 可以阅读当前预览，但不能修改 HTML。",
  },
  processing: {
    label: "执行 · 写入候选",
    detail: "当前页面不会被直接覆盖。",
  },
  validating: {
    label: "执行 · 写入候选",
    detail: "当前页面不会被直接覆盖。",
  },
  "ready-to-open": {
    label: "结果 · 等待决定",
    detail: "当前仍是修改前页面。",
  },
  "review-view": {
    label: "审阅 · 只读",
    detail: "讨论不会改变候选。",
  },
  // Not a run status: this is the moment between choosing to modify and the round
  // existing. Nothing is written yet, and the copy says so.
  "pending-modification": {
    label: "修改 · 待发送",
    detail: "按你写的评论改，结果先进入审阅。",
  },
  promoting: {
    label: "结果 · 等待决定",
    detail: "当前仍是修改前页面。",
  },
  // A round that produced nothing new: the round is over, but it is still this
  // thread's fact to state, not a return to plain preview discussion.
  "no-change": {
    label: "结果 · 无变化",
    detail: "评论和当前页面都保持原样。",
  },
});

export function sidebarModePresentation(state, intent) {
  // Before a round exists, the header follows what the user is about to do. Saying
  // "讨论 · 只读" while the Composer directly below it is preparing a modification
  // contradicts itself, and the run status alone cannot tell them apart because no
  // run has been created yet. Once a round exists its durable status wins again.
  if (
    intent === INTENT_MODIFY
    && (state === "preview-discussion" || state === "preparing-delivery")
  ) {
    return MODE_PRESENTATION["pending-modification"];
  }
  return MODE_PRESENTATION[state] ?? MODE_PRESENTATION["preview-discussion"];
}

// The header's mode comes from the run's own durable status, never from a local
// guess. That is the whole point: the sidebar must not claim "discussion ·
// read-only" while an execution turn is writing a Candidate, and any second
// lifecycle kept in the view would eventually drift from the Request record.
const RUN_STATUS_TO_SIDEBAR_STATE = Object.freeze({
  submitting: "preparing-delivery",
  processing: "processing",
  validating: "validating",
  "ready-to-open": "ready-to-open",
  "awaiting-conflict-resolution": "ready-to-open",
  committing: "promoting",
  "recovering-transaction": "promoting",
  // A settled-without-change round still needs its decision said in the thread:
  // without this row the sidebar falls back to preview-discussion and the
  // no-change action bar below becomes unreachable dead copy.
  "no-change": "no-change",
});

export function sidebarStateFromRun({
  activeRun = null,
  submissionPending = false,
  reviewing = false,
} = {}) {
  if (reviewing) return "review-view";
  const mapped = RUN_STATUS_TO_SIDEBAR_STATE[String(activeRun?.status || "")];
  if (mapped) return mapped;
  // A submission being prepared is authority in flight, not yet a run.
  if (submissionPending) return "preparing-delivery";
  return "preview-discussion";
}

/**
 * The run's own progress, projected for the conversation. The process drawer used
 * to be the only place this existed, which made a round feel like it left the
 * workbench; here it reads as the turn currently in flight.
 *
 * Only the states where a round is actually moving return an entry. A settled
 * round is represented by its result, not by a frozen checklist.
 */
const MAX_NARRATION_BLOCKS = 40;

const RUN_PROGRESS_STATES = Object.freeze([
  "preparing-delivery",
  "processing",
  "validating",
  "promoting",
  // The result states keep the record on screen. The process drawer used to be the
  // only place the round's stages existed, so once it is gone the thread has to
  // hold them — a user deciding whether to adopt still wants to see what happened.
  "ready-to-open",
  "review-view",
]);

export function sidebarRunProgress({ state, steps = [], agentText = "" } = {}) {
  if (!RUN_PROGRESS_STATES.includes(String(state))) return null;
  if (!Array.isArray(steps) || steps.length === 0) return null;
  const projected = [];
  for (const step of steps) {
    if (!step || typeof step !== "object") continue;
    const key = typeof step.key === "string" ? step.key : "";
    const label = typeof step.label === "string" ? step.label.trim() : "";
    if (!key || !label) continue;
    projected.push(Object.freeze({
      key,
      label,
      // The detail only rides along for the step being worked on. Showing every
      // detail at once turns a short status into a wall of text.
      detail: step.state === "current" && typeof step.detail === "string"
        ? step.detail.trim() || null
        : null,
      state: typeof step.state === "string" ? step.state : "pending",
    }));
  }
  if (projected.length === 0) return null;
  const failedStep = projected.find((step) => step.state === "failed") || null;
  const liveStep = projected.find((step) => step.state === "current") || null;
  // ADR 0037: the Agent narrates, PageRoot states the stage. The prose is an
  // annotation on the stage actually running and never claims a stage is done.
  // The Agent speaks in chunks and PageRoot concatenates them, so the raw buffer is
  // one wall of text. Splitting on blank lines restores the paragraphs it actually
  // wrote; the count is capped so a chatty Agent cannot grow the DOM without limit.
  const narration = typeof agentText === "string" ? agentText.trim() : "";
  const narrationBlocks = narration
    ? Object.freeze(narration
      .split(/\n{2,}/u)
      .map((block) => block.trim())
      .filter(Boolean)
      .slice(0, MAX_NARRATION_BLOCKS))
    : null;
  return Object.freeze({
    steps: Object.freeze(projected),
    // Only a failure gets its own line. The list already shows which step is live at
    // full strength, and each stage carries its own detail, so nothing is repeated
    // above it.
    headline: failedStep?.label ?? null,
    // What Qoder is saying while it works. Collapsible by the view; absent when the
    // Agent has said nothing, so an empty shell never appears.
    narration: narration || null,
    narrationBlocks: narrationBlocks && narrationBlocks.length > 0 ? narrationBlocks : null,
    liveLabel: liveStep?.label ?? null,
    tone: failedStep ? "attention" : "quiet",
  });
}

const ACTOR_INITIALS = Object.freeze({
  user: "你",
  agent: "A",
  qoder: "Q",
  pageroot: "P",
});

/**
 * The mark shown in a message avatar. Short by design: a chat is scanned by who is
 * speaking, and a full name in that square would only shrink the words beside it.
 */
export function sidebarActorInitial(actor) {
  return ACTOR_INITIALS[actor] ?? ACTOR_INITIALS.pageroot;
}

export function sidebarActorLabel(actor) {
  return ACTOR_LABELS[actor] ?? ACTOR_LABELS.pageroot;
}

/**
 * Projects stored messages for display. A message that carries an interface
 * member is dropped: the fact stream is immutable by contract, and silently
 * rendering such a record would reintroduce the stale-button problem the
 * contract exists to prevent.
 */
export function sidebarMessageStream(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter((message) => (
      message
      && typeof message === "object"
      && !FORBIDDEN_MESSAGE_KEYS.some((key) => key in message)
    ))
    .map((message) => ({
      messageId: String(message.messageId || ""),
      actor: String(message.actor || "pageroot"),
      actorLabel: sidebarActorLabel(message.actor),
      kind: String(message.kind || "text"),
      status: String(message.status || "completed"),
      text: String(message.text || ""),
      truncated: message.truncated === true,
      sequence: Number(message.sequence) || 0,
      createdAt: String(message.createdAt || ""),
      modelDisplayName: message.modelDisplayName || null,
    }));
}

/**
 * The intent switch. It is one control in every state; only its second option
 * changes, so the user learns it once.
 */
export function sidebarIntentOptions(state) {
  if (state === "ready-to-open" || state === "review-view") {
    return [
      { value: INTENT_DISCUSS, label: "讨论结果" },
      { value: INTENT_CONTINUE, label: "继续修改" },
    ];
  }
  // The tab names the kind of round; the button below names the destination. Using
  // 「交给 AI 修改」 in both places put the same words in two controls and made the
  // pair read as a duplicate rather than a choice.
  return [
    { value: INTENT_DISCUSS, label: "讨论" },
    { value: INTENT_MODIFY, label: "修改" },
  ];
}

export function sidebarResolvedIntent(state, requestedIntent) {
  const allowed = new Set(
    sidebarIntentOptions(state).map((option) => option.value),
  );
  return allowed.has(requestedIntent) ? requestedIntent : INTENT_DISCUSS;
}

/**
 * Whether a draft-intent write can be made directly. A conversation that is
 * loaded and ready for this very Document has no load ahead of it that would
 * restore a stored draft over the write. Every other state does: a sidebar
 * opened for the first time loads on becoming visible, and a Document switch
 * closes the conversation while leaving the sidebar itself open, so the reopen
 * that follows is headed for a load that discards a plain write.
 */
export function conversationReadyForDocument(conversation, projectId, documentId) {
  return Boolean(
    conversation
    && conversation.status === "ready"
    && conversation.context?.projectId === projectId
    && conversation.context?.documentId === documentId,
  );
}

/**
 * Whether the conversation stream has settled, so the sidebar may show its
 * loaded content — including the empty state. Loaded is an explicit allowlist:
 * a load that settled with a conversation ("ready"), or one that settled
 * without a conversation while the Document context it loaded for is still
 * attached ("idle" with a context). Everything else reads as not loaded: a
 * null snapshot, a load in flight, the contextless idle the session publishes
 * on subscribe and on deactivate, a failed load, or a status a future version
 * adds. Fail-safe on purpose — the session drops draft writes until it has
 * published a conversation, so the empty-state copy must never invite typing
 * before the load settles: that text is silently lost to the load that
 * follows.
 */
export function conversationLoadedForView(conversation) {
  if (!conversation) return false;
  if (conversation.status === "ready") return true;
  return conversation.status === "idle" && conversation.context != null;
}

/**
 * The action bar. Derived entirely from current product state — never from a
 * message — so a decision stays visible at any scroll position and history
 * never renders a live button.
 *
 * Returns null when there is nothing to decide; the bar then occupies no space.
 */
export function sidebarActionBar({
  state,
  candidateVersionLabel = null,
  candidateStatus = null,
  failureMessage = null,
  deliveryMode = "managed-agent",
} = {}) {
  if (state === "ready-to-open" || state === "review-view") {
    if (candidateStatus === "blocked") {
      return {
        kind: "blocked",
        title: failureMessage || "本轮没有可采用的结果",
        detail: "当前仍是修改前页面。",
        actions: [{ id: "dismiss", label: "结束本轮", tone: "quiet" }],
      };
    }
    const title = candidateVersionLabel
      ? `${candidateVersionLabel} 等待你的决定`
      : "结果等待你的决定";
    // An `attention` candidate offers review only: adopting a large change
    // without looking at it is not a choice PageRoot should offer.
    // Already comparing: offering 「审阅对比」 here would point at the screen the user
    // is looking at. The only decision left is whether to take it, and returning is
    // owned by the review header beside it.
    if (state === "review-view") {
      return {
        kind: "decision",
        title,
        detail: candidateStatus === "attention"
          ? "这次变化较大，核对后再决定。"
          : "看完就可以决定。",
        actions: [{ id: "adopt", label: "采纳这一版", tone: "primary" }],
      };
    }
    if (candidateStatus === "attention") {
      return {
        kind: "decision",
        title,
        detail: "这次变化较大，先看看再决定。",
        actions: [{ id: "review", label: "审阅对比", tone: "primary" }],
      };
    }
    return {
      kind: "decision",
      title,
      detail: "你可以先看变化，也可以直接采用。",
      actions: [
        { id: "review", label: "审阅对比", tone: "primary" },
        { id: "adopt", label: "直接采用", tone: "quiet" },
      ],
    };
  }
  if (state === "processing" || state === "validating") {
    // The clipboard round is not being processed by Qoder at all: the user pasted
    // the task into an Agent of their own and PageRoot is waiting for the file to
    // come back. Saying "Qoder 正在处理" there would describe something that is not
    // happening, and the user would lose the one action they actually need — the
    // task back on the clipboard if the paste went wrong.
    if (deliveryMode === "clipboard") {
      return {
        kind: "progress",
        title: "任务已复制，等你的 AI 改完",
        detail: "粘贴给任意能读写本机文件的 AI。",
        // Nothing here advances the round — PageRoot is waiting on an Agent it does
        // not drive — so neither action takes the accent. Re-copying is a remedy,
        // not the next step.
        actions: [
          { id: "recopy", label: "再次复制", tone: "quiet" },
          { id: "cancel", label: "结束本轮", tone: "quiet" },
        ],
      };
    }
    // The timeline above already narrates the round, and the header already says the
    // page is not being overwritten. Repeating either here would make the user read
    // the same fact twice, so this carries the action alone.
    return {
      kind: "progress",
      title: null,
      detail: null,
      actions: [{ id: "cancel", label: "结束本轮", tone: "quiet" }],
    };
  }
  /*
   * A round can finish without changing anything, which is not a stage the timeline can
   * express. It used to be stated only in the process panel, and that panel is out of
   * the flow, so the conversation says it.
   */
  if (state === "no-change") {
    return {
      kind: "decision",
      title: "这次没有产生有效变化",
      detail: "原评论和附件都已保留，调整要求后可以重新发送。",
      actions: [{ id: "dismiss", label: "结束本轮", tone: "quiet" }],
    };
  }
  if (state === "promoting") {
    return {
      kind: "progress",
      title: "正在采用候选版本",
      detail: "采用完成后会切换到新页面。",
      actions: [],
    };
  }
  return null;
}

/**
 * Whether the Composer can send, and the reason when it cannot. A disabled send
 * button must always say why: greying it out without an explanation leaves the
 * user with no next step.
 */
/**
 * The disclosure that used to live in the delivery dialog. It belongs beside the
 * button that acts on it, so the user reads it without being interrupted by a
 * modal first.
 */
export function sidebarDeliveryDisclosure(intent) {
  if (intent !== INTENT_MODIFY) return null;
  return "Qoder 会读取本轮 HTML、评论和附件；结果先进入审阅。";
}

export function sidebarSendState({
  state,
  catalogStatus = "ready",
  hasText = false,
  queued = false,
  intent = INTENT_DISCUSS,
  discussionBusy = false,
  pendingCommentCount = 0,
} = {}) {
  // The review Canvas wins over every other reason. It is showing a candidate,
  // not the page a discussion would read, so no round may start from here. The
  // thread stays on screen so the user keeps the context that produced the
  // candidate; it is simply not a place to type right now. State is the single
  // owner of this fact — sidebarStateFromRun already maps reviewing to it.
  if (state === "review-view") {
    return {
      kind: "status",
      canSend: false,
      label: "发送",
      reason: "正在审阅 AI 候选，采纳或返回后可继续对话",
    };
  }
  if (catalogStatus === "checking") {
    return {
      kind: "status",
      canSend: false,
      label: "正在连接 Agent…",
      reason: null,
    };
  }
  if (catalogStatus === "auth-required") {
    return {
      kind: "open-agent-settings",
      canSend: false,
      label: "登录 Qoder CLI",
      reason: null,
    };
  }
  if (catalogStatus === "not-installed") {
    return {
      kind: "open-agent-settings",
      canSend: false,
      label: "设置 Qoder CLI",
      reason: null,
    };
  }
  if (catalogStatus === "unavailable") {
    return {
      kind: "status",
      canSend: false,
      label: "Agent 暂不可用",
      reason: "Qoder 暂时无法确认",
    };
  }
  // One discussion turn per Document. The notice line directly above the Composer
  // already says Qoder is replying, so the button stays quiet rather than
  // printing a second sentence that means the same thing.
  if (discussionBusy) {
    return { kind: "send", canSend: false, label: "发送", reason: null };
  }
  if (state === "processing" || state === "validating") {
    return {
      kind: "send",
      canSend: false,
      label: "发送",
      reason: "Qoder 完成本轮后可发送",
    };
  }
  if (state === "promoting") {
    return {
      kind: "send",
      canSend: false,
      label: "发送",
      reason: "正在采用候选版本",
    };
  }
  // Modifying is a Request, and a Request is frozen from the edit surface's
  // comments rather than from this text box. Pointing there beats a send button
  // that would quietly drop what the user typed.
  if (intent === INTENT_MODIFY) {
    // A modification is driven by the comments already written on the page, not by
    // the Composer. That is why this intent shows no text box: there is no typed
    // sentence that could be silently dropped on the way to the Agent.
    if (queued) {
      return {
        kind: "send",
        canSend: false,
        label: "交给 Qoder 修改",
        reason: "正在等待上一个任务完成",
      };
    }
    if (pendingCommentCount <= 0) {
      return {
        kind: "send",
        canSend: false,
        label: "交给 Qoder 修改",
        reason: "先在编辑模式写下评论，AI 会按评论改",
      };
    }
    return { kind: "send", canSend: true, label: "交给 Qoder 修改", reason: null };
  }
  if (intent === INTENT_CONTINUE) {
    return {
      kind: "send",
      canSend: false,
      label: "发送",
      reason: "先采用当前结果才能继续修改",
    };
  }
  if (queued) {
    return {
      kind: "send",
      canSend: false,
      label: "发送",
      reason: "正在等待上一个任务完成",
    };
  }
  if (!hasText) {
    return { kind: "send", canSend: false, label: "发送", reason: null };
  }
  return { kind: "send", canSend: true, label: "发送", reason: null };
}

/**
 * Whether the clipboard delivery beside the send button can run, and the reason
 * when it cannot.
 *
 * Copying is the other branch of the same modification round (PRD §11.4): it
 * freezes the page's comments into a Request and writes the clipboard, and
 * neither step consults Qoder. The send button guards on the model catalog
 * because the Agent path needs it; applying that guard here would take the
 * clipboard down with an unreadable catalog — PRD §10.2 keeps 复制任务 available
 * through every catalog status, and the old delivery dialog's copy option never
 * required the CLI either. What copying does need is the round itself: no round
 * in flight, and comments to freeze.
 */
export function sidebarCopyTaskState({
  state = "preview-discussion",
  queued = false,
  pendingCommentCount = 0,
} = {}) {
  if (state === "review-view") {
    return {
      canCopy: false,
      reason: "正在审阅 AI 候选，采纳或返回后可继续对话",
    };
  }
  if (state === "processing" || state === "validating") {
    return { canCopy: false, reason: "Qoder 完成本轮后可发送" };
  }
  if (state === "promoting") {
    return { canCopy: false, reason: "正在采用候选版本" };
  }
  if (queued) {
    return { canCopy: false, reason: "正在等待上一个任务完成" };
  }
  if (pendingCommentCount <= 0) {
    return {
      canCopy: false,
      reason: "先在编辑模式写下评论，AI 会按评论改",
    };
  }
  return { canCopy: true, reason: null };
}

/**
 * The Composer's model line.
 *
 * PageRoot only names a model when it actually knows one. Saying "no models
 * available" while nothing has been read would assert a fact about the user's
 * account that PageRoot has not established, and the unavailable cases already
 * explain themselves on the send button (PRD §10.2) — a second line there would
 * be noise. So the honest default is silence.
 *
 * Returns null when the line should not render at all.
 */
export function sidebarModelLine({
  catalogStatus = "ready",
  modelDisplayName = null,
  modelChoiceCount = 0,
} = {}) {
  if (catalogStatus === "checking") {
    return Object.freeze({ kind: "checking", text: "正在读取模型…", choosable: false });
  }
  const name = typeof modelDisplayName === "string" ? modelDisplayName.trim() : "";
  if (!name) return null;
  return Object.freeze({
    kind: "name",
    text: name,
    // A picker is offered only when there is a real choice to make. PRD §10.1
    // forbids a dropdown that opens onto a single item.
    choosable: Number(modelChoiceCount) > 1,
  });
}

/**
 * The Agent's reply for the live discussion turn, projected with exactly the
 * same shape as a stored message so the view reuses one treatment instead of
 * inventing a second card for streaming text.
 *
 * Returns null until some text has arrived: an empty shell that later fills
 * would make the stream jump for no information.
 */
export function sidebarLiveReply(discussion, messages = []) {
  if (!discussion) return null;
  const text = typeof discussion.replyText === "string" ? discussion.replyText : "";
  if (!text.trim()) return null;
  // Once this turn has a stored message, the record is what renders. Matching on
  // turnId rather than on "has the turn settled" leaves no gap: the live block
  // stays until the reload actually brings the message in, so the reply never
  // blinks out and never shows twice.
  const turnId = String(discussion.turnId || "");
  if (turnId && Array.isArray(messages) && messages.some(
    (message) => message && message.turnId === turnId
      && (message.actor === "agent" || message.actor === "qoder"),
  )) return null;
  const status = String(discussion.status || "");
  return Object.freeze({
    actor: "qoder",
    actorLabel: sidebarActorLabel("qoder"),
    text,
    truncated: discussion.replyTruncated === true,
    // An interrupted reply says so on the reply itself, not only in the Composer
    // notice, because the text is what the user reads.
    interrupted: discussion.interrupted === true,
    streaming: status === "starting" || status === "running",
  });
}

/**
 * The discussion turn's own visible line. A turn that stopped early must say so:
 * showing its partial text with no marker would present an interrupted answer as
 * a complete one.
 */
export function sidebarDiscussionNotice(discussion) {
  if (!discussion) return null;
  const status = String(discussion.status || "");
  if (status === "starting" || status === "running") {
    return { tone: "progress", text: "Qoder 正在阅读当前预览并回复…" };
  }
  if (status === "cancelling") {
    return { tone: "progress", text: "正在结束这轮讨论…" };
  }
  if (discussion.interrupted === true) {
    return {
      tone: "attention",
      text: discussion.interruptedReason === "timeout"
        ? "这轮讨论超时中断，已收到的内容不是完整回复。"
        : "这轮讨论已结束，已收到的内容不是完整回复。",
    };
  }
  if (status === "failed") {
    return { tone: "attention", text: "这轮讨论没有完成。可以重新发一次。" };
  }
  return null;
}

/**
 * A draft is saved but never sent while a round is running. The Composer says
 * so rather than silently keeping the text.
 */
export function sidebarDraftNotice(state) {
  return state === "processing" || state === "validating" || state === "promoting"
    ? "仅保存草稿，不会发送给当前任务"
    : null;
}

export {
  SIDEBAR_STATES,
  INTENT_DISCUSS,
  INTENT_MODIFY,
  INTENT_CONTINUE,
  FORBIDDEN_MESSAGE_KEYS,
};
