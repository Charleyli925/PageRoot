"use client";

import {
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { ArrowCounterClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowCounterClockwise";
import { CaretRightIcon } from "@phosphor-icons/react/dist/csr/CaretRight";
import { EyeIcon } from "@phosphor-icons/react/dist/csr/Eye";
import { FileIcon } from "@phosphor-icons/react/dist/csr/File";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import {
  formatFileSize,
  insertionLabel,
  targetResolutionLabel,
} from "./comment-model";
import { formatTime } from "./project-model";
import {
  changeKindLabel,
  historyRecordValue,
  summarizeChangeEvents,
} from "./version-model";
import type { CommentAttachment, Version } from "./types";

const PREVIEW_NAVIGATION_AUTO_COLLAPSE_MS = 3_500;

export function PreviewNavigationBanner({
  icon,
  title,
  detail,
  actionLabel,
  actionDisabled = false,
  className,
  onAction,
}: {
  icon: ReactNode;
  title: ReactNode;
  detail: ReactNode;
  actionLabel: string;
  actionDisabled?: boolean;
  className?: string;
  onAction: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);

  useEffect(() => {
    if (collapsed || focusWithin) return;
    const timer = window.setTimeout(() => {
      setCollapsed(true);
    }, PREVIEW_NAVIGATION_AUTO_COLLAPSE_MS);
    return () => window.clearTimeout(timer);
  }, [collapsed, focusWithin]);

  return (
    <section
      className={[
        "history-view-banner",
        "preview-navigation-banner",
        className,
      ].filter(Boolean).join(" ")}
      data-collapsed={collapsed ? "true" : "false"}
      role="status"
      onMouseEnter={() => setCollapsed(false)}
      onMouseMove={() => {
        if (collapsed) setCollapsed(false);
      }}
      onFocusCapture={() => {
        setFocusWithin(true);
        setCollapsed(false);
      }}
      onBlurCapture={(event) => {
        const next = event.relatedTarget;
        if (!(next instanceof Node) || !event.currentTarget.contains(next)) {
          setFocusWithin(false);
        }
      }}
    >
      <div>
        {icon}
        <span>
          <strong>{title}</strong>
          <small>{detail}</small>
        </span>
      </div>
      <button
        type="button"
        disabled={actionDisabled}
        onClick={onAction}
      >
        <ArrowCounterClockwiseIcon aria-hidden="true" size={15} weight="bold" />
        {actionLabel}
      </button>
      <button
        className="preview-banner-reveal"
        type="button"
        aria-label="显示预览导航提示"
        onClick={() => setCollapsed(false)}
      />
    </section>
  );
}

export function CommentAttachmentStrip({
  attachments,
  objectUrls,
  editable = false,
  onEnsurePreview,
  onPreview,
  onDownload,
  onRemove,
}: {
  attachments?: CommentAttachment[];
  objectUrls: Record<string, string>;
  editable?: boolean;
  onEnsurePreview?: (
    attachment: CommentAttachment,
  ) => Promise<string> | void;
  onPreview: (attachment: CommentAttachment) => void;
  onDownload: (attachment: CommentAttachment) => void;
  onRemove?: (attachment: CommentAttachment) => void;
}) {
  useEffect(() => {
    if (!onEnsurePreview) return;
    for (const attachment of attachments ?? []) {
      if (
        attachment.kind !== "image"
        || objectUrls[attachment.attachmentId]
      ) continue;
      void Promise.resolve(onEnsurePreview(attachment)).catch(() => {});
    }
  }, [attachments, objectUrls, onEnsurePreview]);

  if (!attachments?.length) return null;
  return (
    <div
      className="comment-attachments"
      aria-label={`${attachments.length} 个附件`}
    >
      {attachments.map((attachment) => (
        attachment.kind === "image" ? (
          <div className="image-attachment" key={attachment.attachmentId}>
            <button
              className="image-attachment-preview"
              type="button"
              title={`预览 ${attachment.fileName}`}
              aria-label={`预览图片 ${attachment.fileName}`}
              onClick={(event) => {
                event.stopPropagation();
                onPreview(attachment);
              }}
            >
              {objectUrls[attachment.attachmentId] ? (
                // Blob URLs are project-local attachment previews and cannot use next/image.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={objectUrls[attachment.attachmentId]}
                  alt={attachment.fileName}
                />
              ) : (
                <span className="attachment-loading">读取中…</span>
              )}
              <span className="image-attachment-name">
                {attachment.fileName}
              </span>
            </button>
            {editable && onRemove ? (
              <button
                className="remove-attachment-button"
                type="button"
                title="移除图片"
                aria-label={`移除图片 ${attachment.fileName}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onRemove(attachment);
                }}
              >
                <XIcon aria-hidden="true" size={11} weight="bold" />
              </button>
            ) : null}
          </div>
        ) : (
          <div className="file-attachment" key={attachment.attachmentId}>
            <button
              className="file-attachment-open"
              type="button"
              title={`下载 ${attachment.fileName}`}
              onClick={(event) => {
                event.stopPropagation();
                onDownload(attachment);
              }}
            >
              <FileIcon aria-hidden="true" size={15} weight="regular" />
              <span>
                <strong>{attachment.fileName}</strong>
                <small>{formatFileSize(attachment.byteLength)}</small>
              </span>
            </button>
            {editable && onRemove ? (
              <button
                className="remove-file-attachment-button"
                type="button"
                title="移除文件"
                aria-label={`移除文件 ${attachment.fileName}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onRemove(attachment);
                }}
              >
                <XIcon aria-hidden="true" size={11} weight="bold" />
              </button>
            ) : null}
          </div>
        )
      ))}
    </div>
  );
}

export function HistoryVersionItem({
  version,
  expanded,
  current,
  viewing,
  viewDisabled,
  attachmentObjectUrls,
  onToggle,
  onView,
  onReveal,
  onEnsureAttachmentPreview,
  onPreviewAttachment,
  onDownloadAttachment,
}: {
  version: Version;
  expanded: boolean;
  current: boolean;
  viewing: boolean;
  viewDisabled: boolean;
  attachmentObjectUrls: Record<string, string>;
  onToggle: () => void;
  onView: () => void;
  onReveal?: () => void;
  onEnsureAttachmentPreview: (
    attachment: CommentAttachment,
  ) => Promise<string>;
  onPreviewAttachment: (attachment: CommentAttachment) => void;
  onDownloadAttachment: (attachment: CommentAttachment) => void;
}) {
  const attachmentCount = version.comments.reduce(
    (count, comment) => count + (comment.attachments?.length ?? 0),
    0,
  );
  const summarizedEdits = summarizeChangeEvents(version.directEdits);

  return (
    <article
      className="history-item version-entry"
      data-current={current ? "true" : undefined}
    >
      <button
        className="version-row"
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
      >
        <span className="version-index">V{version.ordinal}</span>
        <span>
          <strong>{version.label}</strong>
          <small>
            {version.ordinal === 1
              ? "原始导入"
              : `${version.comments.length} 条评论 · 已安全保留`}
          </small>
        </span>
        <time dateTime={version.generatedAt}>
          {formatTime(version.generatedAt)}
        </time>
        <CaretRightIcon aria-hidden="true" size={14} weight="bold" />
      </button>
      {expanded ? (
        <section
          className="version-inline-detail"
          aria-label={`${version.label} 详情`}
        >
          <header>
            <span>{viewing ? "当前浏览" : "只读备份"}</span>
            <small>{formatTime(version.generatedAt, true)} 保存</small>
          </header>
          <div className="version-summary-facts">
            <div><strong>{version.comments.length}</strong><span>条评论</span></div>
            <div><strong>{attachmentCount}</strong><span>个附件</span></div>
            <div><strong>网页</strong><span>画布类型</span></div>
          </div>
          <div className="version-change-summary">
            <strong>这个版本包含</strong>
            <ul>
              <li>{version.summary || "完整 HTML 内容与页面结构"}</li>
              <li>评论、图片与附件的完整保留</li>
              <li>
                {version.candidateAssessment?.status === "blocked"
                  ? "旧版候选按当前安全规则复核后需要注意"
                  : version.candidateAssessment?.status === "attention"
                  ? "HTML 可以打开，版本连续性已标记为需审阅"
                  : version.candidateAssessment
                    ? "HTML 可用性与版本连续性已检查"
                    : version.validationReview
                      ? "旧版范围校验记录已归档"
                      : "版本与文件完整性已校验"}
              </li>
            </ul>
          </div>
          {version.comments.length > 0
            || version.directEdits.length > 0
            || version.supplements.length > 0
            || version.candidateAssessment
            || version.validationReview ? (
            <details className="history-records">
              <summary>查看本版修改来源与校验</summary>
              <section className="history-source-group">
                <header>
                  <strong>源页原始评论</strong>
                  <span>{version.comments.length}</span>
                </header>
                {version.comments.map((comment) => (
                  <article className="history-record" key={comment.commentId}>
                    <div>
                      <strong>{insertionLabel(comment.target)}</strong>
                      <span
                        className="target-resolution"
                        data-resolution={comment.target.resolution}
                      >
                        {targetResolutionLabel(comment.target.resolution)}
                      </span>
                      <time dateTime={comment.updatedAt || comment.createdAt}>
                        {formatTime(
                          comment.updatedAt || comment.createdAt,
                          true,
                        )}
                      </time>
                    </div>
                    {comment.text ? <p>{comment.text}</p> : null}
                    <CommentAttachmentStrip
                      attachments={comment.attachments}
                      objectUrls={attachmentObjectUrls}
                      onEnsurePreview={onEnsureAttachmentPreview}
                      onPreview={onPreviewAttachment}
                      onDownload={onDownloadAttachment}
                    />
                  </article>
                ))}
                {version.comments.length === 0
                  ? <small>本版没有源页评论。</small>
                  : null}
              </section>
              <section className="history-source-group">
                <header>
                  <strong>内部 AI 对话补充</strong>
                  <span>{version.supplements.length}</span>
                </header>
                {version.supplements.map((supplement) => (
                  <article className="history-record" key={supplement.recordId}>
                    <div>
                      <strong>
                        {supplement.action === "add"
                          ? "新增要求"
                          : supplement.action === "amend"
                            ? "补充修改"
                            : "撤回要求"}
                      </strong>
                      <time dateTime={supplement.createdAt}>
                        {formatTime(supplement.createdAt, true)}
                      </time>
                    </div>
                    <p>{supplement.text}</p>
                    {supplement.attachments.length > 0 ? (
                      <small>
                        已归档原件：
                        {supplement.attachments
                          .map((item) => item.fileName)
                          .join("、")}
                      </small>
                    ) : supplement.evidenceState === "description-only" ? (
                      <small>
                        原件未归档 · {supplement.evidenceDescription}
                      </small>
                    ) : null}
                  </article>
                ))}
                {version.supplements.length === 0
                  ? <small>本版没有内部 AI 对话补充。</small>
                  : null}
              </section>
              <section className="history-source-group">
                <header>
                  <strong>本地编辑</strong>
                  <span>{summarizedEdits.length}</span>
                </header>
                {summarizedEdits.map((event) => (
                  <article
                    className="history-record history-change-record"
                    key={event.eventId}
                  >
                    <div>
                      <strong>
                        {changeKindLabel(event)} · {insertionLabel(event.target)}
                      </strong>
                      <time dateTime={event.createdAt}>
                        {formatTime(event.createdAt, true)}
                      </time>
                    </div>
                    <div className="history-change-values">
                      <span>
                        <small>修改前</small>
                        <del>{historyRecordValue(event, event.before)}</del>
                      </span>
                      <CaretRightIcon
                        aria-hidden="true"
                        size={14}
                        weight="bold"
                      />
                      <span>
                        <small>修改后</small>
                        <ins>{historyRecordValue(event, event.after)}</ins>
                      </span>
                    </div>
                  </article>
                ))}
                {version.directEdits.length === 0
                  ? <small>本版没有本地编辑。</small>
                  : null}
              </section>
              <section className="history-source-group">
                <header>
                  <strong>AI 结果与校验</strong>
                  <span>已归档</span>
                </header>
                <p>
                  {version.candidateAssessment?.status === "blocked"
                    ? "这份历史候选由早期开发测试版生成；当前复核发现它没有通过现行安全检查。版本文件仍会保留，当前 HTML 的编辑不受影响。"
                    : version.candidateAssessment?.status === "attention"
                    ? "候选 HTML 可以打开，但系统找到的上一版共同特征较少；审阅提醒已随版本归档。"
                    : version.candidateAssessment
                      ? "HTML 可用性、可执行内容和上一版连续性已经检查并保存。"
                      : version.validationReview
                        ? "这是旧版本保留的范围校验记录。"
                        : "版本与文件内容已经校验并保存。"}
                </p>
              </section>
            </details>
          ) : null}
          <div className="version-detail-actions">
            <button
              className="view-version-button"
              type="button"
              disabled={viewDisabled}
              onClick={onView}
            >
              <EyeIcon aria-hidden="true" size={15} weight="bold" />
              在画布中查看
            </button>
            {onReveal ? (
              <button type="button" onClick={onReveal}>
                Finder
              </button>
            ) : null}
          </div>
        </section>
      ) : null}
    </article>
  );
}
