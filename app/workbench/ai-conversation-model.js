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
  promoting: {
    label: "结果 · 等待决定",
    detail: "当前仍是修改前页面。",
  },
});

export function sidebarModePresentation(state) {
  return MODE_PRESENTATION[state] ?? MODE_PRESENTATION["preview-discussion"];
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
  return [
    { value: INTENT_DISCUSS, label: "讨论" },
    { value: INTENT_MODIFY, label: "交给 AI 修改" },
  ];
}

export function sidebarResolvedIntent(state, requestedIntent) {
  const allowed = new Set(
    sidebarIntentOptions(state).map((option) => option.value),
  );
  return allowed.has(requestedIntent) ? requestedIntent : INTENT_DISCUSS;
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
    return {
      kind: "progress",
      title: "Qoder 正在处理本轮任务",
      detail: "当前页面不会被直接覆盖。",
      actions: [{ id: "cancel", label: "结束本轮", tone: "quiet" }],
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
export function sidebarSendState({
  state,
  catalogStatus = "ready",
  hasText = false,
  queued = false,
} = {}) {
  if (catalogStatus === "checking") {
    return { canSend: false, label: "发送", reason: "正在读取模型…" };
  }
  if (catalogStatus === "auth-required") {
    return { canSend: false, label: "登录 Qoder 后可发送", reason: null };
  }
  if (catalogStatus === "not-installed") {
    return { canSend: false, label: "安装 Qoder CLI 后可发送", reason: null };
  }
  if (catalogStatus === "unavailable") {
    return { canSend: false, label: "发送", reason: "Qoder 暂时无法确认" };
  }
  if (state === "processing" || state === "validating") {
    return { canSend: false, label: "发送", reason: "Qoder 完成本轮后可发送" };
  }
  if (state === "promoting") {
    return { canSend: false, label: "发送", reason: "正在采用候选版本" };
  }
  if (queued) {
    return { canSend: false, label: "发送", reason: "正在等待上一个任务完成" };
  }
  if (!hasText) {
    return { canSend: false, label: "发送", reason: null };
  }
  return { canSend: true, label: "发送", reason: null };
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
