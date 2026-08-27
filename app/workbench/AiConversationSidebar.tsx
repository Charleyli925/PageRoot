"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  sidebarActionBar,
  sidebarActorInitial,
  sidebarMessageStream,
  sidebarModelLine,
  sidebarModePresentation,
  sidebarResolvedIntent,
  sidebarDeliveryDisclosure,
  sidebarRunProgress,
  sidebarSendState,
  sidebarCopyTaskState,
  sidebarTimestampLabel,
  type SidebarCatalogStatus,
} from "./ai-conversation-model.js";
import { copyText } from "./browser-io";
import styles from "./ai-conversation-sidebar.module.css";

// The AI conversation sidebar.
//
// Four fixed regions, top to bottom: header, message stream, action bar,
// Composer. The split is load-bearing, not cosmetic:
//
//   - The message stream carries immutable facts only. It never renders a
//     button, so scrolling back through history cannot surface a stale action.
//   - The action bar holds whatever the user can decide right now and does not
//     scroll. In a 400px sidebar a decision parked in the stream disappears once
//     the conversation grows, leaving a pending decision the user cannot see.
//   - The Composer holds the modification context, model and delivery actions.
//
// This component is presentation only. It owns no durable state and reaches no
// Bridge; the workflow layer supplies data and receives intents.

export type AiConversationSidebarProps = {
  state: string;
  title: string;
  messages: readonly unknown[];
  catalogStatus?: SidebarCatalogStatus;
  modelDisplayName?: string | null;
  agentActionName?: string | null;
  agentSettingsName?: string | null;
  agentSettingsSupported?: boolean;
  agentLocalReadDisclosure?: string | null;
  modelChoiceCount?: number;
  modelChoices?: readonly Readonly<{
    id: string;
    label: string;
    detail?: string | null;
  }>[];
  selectedModelChoiceId?: string | null;
  candidateVersionLabel?: string | null;
  candidateStatus?: string | null;
  failureMessage?: string | null;
  contextLabel?: string | null;
  pendingCommentCount?: number;
  queued?: boolean;
  loading?: boolean;
  onSend?: () => void;
  onAction?: (actionId: string) => void;
  onOpenAgentSettings?: () => void;
  onOpenModelChoices?: () => void;
  onSelectModelChoice?: (choiceId: string) => void;
  onCollapse?: () => void;
  /** Hands the same round to the clipboard instead of the local Agent. */
  onCopyTask?: () => void;
  /** What the selected Agent is saying while it works (ADR 0037). */
  agentText?: string;
  /** True only when a bounded public-text projection omitted a suffix. */
  agentTextTruncated?: boolean;
  agentStartedAt?: string | null;
  agentUpdatedAt?: string | null;
  /** A frozen Request identity, used solely to follow the round the user started. */
  runKey?: string | null;
  runCommentCount?: number | null;
  agentPresentation?: Readonly<{
    providerId: string;
    displayName: string;
    agentName: string;
    logoSrc: string | null;
  }> | null;
  /** Which destination this round uses; the decision bar copy depends on it. */
  deliveryMode?: "managed-agent" | "clipboard";
  /** The run's own progress steps, so a round in flight reads inside the thread. */
  runSteps?: readonly unknown[];
};

type CopyFeedback = Readonly<{
  key: string;
  label: "已复制" | "复制失败";
}> | null;

const FOLLOW_THRESHOLD_PX = 48;

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function AgentAvatar({
  presentation,
}: {
  presentation: AiConversationSidebarProps["agentPresentation"];
}) {
  if (presentation?.logoSrc) {
    return (
      <span className={`${styles.avatar} ${styles.agentAvatar}`} aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={presentation.logoSrc} alt="" />
      </span>
    );
  }
  return (
    <span className={`${styles.avatar} ${styles.agentAvatar}`} aria-hidden="true">
      {sidebarActorInitial("agent")}
    </span>
  );
}

export default function AiConversationSidebar({
  state,
  title,
  messages,
  catalogStatus = "ready",
  modelDisplayName = null,
  agentActionName = "Agent",
  agentSettingsName = "Agent",
  agentSettingsSupported = true,
  agentLocalReadDisclosure = null,
  modelChoiceCount = 0,
  modelChoices = [],
  selectedModelChoiceId = null,
  candidateVersionLabel = null,
  candidateStatus = null,
  failureMessage = null,
  contextLabel = null,
  pendingCommentCount = 0,
  queued = false,
  loading = false,
  onSend,
  onAction,
  onOpenAgentSettings,
  onOpenModelChoices,
  onSelectModelChoice,
  onCollapse,
  onCopyTask,
  deliveryMode = "managed-agent",
  agentText = "",
  agentTextTruncated = false,
  agentStartedAt = null,
  agentUpdatedAt = null,
  runKey = null,
  runCommentCount = null,
  agentPresentation = null,
  runSteps = [],
}: AiConversationSidebarProps) {
  const [modelChoicesOpen, setModelChoicesOpen] = useState(false);
  const [hasUnseenContent, setHasUnseenContent] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<CopyFeedback>(null);
  const streamRef = useRef<HTMLDivElement | null>(null);
  const bottomSentinelRef = useRef<HTMLDivElement | null>(null);
  const liveMessageRef = useRef<HTMLElement | null>(null);
  const followingRef = useRef(true);
  const contentKeyRef = useRef<string | null>(null);
  const runKeyRef = useRef<string | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resolvedAgentActionName = agentPresentation?.agentName
    || agentActionName
    || "Agent";
  const resolvedAgentSettingsName = agentSettingsName || resolvedAgentActionName;
  const stream = useMemo(() => sidebarMessageStream(messages), [messages]);
  const activeIntent = sidebarResolvedIntent(state);
  // Product state alone determines the one available action and mode copy.
  const mode = sidebarModePresentation(state);
  const actionBar = useMemo(
    () => sidebarActionBar({
      state,
      candidateVersionLabel,
      candidateStatus,
      failureMessage,
      deliveryMode,
    }),
    [candidateStatus, candidateVersionLabel, deliveryMode, failureMessage, state],
  );
  const send = sidebarSendState({
    state,
    catalogStatus,
    queued,
    intent: activeIntent,
    pendingCommentCount,
    agentName: resolvedAgentActionName,
    agentSettingsName: resolvedAgentSettingsName,
    agentSettingsSupported,
  });
  // The clipboard button does not read the model catalog: copying is a branch
  // of the same round that never consults the selected Agent, so an unreadable catalog must
  // not grey it out with the send button it sits beside.
  const copyTask = sidebarCopyTaskState({
    state,
    queued,
    pendingCommentCount,
    agentName: resolvedAgentActionName,
  });
  const disclosure = sidebarDeliveryDisclosure(activeIntent, {
    agentName: resolvedAgentActionName,
    localReadDisclosure: agentLocalReadDisclosure,
  });
  const runProgress = sidebarRunProgress({
    state,
    steps: runSteps,
    agentText,
    agentTextTruncated,
  });
  const modelLine = sidebarModelLine({
    catalogStatus,
    modelDisplayName,
    modelChoiceCount,
  });
  const runSummary = runKey
    ? runKey.startsWith("pending:")
      ? { title: "正在确认本轮任务是否已创建…", detail: null }
      : {
          title: "本轮修改已提交",
          detail: `${Math.max(0, Number(runCommentCount ?? pendingCommentCount) || 0)} 条评论 · 当前 HTML · 项目规则`,
        }
    : null;
  const liveTimestamp = sidebarTimestampLabel(agentUpdatedAt || agentStartedAt);
  const contentKey = [
    runKey || "",
    state,
    runProgress?.liveLabel || runProgress?.headline || "",
    runProgress?.narration || "",
    runProgress?.narrationTruncated ? "truncated" : "",
    actionBar?.kind || "",
    actionBar?.title || "",
    stream.map((message) => `${message.messageId}:${message.sequence}:${message.text.length}`).join(","),
  ].join("|");

  const scrollToLatest = useCallback((behavior: ScrollBehavior = "auto") => {
    const streamElement = streamRef.current;
    if (!streamElement) return;
    const resolvedBehavior = behavior === "smooth" && !prefersReducedMotion()
      ? "smooth"
      : "auto";
    streamElement.scrollTo({ top: streamElement.scrollHeight, behavior: resolvedBehavior });
  }, []);

  const scheduleFollow = useCallback((behavior: ScrollBehavior = "auto") => {
    if (typeof window === "undefined") return;
    window.requestAnimationFrame(() => scrollToLatest(behavior));
  }, [scrollToLatest]);

  const onStreamScroll = useCallback(() => {
    const streamElement = streamRef.current;
    if (!streamElement) return;
    const distanceFromBottom = Math.max(
      0,
      streamElement.scrollHeight - streamElement.clientHeight - streamElement.scrollTop,
    );
    followingRef.current = distanceFromBottom <= FOLLOW_THRESHOLD_PX;
    if (followingRef.current) setHasUnseenContent(false);
  }, []);

  const revealLatest = useCallback(() => {
    followingRef.current = true;
    setHasUnseenContent(false);
    scheduleFollow("smooth");
  }, [scheduleFollow]);

  const copyMessage = useCallback((key: string, value: string) => {
    if (!value) return;
    void copyText(value).then(() => {
      setCopyFeedback({ key, label: "已复制" });
    }, () => {
      setCopyFeedback({ key, label: "复制失败" });
    }).finally(() => {
      if (copyTimerRef.current !== null) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopyFeedback(null), 1_800);
    });
  }, []);

  useEffect(() => () => {
    if (copyTimerRef.current !== null) clearTimeout(copyTimerRef.current);
  }, []);

  useEffect(() => {
    if (runKey && runKey !== runKeyRef.current) {
      followingRef.current = true;
      setHasUnseenContent(false);
      scheduleFollow("auto");
    }
    runKeyRef.current = runKey;
  }, [runKey, scheduleFollow]);

  useEffect(() => {
    if (contentKeyRef.current === null) {
      contentKeyRef.current = contentKey;
      return;
    }
    if (contentKeyRef.current === contentKey) return;
    contentKeyRef.current = contentKey;
    if (followingRef.current) scheduleFollow("auto");
    else setHasUnseenContent(true);
  }, [contentKey, scheduleFollow]);

  useEffect(() => {
    const liveMessage = liveMessageRef.current;
    if (!liveMessage || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(() => {
      if (followingRef.current) scheduleFollow("auto");
    });
    observer.observe(liveMessage);
    return () => observer.disconnect();
  }, [contentKey, scheduleFollow]);

  return (
    <aside
      className={styles.sidebar}
      aria-label="AI 助手"
      data-state={state}
      data-testid="ai-conversation-sidebar"
    >
      <header className={styles.header}>
        <div className={styles.headerTitle}>
          <strong data-testid="ai-conversation-title">{title || "AI 助手"}</strong>
          <span className={styles.mode} data-testid="ai-conversation-mode">
            {mode.label}
          </span>
        </div>
        <p className={styles.modeDetail}>{mode.detail}</p>
        {contextLabel ? (
          <p className={styles.context} data-testid="ai-conversation-context">
            {contextLabel}
          </p>
        ) : null}
        {onCollapse ? (
          <button
            type="button"
            className={styles.collapse}
            onClick={onCollapse}
            aria-label="收起 AI 助手"
          >
            收起
          </button>
        ) : null}
      </header>

      {/*
        * Immutable facts only. A screen reader browses this as a log rather than
        * being interrupted for every streamed fragment.
        */}
      <div
        ref={streamRef}
        className={styles.stream}
        role="log"
        aria-live="off"
        aria-busy={loading}
        aria-label="对话记录"
        data-testid="ai-conversation-stream"
        onScroll={onStreamScroll}
      >
        {loading ? (
          <p className={styles.placeholder}>正在读取这份文档的对话…</p>
        ) : stream.length === 0 && !runProgress ? (
          <p className={styles.placeholder}>
            还没有修改记录。先在页面上写评论，再交给 AI 修改。
          </p>
        ) : (
          stream.map((message) => {
            const timestamp = sidebarTimestampLabel(message.createdAt);
            const copyKey = `message:${message.messageId}`;
            return (
              <article
                key={message.messageId}
                className={styles.message}
                data-actor={message.actor}
                data-kind={message.kind}
                data-status={message.status}
                data-testid="ai-conversation-message"
              >
                <span className={styles.avatar} aria-hidden="true">
                  {sidebarActorInitial(message.actor)}
                </span>
                <span className={styles.actor}>{message.actorLabel}</span>
                <p className={styles.text}>{message.text}</p>
                {timestamp || message.text ? (
                  <div className={styles.messageMeta}>
                    {timestamp ? <time dateTime={message.createdAt}>{timestamp}</time> : null}
                    {message.text ? (
                      <button type="button" onClick={() => copyMessage(copyKey, message.text)}>
                        {copyFeedback?.key === copyKey ? copyFeedback.label : "复制"}
                      </button>
                    ) : null}
                  </div>
                ) : null}
                {message.truncated ? (
                  <small className={styles.truncated}>部分内容已省略</small>
                ) : null}
                {message.status === "interrupted" ? (
                  <small className={styles.interrupted}>这条回复没有完成</small>
                ) : null}
              </article>
            );
          })
        )}

        {runSummary ? (
          <section
            className={`${styles.message} ${styles.runSummary}`}
            data-actor="pageroot"
            data-testid="ai-conversation-run-summary"
            aria-label="本轮任务摘要"
          >
            <span className={styles.avatar} aria-hidden="true">
              {sidebarActorInitial("pageroot")}
            </span>
            <span className={styles.actor}>PageRoot</span>
            <p className={styles.text}>{runSummary.title}</p>
            {runSummary.detail ? <small className={styles.runSummaryDetail}>{runSummary.detail}</small> : null}
          </section>
        ) : null}

        {/*
          * A round in flight, told inside the thread rather than a
          * panel of its own. PageRoot states the stage from the run's durable status
          * (ADR 0037 §4). The selected Agent's public words follow in their
          * own stable article, so the two speakers never blur together.
          */}
        {runProgress ? (
          <section
            className={`${styles.message} ${styles.runActivity}`}
            data-actor="pageroot"
            data-tone={runProgress.tone}
            data-testid="ai-conversation-run-progress"
            aria-label="本轮进度"
          >
            <span className={styles.avatar} aria-hidden="true">
              {sidebarActorInitial("pageroot")}
            </span>
            {/*
              * PageRoot states the stages from the run's durable status (ADR 0037 §4).
              * Signing them with an Agent name made the Agent look like the author of
              * PageRoot's own bookkeeping, and put the brand mark on the wrong speaker.
            */}
            <span className={styles.actor}>PageRoot</span>
            {runProgress.liveLabel || runProgress.headline ? (
              <p
                className={`${styles.text} ${styles.liveStatus}`}
                role="status"
                aria-live="polite"
                aria-atomic="true"
              >
                {runProgress.liveLabel || runProgress.headline}
              </p>
            ) : null}
            <ol className={styles.runSteps}>
              {runProgress.steps.map((step) => (
                <li key={step.key} data-step-state={step.state}>
                  {step.label}
                  {step.detail ? (
                    <span className={styles.runStepDetail}>{step.detail}</span>
                  ) : null}
                </li>
              ))}
            </ol>
          </section>
        ) : null}

        {/* Public Agent narration grows in one stable article. It is presentation
            evidence only and never changes Candidate authority. */}
        {runProgress?.narration ? (
          <article
            ref={liveMessageRef}
            className={styles.message}
            data-actor="agent"
            data-testid="ai-conversation-narration-message"
            aria-label={`${resolvedAgentActionName} 的说明`}
            aria-live="off"
          >
            <AgentAvatar presentation={agentPresentation} />
            <span className={styles.actor}>{resolvedAgentActionName}</span>
            <div
              className={styles.narrationText}
              data-testid="ai-conversation-narration"
            >
              {runProgress.narration}
            </div>
            {liveTimestamp || runProgress.narration ? (
              <div className={styles.messageMeta}>
                {liveTimestamp ? (
                  <time dateTime={agentUpdatedAt || agentStartedAt || undefined}>
                    {liveTimestamp}
                  </time>
                ) : null}
                <button
                  type="button"
                  onClick={() => copyMessage("live-agent", runProgress.narration || "")}
                >
                  {copyFeedback?.key === "live-agent" ? copyFeedback.label : "复制"}
                </button>
              </div>
            ) : null}
            {runProgress.narrationTruncated ? (
              <small className={styles.truncated}>部分输出已省略</small>
            ) : null}
          </article>
        ) : null}

        {/*
          * The decision reads as the next thing said in this thread rather than a
          * band pinned above the Composer. Stage, decision and Composer used to be
          * three separate regions, so a single round was read in three places with
          * an empty gap between them.
          */}
        {actionBar ? (
          <section
            className={`${styles.message} ${styles.actionBar}`}
            data-actor="pageroot"
            data-kind={actionBar.kind}
            data-testid="ai-conversation-action-bar"
            aria-label="当前待决定"
          >
            <span className={styles.avatarSpacer} aria-hidden="true" />
            {actionBar.title ? <strong>{actionBar.title}</strong> : null}
            {actionBar.detail ? <p>{actionBar.detail}</p> : null}
            {actionBar.actions.length > 0 ? (
              <div className={styles.actions}>
                {actionBar.actions.map((action) => (
                  <button
                    key={action.id}
                    type="button"
                    className={styles.action}
                    data-tone={action.tone}
                    data-action-id={action.id}
                    onClick={() => onAction?.(action.id)}
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            ) : null}
          </section>
        ) : null}
        {hasUnseenContent ? (
          <button
            className={styles.unseenContent}
            type="button"
            data-testid="ai-conversation-unseen-content"
            onClick={revealLatest}
          >
            有新进展
          </button>
        ) : null}
        <div ref={bottomSentinelRef} className={styles.bottomSentinel} aria-hidden="true" />
      </div>

      <div className={styles.composer} data-testid="ai-conversation-composer">
        <div className={styles.composerTop}>
          {/*
            * The model is a quiet inline affordance, and it says nothing when
            * PageRoot has not actually read a model. With a single usable model it
            * is plain text: offering a dropdown that opens onto one item would
            * promise a choice the user does not have.
            */}
          {modelLine?.choosable ? (
            <button
              type="button"
              className={styles.model}
              data-testid="ai-conversation-model"
              onClick={() => {
                setModelChoicesOpen((value) => !value);
                onOpenModelChoices?.();
              }}
              aria-expanded={modelChoicesOpen}
              aria-haspopup="listbox"
              aria-label={`当前模型 ${modelLine.text}，点击切换`}
            >
              {modelLine.text}
              <span aria-hidden="true">▾</span>
            </button>
          ) : modelLine ? (
            <span className={styles.modelStatic} data-testid="ai-conversation-model">
              {modelLine.text}
            </span>
          ) : null}
        </div>

        {modelChoicesOpen && modelChoices.length > 1 ? (
          <div
            className={styles.modelChoices}
            role="listbox"
            aria-label="选择本轮 Agent"
            data-testid="ai-conversation-model-choices"
          >
            {modelChoices.map((choice) => (
              <button
                key={choice.id}
                type="button"
                role="option"
                aria-selected={choice.id === selectedModelChoiceId}
                className={styles.modelChoice}
                onClick={() => {
                  onSelectModelChoice?.(choice.id);
                  setModelChoicesOpen(false);
                }}
              >
                <strong>{choice.label}</strong>
                {choice.detail ? <span>{choice.detail}</span> : null}
              </button>
            ))}
          </div>
        ) : null}

        {/*
          * The round's context summary belongs to the Composer, not to the fact
          * stream: it changes as the user works and must never be persisted as
          * a message.
          */}
        {activeIntent === "modify" ? (
          <p
            className={styles.contextSummary}
            data-testid="ai-conversation-context-summary"
          >
            {`本轮将包含：${pendingCommentCount} 条评论 · 当前 HTML · 项目规则`}
          </p>
        ) : null}
        {disclosure ? (
          <p
            className={styles.deliveryDisclosure}
            data-testid="ai-conversation-delivery-disclosure"
          >
            {disclosure}
          </p>
        ) : null}
        {activeIntent === "continue" ? (
          <p
            className={styles.contextSummary}
            data-testid="ai-conversation-context-summary"
          >
            需要先采用当前结果，才能在它的基础上继续修改。修改前版本、本轮对话和候选记录都会保留。
          </p>
        ) : null}

        <div className={styles.composerActions}>
          {/*
            * A blocked send always says why. Greying the button out with no
            * explanation leaves the user without a next step.
            */}
          {send.reason ? (
            <span className={styles.sendReason} data-testid="ai-conversation-send-reason">
              {send.reason}
            </span>
          ) : null}
          {/*
            * The clipboard path from the old delivery dialog, kept as a quiet
            * alternative beside the primary action instead of a question asked
            * before anything happens. Same round, same payload, different
            * destination.
            */}
          {activeIntent === "modify" && onCopyTask ? (
            <button
              type="button"
              className={styles.copyTask}
              data-testid="ai-conversation-copy-task"
              disabled={!copyTask.canCopy}
              onClick={() => onCopyTask()}
            >
              复制给别的 AI
            </button>
          ) : null}
          {send.kind === "status" ? (
            <span
              className={styles.sendStatus}
              data-testid="ai-conversation-agent-status"
              aria-live="polite"
            >
              {send.label}
            </span>
          ) : (
            <button
              type="button"
              className={styles.send}
              data-testid="ai-conversation-send"
              disabled={send.kind === "send" && !send.canSend}
              onClick={() => {
                if (send.kind === "open-agent-settings") {
                  onOpenAgentSettings?.();
                  return;
                }
                onSend?.();
              }}
            >
              {activeIntent === "continue" ? "采纳并继续" : send.label}
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}
