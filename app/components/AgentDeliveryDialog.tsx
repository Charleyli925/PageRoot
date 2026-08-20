"use client";

import {
  useEffect,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import { CheckCircleIcon } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { CopyIcon } from "@phosphor-icons/react/dist/csr/Copy";
import { PaperPlaneTiltIcon } from "@phosphor-icons/react/dist/csr/PaperPlaneTilt";
import { ShieldCheckIcon } from "@phosphor-icons/react/dist/csr/ShieldCheck";

export type AgentDeliveryMode = "qoder-acp" | "clipboard";

function triggerLabel({
  generating,
  status,
  deliveryMode,
  runInProgress,
  pendingCount,
}: {
  generating: boolean;
  status: string;
  deliveryMode: AgentDeliveryMode;
  runInProgress: boolean;
  pendingCount: number;
}) {
  if (generating) return "正在准备…";
  if (status === "copying") return "正在复制…";
  if (status === "starting") return "正在启动 Qoder…";
  if (status === "running") return "Qoder 正在处理";
  if (status === "completed") return "正在确认结果";
  if (status === "interrupted") return "Qoder 会话已中断";
  if (status === "failed") {
    return deliveryMode === "qoder-acp" ? "Qoder 需处理" : "复制失败，再试一次";
  }
  if (status === "copied" || runInProgress) return "查看本轮";
  return pendingCount === 0 ? "写评论后再发送" : "发给 AI";
}

export function AgentDeliveryButton({
  status,
  deliveryMode,
  generating,
  runInProgress,
  pendingCount,
  disabled,
  onOpenRun,
  onSelect,
}: {
  status: string;
  deliveryMode: AgentDeliveryMode;
  generating: boolean;
  runInProgress: boolean;
  pendingCount: number;
  disabled: boolean;
  onOpenRun: () => void;
  onSelect: (mode: AgentDeliveryMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const copied = status === "copied";
  return (
    <>
      <button
        className="header-send-button"
        type="button"
        data-handoff-status={status}
        data-copied={copied ? "true" : undefined}
        disabled={disabled}
        onClick={() => {
          if (runInProgress || copied) onOpenRun();
          else setOpen(true);
        }}
      >
        {copied ? (
          <CheckCircleIcon aria-hidden="true" size={15} weight="fill" />
        ) : (
          <PaperPlaneTiltIcon aria-hidden="true" size={15} weight="fill" />
        )}
        <span>{triggerLabel({ generating, status, deliveryMode, runInProgress, pendingCount })}</span>
        {pendingCount > 0 && !runInProgress && !["copied", "failed"].includes(status)
          ? <small>{pendingCount}</small>
          : null}
      </button>
      <AgentDeliveryDialog
        open={open}
        onClose={() => setOpen(false)}
        onSelect={(mode) => {
          setOpen(false);
          onSelect(mode);
        }}
      />
    </>
  );
}

export default function AgentDeliveryDialog({
  open,
  onClose,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (mode: AgentDeliveryMode) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const qoderButtonRef = useRef<HTMLButtonElement>(null);
  const backdropReadyAtRef = useRef(0);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      backdropReadyAtRef.current = performance.now() + 350;
      dialog.showModal();
      const focusFrame = requestAnimationFrame(
        () => qoderButtonRef.current?.focus(),
      );
      return () => cancelAnimationFrame(focusFrame);
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const handleBackdropPointer = (event: MouseEvent<HTMLDialogElement>) => {
    if (
      event.target === event.currentTarget
      && performance.now() >= backdropReadyAtRef.current
    ) onClose();
  };

  return (
    <dialog
      ref={dialogRef}
      className="agent-delivery-dialog"
      aria-labelledby="agent-delivery-title"
      aria-describedby="agent-delivery-description"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={onClose}
      onMouseDown={handleBackdropPointer}
    >
      <article className="agent-delivery-card">
        <header>
          <span>AGENT BRIDGE</span>
          <h2 id="agent-delivery-title">怎样交给 AI？</h2>
          <p id="agent-delivery-description">
            两种方式都只会生成待审阅 Candidate；当前 HTML 不会被自动覆盖。
          </p>
        </header>
        <div className="agent-delivery-options">
          <button
            ref={qoderButtonRef}
            className="agent-delivery-option primary"
            type="button"
            onClick={() => onSelect("qoder-acp")}
          >
            <ShieldCheckIcon aria-hidden="true" size={23} weight="duotone" />
            <span>
              <strong>用 Qoder CLI 自动执行</strong>
              <small>PageRoot 启动受管 ACP 会话并显示进度，可随时停止</small>
            </span>
            <em>ACP</em>
          </button>
          <button
            className="agent-delivery-option"
            type="button"
            onClick={() => onSelect("clipboard")}
          >
            <CopyIcon aria-hidden="true" size={22} weight="duotone" />
            <span>
              <strong>只复制任务</strong>
              <small>保留原有方式，由你粘贴给任意本地 AI Agent</small>
            </span>
          </button>
        </div>
        <aside>
          <strong>可信本机 Agent 提示</strong>
          <p>
            Qoder CLI 会使用你的本机 Qoder 账号和系统权限运行。PageRoot 会严格限制
            ACP 文件与命令接口，但这不是操作系统沙箱。选择自动执行即表示你信任本机
            独立安装的 Qoder CLI 处理本轮冻结资料。
          </p>
        </aside>
        <footer>
          <button type="button" onClick={onClose}>取消</button>
        </footer>
      </article>
    </dialog>
  );
}
