"use client";

import { useState, type Ref } from "react";

import {
  qoderAvailabilityPresentation,
  type QoderAvailabilitySnapshot,
  type QoderGuidanceKind,
} from "../domain/qoder-availability.js";

type QoderActionOutcome = Readonly<{
  status: string;
  reason?: string;
}> | null | undefined;

type QoderAvailabilityCardProps = {
  availability: QoderAvailabilitySnapshot;
  surface: "delivery" | "about";
  disabled?: boolean;
  actionButtonRef?: Ref<HTMLButtonElement>;
  onCopyGuidance: (kind: QoderGuidanceKind) => Promise<QoderActionOutcome>;
};

function actionForAvailability(availability: QoderAvailabilitySnapshot) {
  if (availability.status === "not-installed") {
    return {
      kind: "install" as const,
      label: "复制安装指令至 Agent",
      copiedLabel: "复制安装指令至 Agent",
    };
  }
  if (availability.status === "auth-required") {
    return {
      kind: "login" as const,
      label: "复制指令粘贴至 Agent",
      copiedLabel: "重新复制",
    };
  }
  return null;
}

export default function QoderAvailabilityCard({
  availability,
  surface,
  disabled = false,
  actionButtonRef,
  onCopyGuidance,
}: QoderAvailabilityCardProps) {
  const [pendingAction, setPendingAction] = useState<QoderGuidanceKind | null>(null);
  const [actionError, setActionError] = useState("");
  const presentation = qoderAvailabilityPresentation(availability);
  const action = actionForAvailability(availability);
  const checking = availability.status === "checking";
  const actionLabel = action && availability.guidanceCopied === action.kind
    ? action.copiedLabel
    : action?.label;

  const copyGuidance = async (kind: QoderGuidanceKind) => {
    if (pendingAction || disabled) return;
    setPendingAction(kind);
    setActionError("");
    try {
      const outcome = await onCopyGuidance(kind);
      const succeeded = Boolean(
        outcome && ["succeeded", "stale"].includes(outcome.status),
      );
      if (!succeeded) setActionError("指令暂时无法复制，请重试。");
    } catch {
      setActionError("指令暂时无法复制，请重试。");
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <section
      className="qoder-availability-card"
      data-status={availability.status}
      data-surface={surface}
      data-tone={presentation.tone}
      aria-busy={checking}
    >
      <div className="qoder-card-summary">
        <span className="qoder-card-brand" aria-hidden="true">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="./qoder-logo.png" alt="" />
        </span>
        <span className="qoder-card-copy">
          <strong>Qoder CLI</strong>
        </span>
        <span className="qoder-card-control">
          <span
            className="qoder-card-status"
            data-tone={presentation.tone}
            aria-live="polite"
            aria-atomic="true"
          >
            <i aria-hidden="true" />
            {presentation.statusLabel}
          </span>
          {action ? (
            <button
              ref={actionButtonRef}
              type="button"
              data-qoder-primary="true"
              disabled={Boolean(pendingAction) || disabled}
              aria-label={actionLabel}
              onClick={() => void copyGuidance(action.kind)}
            >
              {pendingAction === action.kind ? "正在复制…" : actionLabel}
            </button>
          ) : null}
          {actionError ? (
            <span className="qoder-card-error" role="alert">{actionError}</span>
          ) : null}
        </span>
      </div>
    </section>
  );
}
