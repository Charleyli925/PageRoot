"use client";

import { CheckCircleIcon } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { InfoIcon } from "@phosphor-icons/react/dist/csr/Info";
import { WarningCircleIcon } from "@phosphor-icons/react/dist/csr/WarningCircle";
import { XCircleIcon } from "@phosphor-icons/react/dist/csr/XCircle";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";

import styles from "./NoticeBar.module.css";

export type NoticeTone = "success" | "info" | "warning" | "error";

export type NoticeBarProps = {
  title: string;
  message: string;
  tone?: NoticeTone;
  placement?: "viewport" | "canvas";
  actionLabel?: string;
  dismissLabel?: string;
  className?: string;
  onAction?: () => void;
  onDismiss: () => void;
  onPauseChange?: (paused: boolean) => void;
};

function NoticeToneIcon({ tone }: { tone: NoticeTone }) {
  if (tone === "success") {
    return <CheckCircleIcon aria-hidden="true" size={18} weight="fill" />;
  }
  if (tone === "warning") {
    return <WarningCircleIcon aria-hidden="true" size={18} weight="fill" />;
  }
  if (tone === "error") {
    return <XCircleIcon aria-hidden="true" size={18} weight="fill" />;
  }
  return <InfoIcon aria-hidden="true" size={18} weight="bold" />;
}

export default function NoticeBar({
  title,
  message,
  tone = "info",
  placement = "viewport",
  actionLabel,
  dismissLabel = "关闭提醒",
  className,
  onAction,
  onDismiss,
  onPauseChange,
}: NoticeBarProps) {
  const classes = [
    styles.notice,
    styles[placement],
    styles.visible,
    className,
    className === "toast" ? "show" : null,
  ].filter(Boolean).join(" ");

  return (
    <section
      className={classes}
      data-tone={tone}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      onMouseEnter={() => onPauseChange?.(true)}
      onMouseLeave={() => onPauseChange?.(false)}
      onFocusCapture={() => onPauseChange?.(true)}
      onBlurCapture={(event) => {
        const next = event.relatedTarget;
        if (!(next instanceof Node) || !event.currentTarget.contains(next)) {
          onPauseChange?.(false);
        }
      }}
    >
      <span className={styles.icon} aria-hidden="true">
        <NoticeToneIcon tone={tone} />
      </span>
      <span className={styles.copy}>
        <strong>{title}</strong>
        <span>{message}</span>
      </span>
      <span className={styles.actions}>
        {actionLabel && onAction ? (
          <button
            className={styles.action}
            type="button"
            onClick={onAction}
          >
            {actionLabel}
          </button>
        ) : null}
        <button
          className={styles.close}
          type="button"
          aria-label={dismissLabel}
          onClick={onDismiss}
        >
          <XIcon aria-hidden="true" size={15} weight="bold" />
        </button>
      </span>
    </section>
  );
}
