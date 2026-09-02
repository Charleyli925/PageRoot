"use client";

import { useState } from "react";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";

export default function EditRuntimeStaticFallbackNotice({
  onRetry,
}: {
  onRetry: () => void;
}) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  return (
    <section
      className="edit-runtime-static-fallback"
      data-testid="edit-runtime-static-fallback"
      role="status"
      aria-live="polite"
    >
      <strong>部分动态内容未加载</strong>
      <span>页面仍可编辑和保存。</span>
      <button
        type="button"
        className="edit-runtime-static-fallback__retry"
        onClick={onRetry}
      >
        重新加载动态内容
      </button>
      <button
        type="button"
        className="edit-runtime-static-fallback__close"
        aria-label="关闭动态内容提示"
        onClick={() => setDismissed(true)}
      >
        <XIcon aria-hidden="true" size={14} weight="bold" />
      </button>
    </section>
  );
}
