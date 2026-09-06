"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  sidebarActionBar,
  sidebarAgentLine,
  sidebarReasoningLine,
  sidebarActorInitial,
  sidebarMessageStream,
  sidebarModePresentation,
  sidebarResolvedIntent,
  sidebarRunProgress,
  sidebarSendState,
  sidebarCopyTaskState,
  sidebarExecutionStatus,
  sidebarTimestampLabel,
  type SidebarCatalogStatus,
  type SidebarHistoryGroup,
} from "./ai-conversation-model.js";
import type { AgentSelection } from "../domain/agent-provider-state.js";
import { BoundAgentSetupPanel, type BoundAgentSetupPanelProps } from "../components/AgentSetupPanel";
import type { AgentProviderCardData } from "../components/agent-provider-card-types";
import { agentServiceLabel } from "../application/workspace-agent-preference.js";
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
  historyGroups?: readonly SidebarHistoryGroup[];
  catalogStatus?: SidebarCatalogStatus;
  catalogReason?: string | null;
  agentDisplayName?: string | null;
  executionDisplayName?: string | null;
  agentActionName?: string | null;
  agentSettingsName?: string | null;
  agentSettingsSupported?: boolean;
  credentialKind?: "api-token" | null;
  models?: readonly Readonly<{
    id: string;
    displayName: string;
  }>[];
  selectedModelId?: string | null;
  reasoningChoices?: readonly Readonly<{
    id: string;
    label: string;
  }>[];
  selectedReasoningId?: string | null;
  candidateVersionLabel?: string | null;
  candidateStatus?: string | null;
  runStatus?: string | null;
  failureMessage?: string | null;
  failureCode?: string | null;
  failureRetryable?: boolean;
  failureRecoveryKind?: "retry" | "wait" | "reauthenticate" | "change-model" | "change-provider" | "repair-installation" | "end" | null;
  contextLabel?: string | null;
  pendingCommentCount?: number;
  queued?: boolean;
  loading?: boolean;
  onSend?: () => void;
  onAction?: (actionId: string) => void;
  onOpenAgentSettings?: () => void;
  onSelectModel?: (modelId: string) => void;
  onSelectReasoning?: (reasoning: string) => void;
  /** Hands the same round to the clipboard instead of the local Agent. */
  onCopyTask?: () => void;
  agentAccess?: Readonly<{
    cards: readonly AgentProviderCardData[];
    documentId: string;
    recovery?: null | Readonly<{
      documentId: string;
      providerId: string | null;
      field: "apiKey" | "login" | "install";
      requestId?: string;
      attemptId?: string;
    }>;
    bindings: Omit<
      BoundAgentSetupPanelProps,
      "card" | "surface" | "hideDisconnectAction" | "initialApiKeyOpen" | "actionButtonRef"
    >;
    onSelect(selection: AgentSelection): void;
    onQueueDefault?(selection: AgentSelection): void;
    onReconnect?(selection: AgentSelection): Promise<unknown>;
    onBeginAccessRepair?(field?: "apiKey" | "login" | "install"): void;
  }>;
  /** What the selected Agent is saying while it works (ADR 0037). */
  agentText?: string;
  /** Stable public message rows from canonical visible-text events. */
  agentUpdates?: readonly unknown[];
  /** True only when a bounded public-text projection omitted a suffix. */
  agentTextTruncated?: boolean;
  /** A managed Agent is actively thinking or processing this round. */
  agentWorking?: boolean;
  agentStartedAt?: string | null;
  agentLastActivityAt?: string | null;
  agentReceivedBytes?: number;
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
  /** User-facing name of the HTML this round belongs to. */
  sourceFileName?: string | null;
  handoffStatus?: string | null;
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
      {presentation?.agentName?.trim().charAt(0).toUpperCase() || sidebarActorInitial("agent")}
    </span>
  );
}

function PageRootAvatar() {
  return (
    <span className={`${styles.avatar} ${styles.pageRootAvatar}`} aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="./brand-logo.png" alt="" />
    </span>
  );
}

function AgentChoiceMark({
  label,
  logoSrc,
}: {
  label: string;
  logoSrc?: string | null;
}) {
  return (
    <span className={styles.agentChoiceMark} aria-hidden="true">
      {logoSrc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoSrc} alt="" />
      ) : label.trim().charAt(0).toUpperCase() || "A"}
    </span>
  );
}

export default function AiConversationSidebar({
  state,
  title,
  messages,
  historyGroups = [],
  catalogStatus = "ready",
  catalogReason = null,
  agentDisplayName = null,
  executionDisplayName = null,
  agentActionName = "Agent",
  agentSettingsName = "Agent",
  agentSettingsSupported = true,
  credentialKind = null,
  models = [],
  selectedModelId = null,
  reasoningChoices = [],
  selectedReasoningId = null,
  candidateVersionLabel = null,
  candidateStatus = null,
  runStatus = null,
  failureMessage = null,
  failureCode = null,
  failureRetryable = true,
  failureRecoveryKind = null,
  contextLabel = null,
  pendingCommentCount = 0,
  queued = false,
  loading = false,
  onSend,
  onAction,
  onOpenAgentSettings,
  onSelectModel,
  onSelectReasoning,
  onCopyTask,
  agentAccess,
  deliveryMode = "managed-agent",
  agentText = "",
  agentUpdates = [],
  agentTextTruncated = false,
  agentWorking = false,
  agentStartedAt = null,
  agentLastActivityAt = null,
  agentReceivedBytes = 0,
  agentUpdatedAt = null,
  runKey = null,
  runCommentCount = null,
  agentPresentation = null,
  runSteps = [],
  sourceFileName = null,
  handoffStatus = null,
}: AiConversationSidebarProps) {
  const [openChoice, setOpenChoice] = useState<null | "model" | "reasoning" | "service">(null);
  const [setupProviderId, setSetupProviderId] = useState<string | null>(null);
  const [hasUnseenContent, setHasUnseenContent] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<CopyFeedback>(null);
  const [clockNow, setClockNow] = useState(0);
  const streamRef = useRef<HTMLDivElement | null>(null);
  const bottomSentinelRef = useRef<HTMLDivElement | null>(null);
  const liveMessageRef = useRef<HTMLElement | null>(null);
  const agentSelectorRef = useRef<HTMLDivElement | null>(null);
  const agentSelectorButtonRef = useRef<HTMLButtonElement | null>(null);
  const reasoningSelectorButtonRef = useRef<HTMLButtonElement | null>(null);
  const followingRef = useRef(true);
  const contentKeyRef = useRef<string | null>(null);
  const runKeyRef = useRef<string | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resolvedAgentActionName = agentPresentation?.agentName
    || agentActionName
    || "Agent";
  const resolvedAgentSettingsName = agentSettingsName || resolvedAgentActionName;
  const stream = useMemo(() => sidebarMessageStream(messages), [messages]);
  const historyBoundaryByIndex = useMemo(() => {
    const boundaries = new Map<number, { label: string; first: boolean; kind: string }>();
    for (const group of historyGroups) {
      const firstIndex = group.messageIndices[0];
      for (const messageIndex of group.messageIndices) {
        boundaries.set(messageIndex, {
          label: group.label,
          first: messageIndex === firstIndex,
          kind: group.kind,
        });
      }
    }
    return boundaries;
  }, [historyGroups]);
  const activeIntent = sidebarResolvedIntent(state);
  // Product state alone determines the one available action and mode copy.
  const mode = sidebarModePresentation(state);
  const actionBar = useMemo(
    () => sidebarActionBar({
      state,
      runStatus,
      candidateVersionLabel,
      candidateStatus,
      failureMessage,
      failureCode,
      failureRetryable,
      failureRecoveryKind,
      deliveryMode,
      handoffStatus,
      credentialKind,
    }),
    [
      candidateStatus,
      candidateVersionLabel,
      credentialKind,
      deliveryMode,
      failureMessage,
      failureCode,
      failureRetryable,
      failureRecoveryKind,
      handoffStatus,
      runStatus,
      state,
    ],
  );
  const send = sidebarSendState({
    state,
    catalogStatus,
    catalogReason,
    queued,
    intent: activeIntent,
    pendingCommentCount,
    agentName: resolvedAgentActionName,
    agentSettingsName: resolvedAgentSettingsName,
    agentSettingsSupported,
    credentialKind,
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
  const runProgress = sidebarRunProgress({
    state,
    steps: runSteps,
    agentText,
    agentUpdates,
    agentTextTruncated,
  });
  const executionStatus = agentWorking
    ? sidebarExecutionStatus({
        state,
        providerName: executionDisplayName
          || agentDisplayName
          || agentPresentation?.displayName
          || agentPresentation?.agentName
          || resolvedAgentActionName,
        startedAt: agentStartedAt,
        receivedBytes: agentReceivedBytes,
        now: clockNow,
      })
    : null;
  const selectedModel = models.find((model) => model.id === selectedModelId) || models[0] || null;
  const agentLine = sidebarAgentLine({
    catalogStatus,
    modelDisplayName: selectedModel?.displayName || selectedModel?.id || null,
    modelChoiceCount: models.length,
  });
  const reasoningLine = sidebarReasoningLine({
    choices: reasoningChoices,
    selectedId: selectedReasoningId,
  });
  const showComposerIdentity = state === "preview-ready" || state === "no-change";
  const schemeName = (typeof agentDisplayName === "string" && agentDisplayName.trim())
    || resolvedAgentActionName;
  const recovery = agentAccess?.recovery || null;
  const setupCard = agentAccess?.cards.find((card) => card.selection.providerId === setupProviderId) || null;
  const currentProviderId = agentPresentation?.providerId
    || agentAccess?.cards.find((card) => card.availability.status === "ready")?.selection.providerId
    || "";
  const serviceTriggerLabel = (() => {
    const name = agentServiceLabel(currentProviderId, schemeName);
    if (currentProviderId === "pageroot" && catalogStatus === "ready") {
      return `DeepSeek · ${selectedModel?.displayName || "当前模型"}`;
    }
    if (catalogStatus === "ready") {
      return `${name} · ${selectedModel?.displayName || "默认模型"}`;
    }
    return name;
  })();
  const recoveredOnOrigin = Boolean(
    recovery
    && catalogStatus === "ready"
    && !setupProviderId
    && recovery.documentId === (agentAccess?.documentId || ""),
  );
  const recoveredElsewhere = Boolean(
    recovery
    && catalogStatus === "ready"
    && !setupProviderId
    && recovery.documentId
    && recovery.documentId !== (agentAccess?.documentId || ""),
  );
  const resolvedFileName = sourceFileName?.trim() || "当前 HTML";
  const contextContents = `${Math.max(0, Number(runCommentCount ?? pendingCommentCount) || 0)} 条评论、当前 HTML 和项目规则`;
  const runSummary = runKey
    ? runKey.startsWith("pending:")
      ? {
          title: `正在准备“${resolvedFileName}”`,
          detail: `正在整理${contextContents}。`,
        }
      : deliveryMode === "managed-agent" && handoffStatus
        ? {
            title: `已将“${resolvedFileName}”交给 ${resolvedAgentActionName}`,
            detail: `发送了${contextContents}。`,
          }
        : deliveryMode === "clipboard" && handoffStatus === "copied"
          ? {
              title: `已复制“${resolvedFileName}”的修改要求`,
              detail: `包含${contextContents}。`,
            }
          : {
              title: `已准备“${resolvedFileName}”的修改要求`,
              detail: `包含${contextContents}。`,
            }
    : null;
  const liveTimestamp = sidebarTimestampLabel(agentUpdatedAt || agentStartedAt);
  const contentKey = [
    runKey || "",
    state,
    runProgress?.liveLabel || runProgress?.headline || "",
    runProgress?.narrationUpdates?.map((update) => `${update.id}:${update.text.length}`).join(",") || "",
    agentWorking ? "working" : "idle",
    runProgress?.narrationTruncated ? "truncated" : "",
    actionBar?.kind || "",
    actionBar?.title || "",
    historyGroups.map((group) => `${group.key}:${group.label}`).join(","),
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
    if (!openChoice) return undefined;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!agentSelectorRef.current?.contains(event.target as Node)) {
        setOpenChoice(null);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpenChoice(null);
      (openChoice === "reasoning" ? reasoningSelectorButtonRef : agentSelectorButtonRef)
        .current?.focus();
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer, true);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer, true);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [openChoice]);

  useEffect(() => {
    if (!agentWorking && handoffStatus !== "cancelling") return undefined;
    const timer = window.setInterval(() => setClockNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [agentWorking, handoffStatus, agentStartedAt, agentLastActivityAt]);

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

  if (recovery && setupProviderId && setupCard?.availability.status === "ready") {
    setSetupProviderId(null);
  }

  return (
    <aside
      id="ai-assistant-sidebar"
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
        {sourceFileName || contextLabel ? (
          <p className={styles.context} data-testid="ai-conversation-context">
            {sourceFileName ? `当前文件 · ${sourceFileName}` : contextLabel}
          </p>
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
          stream.map((message, messageIndex) => {
            const timestamp = sidebarTimestampLabel(message.createdAt);
            const copyKey = `message:${message.messageId}`;
            const historyBoundary = historyBoundaryByIndex.get(messageIndex);
            return (
              <Fragment key={`${message.messageId || "message"}:${messageIndex}`}>
                {historyBoundary?.first ? (
                  <div
                    className={styles.historyGroup}
                    data-kind={historyBoundary.kind}
                    data-testid="ai-conversation-history-group"
                  >
                    {historyBoundary.label}
                  </div>
                ) : null}
                <article
                  className={styles.message}
                  data-actor={message.actor}
                  data-kind={message.kind}
                  data-status={message.status}
                  data-testid="ai-conversation-message"
                >
                  {message.actor === "pageroot" ? (
                    <PageRootAvatar />
                  ) : (
                    <span className={styles.avatar} aria-hidden="true">
                      {sidebarActorInitial(message.actor)}
                    </span>
                  )}
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
              </Fragment>
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
            <PageRootAvatar />
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
        {executionStatus || runProgress?.liveLabel || runProgress?.headline ? (
          <section
            className={`${styles.message} ${styles.runActivity}`}
            data-actor="pageroot"
            data-tone={runProgress?.tone || "quiet"}
            data-testid="ai-conversation-run-progress"
            aria-label="本轮进度"
          >
            <PageRootAvatar />
            {/*
              * PageRoot states the stages from the run's durable status (ADR 0037 §4).
              * Signing them with an Agent name made the Agent look like the author of
              * PageRoot's own bookkeeping, and put the brand mark on the wrong speaker.
            */}
            <span className={styles.actor}>PageRoot</span>
            <p
              className={`${styles.text} ${styles.liveStatus}`}
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              {executionStatus?.title || runProgress?.liveLabel || runProgress?.headline}
            </p>
            {executionStatus ? <small className={styles.runSummaryDetail}>{executionStatus.detail}</small> : null}
          </section>
        ) : null}

        {/* Public Agent narration grows in one stable article. It is presentation
            evidence only and never changes Candidate authority. */}
        {runProgress?.narrationUpdates || agentWorking ? (
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
            {runProgress?.narrationUpdates ? (
              <div
                className={styles.narrationText}
                data-testid="ai-conversation-narration"
              >
                {runProgress.narrationUpdates.map((update) => (
                  <p key={update.id} className={styles.narrationLine}>{update.text}</p>
                ))}
              </div>
            ) : null}
            {agentWorking ? (
              <span
                className={styles.thinking}
                role="status"
                aria-live="polite"
                aria-label={`${resolvedAgentActionName} 正在思考和处理`}
                data-testid="ai-conversation-thinking"
              >
                <span aria-hidden="true">Thinking</span>
                <span className={styles.thinkingDots} aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
              </span>
            ) : null}
            {liveTimestamp || runProgress?.narration ? (
              <div className={styles.messageMeta}>
                {liveTimestamp ? (
                  <time dateTime={agentUpdatedAt || agentStartedAt || undefined}>
                    {liveTimestamp}
                  </time>
                ) : null}
                <button
                  type="button"
                  onClick={() => copyMessage("live-agent", runProgress?.narration || "")}
                >
                  {copyFeedback?.key === "live-agent" ? copyFeedback.label : "复制"}
                </button>
              </div>
            ) : null}
            {runProgress?.narrationTruncated ? (
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
            <PageRootAvatar />
            <span className={styles.actor}>PageRoot</span>
            {actionBar.title ? (
              <strong
                {...(actionBar.kind === "decision"
                  ? { role: "status", "aria-live": "polite", "aria-atomic": "true" }
                  : {})}
              >
                {actionBar.title}
              </strong>
            ) : null}
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
                    disabled={action.disabled === true}
                    onClick={() => {
                      if (action.id === "replace-api-key" && agentAccess) {
                        const providerId = agentPresentation?.providerId
                          || agentAccess.cards[0]?.selection.providerId
                          || "";
                        agentAccess.onBeginAccessRepair?.("apiKey");
                        setSetupProviderId(providerId);
                        setOpenChoice(null);
                        return;
                      }
                      onAction?.(action.id);
                    }}
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
        {/*
          * The round's context summary belongs to the Composer, not to the fact
          * stream: it changes as the user works and must never be persisted as
          * a message.
          */}
        {(state === "preview-ready" || state === "no-change") && activeIntent === "modify" ? (
          <p
            className={styles.contextSummary}
            data-testid="ai-conversation-context-summary"
          >
            {`将发送：${pendingCommentCount} 条评论 · 当前 HTML · 项目规则`}
          </p>
        ) : null}
        {(state === "preview-ready" || state === "no-change") && send.reason ? (
          <p className={styles.sendReason} data-testid="ai-conversation-send-reason">
            {send.reason}
          </p>
        ) : null}

        <div className={styles.composerActions}>
          {showComposerIdentity ? <div className={styles.identityActions}>
            <div className={styles.agentSelector}>
              <button
                type="button"
                className={styles.schemeTrigger}
                data-testid="ai-conversation-agent"
                onClick={() => {
                  if (agentAccess?.cards.length) {
                    setOpenChoice((value) => (value === "service" ? null : "service"));
                    return;
                  }
                  onOpenAgentSettings?.();
                }}
                aria-expanded={openChoice === "service"}
                aria-controls="ai-conversation-service-choices"
                aria-label={`当前服务 ${serviceTriggerLabel}，选择 AI 服务`}
              >
                <AgentChoiceMark label={schemeName} logoSrc={agentPresentation?.logoSrc} />
                <span>{serviceTriggerLabel}</span>
                <span className={styles.agentChevron} aria-hidden="true">▾</span>
              </button>
              {openChoice === "service" && agentAccess?.cards.length ? (
                <div
                  id="ai-conversation-service-choices"
                  className={styles.agentChoices}
                  aria-label="选择 AI 服务"
                  data-testid="ai-conversation-service-choices"
                >
                  {agentAccess.cards.map((card) => {
                    const snapshot = card.presentation.availability(card.availability);
                    const disconnected = card.availability.reason === "disabled";
                    return (
                      <button
                        key={card.selection.providerId}
                        type="button"
                        aria-pressed={card.selection.providerId === currentProviderId}
                        className={styles.agentChoice}
                        data-testid={`ai-conversation-service-${card.selection.providerId}`}
                        onPointerDown={(event) => {
                          event.preventDefault();
                        }}
                        onClick={() => {
                          if (card.availability.status === "ready") {
                            agentAccess.onSelect(card.selection);
                            setOpenChoice(null);
                            setSetupProviderId(null);
                            return;
                          }
                          agentAccess.onQueueDefault?.(card.selection);
                          if (disconnected) void agentAccess.onReconnect?.(card.selection);
                          setSetupProviderId(card.selection.providerId);
                          setOpenChoice(null);
                        }}
                      >
                        <strong>{agentServiceLabel(card.selection.providerId, card.presentation.displayName)}</strong>
                        <span>{disconnected ? "已断开" : snapshot.statusLabel}</span>
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>

            <div ref={agentSelectorRef} className={styles.identityPickers}>
              <div className={styles.agentSelector}>
                {agentLine?.choosable ? (
                  <button
                    ref={agentSelectorButtonRef}
                    id="ai-conversation-model-selector"
                    type="button"
                    className={styles.agentTrigger}
                    data-testid="ai-conversation-model"
                    onClick={() => setOpenChoice((value) => (value === "model" ? null : "model"))}
                    aria-expanded={openChoice === "model"}
                    aria-controls="ai-conversation-model-choices"
                    aria-label={`当前模型 ${agentLine.text}，点击切换`}
                  >
                    <span>{agentLine.text}</span>
                    <span className={styles.agentChevron} aria-hidden="true">▾</span>
                  </button>
                ) : agentLine ? (
                  <span className={styles.agentStatic} data-testid="ai-conversation-model">
                    <span>{agentLine.text}</span>
                  </span>
                ) : null}

                {openChoice === "model" && models.length > 1 ? (
                  <div
                    id="ai-conversation-model-choices"
                    className={styles.agentChoices}
                    aria-label="选择模型"
                    data-testid="ai-conversation-model-choices"
                  >
                    {models.map((model) => (
                      <button
                        key={model.id}
                        type="button"
                        aria-pressed={model.id === (selectedModel?.id || selectedModelId)}
                        className={styles.agentChoice}
                        onPointerDown={(event) => {
                          event.preventDefault();
                        }}
                        onClick={() => {
                          agentSelectorButtonRef.current?.focus();
                          onSelectModel?.(model.id);
                          setOpenChoice(null);
                        }}
                      >
                        <strong>{model.displayName}</strong>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>

              {reasoningLine ? (
                <div className={styles.agentSelector}>
                  {reasoningLine.choosable ? (
                    <button
                      ref={reasoningSelectorButtonRef}
                      id="ai-conversation-reasoning-selector"
                      type="button"
                      className={styles.agentTrigger}
                      data-testid="ai-conversation-reasoning"
                      onClick={() => setOpenChoice((value) => (value === "reasoning" ? null : "reasoning"))}
                      aria-expanded={openChoice === "reasoning"}
                      aria-controls="ai-conversation-reasoning-choices"
                      aria-label={`当前思考深度 ${reasoningLine.text}，点击切换`}
                    >
                      <span>{reasoningLine.text}</span>
                      <span className={styles.agentChevron} aria-hidden="true">▾</span>
                    </button>
                  ) : (
                    <span className={styles.agentStatic} data-testid="ai-conversation-reasoning">
                      <span>{reasoningLine.text}</span>
                    </span>
                  )}

                  {openChoice === "reasoning" && reasoningChoices.length > 1 ? (
                    <div
                      id="ai-conversation-reasoning-choices"
                      className={styles.agentChoices}
                      aria-label="选择思考深度"
                      data-testid="ai-conversation-reasoning-choices"
                    >
                      {reasoningChoices.map((choice) => (
                        <button
                          key={choice.id}
                          type="button"
                          aria-pressed={choice.id === reasoningLine.selectedId}
                          className={styles.agentChoice}
                          onPointerDown={(event) => {
                            event.preventDefault();
                          }}
                          onClick={() => {
                            reasoningSelectorButtonRef.current?.focus();
                            onSelectReasoning?.(choice.id);
                            setOpenChoice(null);
                          }}
                        >
                          <strong>{choice.label}</strong>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div> : null}

          {(state === "preview-ready" || state === "no-change") ? (
          <div className={styles.deliveryActions}>
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
              send.label ? (
                <span
                  className={styles.sendStatus}
                  data-testid="ai-conversation-agent-status"
                  aria-live="polite"
                >
                  {send.label}
                </span>
              ) : null
            ) : (
              <button
                type="button"
                className={styles.send}
                data-testid="ai-conversation-send"
                disabled={send.kind === "send" && !send.canSend}
                onClick={() => {
                  if (send.kind === "open-agent-settings") {
                    if (agentAccess?.cards.length) {
                      const providerId = agentPresentation?.providerId
                        || agentAccess.cards[0]?.selection.providerId
                        || "";
                      setSetupProviderId(providerId);
                      setOpenChoice(null);
                      return;
                    }
                    onOpenAgentSettings?.();
                    return;
                  }
                  onSend?.();
                }}
              >
                {send.label}
              </button>
            )}
          </div>
          ) : null}
        </div>
        {recoveredOnOrigin || recoveredElsewhere ? (
          <p className={styles.recoveredBar} data-testid="ai-conversation-access-recovered">
            连接已恢复
            {recoveredOnOrigin ? (
              <button
                type="button"
                onClick={() => {
                  onAction?.("resend-agent");
                }}
              >
                重新发送
              </button>
            ) : (
              <span>不会对当前文件发送。</span>
            )}
          </p>
        ) : null}
        {setupCard && agentAccess ? (
          <div className={styles.setupPanel} data-testid="ai-conversation-setup-panel">
            <BoundAgentSetupPanel
              card={setupCard}
              surface="delivery"
              hideDisconnectAction
              initialApiKeyOpen={recovery?.field === "apiKey"}
              {...agentAccess.bindings}
            />
          </div>
        ) : null}
      </div>
    </aside>
  );
}
