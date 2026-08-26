"use client";

import type { KeyboardEvent, ReactNode, RefObject } from "react";
import { ArrowSquareOutIcon } from "@phosphor-icons/react/dist/csr/ArrowSquareOut";
import { ClockCounterClockwiseIcon } from "@phosphor-icons/react/dist/csr/ClockCounterClockwise";
import { EyeIcon } from "@phosphor-icons/react/dist/csr/Eye";
import { FileHtmlIcon } from "@phosphor-icons/react/dist/csr/FileHtml";
import { FolderOpenIcon } from "@phosphor-icons/react/dist/csr/FolderOpen";
import { PencilSimpleIcon } from "@phosphor-icons/react/dist/csr/PencilSimple";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";

import type {
  ApplicationUpdateResult,
  CanvasMode,
  Drawer,
  PersistState,
} from "./types";
import { WorkbenchHeaderActions } from "./workbench-header-shell";

export type WorkbenchFileHeaderViewProps = {
  fileRenameInputRef: RefObject<HTMLInputElement | null>;
  openHtmlButtonRef: RefObject<HTMLButtonElement | null>;
  updateActionVisible: boolean;
  updateDownloaded: boolean;
  updateDownloading: boolean;
  updateResult: ApplicationUpdateResult | null | undefined;
  updateBadgeLabel: string;
  fileRenameEditing: boolean;
  fileRenameBusy: boolean;
  fileRenameError: string;
  fileRenameDraft: string;
  currentSourceFileStem: string;
  currentSourceFileExtension: string;
  currentSourceFileName: string;
  canOfferFileRename: boolean;
  openHtmlDialogOpen: boolean;
  canOpenCurrentHtmlInDefaultBrowser: boolean;
  persistState: PersistState;
  editRevision: number;
  lastPersistedRevision: number;
  headerStatusFacts: string[];
  canOpenProjectRootInFolder: boolean;
  canShowCurrentFileInFolder: boolean;
  canvasGeneration: number;
  canvasAuthority: {
    status: string;
  } | null | undefined;
  visibleCanvasAck: {
    generation: number;
    sha256: string | null;
  } | null | undefined;
  saveStatusLabel: string;
  onOpenAbout: () => void;
  onDownloadOrRestartUpdate: () => void;
  onFileRenameBlur: () => void;
  onFileRenameChange: (value: string) => void;
  onFileRenameKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  onBeginFileRename: () => void;
  onOpenHtmlDialog: () => void;
  onOpenInDefaultBrowser: () => void;
  onShowProjectRecordsInFolder: () => void;
  onShowProjectInFolder: () => void;
  onRetryCanvasVerification: () => void;
};

export function WorkbenchFileHeaderView({
  fileRenameInputRef,
  openHtmlButtonRef,
  updateActionVisible,
  updateDownloaded,
  updateDownloading,
  updateResult,
  updateBadgeLabel,
  fileRenameEditing,
  fileRenameBusy,
  fileRenameError,
  fileRenameDraft,
  currentSourceFileStem,
  currentSourceFileExtension,
  currentSourceFileName,
  canOfferFileRename,
  openHtmlDialogOpen,
  canOpenCurrentHtmlInDefaultBrowser,
  persistState,
  editRevision,
  lastPersistedRevision,
  headerStatusFacts,
  canOpenProjectRootInFolder,
  canShowCurrentFileInFolder,
  canvasGeneration,
  canvasAuthority,
  visibleCanvasAck,
  saveStatusLabel,
  onOpenAbout,
  onDownloadOrRestartUpdate,
  onFileRenameBlur,
  onFileRenameChange,
  onFileRenameKeyDown,
  onBeginFileRename,
  onOpenHtmlDialog,
  onOpenInDefaultBrowser,
  onShowProjectRecordsInFolder,
  onShowProjectInFolder,
  onRetryCanvasVerification,
}: WorkbenchFileHeaderViewProps) {
  return (
        <div className="window-file">
          <span
            className="window-file-icon-cluster"
            data-update-visible={updateActionVisible ? "true" : undefined}
            data-update-downloaded={updateDownloaded ? "true" : undefined}
          >
            <button
              className="window-file-icon window-file-about-button"
              type="button"
              aria-label="关于源页"
              title="关于源页"
              onClick={onOpenAbout}
            >
              <FileHtmlIcon aria-hidden="true" size={20} weight="duotone" />
            </button>
            {updateActionVisible ? (
              <button
                className="header-update-badge window-file-update-badge"
                type="button"
                data-update-downloaded={updateDownloaded ? "true" : undefined}
                aria-label={updateDownloaded
                  ? `PageRoot ${updateResult?.latestVersion || "新版本"} 已下载，重启更新`
                  : updateDownloading
                    ? `正在下载 PageRoot ${updateResult?.latestVersion || "新版本"}`
                    : `发现 PageRoot ${updateResult?.latestVersion || "新版本"}，下载更新`}
                title={updateDownloaded
                  ? `重启更新 PageRoot ${updateResult?.latestVersion || "新版本"}`
                  : updateDownloading
                    ? `正在下载 PageRoot ${updateResult?.latestVersion || "新版本"}`
                    : `下载 PageRoot ${updateResult?.latestVersion || "新版本"}`}
                disabled={updateDownloading}
                onClick={onDownloadOrRestartUpdate}
              >
                <span>{updateBadgeLabel}</span>
              </button>
            ) : null}
          </span>
          <div className="window-file-copy">
            <div
              className="window-file-title-row"
              data-renaming={fileRenameEditing ? "true" : undefined}
              role={fileRenameEditing ? undefined : "status"}
              aria-live={fileRenameEditing ? undefined : "polite"}
              aria-atomic={fileRenameEditing ? undefined : "true"}
            >
              {fileRenameEditing ? (
                <label className="window-file-rename-field">
                  <span className="sr-only">文件名（不含后缀）</span>
                  <input
                    ref={fileRenameInputRef}
                    aria-label="文件名（不含后缀）"
                    aria-invalid={fileRenameError ? "true" : undefined}
                    aria-describedby={fileRenameError
                      ? "window-file-rename-error"
                      : undefined}
                    autoComplete="off"
                    disabled={fileRenameBusy}
                    maxLength={180}
                    spellCheck={false}
                    value={fileRenameDraft}
                    onBlur={onFileRenameBlur}
                    onChange={(event) => onFileRenameChange(event.target.value)}
                    onKeyDown={onFileRenameKeyDown}
                  />
                  <span aria-hidden="true">{currentSourceFileExtension}</span>
                </label>
              ) : canOfferFileRename ? (
                <button
                  className="window-file-title-action"
                  type="button"
                  aria-label={`重命名文件 ${currentSourceFileStem}`}
                  title="重命名文件"
                  onClick={onBeginFileRename}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === "F2") {
                      event.preventDefault();
                      onBeginFileRename();
                    }
                  }}
                >
                  <strong>{currentSourceFileStem}</strong>
                  <PencilSimpleIcon
                    className="window-file-rename-icon"
                    aria-hidden="true"
                    size={13}
                    weight="bold"
                  />
                </button>
              ) : (
                <strong title={currentSourceFileName}>
                  {currentSourceFileStem}
                </strong>
              )}
              <span className="window-file-quick-actions">
                  <button
                  ref={openHtmlButtonRef}
                  className="window-file-quick-action"
                  type="button"
                  data-tooltip="打开新的本地 HTML"
                  aria-label="打开新的本地 HTML"
                  aria-haspopup="dialog"
                  aria-expanded={openHtmlDialogOpen}
                  disabled={fileRenameEditing || fileRenameBusy}
                  onClick={onOpenHtmlDialog}
                >
                  <PlusIcon aria-hidden="true" size={16} weight="bold" />
                </button>
                <button
                  className="window-file-quick-action"
                  type="button"
                  data-tooltip="在默认浏览器中打开"
                  aria-label={`在默认浏览器中打开 ${currentSourceFileName}`}
                  disabled={
                    !canOpenCurrentHtmlInDefaultBrowser
                    || fileRenameEditing
                    || fileRenameBusy
                    || persistState !== "idle"
                    || editRevision !== lastPersistedRevision
                  }
                  onClick={onOpenInDefaultBrowser}
                >
                  <ArrowSquareOutIcon
                    aria-hidden="true"
                    size={16}
                    weight="bold"
                  />
                </button>
              </span>
              {fileRenameError ? (
                <span
                  id="window-file-rename-error"
                  className="window-file-rename-error"
                  role="alert"
                >
                  {fileRenameError}
                </span>
              ) : null}
            </div>
            <span className="file-meta">
              {headerStatusFacts.length ? (
                <span className="file-version-label project-status-facts">
                  {headerStatusFacts.map((fact) => (
                    <span key={fact}>{fact}</span>
                  ))}
                </span>
              ) : null}
              {canOpenProjectRootInFolder ? (
                <button
                  className="window-file-folder-action"
                  type="button"
                  aria-label="在文件夹中打开当前项目文件夹"
                  title="在文件夹中打开当前项目文件夹"
                  onClick={onShowProjectRecordsInFolder}
                >
                  在文件夹中打开
                </button>
              ) : canShowCurrentFileInFolder ? (
                <button
                  className="window-file-folder-action"
                  type="button"
                  aria-label={`在文件夹中打开 ${currentSourceFileName}`}
                  title="在文件夹中打开当前文件"
                  onClick={onShowProjectInFolder}
                >
                  在文件夹中打开
                </button>
              ) : null}
              <span
                className="save-status"
                data-persist-state={persistState}
                data-file-renaming={fileRenameBusy ? "true" : undefined}
                data-edit-revision={editRevision}
                data-persisted-revision={lastPersistedRevision}
                data-canvas-generation={canvasGeneration}
                data-canvas-authority={canvasAuthority?.status}
                data-render-generation={visibleCanvasAck?.generation}
                data-rendered-sha256={visibleCanvasAck?.sha256 || undefined}
                role={canvasAuthority?.status === "failed" ? "button" : "status"}
                aria-live="polite"
                tabIndex={canvasAuthority?.status === "failed" ? 0 : undefined}
                onClick={canvasAuthority?.status === "failed" ? onRetryCanvasVerification : undefined}
                onKeyDown={canvasAuthority?.status === "failed" ? (event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onRetryCanvasVerification();
                  }
                } : undefined}
              >
                <span aria-hidden="true" />
                {saveStatusLabel}
              </span>
            </span>
          </div>
        </div>
  );
}

export function WorkbenchHeaderToolbar({
  runInProgress,
  canvasMode,
  browserPreviewOnly,
  viewMode,
  interactionLocked,
  projectHydrating,
  viewTransitioning,
  attachmentUploadCount,
  drawer,
  recentRunOutcome,
  terminalRun,
  readyReviewOverlay,
  aiAssistantEntry,
  onSelectEdit,
  onSelectPreview,
  onToggleProjectPanel,
  reopenRecentRunOutcome,
}: {
  runInProgress: boolean;
  canvasMode: CanvasMode;
  browserPreviewOnly: boolean;
  viewMode: string;
  interactionLocked: boolean;
  projectHydrating: boolean;
  viewTransitioning: boolean;
  attachmentUploadCount: number;
  drawer: Drawer;
  recentRunOutcome: unknown;
  terminalRun: unknown;
  readyReviewOverlay: ReactNode;
  aiAssistantEntry: ReactNode;
  onSelectEdit: () => void;
  onSelectPreview: () => void;
  onToggleProjectPanel: () => void;
  reopenRecentRunOutcome: () => void;
}) {
  return (
        <WorkbenchHeaderActions aria-label="画布模式、项目和版本操作">
          <div
            className="canvas-mode-switch"
            role="group"
            aria-label="画布模式"
            /*
             * The reason lives on the group, not on the disabled button: a disabled
             * element dispatches no hover, so its own title never surfaces and only a
             * screen reader ever heard it. Hovering the group works, and nothing is
             * printed in the bar when there is no reason to give.
             */
            title={runInProgress ? "本轮还在进行，结束或采纳后可回到编辑" : undefined}
          >
            <button
              type="button"
              aria-pressed={canvasMode === "edit"}
              disabled={browserPreviewOnly || runInProgress || viewMode === "history"}
              /*
               * A disabled control that will not say why reads as a broken control. The
               * round in flight is the reason, and it is temporary, so the tooltip names
               * it instead of leaving the user to guess.
               */
              title={
                browserPreviewOnly
                  ? "浏览器预览为只读模式"
                  : runInProgress
                    ? "本轮还在进行，结束或采纳后可回到编辑"
                    : undefined
              }
              onClick={onSelectEdit}
            >
              <PencilSimpleIcon aria-hidden="true" size={16} weight="bold" />
              编辑
            </button>
            <button
              type="button"
              aria-pressed={canvasMode === "preview"}
              disabled={!browserPreviewOnly && interactionLocked}
              title={browserPreviewOnly
                ? "只读运行页面自身的脚本和交互；操作不会保存"
                : interactionLocked
                  ? "当前状态只能使用编辑画布"
                  : "运行页面自身的脚本和交互"}
              onClick={onSelectPreview}
            >
              <EyeIcon aria-hidden="true" size={16} weight="bold" />
              预览
            </button>
          </div>
          <button
            className="project-button"
            type="button"
            aria-expanded={drawer === "files"}
            disabled={projectHydrating || viewTransitioning || attachmentUploadCount > 0}
            onClick={onToggleProjectPanel}
          >
            <FolderOpenIcon aria-hidden="true" size={18} weight="duotone" />
            项目
          </button>
          {recentRunOutcome && !runInProgress && !terminalRun ? (
            <button
              className="recent-run-button"
              type="button"
              aria-expanded={drawer === "handoff"}
              onClick={reopenRecentRunOutcome}
            >
              <ClockCounterClockwiseIcon
                aria-hidden="true"
                size={18}
                weight="duotone"
              />
              上轮处理
            </button>
          ) : null}
          {!readyReviewOverlay ? aiAssistantEntry : null}
        </WorkbenchHeaderActions>
  );
}
