"use client";

import {
  useEffect,
  useRef,
  type MouseEvent,
} from "react";

type RestartUpdateDialogProps = {
  open: boolean;
  installing: boolean;
  onClose: () => void;
  onRestartNow: () => void;
};

export default function RestartUpdateDialog({
  open,
  installing,
  onClose,
  onRestartNow,
}: RestartUpdateDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const laterButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      requestAnimationFrame(() => laterButtonRef.current?.focus());
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  const handleBackdropPointer = (event: MouseEvent<HTMLDialogElement>) => {
    if (event.target === event.currentTarget && !installing) onClose();
  };

  return (
    <dialog
      ref={dialogRef}
      className="restart-update-dialog"
      aria-labelledby="restart-update-title"
      aria-describedby="restart-update-description"
      onCancel={(event) => {
        event.preventDefault();
        if (!installing) onClose();
      }}
      onClose={onClose}
      onMouseDown={handleBackdropPointer}
    >
      <article className="restart-update-card">
        <h2 id="restart-update-title">现在重启并安装更新？</h2>
        <p id="restart-update-description">
          源页会先确认当前编辑已安全写入，然后关闭并安装新版本。
        </p>
        <footer>
          <button
            ref={laterButtonRef}
            className="restart-update-later"
            type="button"
            disabled={installing}
            onClick={onClose}
          >
            稍后
          </button>
          <button
            className="restart-update-now"
            type="button"
            disabled={installing}
            onClick={onRestartNow}
          >
            {installing ? "正在重启…" : "现在重启"}
          </button>
        </footer>
      </article>
    </dialog>
  );
}
