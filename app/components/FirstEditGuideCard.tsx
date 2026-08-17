"use client";

import { useEffect, useState } from "react";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import { CursorTextIcon } from "@phosphor-icons/react/dist/csr/CursorText";
import { EyeIcon } from "@phosphor-icons/react/dist/csr/Eye";
import { CursorClickIcon } from "@phosphor-icons/react/dist/csr/CursorClick";

import styles from "./FirstEditGuideCard.module.css";

export type FirstEditGuideCardProps = {
  visible: boolean;
  onDismiss: () => void;
};

const LEAVE_MS = 200;

const ROWS = [
  { icon: "pointer", label: "单击选择" },
  { icon: "text", label: "双击文字直接编辑" },
  { icon: "eye", label: "点击“预览”查看最终效果。" },
] as const;

function RowIcon({ name }: { name: (typeof ROWS)[number]["icon"] }) {
  if (name === "text") {
    return <CursorTextIcon aria-hidden="true" size={16} weight="duotone" />;
  }
  if (name === "eye") {
    return <EyeIcon aria-hidden="true" size={16} weight="duotone" />;
  }
  return <CursorClickIcon aria-hidden="true" size={16} weight="duotone" />;
}

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
      className={styles.card}
      data-testid="first-edit-guide"
      data-leaving={visible ? undefined : "true"}
      role="region"
      aria-label="快速开始"
    >
      <p className="sr-only" aria-live="polite">
        快速开始。单击选择。双击文字直接编辑。点击预览查看最终效果。
      </p>
      <button
        type="button"
        className={styles.close}
        aria-label="关闭"
        onClick={onDismiss}
      >
        <XIcon aria-hidden="true" size={12} weight="bold" />
      </button>
      <h2 className={styles.title}>快速开始</h2>
      <ul className={styles.list}>
        {ROWS.map((row) => (
          <li key={row.label} className={styles.row}>
            <span className={styles.icon} data-icon={row.icon}>
              <RowIcon name={row.icon} />
            </span>
            <span>{row.label}</span>
          </li>
        ))}
      </ul>
      <div className={styles.footer}>
        <button type="button" className={styles.confirm} onClick={onDismiss}>
          知道了
        </button>
      </div>
    </aside>
  );
}
