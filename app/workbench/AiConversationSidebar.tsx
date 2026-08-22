"use client";

import { useMemo, useRef, type ChangeEvent } from "react";

import {
  sidebarActionBar,
  sidebarDiscussionNotice,
  sidebarDraftNotice,
  sidebarIntentOptions,
  sidebarMessageStream,
  sidebarModePresentation,
  sidebarResolvedIntent,
  sidebarSendState,
  type SidebarCatalogStatus,
  type SidebarIntent,
} from "./ai-conversation-model.js";
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
//   - The Composer holds every mutable control: the intent switch, the round's
//     context summary, model selection, input and send.
//
// This component is presentation only. It owns no durable state and reaches no
// Bridge; the workflow layer supplies data and receives intents.

export type AiConversationSidebarProps = {
  state: string;
  title: string;
  messages: readonly unknown[];
  draftText: string;
  intent: SidebarIntent;
  catalogStatus?: SidebarCatalogStatus;
  modelDisplayName?: string | null;
  modelChoiceCount?: number;
  candidateVersionLabel?: string | null;
  candidateStatus?: string | null;
  failureMessage?: string | null;
  contextLabel?: string | null;
  pendingCommentCount?: number;
  queued?: boolean;
  loading?: boolean;
  discussion?: {
    status?: string;
    interrupted?: boolean;
    interruptedReason?: string | null;
  } | null;
  onIntentChange?: (intent: SidebarIntent) => void;
  onDraftChange?: (text: string) => void;
  onSend?: (intent: SidebarIntent) => void;
  onAction?: (actionId: string) => void;
  onOpenModelChoices?: () => void;
  onCollapse?: () => void;
};

export default function AiConversationSidebar({
  state,
  title,
  messages,
  draftText,
  intent,
  catalogStatus = "ready",
  modelDisplayName = null,
  modelChoiceCount = 0,
  candidateVersionLabel = null,
  candidateStatus = null,
  failureMessage = null,
  contextLabel = null,
  pendingCommentCount = 0,
  queued = false,
  loading = false,
  discussion = null,
  onIntentChange,
  onDraftChange,
  onSend,
  onAction,
  onOpenModelChoices,
  onCollapse,
}: AiConversationSidebarProps) {
  const intentOptionsRef = useRef<HTMLDivElement>(null);
  const mode = sidebarModePresentation(state);
  const stream = useMemo(() => sidebarMessageStream(messages), [messages]);
  const intentOptions = useMemo(() => sidebarIntentOptions(state), [state]);
  const activeIntent = sidebarResolvedIntent(state, intent);
  const actionBar = useMemo(
    () => sidebarActionBar({
      state,
      candidateVersionLabel,
      candidateStatus,
      failureMessage,
    }),
    [candidateStatus, candidateVersionLabel, failureMessage, state],
  );
  const send = sidebarSendState({
    state,
    catalogStatus,
    hasText: draftText.trim().length > 0,
    queued,
    intent: activeIntent,
    discussionBusy: discussion?.status === "starting"
      || discussion?.status === "running"
      || discussion?.status === "cancelling",
  });
  const draftNotice = sidebarDraftNotice(state);
  const discussionNotice = sidebarDiscussionNotice(discussion);

  // The intent switch is a radio group: arrow keys, Home and End move between
  // its options, and the pressed state is exposed rather than implied by colour.
  const moveIntent = (offset: number) => {
    const index = intentOptions.findIndex(
      (option) => option.value === activeIntent,
    );
    const next = intentOptions[
      (index + offset + intentOptions.length) % intentOptions.length
    ];
    if (next) onIntentChange?.(next.value);
  };

  return (
    <aside
      className={styles.sidebar}
      aria-label="AI 对话"
      data-state={state}
      data-testid="ai-conversation-sidebar"
    >
      <header className={styles.header}>
        <div className={styles.headerTitle}>
          <strong data-testid="ai-conversation-title">{title || "AI 对话"}</strong>
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
            aria-label="收起 AI 对话"
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
        className={styles.stream}
        role="log"
        aria-live="polite"
        aria-busy={loading}
        aria-label="对话记录"
        data-testid="ai-conversation-stream"
      >
        {loading ? (
          <p className={styles.placeholder}>正在读取这份文档的对话…</p>
        ) : stream.length === 0 ? (
          <p className={styles.placeholder}>
            还没有对话。说说你想改哪里，或者先问问这个页面。
          </p>
        ) : (
          stream.map((message) => (
            <article
              key={message.messageId}
              className={styles.message}
              data-actor={message.actor}
              data-kind={message.kind}
              data-status={message.status}
              data-testid="ai-conversation-message"
            >
              <span className={styles.actor}>{message.actorLabel}</span>
              <p className={styles.text}>{message.text}</p>
              {message.truncated ? (
                <small className={styles.truncated}>部分内容已省略</small>
              ) : null}
              {message.status === "interrupted" ? (
                <small className={styles.interrupted}>这条回复没有完成</small>
              ) : null}
            </article>
          ))
        )}
      </div>

      {/*
        * The action bar never scrolls away, so a pending decision is always in
        * view. It occupies no space when there is nothing to decide.
        */}
      {actionBar ? (
        <section
          className={styles.actionBar}
          data-kind={actionBar.kind}
          data-testid="ai-conversation-action-bar"
          aria-label="当前待决定"
        >
          <strong>{actionBar.title}</strong>
          <p>{actionBar.detail}</p>
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

      <div className={styles.composer} data-testid="ai-conversation-composer">
        <div className={styles.composerTop}>
          <div
            ref={intentOptionsRef}
            className={styles.intent}
            role="radiogroup"
            aria-label="本次发送的意图"
            data-testid="ai-conversation-intent"
          >
            {intentOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={option.value === activeIntent}
                data-selected={option.value === activeIntent ? "true" : undefined}
                className={styles.intentOption}
                tabIndex={option.value === activeIntent ? 0 : -1}
                onClick={() => onIntentChange?.(option.value)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowRight" || event.key === "ArrowDown") {
                    event.preventDefault();
                    moveIntent(1);
                  } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
                    event.preventDefault();
                    moveIntent(-1);
                  } else if (event.key === "Home") {
                    event.preventDefault();
                    onIntentChange?.(intentOptions[0].value);
                  } else if (event.key === "End") {
                    event.preventDefault();
                    onIntentChange?.(
                      intentOptions[intentOptions.length - 1].value,
                    );
                  }
                }}
              >
                {option.label}
              </button>
            ))}
          </div>

          {/*
            * The model is a quiet inline affordance. With a single usable model
            * it is plain text: offering a dropdown that opens onto one item
            * would promise a choice the user does not have.
            */}
          {modelChoiceCount > 1 ? (
            <button
              type="button"
              className={styles.model}
              data-testid="ai-conversation-model"
              onClick={onOpenModelChoices}
              aria-label={`当前模型 ${modelDisplayName || "未选择"}，点击切换`}
            >
              {modelDisplayName || "选择模型"}
              <span aria-hidden="true">▾</span>
            </button>
          ) : (
            <span className={styles.modelStatic} data-testid="ai-conversation-model">
              {catalogStatus === "checking"
                ? "正在读取模型…"
                : modelDisplayName || "暂无可用模型"}
            </span>
          )}
        </div>

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
        {activeIntent === "continue" ? (
          <p
            className={styles.contextSummary}
            data-testid="ai-conversation-context-summary"
          >
            需要先采用当前结果，才能在它的基础上继续修改。修改前版本、本轮对话和候选记录都会保留。
          </p>
        ) : null}

        <label className={styles.inputLabel} htmlFor="ai-conversation-input">
          输入内容
        </label>
        <textarea
          id="ai-conversation-input"
          className={styles.input}
          data-testid="ai-conversation-input"
          value={draftText}
          rows={3}
          placeholder={activeIntent === "discuss"
            ? "问问这个页面…"
            : "说说你想怎么改…"}
          onChange={(event: ChangeEvent<HTMLTextAreaElement>) => (
            onDraftChange?.(event.target.value)
          )}
        />

        {draftNotice ? (
          <p className={styles.draftNotice} data-testid="ai-conversation-draft-notice">
            {draftNotice}
          </p>
        ) : null}

        {/*
          * The discussion turn's own line. An interrupted turn says so here
          * rather than letting partial text read as a finished answer.
          */}
        {discussionNotice ? (
          <p
            className={styles.draftNotice}
            data-tone={discussionNotice.tone}
            data-testid="ai-conversation-discussion-notice"
            role={discussionNotice.tone === "attention" ? "status" : undefined}
          >
            {discussionNotice.text}
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
          <button
            type="button"
            className={styles.send}
            data-testid="ai-conversation-send"
            disabled={!send.canSend}
            onClick={() => onSend?.(activeIntent)}
          >
            {activeIntent === "modify"
              ? "交给 AI 修改"
              : activeIntent === "continue"
                ? "采用并继续"
                : send.label}
          </button>
        </div>
      </div>
    </aside>
  );
}
