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
import { FileHtmlIcon } from "@phosphor-icons/react/dist/csr/FileHtml";
import { FolderOpenIcon } from "@phosphor-icons/react/dist/csr/FolderOpen";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";

import type { BackgroundProjectResult, RecentProject } from "./types";
import { folderFromSourcePath, formatProjectTimestamp } from "./project-model";
import styles from "./open-html-dialog.module.css";

type OpenHtmlDialogProps = {
  anchorRef: RefObject<HTMLElement | null>;
  recentProjects: RecentProject[];
  recentProjectsError: string;
  actionsDisabled: boolean;
  canForgetRecent: boolean;
  statusForSource: (sourcePath: string) => BackgroundProjectResult | null;
  onOpenLocal: () => void;
  onOpenRecent: (sourcePath: string) => void;
  onForgetRecent: (sourcePath: string) => void;
  onRetryRecents: () => void;
  onClose: () => void;
};

function requireTrustedEvent(event: { isTrusted?: boolean } | null) {
  return Boolean(event && event.isTrusted === true);
}

export default function OpenHtmlDialog({
  anchorRef,
  recentProjects,
  recentProjectsError,
  actionsDisabled,
  canForgetRecent,
  statusForSource,
  onOpenLocal,
  onOpenRecent,
  onForgetRecent,
  onRetryRecents,
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
            <FolderOpenIcon size={22} weight="duotone" />
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
            <XIcon aria-hidden="true" size={16} weight="bold" />
          </button>
        </header>
        <div className={styles.body}>
          <section className="recent-files">
            <header>
              <strong>最近打开</strong>
              <small>{recentProjects.length} 个文件</small>
            </header>
            <div>
              {recentProjectsError ? (
                <section className="recent-projects-error" role="status">
                  <span>{recentProjectsError}</span>
                  <button type="button" onClick={() => onRetryRecents()}>
                    重试读取
                  </button>
                </section>
              ) : null}
              {recentProjects.length ? recentProjects.map((project) => {
                const projectStatus = statusForSource(project.sourcePath);
                return (
                  <div className="recent-file-item" key={project.path}>
                    <button
                      className="recent-file-row"
                      type="button"
                      disabled={actionsDisabled}
                      onClick={() => onOpenRecent(project.sourcePath)}
                    >
                      <FileHtmlIcon aria-hidden="true" size={19} weight="duotone" />
                      <span>
                        <strong>{project.name}</strong>
                        <small>{folderFromSourcePath(project.sourcePath)}</small>
                      </span>
                      <time dateTime={new Date(project.lastOpenedAt).toISOString()}>
                        {formatProjectTimestamp(project.lastOpenedAt)}
                      </time>
                      {projectStatus ? (
                        <em
                          className="recent-project-status"
                          data-state={projectStatus.state}
                        >{projectStatus.label}</em>
                      ) : null}
                      <CaretRightIcon aria-hidden="true" size={14} weight="bold" />
                    </button>
                    {canForgetRecent ? (
                      <button
                        className="recent-file-remove"
                        type="button"
                        aria-label={`从最近打开中移除 ${project.name}`}
                        title="移除这条记录"
                        onClick={() => onForgetRecent(project.sourcePath)}
                      >
                        <XIcon aria-hidden="true" size={14} weight="bold" />
                      </button>
                    ) : null}
                  </div>
                );
              }) : !recentProjectsError ? (
                <span className="recent-projects-empty">还没有最近打开的文件</span>
              ) : null}
            </div>
          </section>

          <button
            ref={openLocalButtonRef}
            className="open-local-button"
            type="button"
            onClick={() => onOpenLocal()}
          >
            <span><PlusIcon aria-hidden="true" size={19} weight="bold" /></span>
            <span>
              <strong>打开本地 HTML</strong>
              <small>选择已有的 .html 或 .htm 文件</small>
            </span>
            <CaretRightIcon aria-hidden="true" size={15} weight="bold" />
          </button>
        </div>
      </section>
    </div>
  );
}
