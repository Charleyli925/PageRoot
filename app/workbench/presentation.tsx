"use client";

import {
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { ArrowCounterClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowCounterClockwise";
import { CaretRightIcon } from "@phosphor-icons/react/dist/csr/CaretRight";
import { ChatCircleIcon } from "@phosphor-icons/react/dist/csr/ChatCircle";
import { FileIcon } from "@phosphor-icons/react/dist/csr/File";
import { GitBranchIcon } from "@phosphor-icons/react/dist/csr/GitBranch";
import { PencilSimpleIcon } from "@phosphor-icons/react/dist/csr/PencilSimple";
import { SparkleIcon } from "@phosphor-icons/react/dist/csr/Sparkle";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import {
  formatFileSize,
  insertionLabel,
} from "./comment-model";
import { formatTime } from "./project-model";
import {
  changeKindLabel,
  historyRecordValue,
  summarizeChangeEvents,
  versionTitle,
} from "./version-model";
import { versionGraphLayout } from "./version-graph";
import type { CommentAttachment, Version } from "./types";

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

// Geometry shared by the lane rails and the rows they sit behind. The row height
// must match `.version-tree-row` in globals.css or the rails drift off the dots.
const VERSION_TREE_ROW_HEIGHT = 38;
const VERSION_TREE_LANE_WIDTH = 17;
const VERSION_TREE_EDGE_PADDING = 12;
const VERSION_TREE_ELBOW_RADIUS = 6;
const VERSION_TREE_LANE_COUNT = 4;

function laneStroke(lane: number): string {
  // One indigo family, four depths: branches stay distinguishable without
  // introducing a second accent colour.
  return `var(--version-lane-${lane % VERSION_TREE_LANE_COUNT})`;
}

function laneCenter(lane: number): number {
  return VERSION_TREE_EDGE_PADDING + lane * VERSION_TREE_LANE_WIDTH;
}

function rowCenter(row: number): number {
  return row * VERSION_TREE_ROW_HEIGHT + VERSION_TREE_ROW_HEIGHT / 2;
}

export function VersionTreeList({
  versions,
  selectedVersionId,
  editingBaseVersionId,
  onSelect,
}: {
  versions: readonly Version[];
  selectedVersionId: string | null;
  editingBaseVersionId: string | null;
  onSelect: (versionId: string) => void;
}) {
  const layout = versionGraphLayout(versions);
  const byId = new Map(versions.map((version) => [version.id, version]));
  const railWidth = VERSION_TREE_EDGE_PADDING * 2
    + Math.max(0, layout.laneCount - 1) * VERSION_TREE_LANE_WIDTH;
  const railHeight = layout.rows.length * VERSION_TREE_ROW_HEIGHT;

  return (
    <div className="version-tree">
      <svg
        className="version-tree-rail"
        width={railWidth}
        height={railHeight}
        aria-hidden="true"
      >
        {layout.segments.map((segment) => (
          <path
            key={`s${segment.lane}-${segment.fromRow}`}
            d={`M${laneCenter(segment.lane)} ${rowCenter(segment.fromRow)}V${rowCenter(segment.toRow)}`}
            stroke={laneStroke(segment.lane)}
          />
        ))}
        {layout.edges.map((edge) => {
          const from = laneCenter(edge.fromLane);
          const to = laneCenter(edge.toLane);
          const top = rowCenter(edge.fromRow);
          // Turn out of the parent lane immediately, then run straight down the
          // new lane: forks stay clear of the line they branched from.
          return (
            <path
              key={`e${edge.fromVersionId}-${edge.toVersionId}`}
              d={`M${from} ${top}H${to - VERSION_TREE_ELBOW_RADIUS}`
                + `Q${to} ${top} ${to} ${top + VERSION_TREE_ELBOW_RADIUS}`
                + `V${rowCenter(edge.toRow)}`}
              stroke={laneStroke(edge.toLane)}
            />
          );
        })}
        {layout.rows.map((row) => (
          <circle
            key={`n${row.versionId}`}
            className="version-tree-node"
            data-current={row.versionId === editingBaseVersionId ? "true" : undefined}
            cx={laneCenter(row.lane)}
            cy={rowCenter(row.row)}
            r={row.versionId === editingBaseVersionId ? 5 : 4.4}
            fill={row.versionId === editingBaseVersionId
              ? laneStroke(row.lane)
              : undefined}
            stroke={laneStroke(row.lane)}
          />
        ))}
      </svg>
      <div className="version-tree-rows">
        {layout.rows.map((row) => {
          const version = byId.get(row.versionId);
          if (!version) return null;
          const title = version.displayFileName || `版本-${version.ordinal}.html`;
          const editingBase = version.id === editingBaseVersionId;
          return (
            <button
              className="version-tree-row"
              type="button"
              key={version.id}
              aria-current={version.id === selectedVersionId ? "true" : undefined}
              data-selected={version.id === selectedVersionId ? "true" : undefined}
              style={{ paddingLeft: `${railWidth + 6}px` }}
              onClick={() => onSelect(version.id)}
            >
              <span className="version-tree-title" title={title}>{title}</span>
              {editingBase ? (
                <span className="version-tree-flag">当前</span>
              ) : (
                <time dateTime={version.modifiedAt || version.generatedAt}>
                  {formatTime(version.modifiedAt || version.generatedAt)}
                </time>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function VersionDetail({
  version,
  parent,
  latest,
  editingBase,
  viewing,
  attachmentObjectUrls,
  onSelectParent,
  onEnsureAttachmentPreview,
  onPreviewAttachment,
  onDownloadAttachment,
}: {
  version: Version;
  parent: Version | null;
  latest: boolean;
  editingBase: boolean;
  viewing: boolean;
  attachmentObjectUrls: Record<string, string>;
  onSelectParent?: (versionId: string) => void;
  onEnsureAttachmentPreview: (
    attachment: CommentAttachment,
  ) => Promise<string>;
  onPreviewAttachment: (attachment: CommentAttachment) => void;
  onDownloadAttachment: (attachment: CommentAttachment) => void;
}) {
  const summarizedEdits = summarizeChangeEvents(version.directEdits);
  const flags = [
    latest ? "最新版本" : null,
    editingBase ? "当前编辑基础" : null,
    viewing ? "正在浏览" : null,
    version.differsFromBase ? "有本地修改" : null,
    version.saveState === "saving"
      ? "本地保存中"
      : version.saveState === "failed"
        ? "本地保存失败"
        : null,
  ].filter((value): value is string => Boolean(value));
  // Only an unresolved assessment is worth a line here; a clean check is the
  // expected case and stays silent.
  const assessmentNotice = version.candidateAssessment?.status === "blocked"
    ? "这份历史候选由早期开发测试版生成，没有通过现行安全检查。版本文件仍保留，当前 HTML 的编辑不受影响。"
    : version.candidateAssessment?.status === "attention"
      ? "HTML 可以打开，但与上一版的共同特征较少，当时已标记为需审阅。"
      : null;

  const parentTitle = parent ? versionTitle(parent) : "";
  const hasRecords = version.comments.length > 0
    || version.supplements.length > 0
    || summarizedEdits.length > 0;
  // Current projects keep the round's comments in the request rather than on the
  // version, so the frozen requirement is what stands in for them here.
  const showRequirement = Boolean(version.requirement)
    && version.comments.length === 0;

  return (
    <section
      className="version-detail"
      aria-label={`版本 ${version.ordinal} 详情`}
    >
      <header className="version-detail-head">
        <span className="version-detail-badge">V{version.ordinal}</span>
        <span className="version-detail-identity">
          <span className="version-detail-heading">
            <strong>版本 {version.ordinal}</strong>
            {flags.map((flag) => (
              <em className="version-detail-flag" key={flag}>{flag}</em>
            ))}
          </span>
          <small>{formatTime(version.generatedAt, true)} · 只读备份</small>
        </span>
      </header>
      <div className="version-detail-lineage">
        <GitBranchIcon aria-hidden="true" size={15} weight="bold" />
        <span>
          {parent
            ? <>基于 <strong>版本 {parent.ordinal}</strong>{parentTitle ? ` · ${parentTitle}` : ""}</>
            : <>从源文件导入，是这个项目的起点</>}
        </span>
        {parent && onSelectParent ? (
          <button type="button" onClick={() => onSelectParent(parent.id)}>
            查看
            <CaretRightIcon aria-hidden="true" size={12} weight="bold" />
          </button>
        ) : null}
      </div>
      {assessmentNotice ? (
        <p className="version-detail-notice" role="status">{assessmentNotice}</p>
      ) : null}
      {showRequirement ? (
        <section className="version-detail-group">
          <header>
            <ChatCircleIcon aria-hidden="true" size={15} weight="bold" />
            <strong>本轮要求</strong>
          </header>
          <div className="version-detail-records">
            <article className="version-detail-comment">
              <p>{version.requirement}</p>
            </article>
          </div>
        </section>
      ) : null}
      {version.comments.length > 0 ? (
        <section className="version-detail-group">
          <header>
            <ChatCircleIcon aria-hidden="true" size={15} weight="bold" />
            <strong>我留的评论</strong>
            <span className="version-detail-count">
              {version.comments.length}
            </span>
          </header>
          <div className="version-detail-records">
            {version.comments.map((comment) => (
              <article className="version-detail-comment" key={comment.commentId}>
                <strong>{insertionLabel(comment.target)}</strong>
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
          </div>
        </section>
      ) : null}
      {version.supplements.length > 0 ? (
        <section className="version-detail-group">
          <header>
            <SparkleIcon aria-hidden="true" size={15} weight="bold" />
            <strong>AI 对话补充</strong>
            <span className="version-detail-count">
              {version.supplements.length}
            </span>
          </header>
          <div className="version-detail-records">
            {version.supplements.map((supplement) => (
              <article
                className="version-detail-comment"
                key={supplement.recordId}
              >
                <strong>
                  {supplement.action === "add"
                    ? "新增要求"
                    : supplement.action === "amend"
                      ? "补充修改"
                      : "撤回要求"}
                </strong>
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
          </div>
        </section>
      ) : null}
      {summarizedEdits.length > 0 ? (
        <section className="version-detail-group">
          <header>
            <PencilSimpleIcon aria-hidden="true" size={15} weight="bold" />
            <strong>本地编辑</strong>
            <span className="version-detail-count">
              {summarizedEdits.length}
            </span>
          </header>
          <div className="version-detail-records">
            {summarizedEdits.map((event) => (
              <div className="version-detail-edit" key={event.eventId}>
                <del>{historyRecordValue(event, event.before)}</del>
                <CaretRightIcon aria-hidden="true" size={13} weight="bold" />
                <ins>{historyRecordValue(event, event.after)}</ins>
                <small>{changeKindLabel(event)}</small>
              </div>
            ))}
          </div>
        </section>
      ) : null}
      {hasRecords || showRequirement ? null : (
        <p className="version-detail-empty">
          {version.source === "初始页面"
            ? "这是项目的起点版本。"
            : "这一版没有随版本保留的评论与修改记录。"}
        </p>
      )}
    </section>
  );
}
