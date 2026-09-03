"use client";

import type { ReactNode } from "react";
import { ArrowClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowClockwise";
import { CheckCircleIcon } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { ClockCounterClockwiseIcon } from "@phosphor-icons/react/dist/csr/ClockCounterClockwise";
import { EyeIcon } from "@phosphor-icons/react/dist/csr/Eye";
import { PencilSimpleIcon } from "@phosphor-icons/react/dist/csr/PencilSimple";

import type { CanvasMode } from "./types";
import { ReviewToolbarControls } from "./review-toolbar-controls";
import { WorkbenchMoreMenu, type WorkbenchMoreMenuProps } from "./workbench-more-menu";
import {
  WorkbenchHeaderActions,
  WorkbenchHeaderShell,
} from "./workbench-header-shell";
import { WorkbenchTooltipHost } from "./workbench-tooltip";

export type WorkbenchHeaderToolbarProps = {
  runInProgress: boolean;
  canvasMode: CanvasMode;
  viewMode: string;
  interactionLocked: boolean;
  recentRunOutcome: unknown;
  terminalRun: unknown;
  reviewActive: boolean;
  reviewAvailable: boolean;
  reviewPreparing: boolean;
  refreshAvailable: boolean;
  aiConversationVisible: boolean;
  aiAssistantEntry: ReactNode;
  moreMenu: WorkbenchMoreMenuProps;
  onSelectEdit: () => void;
  onSelectPreview: () => void;
  onOpenReview: () => void;
  onRefreshCanvas: () => void;
  reopenRecentRunOutcome: () => void;
};

export function WorkbenchHeaderToolbar({
  runInProgress,
  canvasMode,
  viewMode,
  interactionLocked,
  recentRunOutcome,
  terminalRun,
  reviewActive,
  reviewAvailable,
  reviewPreparing,
  refreshAvailable,
  aiConversationVisible,
  aiAssistantEntry,
  moreMenu,
  onSelectEdit,
  onSelectPreview,
  onOpenReview,
  onRefreshCanvas,
  reopenRecentRunOutcome,
}: WorkbenchHeaderToolbarProps) {
  return (
    <>
      <WorkbenchHeaderActions aria-label="模式、审阅和文件操作">
          <div className="workbench-toolbar-primary">
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
                disabled={reviewActive || runInProgress || viewMode === "history"}
                data-tooltip={
                  reviewActive
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
                disabled={reviewActive || interactionLocked}
                data-tooltip={reviewActive
                  ? "完成审阅后可继续预览"
                  : interactionLocked
                    ? "当前状态只能使用编辑画布"
                    : undefined}
                onClick={onSelectPreview}
              >
                <EyeIcon aria-hidden="true" size={16} weight="bold" />
                预览
              </button>
              <button
                type="button"
                aria-pressed={reviewActive}
                aria-label={reviewActive
                  ? "审阅，正在审阅 AI 修改"
                  : reviewAvailable
                    ? "审阅，有 AI 修改待查看"
                    : "审阅"}
                disabled={reviewActive || reviewPreparing || !reviewAvailable}
                data-review-available={reviewAvailable ? "true" : undefined}
                data-tooltip={reviewActive
                  ? "正在审阅 AI 修改"
                  : reviewPreparing
                    ? "正在准备审阅…"
                    : reviewAvailable
                      ? undefined
                      : "有待审阅修改时自动可用"}
                onClick={onOpenReview}
              >
                <CheckCircleIcon aria-hidden="true" size={15} weight="duotone" />
                审阅
                {reviewAvailable ? <span className="review-attention-dot" aria-hidden="true" /> : null}
              </button>
            </div>
          </div>
          <div className="workbench-toolbar-center">
            <span className="toolbar-section-divider" aria-hidden="true" />
            <div
              id="workbench-review-tools-slot"
              className="workbench-review-tools-slot"
              aria-label="审阅工具与结果操作"
            >
              {!reviewActive ? <ReviewToolbarControls disabled /> : null}
            </div>
            <span className="toolbar-section-divider" aria-hidden="true" />
          </div>
          <div className="workbench-toolbar-actions">
            <button
              className="workbench-refresh-button"
              type="button"
              aria-label={reviewActive ? "刷新审阅画布" : canvasMode === "preview" ? "刷新预览" : "刷新画布"}
              disabled={!refreshAvailable}
              data-tooltip={reviewActive
                ? "刷新审阅画布"
                : canvasMode === "preview"
                  ? "刷新预览"
                  : "进入预览或审阅后可刷新"}
              onClick={onRefreshCanvas}
            >
              <ArrowClockwiseIcon aria-hidden="true" size={20} weight="bold" />
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
            {aiAssistantEntry}
            <WorkbenchMoreMenu {...moreMenu} />
          </div>
      </WorkbenchHeaderActions>
      <WorkbenchTooltipHost />
    </>
  );
}

export function WorkbenchHeaderView(props: WorkbenchHeaderToolbarProps) {
  return (
    <WorkbenchHeaderShell>
      <WorkbenchHeaderToolbar {...props} />
    </WorkbenchHeaderShell>
  );
}
