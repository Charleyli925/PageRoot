"use client";

import { useEffect, useState } from "react";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";

import styles from "./FirstEditGuideCard.module.css";

export type FirstEditGuideCardProps = {
  visible: boolean;
  onDismiss: () => void;
};

const LEAVE_MS = 200;

const STEPS = [
  "打开自己的 HTML，添加为项目",
  "双击改字，自动保存在当前页",
  "单击要改的区域，写下评论，AI 会按这里改",
  "点右上角发送，把任务粘贴给 AI Agent",
] as const;

function prefersReducedMotion() {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export default function FirstEditGuideCard({
  visible,
  onDismiss,
}: FirstEditGuideCardProps) {
  const [mounted, setMounted] = useState(visible);

  if (visible && !mounted) {
    setMounted(true);
  }

  useEffect(() => {
    if (visible || !mounted) return undefined;
    const delay = prefersReducedMotion() ? 0 : LEAVE_MS;
    const timer = window.setTimeout(() => {
      setMounted(false);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [visible, mounted]);

  if (!mounted) return null;
  return (
    <aside
      className={styles.host}
      data-testid="first-edit-guide"
      data-leaving={visible ? undefined : "true"}
      role="region"
      aria-label="快速开始"
    >
      <div className={styles.card}>
        <p className="sr-only" aria-live="polite">
          快速开始。{STEPS.join("。")}。
        </p>
        <button
          type="button"
          className={styles.close}
          aria-label="跳过这次说明"
          onClick={onDismiss}
        >
          <XIcon aria-hidden="true" size={12} weight="bold" />
        </button>
        <h2 className={styles.title}>快速开始</h2>
        <ol className={styles.list}>
          {STEPS.map((label, index) => (
            <li key={label} className={styles.row}>
              <span className={styles.index} aria-hidden="true">
                {index + 1}
              </span>
              <span>{label}</span>
            </li>
          ))}
        </ol>
      </div>
    </aside>
  );
}
