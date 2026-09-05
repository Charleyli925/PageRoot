export const AGENT_SERVICE_LABELS = Object.freeze({
  pageroot: "内置 AI",
  qoder: "Qoder",
  codex: "Codex",
});

export function agentServiceLabel(providerId, fallback = "") {
  return AGENT_SERVICE_LABELS[providerId] || fallback;
}

export function resolvePreferredAgentProvider({
  defaultAgentProviderId,
  disabledAgentProviderIds = [],
  providers = [],
} = {}) {
  const stored = providers.find((provider) => provider.providerId === defaultAgentProviderId)
    || null;
  if (stored) return stored;
  return providers.find((provider) => !disabledAgentProviderIds.includes(provider.providerId))
    || providers[0]
    || null;
}

export function shouldPersistDefaultAgentProvider({
  storedDefaultId,
  preferredId,
  disabledAgentProviderIds = [],
} = {}) {
  if (!preferredId || preferredId === storedDefaultId) return false;
  if (storedDefaultId && disabledAgentProviderIds.includes(storedDefaultId)) return false;
  return preferredId === "pageroot" || preferredId === "qoder" || preferredId === "codex";
}
