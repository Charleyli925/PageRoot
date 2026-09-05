"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import type { AgentProviderCardData } from "../components/agent-provider-card-types";
import { reportInternalFailure } from "../application/internal-failure.js";
import type { AgentRecoveryIntent } from "../application/agent-recovery-intent.js";

// Owns the shared AI setup panel's focus, sidebar expansion, deferred default
// commit and recovery intent. Called from useAiConversation so Workbench adds
// no extra hook calls and keeps its existing memoization budget.

export type AgentAccessFocus = Readonly<{
  providerId?: string | null;
  field?: "apiKey" | "login" | "model" | "install" | null;
  surface?: "settings" | "sidebar";
}>;

type SelectAgent = (selection: AgentProviderCardData["selection"]) => (
  { providerId: string } | null | undefined
);

export function useAgentSetupSurface({
  frozenProviderId,
  agentCards,
  selectAgent,
  persistDefaultProviderId,
}: {
  frozenProviderId: string | null;
  agentCards: readonly AgentProviderCardData[];
  selectAgent?: SelectAgent | null;
  persistDefaultProviderId?: ((providerId: string) => void) | null;
}) {
  const [agentAccessFocus, setAgentAccessFocus] = useState<AgentAccessFocus>({});
  const [sidebarSetupProviderId, setSidebarSetupProviderId] = useState<string | null>(null);
  const [pendingSidebarDefault, setPendingSidebarDefault] = useState(false);
  const [agentRecoveryIntent, setAgentRecoveryIntent] = useState<AgentRecoveryIntent | null>(null);
  const openSettingsPageRef = useRef<(() => void) | null>(null);
  const frozenProviderIdRef = useRef(frozenProviderId);
  const selectAgentRef = useRef(selectAgent);
  const persistDefaultProviderIdRef = useRef(persistDefaultProviderId);
  const agentCardsRef = useRef(agentCards);
  useLayoutEffect(() => {
    frozenProviderIdRef.current = frozenProviderId;
    selectAgentRef.current = selectAgent;
    persistDefaultProviderIdRef.current = persistDefaultProviderId;
    agentCardsRef.current = agentCards;
  }, [agentCards, frozenProviderId, persistDefaultProviderId, selectAgent]);

  const bindOpenSettingsPage = useCallback((openPage: (() => void) | null) => {
    openSettingsPageRef.current = openPage;
  }, []);

  const openAgentSettings = useCallback((focus: AgentAccessFocus = {}) => {
    setAgentAccessFocus(focus);
    if (focus.surface === "settings") {
      openSettingsPageRef.current?.();
      return;
    }
    const providerId = focus.providerId
      || frozenProviderIdRef.current
      || agentCardsRef.current[0]?.selection.providerId
      || null;
    if (providerId) setSidebarSetupProviderId(providerId);
  }, []);

  useEffect(() => {
    if (!pendingSidebarDefault || !sidebarSetupProviderId) return;
    const card = agentCards.find((item) => item.selection.providerId === sidebarSetupProviderId);
    if (card?.availability.status !== "ready" || card.availability.reason === "disabled") return;
    try {
      const selected = selectAgentRef.current?.(card.selection);
      if (selected) persistDefaultProviderIdRef.current?.(selected.providerId);
    } catch (cause) {
      reportInternalFailure({
        area: "settings",
        operation: "select-agent",
        code: "default-agent-selection-failed",
        recovered: false,
        cause,
      });
    }
    queueMicrotask(() => {
      setPendingSidebarDefault(false);
      setSidebarSetupProviderId(null);
    });
  }, [agentCards, pendingSidebarDefault, sidebarSetupProviderId]);

  return {
    agentAccessFocus,
    sidebarSetupProviderId,
    setSidebarSetupProviderId,
    pendingSidebarDefault,
    setPendingSidebarDefault,
    openAgentSettings,
    bindOpenSettingsPage,
    agentRecoveryIntent,
    setAgentRecoveryIntent,
  };
}
