"use client";

import type { Ref } from "react";

import type {
  AgentProviderGuidanceKind,
  AgentSelection,
} from "../domain/agent-provider-state.js";
import AgentProviderCard from "./AgentProviderCard";
import type { AgentProviderCardData } from "./agent-provider-card-types";

type AgentActionOutcome = Readonly<{ status: string; reason?: string; code?: string }> | null | undefined;
type ApiKeyExtras = Readonly<{
  vendorId?: string;
  baseUrl?: string;
  modelId?: string;
  remember?: boolean;
}>;

export type AgentSetupPanelProps = {
  card: AgentProviderCardData;
  surface?: "delivery" | "about" | "settings";
  actionButtonRef?: Ref<HTMLButtonElement>;
  initialFocusField?: "apiKey" | "login" | "model" | "install" | null;
  onCopyGuidance(kind: AgentProviderGuidanceKind, selection: AgentSelection): Promise<AgentActionOutcome>;
  onStartLogin(selection: AgentSelection): Promise<AgentActionOutcome>;
  onInstall(selection: AgentSelection): Promise<AgentActionOutcome>;
  onCancelInstall(selection: AgentSelection): Promise<AgentActionOutcome>;
  onCheckSelection(selection: AgentSelection): Promise<AgentActionOutcome>;
  onConnectApiKey(
    selection: AgentSelection,
    apiKey: string,
    extras?: ApiKeyExtras,
  ): Promise<AgentActionOutcome>;
  onDisconnectApiKey(selection: AgentSelection): Promise<AgentActionOutcome>;
  onOpenVendorApiKeyPage?(vendorId: string): Promise<AgentActionOutcome>;
  onSelectAgentModel(modelId: string, expectedSelection: AgentSelection): AgentSelection | null;
  onSelectAgentReasoning(reasoning: string, expectedSelection: AgentSelection): AgentSelection | null;
};

export default function AgentSetupPanel({
  card,
  surface = "settings",
  actionButtonRef,
  initialFocusField = null,
  onCopyGuidance,
  onStartLogin,
  onInstall,
  onCancelInstall,
  onCheckSelection,
  onConnectApiKey,
  onDisconnectApiKey,
  onOpenVendorApiKeyPage,
  onSelectAgentModel,
  onSelectAgentReasoning,
}: AgentSetupPanelProps) {
  return (
    <AgentProviderCard
      key={`${card.selection.providerId}:${card.selection.runtimeId}:${card.connection?.vendorId || "none"}:${card.connection?.baseUrl || ""}:${card.selection.resolvedModelId || "none"}`}
      availability={card.availability}
      connection={card.connection}
      models={card.models}
      selectedModelId={card.selection.resolvedModelId}
      selectedReasoningId={card.selection.reasoning.requested || "auto"}
      presentation={card.presentation}
      surface={surface}
      actionButtonRef={actionButtonRef}
      initialFocusField={initialFocusField}
      onCopyGuidance={(kind) => onCopyGuidance(kind, card.selection)}
      onStartLogin={() => onStartLogin(card.selection)}
      onInstall={() => onInstall(card.selection)}
      installState={card.installState}
      activeOperation={card.activeOperation}
      onCancelInstall={() => onCancelInstall(card.selection)}
      onRecheck={() => onCheckSelection(card.selection)}
      onConnectApiKey={(apiKey, extras) => onConnectApiKey(card.selection, apiKey, extras)}
      onDisconnectApiKey={() => onDisconnectApiKey(card.selection)}
      onOpenVendorApiKeyPage={onOpenVendorApiKeyPage}
      onSelectModel={async (modelId) => {
        if (card.connection) {
          return onConnectApiKey(card.selection, "", {
            vendorId: card.connection.vendorId,
            baseUrl: card.connection.baseUrl,
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
      }}
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
