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
  "preview-ready",
  "preparing-delivery",
  "processing",
  "validating",
  "ready-to-open",
  "review-view",
  "promoting",
  "run-error",
]);

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
  "preview-ready": {
    label: "待发送",
  },
  "preparing-delivery": {
    label: "准备中",
  },
  processing: {
    label: "处理中",
  },
  validating: {
    label: "检查结果",
  },
  "ready-to-open": {
    label: "待决定",
  },
  "review-view": {
    label: "审阅中",
  },
  promoting: {
    label: "采用中",
  },
  "run-error": {
    label: "需要处理",
  },
  // A round that produced nothing new: the round is over, but it is still this
  // thread's fact to state, not a return to the idle preview.
  "no-change": {
    label: "无变化",
  },
});

export function sidebarModePresentation(state) {
  return MODE_PRESENTATION[state] ?? MODE_PRESENTATION["preview-ready"];
}

// The header's mode comes from the run's own durable status, never from a local
// guess. Any second
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
  // without this row the sidebar falls back to preview-ready and the
  // no-change action bar below becomes unreachable dead copy.
  "no-change": "no-change",
  error: "run-error",
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
  return "preview-ready";
}

/**
 * The run's own progress, projected for the conversation. The process drawer used
 * to be the only place this existed, which made a round feel like it left the
 * workbench; here it reads as the turn currently in flight.
 *
 * Only the states where a round is actually moving return an entry. A settled
 * round is represented by its result, not by a frozen checklist.
 */
const MAX_NARRATION_BLOCKS = 80;

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

export function sidebarRunProgress({
  state,
  steps = [],
  agentText = "",
  agentUpdates = [],
  agentTextTruncated = false,
} = {}) {
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
  // Canonical visible-text events preserve the Agent's public message boundaries.
  // A blank-line split remains only for sessions recovered from the older cumulative
  // text contract; the count matches the Bridge projection's bounded DOM budget.
  const narration = typeof agentText === "string" ? agentText.trim() : "";
  const projectedUpdates = [];
  const seenUpdateIds = new Set();
  for (const update of Array.isArray(agentUpdates) ? agentUpdates.slice(0, MAX_NARRATION_BLOCKS) : []) {
    if (!update || typeof update !== "object") continue;
    const id = String(update.id || "").trim().slice(0, 200);
    const text = String(update.text || "").trim();
    if (!id || !text || seenUpdateIds.has(id)) continue;
    seenUpdateIds.add(id);
    projectedUpdates.push(Object.freeze({ id, text }));
  }
  const fallbackBlocks = narration
    ? narration
      .split(/\n{2,}/u)
      .map((block) => block.trim())
      .filter(Boolean)
      .slice(0, MAX_NARRATION_BLOCKS)
      .map((text, index) => Object.freeze({ id: `legacy:${index}`, text }))
    : [];
  const narrationUpdates = projectedUpdates.length > 0 ? projectedUpdates : fallbackBlocks;
  const narrationText = narration || projectedUpdates.map((update) => update.text).join("");
  const decisionOwnsSettledStatus = state === "ready-to-open" || state === "review-view";
  return Object.freeze({
    steps: Object.freeze(projected),
    // Only a failure gets its own line. The list already shows which step is live at
    // full strength, and each stage carries its own detail, so nothing is repeated
    // above it.
    headline: failedStep?.label ?? null,
    // Public Agent narration is projected separately from PageRoot's lifecycle
    // facts. It never grants Candidate authority.
    narration: narrationText || null,
    narrationUpdates: narrationUpdates.length > 0 ? Object.freeze(narrationUpdates) : null,
    narrationTruncated: agentTextTruncated === true,
    // Once a Candidate decision exists, its signed PageRoot message is the sole
    // settled-status line. Keeping the completed progress step beside it repeated
    // the same fact and recreated the PageRoot message pile this UI removes.
    liveLabel: decisionOwnsSettledStatus ? null : liveStep?.label ?? null,
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

export function sidebarTimestampLabel(value, { now = Date.now() } = {}) {
  const timestamp = Date.parse(String(value || ""));
  const reference = Number(now);
  if (!Number.isFinite(timestamp) || !Number.isFinite(reference)) return null;
  const date = new Date(timestamp);
  const current = new Date(reference);
  const time = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  if (
    date.getFullYear() === current.getFullYear()
    && date.getMonth() === current.getMonth()
    && date.getDate() === current.getDate()
  ) return time;
  return `${date.getMonth() + 1}月${date.getDate()}日 ${time}`;
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

export function sidebarResolvedIntent(state) {
  return state === "ready-to-open" || state === "review-view"
    ? INTENT_CONTINUE
    : INTENT_MODIFY;
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
  runStatus = null,
  candidateVersionLabel = null,
  candidateStatus = null,
  failureMessage = null,
  deliveryMode = "managed-agent",
  handoffStatus = null,
} = {}) {
  if (runStatus === "awaiting-conflict-resolution") {
    return {
      kind: "decision",
      title: "源文件在 AI 处理期间发生了外部修改",
      detail: "请选择采用 AI 候选，或保留磁盘上的外部 HTML。",
      actions: [
        { id: "adopt-ai", label: "采用 AI 结果", tone: "primary" },
        { id: "keep-external", label: "保留外部 HTML", tone: "quiet" },
      ],
    };
  }
  if (state === "run-error") {
    return {
      kind: "blocked",
      title: failureMessage || "AI 输出没有通过安全校验",
      detail: "当前页面和评论仍保持原样。",
      actions: [{ id: "return-editing", label: "返回编辑", tone: "quiet" }],
    };
  }
  if (state === "ready-to-open" || state === "review-view") {
    if (candidateStatus === "blocked") {
      return {
        kind: "blocked",
        title: failureMessage || "本轮没有可采用的结果",
        detail: "这次修改没有通过检查。",
        actions: [{ id: "dismiss", label: "结束本轮", tone: "quiet" }],
      };
    }
    const title = candidateVersionLabel
      ? `${candidateVersionLabel} 等待你的决定`
      : "AI 修改已完成";
    const decisionDetail = "你可以先看变化，也可以直接采用。";
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
          : decisionDetail,
        actions: [{ id: "adopt", label: "采纳这一版", tone: "primary" }],
      };
    }
    if (candidateStatus === "attention") {
      return {
        kind: "decision",
        title,
        detail: "这次变化较大，先对比审阅。",
        actions: [{ id: "review", label: "审阅对比", tone: "primary" }],
      };
    }
    return {
      kind: "decision",
      title,
      detail: decisionDetail,
      actions: [
        { id: "review", label: "审阅对比", tone: "primary" },
        { id: "adopt", label: "直接采用", tone: "quiet" },
      ],
    };
  }
  if (state === "processing" || state === "validating") {
    // The clipboard round is not being processed by the selected Agent at all: the user pasted
    // the task into an Agent of their own and PageRoot is waiting for the file to
    // come back. Claiming an Agent is processing there would describe something that is not
    // happening, and the user would lose the one action they actually need — the
    // task back on the clipboard if the paste went wrong.
    if (deliveryMode === "clipboard") {
      if (handoffStatus === "failed") {
        return {
          kind: "blocked",
          title: "任务还没复制成功",
          detail: "本轮要求已保留，可以重新复制。",
          actions: [
            { id: "recopy", label: "再次复制", tone: "quiet" },
            { id: "cancel", label: "结束本轮", tone: "quiet" },
          ],
        };
      }
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
export function sidebarSendState({
  state,
  catalogStatus = "ready",
  queued = false,
  intent = INTENT_MODIFY,
  pendingCommentCount = 0,
  agentName = "Agent",
  agentSettingsName = "Agent",
  agentSettingsSupported = true,
} = {}) {
  const boundedAgentName = String(agentName || "Agent").trim().slice(0, 80) || "Agent";
  const boundedAgentSettingsName = String(agentSettingsName || boundedAgentName)
    .trim()
    .slice(0, 80) || boundedAgentName;
  // The review Canvas wins over every other reason. It is showing a candidate,
  // so no round may start from here. The
  // thread stays on screen so the user keeps the context that produced the
  // candidate; it is simply not a place to type right now. State is the single
  // owner of this fact — sidebarStateFromRun already maps reviewing to it.
  if (state === "review-view") {
    return {
      kind: "status",
      canSend: false,
      label: "",
      reason: null,
    };
  }
  // Lifecycle authority wins over provider availability. While a Request is
  // being frozen there is no second action to take, and once a Candidate is
  // ready the decision bar — not the Composer — owns review/adoption.
  if (state === "preparing-delivery") {
    return {
      kind: "send",
      canSend: false,
      label: "正在准备修改…",
      reason: "正在冻结本轮评论和页面内容",
    };
  }
  if (state === "ready-to-open") {
    return {
      kind: "status",
      canSend: false,
      label: "",
      reason: null,
    };
  }
  if (state === "run-error") {
    return {
      kind: "status",
      canSend: false,
      label: "",
      reason: null,
    };
  }
  if (state === "processing" || state === "validating") {
    return {
      kind: "send",
      canSend: false,
      label: "发送",
      reason: `${boundedAgentName} 完成本轮后可发送`,
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
  if (catalogStatus === "checking") {
    if (agentSettingsSupported) {
      return {
        kind: "open-agent-settings",
        canSend: false,
        label: `设置 ${boundedAgentSettingsName}`,
        reason: null,
      };
    }
    return {
      kind: "status",
      canSend: false,
      label: "正在连接 Agent…",
      reason: null,
    };
  }
  if (catalogStatus === "auth-required") {
    if (!agentSettingsSupported) {
      return {
        kind: "status",
        canSend: false,
        label: `请先登录 ${boundedAgentName}`,
        reason: `在 ${boundedAgentName} 中完成登录后返回 Stemmio`,
      };
    }
    return {
      kind: "open-agent-settings",
      canSend: false,
      label: `登录 ${boundedAgentSettingsName}`,
      reason: null,
    };
  }
  if (catalogStatus === "not-installed") {
    if (!agentSettingsSupported) {
      return {
        kind: "status",
        canSend: false,
        label: `${boundedAgentName} runtime 不可用`,
        reason: "请重新安装当前版本的 Stemmio",
      };
    }
    return {
      kind: "open-agent-settings",
      canSend: false,
      label: `设置 ${boundedAgentSettingsName}`,
      reason: null,
    };
  }
  if (catalogStatus === "unavailable") {
    return {
      kind: "status",
      canSend: false,
      label: "Agent 暂不可用",
      reason: `${boundedAgentName} 暂时无法确认`,
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
        label: `交给 ${boundedAgentName} 修改`,
        reason: "正在等待上一个任务完成",
      };
    }
    if (pendingCommentCount <= 0) {
      return {
        kind: "send",
        canSend: false,
        label: `交给 ${boundedAgentName} 修改`,
        reason: "先在编辑模式写下评论，AI 会按评论改",
      };
    }
    return {
      kind: "send",
      canSend: true,
      label: `交给 ${boundedAgentName} 修改`,
      reason: null,
    };
  }
  if (intent === INTENT_CONTINUE) {
    return {
      kind: "send",
      canSend: false,
      label: "",
      reason: null,
    };
  }
  return { kind: "send", canSend: false, label: "发送", reason: null };
}

/**
 * Whether the clipboard delivery beside the send button can run, and the reason
 * when it cannot.
 *
 * Copying is the other branch of the same modification round (PRD §11.4): it
 * freezes the page's comments into a Request and writes the clipboard, and
   * neither step consults the selected Agent. The send button guards on the model catalog
 * because the Agent path needs it; applying that guard here would take the
 * clipboard down with an unreadable catalog — PRD §10.2 keeps 复制任务 available
 * through every catalog status, and the old delivery dialog's copy option never
 * required the CLI either. What copying does need is the round itself: no round
 * in flight, and comments to freeze.
 */
export function sidebarCopyTaskState({
  state = "preview-ready",
  queued = false,
  pendingCommentCount = 0,
  agentName = "Agent",
} = {}) {
  const boundedAgentName = String(agentName || "Agent").trim().slice(0, 80) || "Agent";
  if (state === "review-view") {
    return {
      canCopy: false,
      reason: null,
    };
  }
  if (state === "preparing-delivery") {
    return { canCopy: false, reason: "正在冻结本轮评论和页面内容" };
  }
  if (state === "ready-to-open") {
    return { canCopy: false, reason: null };
  }
  if (state === "processing" || state === "validating") {
    return { canCopy: false, reason: `${boundedAgentName} 完成本轮后可发送` };
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
export function sidebarAgentLine({
  catalogStatus = "ready",
  agentDisplayName = null,
  agentChoiceCount = 0,
} = {}) {
  const name = typeof agentDisplayName === "string" ? agentDisplayName.trim() : "";
  if (catalogStatus === "checking" && !name) {
    return Object.freeze({ kind: "checking", text: "正在连接 Agent…", choosable: false });
  }
  if (!name) return null;
  return Object.freeze({
    kind: catalogStatus === "checking" ? "checking" : "name",
    text: name,
    // A picker is offered only when there is a real choice to make. PRD §10.1
    // forbids a dropdown that opens onto a single item.
    choosable: Number(agentChoiceCount) > 1,
  });
}

export {
  SIDEBAR_STATES,
  INTENT_MODIFY,
  INTENT_CONTINUE,
  FORBIDDEN_MESSAGE_KEYS,
};
