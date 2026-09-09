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
  onRetry?: () => boolean | Promise<boolean>;
  onExport?: () => void;
  state?: EditRuntimeStaticFallbackNoticeState;
}) {
  const [dismissedState, setDismissedState] = useState<
    EditRuntimeStaticFallbackNoticeState | null
  >(null);
  const [retrying, setRetrying] = useState(false);
  const [retryFailed, setRetryFailed] = useState(false);
  const directStaticVisible = state === "direct-static-visible";
  const lastKnownGoodReadOnly = state === "last-known-good-readonly";
  // A verified static projection is an ordinary editable surface. Keep the
  // chrome quiet and expose the optional dynamic retry through the More menu.
  if (state === "none" || state === "static-visible" || directStaticVisible) return null;
  if (!lastKnownGoodReadOnly && dismissedState === state) return null;

  return (
    <section
      className="edit-runtime-static-fallback"
      data-testid="edit-runtime-static-fallback"
      role={lastKnownGoodReadOnly ? "alert" : "status"}
      aria-live={lastKnownGoodReadOnly ? "assertive" : "polite"}
    >
      <strong>{lastKnownGoodReadOnly
        ? "页面暂时无法编辑"
        : "部分动态内容未加载"}</strong>
      <span>{lastKnownGoodReadOnly
        ? "仍显示上一次可用预览，你的修改已保留。请重新加载后继续。"
        : "正在恢复页面，完成后即可继续编辑。"}</span>
      {onRetry ? (
        <button
          type="button"
          className="edit-runtime-static-fallback__retry"
          disabled={retrying}
          onClick={async () => {
            setRetrying(true);
            setRetryFailed(false);
            try { setRetryFailed(!await onRetry()); }
            catch { setRetryFailed(true); }
            finally { setRetrying(false); }
          }}
        >
          {retrying
            ? "正在重新加载…"
            : lastKnownGoodReadOnly
              ? "重新载入当前 HTML"
              : "重新加载动态内容"}
        </button>
      ) : null}
      {retryFailed ? <span role="status">{lastKnownGoodReadOnly
        ? "暂时无法重新载入，请检查文件保存状态后重试。"
        : "动态内容仍未恢复，当前页面仍可继续编辑和保存。"}</span> : null}
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
