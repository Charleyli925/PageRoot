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
import { FileHtmlIcon } from "@phosphor-icons/react/dist/csr/FileHtml";
import { FolderOpenIcon } from "@phosphor-icons/react/dist/csr/FolderOpen";

import { productErrorMessage } from "../lib/notification-policy.js";
import styles from "./external-html-open-dialog.module.css";

export type ExternalHtmlOpenConfirmation = {
  requestId: string;
  classification: string;
  sourceFileName?: string;
  visibleV1FileName?: string;
  projectsRootLabel?: string;
  projectName?: string;
  currentBasedOnOrdinal?: number;
  latestOfficialOrdinal?: number;
  currentDiffersFromBase?: boolean;
  sourceRelation?: "unchanged" | "changed";
};

type ExternalHtmlOpenDialogProps = {
  confirmation: ExternalHtmlOpenConfirmation;
  deleteOriginal: boolean;
  busy?: boolean;
  onDeleteOriginalChange: (next: boolean) => void;
  onCancel: () => void;
  onConfirm: (action: "import-new" | "continue-current") => void;
};

function requireTrustedEvent(
  event: { isTrusted?: boolean } | null,
) {
  return Boolean(event && event.isTrusted === true);
}

function versionLabel(ordinal: number | undefined) {
  const value = Number(ordinal);
  return Number.isFinite(value) && value > 0 ? `版本 ${value}` : "当前版本";
}

// The full breadcrumb stays in the tooltip and accessible name; the sentence only
// carries the folder itself, plus its parent while the pair stays short enough to read.
function folderNameFromBreadcrumb(breadcrumb: string) {
  const segments = breadcrumb.split("›").map((segment) => segment.trim()).filter(Boolean);
  const folder = segments.at(-1) || breadcrumb.trim();
  const parent = segments.at(-2);
  if (!parent) return folder;
  const pair = `${parent} › ${folder}`;
  return pair.length <= 28 ? pair : folder;
}

export default function ExternalHtmlOpenDialog({
  confirmation,
  deleteOriginal,
  busy = false,
  onDeleteOriginalChange,
  onCancel,
  onConfirm,
}: ExternalHtmlOpenDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const primaryButtonRef = useRef<HTMLButtonElement>(null);
  const [folderOpenError, setFolderOpenError] = useState("");
  const isNewExternal = confirmation.classification === "new-external";
  const sourceFileName = confirmation.sourceFileName || "这个 HTML";
  const projectsRootLabel = confirmation.projectsRootLabel || "文稿 › PageRoot › 项目";
  const projectsRootFolderName = folderNameFromBreadcrumb(projectsRootLabel);
  const visibleV1FileName = confirmation.visibleV1FileName || "项目内的 V1 文件";
  const projectName = confirmation.projectName || sourceFileName.replace(/\.html?$/iu, "");
  const basedOn = versionLabel(confirmation.currentBasedOnOrdinal);
  const latestOfficial = versionLabel(confirmation.latestOfficialOrdinal);
  const currentEditLine = confirmation.currentDiffersFromBase
    ? `基于${basedOn} · 有已保存修改`
    : `基于${basedOn} · 与该版本一致`;
  const sourceRelationLine = confirmation.sourceRelation === "changed"
    ? "当前这份原文件在首次导入后发生了变化；继续不会把这些变化自动导入或覆盖项目内容。"
    : "当前这份原文件与项目初始版本 V1 完全一致。";
  const primaryLabel = isNewExternal ? "导入并打开" : "继续当前项目";
  const busyLabel = isNewExternal ? "正在导入…" : "正在打开…";

  useEffect(() => {
    primaryButtonRef.current?.focus();
  }, [confirmation.requestId]);

  const cancel = useCallback((event?: { isTrusted?: boolean }) => {
    if (event && !requireTrustedEvent(event)) return;
    if (busy) return;
    onCancel();
  }, [busy, onCancel]);

  const confirm = useCallback((event: { isTrusted?: boolean }) => {
    if (!requireTrustedEvent(event) || busy) return;
    onConfirm(isNewExternal ? "import-new" : "continue-current");
  }, [busy, isNewExternal, onConfirm]);

  const openProjectsRoot = useCallback((event: ReactMouseEvent<HTMLButtonElement>) => {
    if (!requireTrustedEvent(event) || busy) return;
    const open = window.htmlAIProjects?.openProjectsRoot;
    if (!open) return;
    void open().then(
      () => setFolderOpenError(""),
      (cause: unknown) => setFolderOpenError(productErrorMessage(
        cause,
        "PageRoot 项目文件夹暂时无法打开，请稍后重试。",
      )),
    );
  }, [busy]);

  const handleKeyDown = useCallback((event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      cancel(event);
      return;
    }
    if (
      event.key === "Enter"
      && !(event.target instanceof HTMLButtonElement)
      && !(event.target instanceof HTMLInputElement)
    ) {
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
    <div
      className={styles.backdrop}
      onMouseDown={handleBackdropMouseDown}
    >
      <section
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        aria-busy={busy ? "true" : undefined}
        data-classification={confirmation.classification}
        data-busy={busy ? "true" : "false"}
        onKeyDown={handleKeyDown}
      >
        <header className={styles.header}>
          <div
            className={styles.icon}
            data-kind={isNewExternal ? "import" : "known"}
            aria-hidden="true"
          >
            {isNewExternal
              ? <FileHtmlIcon size={24} weight="duotone" />
              : <FolderOpenIcon size={24} weight="duotone" />}
          </div>
          <h2 id={titleId}>
            {isNewExternal ? (
              <>
                要把「
                <span className={styles.fileName}>{sourceFileName}</span>
                」导入 PageRoot 吗？
              </>
            ) : (
              <>
                「
                <span className={styles.fileName}>{sourceFileName}</span>
                」已经导入 PageRoot
              </>
            )}
          </h2>
        </header>
        {isNewExternal ? (
          <>
            <div className={styles.body} id={descriptionId}>
              <p>
                会在「
                <span className={styles.folderName} title={projectsRootLabel}>
                  {projectsRootFolderName}
                </span>
                」
                <button
                  className={styles.openFolder}
                  type="button"
                  disabled={busy}
                  aria-label={`点击打开 ${projectsRootLabel}`}
                  title={`打开 ${projectsRootLabel}`}
                  onClick={openProjectsRoot}
                >
                  （<span>点击打开</span>）
                </button>
                里新建项目，<strong>复制</strong>本文件并保存为
                {" "}
                <span className={styles.fileChip}>{visibleV1FileName}</span>
                。
              </p>
              {folderOpenError ? (
                <p className={styles.folderError} role="alert">{folderOpenError}</p>
              ) : null}
            </div>
            <label className={styles.deleteOption} data-checked={deleteOriginal ? "true" : "false"}>
              <span className={styles.checkbox}>
                <input
                  type="checkbox"
                  checked={deleteOriginal}
                  disabled={busy}
                  onChange={(event) => {
                    if (!requireTrustedEvent(event)) return;
                    onDeleteOriginalChange(event.currentTarget.checked);
                  }}
                />
              </span>
              <span>成功导入后，同意将原文件移至废纸篓。</span>
            </label>
          </>
        ) : (
          <div className={styles.body} id={descriptionId}>
            <p>这份原文件已关联到项目「{projectName}」。</p>
            <dl className={styles.facts}>
              <div>
                <dt>当前本地编辑</dt>
                <dd>{currentEditLine}</dd>
              </div>
              <div>
                <dt>最新正式版本</dt>
                <dd>{latestOfficial}</dd>
              </div>
            </dl>
            <p className={styles.note}>{sourceRelationLine}</p>
          </div>
        )}
        {busy ? (
          <p className={styles.srOnly} aria-live="polite">
            {busyLabel}
          </p>
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
            ref={primaryButtonRef}
            className={styles.primary}
            type="button"
            disabled={busy}
            onClick={(event) => confirm(event)}
          >
            {busy ? busyLabel : primaryLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
