"use client";

import { useEffect } from "react";

import AgentProviderCard from "./AgentProviderCard";
import type { AgentProviderCardProps } from "./AgentProviderCard";
import type { AgentProviderCardData } from "./agent-provider-card-types";
import type {
  AgentProviderGuidanceKind,
  AgentSelection,
} from "../domain/agent-provider-state.js";

export type AgentSetupPanelProps = AgentProviderCardProps;

type AgentActionOutcome = Readonly<{ status: string; reason?: string; code?: string }> | null | undefined;

export type BoundAgentSetupPanelProps = Readonly<{
  card: AgentProviderCardData;
  surface: AgentProviderCardProps["surface"];
  actionButtonRef?: AgentProviderCardProps["actionButtonRef"];
  hideDisconnectAction?: boolean;
  initialApiKeyOpen?: boolean;
  onCopyGuidance(kind: AgentProviderGuidanceKind, selection: AgentSelection): Promise<AgentActionOutcome>;
  onStartLogin(selection: AgentSelection): Promise<AgentActionOutcome>;
  onReopenLogin?(selection: AgentSelection): Promise<AgentActionOutcome>;
  onInstall(selection: AgentSelection): Promise<AgentActionOutcome>;
  onCancelInstall(selection: AgentSelection): Promise<AgentActionOutcome>;
  onCheckSelection(selection: AgentSelection): Promise<AgentActionOutcome>;
  onConnectApiKey(
    selection: AgentSelection,
    apiKey: string,
    extras?: Readonly<{ vendorId?: string; baseUrl?: string; modelId?: string; remember?: boolean }>,
  ): Promise<AgentActionOutcome>;
  onRetryPersistCredential?(selection: AgentSelection): Promise<AgentActionOutcome>;
  onDisconnectApiKey?(selection: AgentSelection): Promise<AgentActionOutcome>;
  onOpenVendorApiKeyPage?(vendorId: string): Promise<AgentActionOutcome>;
  onSelectAgentModel(modelId: string, expectedSelection: AgentSelection): AgentSelection | null;
  onSelectAgentReasoning(reasoning: string, expectedSelection: AgentSelection): AgentSelection | null;
}>;

export function BoundAgentSetupPanel({
  card,
  surface,
  actionButtonRef,
  hideDisconnectAction,
  initialApiKeyOpen,
  onCopyGuidance,
  onStartLogin,
  onReopenLogin,
  onInstall,
  onCancelInstall,
  onCheckSelection,
  onConnectApiKey,
  onRetryPersistCredential,
  onDisconnectApiKey,
  onOpenVendorApiKeyPage,
  onSelectAgentModel,
  onSelectAgentReasoning,
}: BoundAgentSetupPanelProps) {
  useEffect(() => {
    void onCheckSelection(card.selection);
    // Entering the panel starts the necessary check once per service identity.
    // Availability snapshots change during diagnose and must not retrigger it.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- provider/runtime identity only
  }, [card.selection.providerId, card.selection.runtimeId, onCheckSelection]);
  const usesApiKeyModels = card.presentation.credentialKind === "api-token";
  const canSelectModel = usesApiKeyModels || card.presentation.supportsSelectableModels === true;
  return (
    <AgentProviderCard
      key={`${card.selection.providerId}:${card.selection.runtimeId}`}
      availability={card.availability}
      connection={card.connection}
      models={card.models}
      selectedModelId={card.selection.resolvedModelId}
      selectedReasoningId={card.selection.reasoning.requested || "auto"}
      presentation={card.presentation}
      surface={surface}
      actionButtonRef={actionButtonRef}
      hideDisconnectAction={hideDisconnectAction}
      initialApiKeyOpen={initialApiKeyOpen}
      onCopyGuidance={(kind) => onCopyGuidance(kind, card.selection)}
      onStartLogin={() => onStartLogin(card.selection)}
      onReopenLogin={onReopenLogin ? () => onReopenLogin(card.selection) : undefined}
      onInstall={() => onInstall(card.selection)}
      installState={card.installState}
      activeOperation={card.activeOperation}
      loginUrlPresent={card.loginUrlPresent === true}
      loginOpenError={card.loginOpenError || null}
      onCancelInstall={() => onCancelInstall(card.selection)}
      onRecheck={() => onCheckSelection(card.selection)}
      onConnectApiKey={(apiKey, extras) => onConnectApiKey(card.selection, apiKey, extras)}
      onRetryPersistCredential={onRetryPersistCredential
        ? () => onRetryPersistCredential(card.selection)
        : undefined}
      credentialPersist={card.credentialPersist || null}
      onDisconnectApiKey={onDisconnectApiKey
        ? () => onDisconnectApiKey(card.selection)
        : undefined}
      onOpenVendorApiKeyPage={onOpenVendorApiKeyPage}
      onSelectModel={canSelectModel ? async (modelId) => {
        if (usesApiKeyModels) {
          return onConnectApiKey(card.selection, "", {
            vendorId: card.connection?.vendorId,
            baseUrl: card.connection?.baseUrl,
            modelId: modelId.replace(/^pageroot:/u, ""),
          });
        }
        const candidateSelection = {
          ...card.selection,
          requestedModelId: modelId,
          resolvedModelId: modelId,
          reasoning: {
            requested: null,
            applied: null,
            resolution: "provider-default",
          },
        };
        const checked = await onCheckSelection(candidateSelection);
        if (!checked || checked.status !== "succeeded") return checked;
        const committed = onSelectAgentModel(modelId, card.selection);
        return committed
          ? { status: "succeeded" }
          : { status: "rejected", reason: "模型选择已经变化，请重新选择。" };
      } : undefined}
      onSelectReasoning={async (reasoning) => {
        const automatic = reasoning === "auto";
        const candidateSelection = {
          ...card.selection,
          reasoning: automatic
            ? { requested: null, applied: null, resolution: "provider-default" }
            : { requested: reasoning, applied: reasoning, resolution: "exact" },
        } as AgentSelection;
        const checked = await onCheckSelection(candidateSelection);
        if (!checked || checked.status !== "succeeded") return checked;
        const committed = onSelectAgentReasoning(reasoning, card.selection);
        return committed
          ? { status: "succeeded" }
          : { status: "rejected", reason: "思考深度已经变化，请重新选择。" };
      }}
    />
  );
}

export default function AgentSetupPanel(props: AgentSetupPanelProps) {
  return <AgentProviderCard {...props} />;
}
