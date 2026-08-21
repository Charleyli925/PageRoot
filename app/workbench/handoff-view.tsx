"use client";

import { ArrowCounterClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowCounterClockwise";
import { CaretRightIcon } from "@phosphor-icons/react/dist/csr/CaretRight";
import { CheckCircleIcon } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { ClockCounterClockwiseIcon } from "@phosphor-icons/react/dist/csr/ClockCounterClockwise";
import { CopyIcon } from "@phosphor-icons/react/dist/csr/Copy";
import { EyeIcon } from "@phosphor-icons/react/dist/csr/Eye";
import { FileIcon } from "@phosphor-icons/react/dist/csr/File";
import { FileHtmlIcon } from "@phosphor-icons/react/dist/csr/FileHtml";
import { FlagCheckeredIcon } from "@phosphor-icons/react/dist/csr/FlagCheckered";
import { FloppyDiskIcon } from "@phosphor-icons/react/dist/csr/FloppyDisk";
import { FolderOpenIcon } from "@phosphor-icons/react/dist/csr/FolderOpen";
import { GitDiffIcon } from "@phosphor-icons/react/dist/csr/GitDiff";
import { LockKeyIcon } from "@phosphor-icons/react/dist/csr/LockKey";
import { MinusCircleIcon } from "@phosphor-icons/react/dist/csr/MinusCircle";
import { PaperclipIcon } from "@phosphor-icons/react/dist/csr/Paperclip";
import { SealCheckIcon } from "@phosphor-icons/react/dist/csr/SealCheck";
import { ShieldCheckIcon } from "@phosphor-icons/react/dist/csr/ShieldCheck";
import { TriangleIcon } from "@phosphor-icons/react/dist/csr/Triangle";

import type {
  ActiveRun,
  RunProgressStep,
} from "../domain/run-lifecycle.js";
import { insertionLabel } from "./comment-model";
import type {
  CommentItem,
  QoderHandoffUiStatus,
} from "./types";

export function processStepStatusLabel(state: string): string {
  switch (state) {
    case "done":
      return "已完成";
    case "current":
      return "进行中";
    case "neutral":
      return "已结束";
    case "error":
      return "需处理";
    case "attention":
      return "待确认";
    default:
      return "待进行";
  }
}

function ProcessStepGlyph({
  stepKey,
  state,
}: {
  stepKey: string;
  state: string;
}) {
  if (state === "error") {
    return <TriangleIcon size={21} weight="fill" />;
  }
  if (state === "neutral") {
    return <MinusCircleIcon size={22} weight="duotone" />;
  }

  switch (stepKey) {
    case "handoff":
      return (
        <ShieldCheckIcon
          size={23}
          weight={state === "done" ? "fill" : "duotone"}
        />
      );
    case "validation":
      return <FloppyDiskIcon size={22} weight="regular" />;
    case "result":
      return <FlagCheckeredIcon size={22} weight="regular" />;
    default:
      return <ClockCounterClockwiseIcon size={22} weight="duotone" />;
  }
}

export function HandoffDrawerHeader({
  panelEyebrow,
  panelTitle,
  candidateVersionLabel,
}: {
  panelEyebrow: string;
  panelTitle: string;
  candidateVersionLabel?: string;
}) {
  return (
    <header className="drawer-header processing-header">
      <div className="processing-title">
        <span className="processing-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="./brand-logo.png" alt="" />
        </span>
        <span>
          <small>{panelEyebrow}</small>
          <strong>{panelTitle}</strong>
        </span>
      </div>
      <div className="processing-header-actions">
        <span className="round-version">
          {candidateVersionLabel || "下一版"}
        </span>
      </div>
    </header>
  );
}

export function HandoffPanel({
  activeRun,
  terminalRun,
  processSummaryTitle,
  processSummaryDetail,
  processStatusLabel,
  processSteps,
  activeCommentCount,
  activeCommentItems,
  runBasisLabel,
  runSubmittedLabel,
  pendingRunOutcome,
  canRevealAiTask,
  onRevealAiTask,
  onRetrySubmission,
  onCancelRun,
}: {
  activeRun: ActiveRun | null;
  terminalRun: boolean;
  processSummaryTitle: string;
  processSummaryDetail: string;
  processStatusLabel: string;
  processSteps: RunProgressStep[];
  activeCommentCount: number;
  activeCommentItems: CommentItem[];
  runBasisLabel: string;
  runSubmittedLabel: string;
  pendingRunOutcome: boolean;
  canRevealAiTask: boolean;
  onRevealAiTask: () => void;
  onRetrySubmission?: () => void;
  onCancelRun?: () => void;
}) {
  const continuityNeedsReview =
    activeRun?.candidateAssessment?.status === "attention";
  const summaryTone = activeRun?.status === "error"
    ? "error"
    : continuityNeedsReview
      ? "attention"
      : activeRun?.status === "no-change"
        ? "neutral"
        : activeRun?.status === "ready-to-open"
          ? "ready"
        : terminalRun
          ? "neutral"
          : "processing";
  return (
    <div className="handoff-panel">
      {activeRun ? (
        <>
          <div className="processing-summary-bar" data-tone={summaryTone}>
            <div>
              {activeRun.status === "error" || continuityNeedsReview ? (
                <TriangleIcon aria-hidden="true" size={19} weight="duotone" />
              ) : (
                <LockKeyIcon aria-hidden="true" size={19} weight="duotone" />
              )}
              <span>
                <strong>{processSummaryTitle}</strong>
                <small>{processSummaryDetail}</small>
              </span>
            </div>
            <span className="status-chip" data-tone={summaryTone}>
              <span aria-hidden="true" />
              {processStatusLabel}
            </span>
          </div>

          <div className="processing-content">
            <section
              className="handoff-process-board timeline-panel"
              data-status={activeRun.status}
              aria-live="polite"
            >
              <header>
                <span>本轮流程</span>
                <strong>
                  {processSteps.length} 个阶段 · 已完成{" "}
                  {processSteps.filter((step) => step.state === "done").length}
                  {" "}个
                </strong>
              </header>
              <ol>
                {processSteps.map((step, index) => (
                  <li key={step.key} data-state={step.state}>
                    <span className="process-step-index" aria-hidden="true">
                      {index + 1}
                    </span>
                    <span className="process-step-icon" aria-hidden="true">
                      <ProcessStepGlyph
                        stepKey={step.key}
                        state={step.state}
                      />
                    </span>
                    <span className="process-step-copy">
                      <strong>{step.label}</strong>
                      <small>{step.detail}</small>
                    </span>
                    <span
                      className="process-step-status"
                      data-state={step.state}
                    >
                      {step.state === "done" ? (
                        <>
                          <CheckCircleIcon
                            aria-hidden="true"
                            size={22}
                            weight="regular"
                          />
                          <span className="sr-only">
                            {processStepStatusLabel(step.state)}
                          </span>
                        </>
                      ) : processStepStatusLabel(step.state)}
                    </span>
                  </li>
                ))}
              </ol>
            </section>

            <section className="round-detail-panel" aria-label="本轮记录">
              <header>
                <div>
                  <span>本轮记录</span>
                  <strong>{activeCommentCount} 条评论</strong>
                </div>
                <SealCheckIcon aria-hidden="true" size={24} weight="duotone" />
              </header>
              <div className="round-facts">
                <div><span>基于版本</span><strong>{runBasisLabel}</strong></div>
                <div><span>目标版本</span><strong>{activeRun.candidateVersionLabel}</strong></div>
                <div><span>提交时间</span><strong>{runSubmittedLabel}</strong></div>
              </div>
              <div className="round-comment-list">
                {activeCommentItems.map((comment, index) => (
                  <article key={comment.commentId}>
                    <span>{index + 1}</span>
                    <div>
                      <strong>{insertionLabel(comment.target)}</strong>
                      <p>{comment.text || "已添加参考附件"}</p>
                      {comment.attachments?.length ? (
                        <small>
                          <PaperclipIcon
                            aria-hidden="true"
                            size={12}
                            weight="bold"
                          />
                          {comment.attachments.length} 个附件
                        </small>
                      ) : null}
                    </div>
                  </article>
                ))}
              </div>
              {canRevealAiTask ? (
                <button
                  className="handoff-folder-link finder-link"
                  type="button"
                  onClick={onRevealAiTask}
                >
                  <FolderOpenIcon
                    aria-hidden="true"
                    size={18}
                    weight="duotone"
                  />
                  <span>在文件夹中打开 AI任务</span>
                  <CaretRightIcon aria-hidden="true" size={14} weight="bold" />
                </button>
              ) : null}
            </section>
          </div>

          <div className="processing-decisions">
            {continuityNeedsReview
              && activeRun.status === "ready-to-open" ? (
              <section className="validation-decision" data-tone="attention" role="status">
                <strong>页面变化较大，建议先审阅</strong>
                <p>
                  HTML 可以正常打开，但系统找到的上一版共同特征较少。
                  候选版本已经保留，请先对比审阅再决定是否采用。
                </p>
              </section>
            ) : null}
            {activeRun.status === "awaiting-conflict-resolution" ? (
              <section className="ai-conflict-panel" role="alert">
                <strong>请选择哪份内容成为当前 HTML</strong>
                <p>外部文件和 AI 候选都已保留，系统不会静默覆盖任一侧。</p>
                {activeRun.error ? <small>{activeRun.error}</small> : null}
              </section>
            ) : null}
            {activeRun.status === "recovering-transaction" ? (
              <section className="ai-conflict-panel" role="status">
                <strong>正在恢复尚未保存完成的修改</strong>
                <p>恢复完成前页面保持只读，评论和修改记录不会丢失。</p>
              </section>
            ) : null}
            {pendingRunOutcome ? (
              <section className="ai-conflict-panel" role="status">
                <strong>正在确认这次发送是否成功</strong>
                <p>源页会在后台继续核对，不会重复发送同一轮要求。</p>
              </section>
            ) : null}
            {!pendingRunOutcome
              && activeRun.status === "ready-to-open"
              && activeRun.error ? (
              <section className="validation-decision" role="status">
                <strong>最新版仍已安全保留</strong>
                <p>{activeRun.error} 可在下方再次打开，不需要重新生成。</p>
              </section>
            ) : null}
            {!pendingRunOutcome && activeRun.status === "no-change" ? (
              <section className="validation-decision" data-tone="neutral" role="status">
                <strong>这次没有可采用的变化</strong>
                <p>没有创建新版本。原评论、附件和当前 HTML 都已保留。</p>
              </section>
            ) : null}
            {!pendingRunOutcome && activeRun.status === "error" ? (
              <section className="validation-decision" data-tone="error" role="alert">
                <strong>本轮没有改动当前 HTML</strong>
                <p>{activeRun.errorDetail || activeRun.error || "结果没有通过安全检查。"}</p>
                {activeRun.recoveryHint ? <small>{activeRun.recoveryHint}</small> : null}
                <div className="validation-decision-actions">
                  {onRetrySubmission ? (
                    <button type="button" className="primary-action" onClick={onRetrySubmission}>
                      重新发送
                    </button>
                  ) : null}
                  {onCancelRun ? (
                    <button type="button" className="cancel-action" onClick={onCancelRun}>
                      取消本轮
                    </button>
                  ) : null}
                </div>
                {activeRun.errorPreview ? (
                  <details className="ai-output-preview">
                    <summary>查看 AI 原始输出</summary>
                    <pre>{activeRun.errorPreview}</pre>
                  </details>
                ) : null}
              </section>
            ) : null}
          </div>
        </>
      ) : (
        <div className="drawer-empty">
          发送评论后，这里会显示处理进度和本轮记录。
        </div>
      )}
    </div>
  );
}

export function HandoffFooter({
  activeRun,
  reviewPreparing,
  openingReadyVersion,
  pendingRunOutcome,
  pendingReconcileBusy,
  handoffCopyFailed,
  currentQoderHandoffStatus,
  currentDeliveryMode,
  cancelling,
  resolvingConflict,
  checkingRun,
  terminalRun,
  canRevealAiTask,
  onReviewReadyResult,
  onActivateReadyResult,
  onSend,
  onCopyFallback,
  onCancel,
  onResolveConflict,
  onRevealAiTask,
  onReturnToEditing,
  onRequestEnd,
  onPreviewSentHtml,
}: {
  activeRun: ActiveRun;
  reviewPreparing: boolean;
  openingReadyVersion: boolean;
  pendingRunOutcome: boolean;
  pendingReconcileBusy: boolean;
  handoffCopyFailed: boolean;
  currentQoderHandoffStatus: QoderHandoffUiStatus | "idle";
  currentDeliveryMode: "clipboard" | "qoder-acp";
  cancelling: boolean;
  resolvingConflict: boolean;
  checkingRun: boolean;
  terminalRun: boolean;
  canRevealAiTask: boolean;
  onReviewReadyResult: () => void;
  onActivateReadyResult: () => void;
  onSend: () => void;
  onCopyFallback: () => void;
  onCancel: () => void;
  onResolveConflict: (choice: "adopt-ai" | "keep-external") => void;
  onRevealAiTask: () => void;
  onReturnToEditing: () => void;
  onRequestEnd: () => void;
  onPreviewSentHtml: () => void;
}) {
  return (
    <footer className="processing-footer">
      {activeRun.status === "ready-to-open" ? (
        <>
          <button
            className="primary-action"
            type="button"
            disabled={reviewPreparing || openingReadyVersion || !activeRun.readyPayload}
            onClick={onReviewReadyResult}
          >
            <GitDiffIcon aria-hidden="true" size={18} weight="bold" />
            {reviewPreparing ? "正在准备对比…" : "审阅对比"}
          </button>
          {activeRun.candidateAssessment?.status !== "attention" ? (
            <button
              className="secondary-action"
              type="button"
              disabled={reviewPreparing || openingReadyVersion || !activeRun.readyPayload}
              onClick={onActivateReadyResult}
            >
              <FileHtmlIcon aria-hidden="true" size={18} weight="duotone" />
              {openingReadyVersion ? "正在采纳并核对…" : "采纳并打开"}
            </button>
          ) : null}
        </>
      ) : pendingRunOutcome ? (
        <span className="processing-auto-status" role="status">
          {pendingReconcileBusy
            ? "正在自动确认发送结果…"
            : "等待下一次自动确认…"}
        </span>
      ) : handoffCopyFailed ? (
        <>
          <button
            className="primary-action"
            type="button"
            disabled={
              !activeRun.handoffMessage
              || currentQoderHandoffStatus === "copying"
              || currentQoderHandoffStatus === "starting"
            }
            onClick={onSend}
          >
            {currentDeliveryMode === "qoder-acp" ? (
              <ShieldCheckIcon aria-hidden="true" size={18} weight="duotone" />
            ) : (
              <CopyIcon aria-hidden="true" size={18} weight="bold" />
            )}
            {currentDeliveryMode === "qoder-acp" ? "重新启动 Qoder" : "重新复制"}
          </button>
          {currentDeliveryMode === "qoder-acp" ? (
            <button
              className="secondary-action"
              type="button"
              onClick={onCopyFallback}
            >
              <CopyIcon aria-hidden="true" size={18} weight="bold" />
              复制任务
            </button>
          ) : null}
          <button
            className="cancel-action"
            type="button"
            disabled={cancelling}
            onClick={onCancel}
          >
            <ArrowCounterClockwiseIcon
              aria-hidden="true"
              size={17}
              weight="bold"
            />
            {cancelling ? "正在取消…" : "取消本轮"}
          </button>
        </>
      ) : activeRun.status === "awaiting-conflict-resolution" ? (
        <>
          <button
            className="primary-action"
            type="button"
            disabled={resolvingConflict}
            onClick={() => onResolveConflict("adopt-ai")}
          >
            <FileHtmlIcon aria-hidden="true" size={18} weight="duotone" />
            {resolvingConflict ? "正在处理…" : "采用 AI 版本"}
          </button>
          <button
            className="secondary-action"
            type="button"
            disabled={resolvingConflict}
            onClick={() => onResolveConflict("keep-external")}
          >
            <FileIcon aria-hidden="true" size={17} weight="duotone" />
            保留外部版本
          </button>
        </>
      ) : checkingRun ? (
        <button
          className="secondary-action"
          type="button"
          disabled={!canRevealAiTask}
          onClick={onRevealAiTask}
        >
          <FolderOpenIcon aria-hidden="true" size={18} weight="duotone" />
          查看 AI任务
        </button>
      ) : terminalRun ? (
        <button
          className="primary-action"
          type="button"
          onClick={onReturnToEditing}
        >
          <ArrowCounterClockwiseIcon
            aria-hidden="true"
            size={17}
            weight="bold"
          />
          返回编辑
        </button>
      ) : currentDeliveryMode === "qoder-acp" ? (
        <>
          <button
            className="cancel-action"
            type="button"
            disabled={
              cancelling
              || activeRun.requestId === "pending"
              || currentQoderHandoffStatus === "cancelling"
            }
            onClick={onRequestEnd}
          >
            <ArrowCounterClockwiseIcon aria-hidden="true" size={17} weight="bold" />
            {cancelling
              ? "正在结束本轮…"
              : ["failed", "interrupted"].includes(currentQoderHandoffStatus)
                ? "结束本轮并返回编辑"
                : "停止 Qoder 并继续编辑"}
          </button>
          <button
            className="secondary-action"
            type="button"
            onClick={onPreviewSentHtml}
          >
            <EyeIcon aria-hidden="true" size={17} weight="bold" />
            预览已发送 HTML
          </button>
        </>
      ) : (
        <>
          <button
            className="cancel-action"
            type="button"
            disabled={
              cancelling
              || activeRun.requestId === "pending"
              || currentQoderHandoffStatus === "copying"
            }
            onClick={onRequestEnd}
          >
            <ArrowCounterClockwiseIcon
              aria-hidden="true"
              size={17}
              weight="bold"
            />
            {cancelling ? "正在恢复编辑…" : "结束本轮并继续编辑"}
          </button>
          <button
            className="secondary-action"
            type="button"
            onClick={onPreviewSentHtml}
          >
            <EyeIcon aria-hidden="true" size={17} weight="bold" />
            预览已发送 HTML
          </button>
          <button
            className="primary-action"
            type="button"
            disabled={
              !activeRun.handoffMessage
              || currentQoderHandoffStatus === "copying"
            }
            onClick={onSend}
          >
            <CopyIcon aria-hidden="true" size={18} weight="bold" />
            {currentQoderHandoffStatus === "copying"
              ? "正在复制并核对…"
              : currentQoderHandoffStatus === "failed"
                ? "重新复制本轮要求"
                : "再次复制本轮要求"}
          </button>
        </>
      )}
    </footer>
  );
}
