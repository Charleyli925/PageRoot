"use client";

import { useState, type Ref } from "react";

import type {
  AgentProviderAvailabilitySnapshot,
  AgentProviderGuidanceKind,
} from "../domain/agent-provider-state.js";

type AgentActionOutcome = Readonly<{ status: string; reason?: string }> | null | undefined;

export type AgentProviderCardPresentation = Readonly<{
  displayName: string;
  logoSrc: string | null;
  cardClassName: string;
  primaryActionDataAttribute: string | null;
  availability: (value: AgentProviderAvailabilitySnapshot) => Readonly<{
    statusLabel: string;
    detail: string;
    tone: "ready" | "checking" | "attention";
  }>;
  actions: Readonly<{
    install: Readonly<{ label: string; copiedLabel: string }>;
    login: Readonly<{ label: string; copiedLabel: string }>;
  }>;
}>;

export type AgentProviderCardProps = {
  availability: AgentProviderAvailabilitySnapshot;
  presentation: AgentProviderCardPresentation;
  surface: "delivery" | "about";
  disabled?: boolean;
  actionButtonRef?: Ref<HTMLButtonElement>;
  onCopyGuidance: (kind: AgentProviderGuidanceKind) => Promise<AgentActionOutcome>;
};

function actionForAvailability(
  availability: AgentProviderAvailabilitySnapshot,
  presentation: AgentProviderCardPresentation,
) {
  if (availability.status === "not-installed") {
    return { kind: "install" as const, ...presentation.actions.install };
  }
  if (availability.status === "auth-required") {
    return { kind: "login" as const, ...presentation.actions.login };
  }
  return null;
}

export default function AgentProviderCard({
  availability,
  presentation: provider,
  surface,
  disabled = false,
  actionButtonRef,
  onCopyGuidance,
}: AgentProviderCardProps) {
  const [pendingAction, setPendingAction] = useState<AgentProviderGuidanceKind | null>(null);
  const [actionError, setActionError] = useState("");
  const presentation = provider.availability(availability);
  const action = actionForAvailability(availability, provider);
  const checking = availability.status === "checking";
  const actionLabel = action && availability.guidanceCopied === action.kind
    ? action.copiedLabel
    : action?.label;
  const primaryActionData = provider.primaryActionDataAttribute
    ? { [provider.primaryActionDataAttribute]: "true" }
    : {};

  const copyGuidance = async (kind: AgentProviderGuidanceKind) => {
    if (pendingAction || disabled) return;
    setPendingAction(kind);
    setActionError("");
    try {
      const outcome = await onCopyGuidance(kind);
      const succeeded = Boolean(outcome && ["succeeded", "stale"].includes(outcome.status));
      if (!succeeded) setActionError("指令暂时无法复制，请重试。");
    } catch {
      setActionError("指令暂时无法复制，请重试。");
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <section
      className={provider.cardClassName}
      data-status={availability.status}
      data-surface={surface}
      data-tone={presentation.tone}
      aria-busy={checking}
    >
      <div className="qoder-card-summary">
        <span className="qoder-card-brand" aria-hidden="true">
          {provider.logoSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={provider.logoSrc} alt="" />
          ) : null}
        </span>
        <span className="qoder-card-copy">
          <strong>{provider.displayName}</strong>
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
              {...primaryActionData}
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
