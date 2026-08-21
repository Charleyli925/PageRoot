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
import { XIcon } from "@phosphor-icons/react/dist/csr/X";

import type {
  QoderAvailabilitySnapshot,
  QoderGuidanceKind,
} from "../domain/qoder-availability.js";
import QoderAvailabilityCard from "./QoderAvailabilityCard";

export type AgentDeliveryMode = "qoder-acp" | "clipboard";

type AgentDeliveryOutcome = Readonly<{
  status: string;
  reason?: string;
}> | null | undefined;

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
  availability,
  onOpenRun,
  onSelect,
  onRefreshAvailability,
  onCheckUsability,
  onCopyGuidance,
}: {
  status: string;
  deliveryMode: AgentDeliveryMode;
  generating: boolean;
  runInProgress: boolean;
  pendingCount: number;
  disabled: boolean;
  availability: QoderAvailabilitySnapshot;
  onOpenRun: () => void;
  onSelect: (mode: AgentDeliveryMode) => Promise<AgentDeliveryOutcome>;
  onRefreshAvailability: () => Promise<AgentDeliveryOutcome>;
  onCheckUsability: () => Promise<AgentDeliveryOutcome>;
  onCopyGuidance: (kind: QoderGuidanceKind) => Promise<AgentDeliveryOutcome>;
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
        availability={availability}
        onClose={() => setOpen(false)}
        onRefreshAvailability={onRefreshAvailability}
        onCheckUsability={onCheckUsability}
        onCopyGuidance={onCopyGuidance}
        onSelect={async (mode) => {
          if (mode === "clipboard") setOpen(false);
          const outcome = await onSelect(mode);
          const accepted = Boolean(
            outcome
            && ["succeeded", "unknown", "stale"].includes(outcome.status),
          );
          if (mode === "qoder-acp" && accepted) setOpen(false);
          return accepted;
        }}
      />
    </>
  );
}

export default function AgentDeliveryDialog({
  open,
  availability,
  onClose,
  onSelect,
  onRefreshAvailability,
  onCheckUsability,
  onCopyGuidance,
}: {
  open: boolean;
  availability: QoderAvailabilitySnapshot;
  onClose: () => void;
  onSelect: (mode: AgentDeliveryMode) => Promise<boolean>;
  onRefreshAvailability: () => Promise<AgentDeliveryOutcome>;
  onCheckUsability: () => Promise<AgentDeliveryOutcome>;
  onCopyGuidance: (kind: QoderGuidanceKind) => Promise<AgentDeliveryOutcome>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const backdropReadyAtRef = useRef(0);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      backdropReadyAtRef.current = performance.now() + 350;
      dialog.showModal();
      void onRefreshAvailability();
      const focusFrame = requestAnimationFrame(() => {
        const primary = dialog.querySelector<HTMLElement>("[data-qoder-primary='true']");
        (primary || dialog.querySelector<HTMLElement>(".agent-delivery-close"))?.focus();
      });
      return () => cancelAnimationFrame(focusFrame);
    }
    if (!open && dialog.open) dialog.close();
  }, [onRefreshAvailability, open]);

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
        <button
          className="agent-delivery-close"
          type="button"
          aria-label="关闭怎样交给 AI"
          title="关闭"
          onClick={onClose}
        >
          <XIcon aria-hidden="true" size={17} weight="bold" />
        </button>

        <header>
          <h2 id="agent-delivery-title">怎样交给 AI？</h2>
          <p id="agent-delivery-description">
            结果会先进入审阅，不会覆盖当前页面。
          </p>
        </header>

        <div className="agent-delivery-options">
          <QoderAvailabilityCard
            availability={availability}
            surface="delivery"
            onActivate={() => onSelect("qoder-acp")}
            onRefreshLocal={onRefreshAvailability}
            onCheckUsability={onCheckUsability}
            onCopyGuidance={onCopyGuidance}
          />

          <button
            className="agent-delivery-option clipboard"
            type="button"
            onClick={() => void onSelect("clipboard")}
          >
            <span className="agent-delivery-option-icon" aria-hidden="true">
              <CopyIcon size={20} weight="duotone" />
            </span>
            <span>
              <strong>复制任务</strong>
              <small>粘贴给 Qoder 或其他 AI Agent</small>
            </span>
          </button>
        </div>

        <p className="agent-delivery-safety">
          Qoder 会读取本轮 HTML、评论和附件；结果先进入审阅。
        </p>
      </article>
    </dialog>
  );
}
