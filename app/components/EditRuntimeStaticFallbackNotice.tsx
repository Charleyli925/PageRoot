"use client";

import { useState } from "react";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import type { HtmlCanvasRuntimeDegradation } from "./HtmlCanvasEditor";

export type EditRuntimeStaticFallbackNoticeState =
  | HtmlCanvasRuntimeDegradation
  | "direct-static-visible";

export default function EditRuntimeStaticFallbackNotice({
  onRetry,
  onExport,
  state = "none",
}: {
  onRetry?: () => void;
  onExport?: () => void;
  state?: EditRuntimeStaticFallbackNoticeState;
}) {
  const [dismissedState, setDismissedState] = useState<
    EditRuntimeStaticFallbackNoticeState | null
  >(null);
  const latestStaticVisible = state === "static-visible";
  const directStaticVisible = state === "direct-static-visible";
  const lastKnownGoodReadOnly = state === "last-known-good-readonly";
  if (!lastKnownGoodReadOnly && dismissedState === state) return null;

  return (
    <section
      className="edit-runtime-static-fallback"
      data-testid="edit-runtime-static-fallback"
      role={lastKnownGoodReadOnly ? "alert" : "status"}
      aria-live={lastKnownGoodReadOnly ? "assertive" : "polite"}
    >
      <strong>{lastKnownGoodReadOnly
        ? "动态和静态页面都未能更新"
        : latestStaticVisible
          ? "部分动态内容未更新"
          : directStaticVisible
            ? "部分动态内容未运行"
          : "部分动态内容未加载"}</strong>
      <span>{lastKnownGoodReadOnly
        ? "当前画面是上一次可用预览；最新 HTML 未回滚。"
        : latestStaticVisible
          ? "已显示最新源码的静态页面，仍可编辑和保存。"
          : directStaticVisible
            ? "当前已显示静态页面，仍可编辑和保存。"
          : "旧页面会保持可见，直到最新静态页面准备完成。"}</span>
      {onRetry ? (
        <button
          type="button"
          className="edit-runtime-static-fallback__retry"
          onClick={onRetry}
        >
          {lastKnownGoodReadOnly ? "重新加载" : "重新加载动态内容"}
        </button>
      ) : null}
      {lastKnownGoodReadOnly && onExport ? (
        <button
          type="button"
          className="edit-runtime-static-fallback__retry"
          onClick={onExport}
        >
          导出当前 HTML
        </button>
      ) : null}
      {!lastKnownGoodReadOnly ? (
        <button
          type="button"
          className="edit-runtime-static-fallback__close"
          aria-label="关闭动态内容提示"
          onClick={() => setDismissedState(state)}
        >
          <XIcon aria-hidden="true" size={14} weight="bold" />
        </button>
      ) : null}
    </section>
  );
}
