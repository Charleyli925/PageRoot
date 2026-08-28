"use client";

import {
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { ArrowCounterClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowCounterClockwise";
import { FileIcon } from "@phosphor-icons/react/dist/csr/File";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import { formatFileSize } from "./comment-model";
import type { CommentAttachment } from "./types";

const PREVIEW_NAVIGATION_AUTO_COLLAPSE_MS = 3_500;

export function PreviewNavigationBanner({
  icon,
  title,
  detail,
  actionLabel,
  actionDisabled = false,
  secondaryActionLabel,
  secondaryActionDisabled = false,
  className,
  onAction,
  onSecondaryAction,
}: {
  icon: ReactNode;
  title: ReactNode;
  detail: ReactNode;
  actionLabel: string;
  actionDisabled?: boolean;
  secondaryActionLabel?: string;
  secondaryActionDisabled?: boolean;
  className?: string;
  onAction: () => void;
  onSecondaryAction?: () => void;
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
      {secondaryActionLabel && onSecondaryAction ? (
        <button
          type="button"
          disabled={secondaryActionDisabled}
          onClick={onSecondaryAction}
        >
          {secondaryActionLabel}
        </button>
      ) : null}
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
