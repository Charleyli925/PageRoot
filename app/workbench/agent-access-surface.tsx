"use client";

import {
  createContext,
  useContext,
  useEffect,
  type ReactNode,
} from "react";

import AgentSetupPanel, {
  type AgentSetupPanelProps,
} from "../components/AgentSetupPanel";
import type { AgentProviderCardData } from "../components/agent-provider-card-types";
import type { AgentSelection } from "../domain/agent-provider-state.js";
import type { RunControllerCapability } from "../application/workspace-controller-capabilities.js";
import {
  createAgentRecoveryIntent,
  sidebarRecoveryBar,
} from "../application/agent-recovery-intent.js";
import {
  AGENT_SERVICE_ORDER,
  agentServiceLabel,
  agentServiceStatusText,
  sidebarServiceTriggerText,
} from "../application/agent-service-label.js";
import type { AiConversationSidebarProps } from "./AiConversationSidebar";
import { RunConversationOutlet } from "./run-conversation-outlet";
import {
  useAgentSetupSurface,
  type AgentAccessFocus,
} from "./use-agent-setup-surface";

const RECOVERY_ACTION_IDS = [
  "reconnect-agent",
  "reauthenticate-agent",
  "change-agent-model",
  "change-agent-provider",
  "repair-agent-installation",
  "switch-agent",
  "repair-agent-connection",
] as const;

type AgentAccessValue = ReturnType<typeof useAgentSetupSurface>;

const AgentAccessContext = createContext<AgentAccessValue | null>(null);

export function useAgentAccess(): AgentAccessValue | null {
  return useContext(AgentAccessContext);
}

export function AgentAccessProvider({
  frozenProviderId,
  agentCards,
  selectAgent,
  persistDefaultProviderId,
  openSettingsPage,
  children,
}: {
  frozenProviderId: string | null;
  agentCards: readonly AgentProviderCardData[];
  selectAgent?: (
    selection: AgentProviderCardData["selection"],
  ) => { providerId: string } | null | undefined;
  persistDefaultProviderId?: (providerId: string) => void;
  openSettingsPage: () => void;
  children: ReactNode;
}) {
  const access = useAgentSetupSurface({
    frozenProviderId,
    agentCards,
    selectAgent,
    persistDefaultProviderId,
  });
  useEffect(() => {
    access.bindOpenSettingsPage(openSettingsPage);
    return () => access.bindOpenSettingsPage(null);
  }, [access.bindOpenSettingsPage, openSettingsPage]);
  return (
    <AgentAccessContext.Provider value={access}>
      {children}
    </AgentAccessContext.Provider>
  );
}

export function AgentRunConversationOutlet({
  capability,
  sidebarProps,
  onAction,
  reviewing,
  deliveryMode,
  agentCards,
  frozenAgentSelection,
  frozenProvider,
  qoderAvailability,
  selectedAgentModel,
  projectId,
  documentId,
  activeRun,
  onSelectReadyAgent,
  onEnableProvider,
  onCheckUsability,
  onCopyGuidance,
  onStartLogin,
  onInstall,
  onCancelInstall,
  onConnectApiKey,
  onDisconnectApiKey,
  onOpenVendorApiKeyPage,
  onSelectAgentModel,
  onSelectAgentReasoning,
  onRevealConversation,
}: {
  capability: RunControllerCapability;
  sidebarProps: AiConversationSidebarProps;
  onAction: (actionId: string) => void;
  reviewing: boolean;
  deliveryMode: "managed-agent" | "clipboard";
  agentCards: readonly AgentProviderCardData[];
  frozenAgentSelection: AgentSelection | null;
  frozenProvider: {
    presentation?: { credentialKind?: string | null };
    connection?: { vendorDisplayName?: string | null } | null;
  } | null;
  qoderAvailability: { status: string };
  selectedAgentModel?: { id?: string; displayName?: string } | null;
  projectId: string | null;
  documentId: string | null;
  activeRun?: { requestId?: string; attemptId?: string } | null;
  onSelectReadyAgent: (selection: AgentProviderCardData["selection"]) => void;
  onEnableProvider: (providerId: string) => void;
  onCheckUsability: AgentSetupPanelProps["onCheckSelection"];
  onCopyGuidance: AgentSetupPanelProps["onCopyGuidance"];
  onStartLogin: AgentSetupPanelProps["onStartLogin"];
  onInstall: AgentSetupPanelProps["onInstall"];
  onCancelInstall: AgentSetupPanelProps["onCancelInstall"];
  onConnectApiKey: AgentSetupPanelProps["onConnectApiKey"];
  onDisconnectApiKey: AgentSetupPanelProps["onDisconnectApiKey"];
  onOpenVendorApiKeyPage: AgentSetupPanelProps["onOpenVendorApiKeyPage"];
  onSelectAgentModel: AgentSetupPanelProps["onSelectAgentModel"];
  onSelectAgentReasoning: AgentSetupPanelProps["onSelectAgentReasoning"];
  onRevealConversation: () => void;
}) {
  const access = useAgentAccess();
  if (!access) {
    return (
      <RunConversationOutlet
        capability={capability}
        sidebarProps={{ ...sidebarProps, onAction }}
        reviewing={reviewing}
        deliveryMode={deliveryMode}
      />
    );
  }
  const {
    agentAccessFocus,
    sidebarSetupProviderId,
    setSidebarSetupProviderId,
    setPendingSidebarDefault,
    openAgentSettings,
    agentRecoveryIntent,
    setAgentRecoveryIntent,
  } = access;
  const sidebarSetupCard = agentCards.find((card) => (
    card.selection.providerId === sidebarSetupProviderId
  )) || null;
  const agentServices = AGENT_SERVICE_ORDER.map((providerId) => {
    const card = agentCards.find((item) => item.selection.providerId === providerId);
    if (!card) return null;
    return {
      providerId,
      label: agentServiceLabel(providerId),
      status: agentServiceStatusText({
        availability: card.availability,
        installState: card.installState,
        activeOperation: card.activeOperation,
        connection: card.connection,
        isDefault: frozenAgentSelection?.providerId === providerId,
        providerId,
        modelDisplayName: card.selection.resolvedModelId,
      }),
      connected: card.availability.status === "ready" && card.availability.reason !== "disabled",
    };
  }).filter((service): service is NonNullable<typeof service> => Boolean(service));
  const handleAction = (actionId: string) => {
    if (RECOVERY_ACTION_IDS.includes(actionId as typeof RECOVERY_ACTION_IDS[number])) {
      const providerId = frozenAgentSelection?.providerId || null;
      const field: AgentAccessFocus["field"] = actionId === "change-agent-model"
        ? "model"
        : actionId === "repair-agent-installation"
          ? "install"
          : frozenProvider?.presentation?.credentialKind === "api-token"
            ? "apiKey"
            : "login";
      try {
        setAgentRecoveryIntent(createAgentRecoveryIntent({
          originSurface: "sidebar",
          projectId: projectId || null,
          documentId: documentId || null,
          requestId: activeRun?.requestId || null,
          attemptId: activeRun?.attemptId || null,
          providerId,
          targetField: field,
          errorKind: actionId,
        }));
      } catch {
        setAgentRecoveryIntent(null);
      }
      if (actionId === "change-agent-provider" || actionId === "switch-agent") {
        openAgentSettings({ providerId, field, surface: "settings" });
        return;
      }
      openAgentSettings({ providerId, field, surface: "sidebar" });
      return;
    }
    if (actionId === "return-editing" || actionId === "dismiss" || actionId === "dismiss-recovery") {
      setAgentRecoveryIntent(null);
      setSidebarSetupProviderId(null);
      if (actionId === "dismiss-recovery") return;
    }
    if (actionId === "return-original-task") {
      onRevealConversation();
      return;
    }
    onAction(actionId);
  };
  return (
    <RunConversationOutlet
      capability={capability}
      reviewing={reviewing}
      deliveryMode={deliveryMode}
      sidebarProps={{
        ...sidebarProps,
        agentServices,
        serviceTriggerText: sidebarServiceTriggerText({
          providerId: frozenAgentSelection?.providerId || null,
          catalogStatus: qoderAvailability.status,
          connectionVendorName: frozenProvider?.connection?.vendorDisplayName || null,
          modelDisplayName: selectedAgentModel?.displayName || selectedAgentModel?.id || null,
        }),
        onSelectAgentService: (providerId: string) => {
          const card = agentCards.find((item) => item.selection.providerId === providerId);
          if (!card) return;
          if (card.availability.status === "ready" && card.availability.reason !== "disabled") {
            onSelectReadyAgent(card.selection);
            setSidebarSetupProviderId(null);
            setPendingSidebarDefault(false);
            return;
          }
          if (card.availability.reason === "disabled") onEnableProvider(providerId);
          setSidebarSetupProviderId(providerId);
          setPendingSidebarDefault(true);
          void onCheckUsability(card.selection);
        },
        agentSetupPanel: sidebarSetupCard ? (
          <AgentSetupPanel
            card={sidebarSetupCard}
            surface="settings"
            initialFocusField={agentAccessFocus.field || null}
            onCopyGuidance={onCopyGuidance}
            onStartLogin={onStartLogin}
            onInstall={onInstall}
            onCancelInstall={onCancelInstall}
            onCheckSelection={onCheckUsability}
            onConnectApiKey={onConnectApiKey}
            onDisconnectApiKey={onDisconnectApiKey}
            onOpenVendorApiKeyPage={onOpenVendorApiKeyPage}
            onSelectAgentModel={onSelectAgentModel}
            onSelectAgentReasoning={onSelectAgentReasoning}
          />
        ) : null,
        recoveryBar: sidebarRecoveryBar({
          intent: agentRecoveryIntent,
          catalogStatus: qoderAvailability.status,
          credentialKind: frozenProvider?.presentation?.credentialKind === "api-token"
            ? "api-token"
            : null,
          currentProjectId: projectId || null,
          currentDocumentId: documentId || null,
        }),
        onRecoveryAction: handleAction,
        onAction: handleAction,
        onOpenAgentSettings: () => openAgentSettings({ surface: "sidebar" }),
      }}
    />
  );
}
