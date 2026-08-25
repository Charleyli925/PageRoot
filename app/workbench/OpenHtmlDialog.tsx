"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from "react";
import { CaretRightIcon } from "@phosphor-icons/react/dist/csr/CaretRight";
import { FolderOpenIcon } from "@phosphor-icons/react/dist/csr/FolderOpen";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";

import type { BackgroundProjectResult, RegisteredProject } from "./types";
import RegisteredProjectList from "./RegisteredProjectList";
import styles from "./open-html-dialog.module.css";

type OpenHtmlDialogProps = {
  anchorRef: RefObject<HTMLElement | null>;
  projects: RegisteredProject[];
  projectsError: string;
  activeProjectId: string | null;
  actionsDisabled: boolean;
  canForgetRecent: boolean;
  statusForSource: (sourcePath: string) => BackgroundProjectResult | null;
  onOpenLocal: () => void;
  onOpenProject: (projectId: string) => void;
  onForgetRecent: (sourcePath: string) => void;
  onRetryProjects: () => void;
  onClose: () => void;
};

function requireTrustedEvent(event: { isTrusted?: boolean } | null) {
  return Boolean(event && event.isTrusted === true);
}

export default function OpenHtmlDialog({
  anchorRef,
  projects,
  projectsError,
  activeProjectId,
  actionsDisabled,
  canForgetRecent,
  statusForSource,
  onOpenLocal,
  onOpenProject,
  onForgetRecent,
  onRetryProjects,
  onClose,
}: OpenHtmlDialogProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const openLocalButtonRef = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    openLocalButtonRef.current?.focus();
  }, []);

  // Anchor the popover under the “+” button with their left edges aligned,
  // clamped so it never leaves the viewport.
  useEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return undefined;
    const update = () => {
      const rect = anchor.getBoundingClientRect();
      const width = Math.min(380, window.innerWidth - 24);
      const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
      setPosition({ top: Math.round(rect.bottom + 6), left: Math.round(left) });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [anchorRef]);

  const close = useCallback((event?: { isTrusted?: boolean }) => {
    if (event && !requireTrustedEvent(event)) return;
    onClose();
  }, [onClose]);

  const handleKeyDown = useCallback((event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close(event);
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>(
      "button:not(:disabled)",
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
  }, [close]);

  const handleBackdropMouseDown = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    close(event);
  }, [close]);

  return (
    <div className={styles.backdrop} onMouseDown={handleBackdropMouseDown}>
      <section
        ref={dialogRef}
        className={styles.popover}
        role="dialog"
        aria-label="打开 HTML"
        style={position
          ? { top: position.top, left: position.left }
          : { visibility: "hidden" }}
        onKeyDown={handleKeyDown}
      >
        <header className={styles.header}>
          <span className={styles.icon} aria-hidden="true">
            <FolderOpenIcon size={18} weight="duotone" />
          </span>
          <span className={styles.heading}>
            <small>源页工作区</small>
            <h2>打开 HTML</h2>
          </span>
          <button
            className={styles.close}
            type="button"
            aria-label="关闭"
            title="关闭"
            onClick={(event) => close(event)}
          >
            <XIcon aria-hidden="true" size={14} weight="bold" />
          </button>
        </header>
        <div className={styles.body}>
          <RegisteredProjectList
            projects={projects}
            error={projectsError}
            activeProjectId={activeProjectId}
            actionsDisabled={actionsDisabled}
            canForgetRecent={canForgetRecent}
            statusForSource={statusForSource}
            onOpen={onOpenProject}
            onForgetRecent={onForgetRecent}
            onRetry={onRetryProjects}
          />

          <button
            ref={openLocalButtonRef}
            className="open-local-button"
            type="button"
            onClick={() => onOpenLocal()}
          >
            <span><PlusIcon aria-hidden="true" size={14} weight="bold" /></span>
            <span>
              <strong>打开本地 HTML</strong>
              <small>选择 .html 或 .htm 文件</small>
            </span>
            <CaretRightIcon aria-hidden="true" size={13} weight="bold" />
          </button>
        </div>
      </section>
    </div>
  );
}
