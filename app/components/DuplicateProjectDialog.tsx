"use client";

import {
  useEffect,
  useRef,
  type MouseEvent,
} from "react";

type DuplicateProjectDialogProps = {
  open: boolean;
  busy?: boolean;
  onClose: () => void;
  onReassociate: () => void;
  onImportAsNew: () => void;
};

export default function DuplicateProjectDialog({
  open,
  busy = false,
  onClose,
  onReassociate,
  onImportAsNew,
}: DuplicateProjectDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      const frame = requestAnimationFrame(() => cancelRef.current?.focus());
      return () => cancelAnimationFrame(frame);
    }
    if (!open && dialog.open) dialog.close();
    return undefined;
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className="cancel-ai-run-dialog"
      aria-labelledby="duplicate-project-title"
      aria-describedby="duplicate-project-description"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      onClose={onClose}
      onMouseDown={(event: MouseEvent<HTMLDialogElement>) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <article className="cancel-ai-run-card duplicate-project-card">
        <h2 id="duplicate-project-title">发现重复项目身份</h2>
        <p id="duplicate-project-description">
          当前 HTML 所在文件夹与已知位置使用同一个项目身份。请选择要继续使用的位置，或仅将当前 HTML 导入为新的 V1 项目。
        </p>
        <footer>
          <button
            ref={cancelRef}
            className="cancel-ai-run-end"
            type="button"
            disabled={busy}
            onClick={onClose}
          >
            取消
          </button>
          <button
            className="duplicate-project-import"
            type="button"
            disabled={busy}
            onClick={onImportAsNew}
          >
            作为新项目导入
          </button>
          <button
            className="cancel-ai-run-wait"
            type="button"
            disabled={busy}
            onClick={onReassociate}
          >
            重新关联到此位置
          </button>
        </footer>
      </article>
    </dialog>
  );
}
