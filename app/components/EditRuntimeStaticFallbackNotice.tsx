"use client";

import { useState } from "react";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";

export default function EditRuntimeStaticFallbackNotice() {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  return (
    <section
      className="edit-runtime-static-fallback"
      data-testid="edit-runtime-static-fallback"
      role="status"
      aria-live="polite"
    >
      <strong>脚本未在编辑画布中运行</strong>
      <span>此页面已静态显示；源码编辑和保存仍然有效。</span>
      <button
        type="button"
        aria-label="关闭脚本运行提示"
        onClick={() => setDismissed(true)}
      >
        <XIcon aria-hidden="true" size={14} weight="bold" />
      </button>
    </section>
  );
}
