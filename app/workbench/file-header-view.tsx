"use client";

import type { ReactNode } from "react";
import { ArrowSquareOutIcon } from "@phosphor-icons/react/dist/csr/ArrowSquareOut";
import { CheckCircleIcon } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { ClockCounterClockwiseIcon } from "@phosphor-icons/react/dist/csr/ClockCounterClockwise";
import { EyeIcon } from "@phosphor-icons/react/dist/csr/Eye";
import { FolderOpenIcon } from "@phosphor-icons/react/dist/csr/FolderOpen";
import { PencilSimpleIcon } from "@phosphor-icons/react/dist/csr/PencilSimple";

import type {
  CanvasMode,
  Drawer,
  PersistState,
} from "./types";
import { ReviewToolbarControls } from "./review-toolbar-controls";
import { WorkbenchHeaderActions } from "./workbench-header-shell";

export type WorkbenchFileHeaderViewProps = {
  currentSourceFileName: string;
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
  onOpenInDefaultBrowser: () => void;
  onShowProjectRecordsInFolder: () => void;
  onShowProjectInFolder: () => void;
  onRetryCanvasVerification: () => void;
};

export function WorkbenchFileHeaderView({
  currentSourceFileName,
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
  onOpenInDefaultBrowser,
  onShowProjectRecordsInFolder,
  onShowProjectInFolder,
  onRetryCanvasVerification,
}: WorkbenchFileHeaderViewProps) {
  return (
    <div className="window-file" aria-label="当前文档状态与文件操作">
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
                  className="window-file-quick-action"
                  type="button"
                  data-tooltip="在文件夹中打开项目"
                  aria-label="在文件夹中打开当前项目文件夹"
                  onClick={onShowProjectRecordsInFolder}
                >
                  <FolderOpenIcon aria-hidden="true" size={15} weight="duotone" />
                </button>
              ) : canShowCurrentFileInFolder ? (
                <button
                  className="window-file-quick-action"
                  type="button"
                  data-tooltip="在文件夹中打开"
                  aria-label={`在文件夹中打开 ${currentSourceFileName}`}
                  onClick={onShowProjectInFolder}
                >
                  <FolderOpenIcon aria-hidden="true" size={15} weight="duotone" />
                </button>
              ) : null}
              <button
                className="window-file-quick-action"
                type="button"
                data-tooltip="在默认浏览器中打开"
                aria-label={`在默认浏览器中打开 ${currentSourceFileName}`}
                disabled={
                  !canOpenCurrentHtmlInDefaultBrowser
                  || persistState !== "idle"
                  || editRevision !== lastPersistedRevision
                }
                onClick={onOpenInDefaultBrowser}
              >
                <ArrowSquareOutIcon aria-hidden="true" size={15} weight="bold" />
              </button>
              <span
                className="save-status"
                data-persist-state={persistState}
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
  reviewActive,
  aiConversationVisible,
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
  reviewActive: boolean;
  aiConversationVisible: boolean;
  aiAssistantEntry: ReactNode;
  onSelectEdit: () => void;
  onSelectPreview: () => void;
  onToggleProjectPanel: () => void;
  reopenRecentRunOutcome: () => void;
}) {
  return (
        <WorkbenchHeaderActions aria-label="模式、审阅、项目和文件操作">
          <div
            className="canvas-mode-switch"
            role="group"
            aria-label="工作模式"
            data-mode={reviewActive ? "review" : canvasMode}
            data-tooltip={runInProgress ? "本轮还在进行，结束或采纳后可回到编辑" : undefined}
          >
            <button
              type="button"
              aria-pressed={!reviewActive && canvasMode === "edit"}
              disabled={reviewActive || browserPreviewOnly || runInProgress || viewMode === "history"}
              data-tooltip={
                browserPreviewOnly
                  ? "浏览器预览为只读模式"
                  : reviewActive
                    ? "完成审阅后可继续编辑"
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
              aria-pressed={!reviewActive && canvasMode === "preview"}
              disabled={reviewActive || (!browserPreviewOnly && interactionLocked)}
              data-tooltip={reviewActive
                ? "完成审阅后可继续预览"
                : browserPreviewOnly
                ? "只读运行页面自身的脚本和交互；操作不会保存"
                : interactionLocked
                  ? "当前状态只能使用编辑画布"
                  : "运行页面自身的脚本和交互"}
              onClick={onSelectPreview}
            >
              <EyeIcon aria-hidden="true" size={16} weight="bold" />
              预览
            </button>
            <button
              type="button"
              aria-pressed={reviewActive}
              disabled
              data-tooltip={reviewActive ? "正在审阅 AI 修改" : "有待审阅修改时自动可用"}
            >
              <CheckCircleIcon aria-hidden="true" size={15} weight="duotone" />
              审阅
            </button>
          </div>
          <span className="toolbar-section-divider" aria-hidden="true" />
          <div
            id="workbench-review-tools-slot"
            className="workbench-review-tools-slot"
            aria-label="审阅工具与结果操作"
          >
            {!reviewActive ? <ReviewToolbarControls disabled /> : null}
          </div>
          <span className="toolbar-section-divider" aria-hidden="true" />
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
              aria-expanded={aiConversationVisible}
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
          <span className="toolbar-flex-spacer" aria-hidden="true" />
          {aiAssistantEntry}
        </WorkbenchHeaderActions>
  );
}
