import type { AgentSelection } from "../domain/agent-provider-state.js";

export const AGENT_SERVICE_LABELS: Readonly<{
  pageroot: "内置 AI";
  qoder: "Qoder";
  codex: "Codex";
}>;

export function agentServiceLabel(providerId: string, fallback?: string): string;

export function resolvePreferredAgentProvider(input?: {
  defaultAgentProviderId?: string | null;
  disabledAgentProviderIds?: readonly string[];
  providers?: readonly Readonly<{
    providerId: string;
    selection: AgentSelection;
  }>[];
}): Readonly<{ providerId: string; selection: AgentSelection }> | null;

export function shouldPersistDefaultAgentProvider(input?: {
  storedDefaultId?: string | null;
  preferredId?: string | null;
  disabledAgentProviderIds?: readonly string[];
}): boolean;
