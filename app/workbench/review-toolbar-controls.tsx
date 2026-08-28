"use client";

import type { CSSProperties, KeyboardEvent } from "react";
import {
  BrowsersIcon,
  CaretDownIcon,
  CaretLeftIcon,
  CaretRightIcon,
  CaretUpIcon,
  CornersOutIcon,
  GitDiffIcon,
  LinkBreakIcon,
  LinkIcon,
  TextTIcon,
  TreeStructureIcon,
} from "@phosphor-icons/react";

import type {
  ReviewChangeFilter,
  ReviewPageView,
  ReviewScrollMode,
  ReviewZoomMode,
} from "./review-state";

const FILTER_LABELS: Record<ReviewChangeFilter, string> = {
  all: "全部",
  text: "文字",
  structure: "元素",
};

function handleSegmentedKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
  const buttons = [...(event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
    "button:not(:disabled)",
  ) || [])];
  const currentIndex = buttons.indexOf(event.currentTarget);
  if (currentIndex < 0 || !buttons.length) return;
  let targetIndex: number | null = null;
  if (event.key === "ArrowRight" || event.key === "ArrowDown") {
    targetIndex = (currentIndex + 1) % buttons.length;
  } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
    targetIndex = (currentIndex - 1 + buttons.length) % buttons.length;
  } else if (event.key === "Home") {
    targetIndex = 0;
  } else if (event.key === "End") {
    targetIndex = buttons.length - 1;
  }
  if (targetIndex === null) return;
  event.preventDefault();
  buttons[targetIndex].focus();
  buttons[targetIndex].click();
}

export type ReviewToolbarControlsProps = {
  disabled?: boolean;
  pageView?: ReviewPageView;
  changeFilter?: ReviewChangeFilter;
  contextVisibility?: number;
  scrollMode?: ReviewScrollMode;
  zoomMode?: ReviewZoomMode;
  activeIndex?: number;
  changeCount?: number;
  onPageViewChange?: (value: ReviewPageView) => void;
  onChangeFilter?: (value: ReviewChangeFilter) => void;
  onContextVisibilityChange?: (value: number) => void;
  onScrollModeChange?: (value: ReviewScrollMode) => void;
  onZoomModeChange?: (value: ReviewZoomMode) => void;
  onNavigate?: (direction: -1 | 1) => void;
  onShowWholePage?: () => void;
};

export function ReviewToolbarControls({
  disabled = false,
  pageView = "split",
  changeFilter = "all",
  contextVisibility = 18,
  scrollMode = "linked",
  zoomMode = "actual",
  activeIndex = -1,
  changeCount = 0,
  onPageViewChange,
  onChangeFilter,
  onContextVisibilityChange,
  onScrollModeChange,
  onZoomModeChange,
  onNavigate,
  onShowWholePage,
}: ReviewToolbarControlsProps) {
  const unavailableReason = disabled ? "进入审阅模式后可用" : undefined;
  return (
    <div
      className="unified-review-tools"
      data-disabled={disabled ? "true" : undefined}
      data-tooltip={unavailableReason}
      aria-label="审阅工具"
    >
      <div className="toolbar-control-group" role="group" aria-label="页面预览">
        <button type="button" aria-label="双页对比" data-tooltip="双页对比" aria-pressed={pageView === "split"} disabled={disabled} onClick={() => onPageViewChange?.("split")} onKeyDown={handleSegmentedKeyDown}>
          <BrowsersIcon aria-hidden="true" size={14} weight="duotone" />
        </button>
        <button type="button" aria-label="只看修改前" data-tooltip="只看修改前" aria-pressed={pageView === "before"} disabled={disabled} onClick={() => onPageViewChange?.("before")} onKeyDown={handleSegmentedKeyDown}>
          <CaretLeftIcon aria-hidden="true" size={13} weight="bold" />
        </button>
        <button type="button" aria-label="只看修改后" data-tooltip="只看修改后" aria-pressed={pageView === "after"} disabled={disabled} onClick={() => onPageViewChange?.("after")} onKeyDown={handleSegmentedKeyDown}>
          <CaretRightIcon aria-hidden="true" size={13} weight="bold" />
        </button>
      </div>

      <label className="toolbar-transparency-control" data-tooltip="上下文可见度">
        <span className="sr-only">上下文可见度</span>
        <input
          type="range"
          min="0"
          max="100"
          step="1"
          value={contextVisibility}
          disabled={disabled}
          aria-label="非修改区域上下文可见度"
          style={{ "--mask-position": `${contextVisibility}%` } as CSSProperties}
          onChange={(event) => onContextVisibilityChange?.(Number(event.currentTarget.value))}
        />
      </label>

      <div className="toolbar-control-group toolbar-filter-group" role="group" aria-label="变化审阅">
        {(["all", "text", "structure"] as ReviewChangeFilter[]).map((mode) => (
          <button
            key={mode}
            type="button"
            aria-label={`${FILTER_LABELS[mode]}变化`}
            data-tooltip={`${FILTER_LABELS[mode]}变化`}
            aria-pressed={changeFilter === mode}
            disabled={disabled}
            onClick={() => onChangeFilter?.(mode)}
            onKeyDown={handleSegmentedKeyDown}
          >
            {mode === "all" ? <GitDiffIcon aria-hidden="true" size={14} weight="duotone" /> : null}
            {mode === "text" ? <TextTIcon aria-hidden="true" size={14} weight="bold" /> : null}
            {mode === "structure" ? <TreeStructureIcon aria-hidden="true" size={14} weight="duotone" /> : null}
          </button>
        ))}
      </div>

      <div className="toolbar-control-group" role="group" aria-label="滚动方式">
        <button type="button" aria-label="同步滚动" data-tooltip="同步滚动" aria-pressed={scrollMode === "linked"} disabled={disabled} onClick={() => onScrollModeChange?.("linked")}>
          <LinkIcon aria-hidden="true" size={13} weight="bold" />
        </button>
        <button type="button" aria-label="独立滚动" data-tooltip="独立滚动" aria-pressed={scrollMode === "independent"} disabled={disabled} onClick={() => onScrollModeChange?.("independent")}>
          <LinkBreakIcon aria-hidden="true" size={13} weight="bold" />
        </button>
      </div>

      <div className="toolbar-control-group" role="group" aria-label="画布缩放">
        <button type="button" aria-label="适应画布" data-tooltip="适应画布" aria-pressed={zoomMode === "fit"} disabled={disabled} onClick={() => onZoomModeChange?.("fit")}>
          <CornersOutIcon aria-hidden="true" size={13} />
        </button>
        <button className="toolbar-actual-size" type="button" aria-label="原始大小" data-tooltip="原始大小" aria-pressed={zoomMode === "actual"} disabled={disabled} onClick={() => onZoomModeChange?.("actual")}>100%</button>
      </div>

      <div className="toolbar-change-navigator" role="group" aria-label="逐处查看变化">
        <button type="button" aria-label="上一处变化" data-tooltip="上一处变化" disabled={disabled || changeCount === 0} onClick={() => onNavigate?.(-1)}>
          <CaretUpIcon aria-hidden="true" size={11} weight="bold" />
        </button>
        <span aria-live="polite"><strong>{activeIndex >= 0 ? activeIndex + 1 : 0}</strong>/{changeCount}</span>
        <button type="button" aria-label="下一处变化" data-tooltip="下一处变化" disabled={disabled || changeCount === 0} onClick={() => onNavigate?.(1)}>
          <CaretDownIcon aria-hidden="true" size={11} weight="bold" />
        </button>
        <button className="toolbar-whole-page" type="button" disabled={disabled} onClick={onShowWholePage}>整页</button>
      </div>
    </div>
  );
}
