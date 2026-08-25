"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { FolderIcon } from "@phosphor-icons/react/dist/csr/Folder";

import styles from "./rename-project-dialog.module.css";

type RenameProjectDialogProps = {
  projectName: string;
  busy?: boolean;
  error?: string;
  onCancel: () => void;
  onConfirm: (stem: string) => void;
};

function requireTrustedEvent(event: { isTrusted?: boolean } | null) {
  return Boolean(event && event.isTrusted === true);
}

export default function RenameProjectDialog({
  projectName,
  busy = false,
  error = "",
  onCancel,
  onConfirm,
}: RenameProjectDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const errorId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(projectName);

  useEffect(() => {
    // The dialog opens on the name it is about to replace, fully selected: the
    // usual edit is a new name, not an addition to the old one.
    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, []);

  const requestedStem = draft.normalize("NFC").trim();
  const submittable = Boolean(requestedStem)
    && requestedStem !== projectName.normalize("NFC").trim()
    && !busy;

  const cancel = useCallback((event?: { isTrusted?: boolean }) => {
    if (event && !requireTrustedEvent(event)) return;
    if (busy) return;
    onCancel();
  }, [busy, onCancel]);

  const confirm = useCallback((event: { isTrusted?: boolean }) => {
    if (!requireTrustedEvent(event) || !submittable) return;
    onConfirm(requestedStem);
  }, [onConfirm, requestedStem, submittable]);

  const handleKeyDown = useCallback((event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      cancel(event);
      return;
    }
    if (event.key === "Enter" && !(event.target instanceof HTMLButtonElement)) {
      event.preventDefault();
      confirm(event);
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>(
      "button:not(:disabled), input:not(:disabled)",
    ) || [])];
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable.at(-1) || first;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }, [cancel, confirm]);

  const handleBackdropMouseDown = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    cancel(event);
  }, [cancel]);

  return (
    <div className={styles.backdrop} onMouseDown={handleBackdropMouseDown}>
      <section
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        aria-busy={busy ? "true" : undefined}
        data-busy={busy ? "true" : "false"}
        onKeyDown={handleKeyDown}
      >
        <header className={styles.header}>
          <div className={styles.icon} aria-hidden="true">
            <FolderIcon size={24} weight="duotone" />
          </div>
          <h2 id={titleId}>重命名项目</h2>
        </header>
        <div className={styles.body} id={descriptionId}>
          <p>
            项目名就是项目文件夹的名字，改名会真的把文件夹改名。
          </p>
          <p className={styles.note}>
            项目里的 HTML 文件名、全部历史版本和评论都不会变。
          </p>
        </div>
        <label className={styles.field}>
          <span>项目名</span>
          <input
            ref={inputRef}
            aria-invalid={error ? "true" : undefined}
            aria-describedby={error ? errorId : undefined}
            autoComplete="off"
            disabled={busy}
            maxLength={180}
            spellCheck={false}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        </label>
        {error ? (
          <p className={styles.error} id={errorId} role="alert">{error}</p>
        ) : null}
        {busy ? (
          <p className={styles.srOnly} aria-live="polite">正在重命名…</p>
        ) : null}
        <div className={styles.actions}>
          <button
            className={styles.secondary}
            type="button"
            disabled={busy}
            onClick={(event) => cancel(event)}
          >
            取消
          </button>
          <button
            className={styles.primary}
            type="button"
            disabled={!submittable}
            onClick={(event) => confirm(event)}
          >
            {busy ? "正在重命名…" : "重命名"}
          </button>
        </div>
      </section>
    </div>
  );
}
