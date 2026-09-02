export const MANAGED_AGENT_MODE = "managed-agent";
export const CLIPBOARD_DELIVERY_MODE = "clipboard";
export const LEGACY_QODER_ACP_MODE = "qoder-acp";
export const TRUSTED_LOCAL_AGENT_POLICY_VERSION = "trusted-local-agent-v1";

const REASONING_RESOLUTIONS = new Set([
  "exact",
  "provider-default",
  "unsupported",
]);

function deliveryError(message) {
  const error = new Error(message);
  error.name = "AgentDeliveryError";
  error.code = "AGENT_DELIVERY_INVALID";
  return error;
}

function record(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw deliveryError(`${label} must be an object.`);
  }
  return value;
}

function boundedIdentity(value, label) {
  const text = typeof value === "string" ? value : "";
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/u.test(text)) {
    throw deliveryError(`${label} is invalid.`);
  }
  return text;
}

function nullableModelId(value, label) {
  if (value === null) return null;
  const text = typeof value === "string" ? value : "";
  if (!text || text.length > 160 || /[\u0000-\u001f\u007f]/u.test(text)) {
    throw deliveryError(`${label} is invalid.`);
  }
  return text;
}

function reasoningSelection(value) {
  const input = record(value, "Agent reasoning selection");
  const requested = nullableModelId(input.requested, "requested reasoning");
  const applied = nullableModelId(input.applied, "applied reasoning");
  const resolution = String(input.resolution || "");
  if (!REASONING_RESOLUTIONS.has(resolution)) {
    throw deliveryError("Agent reasoning resolution is invalid.");
  }
  if (resolution === "provider-default" && (requested !== null || applied !== null)) {
    throw deliveryError("Provider-default reasoning cannot carry an override.");
  }
  if (resolution === "exact" && (!requested || requested !== applied)) {
    throw deliveryError("Exact reasoning requires equal requested and applied values.");
  }
  if (resolution === "unsupported" && (!requested || applied !== null)) {
    throw deliveryError("Unsupported reasoning requires a request and no applied value.");
  }
  return Object.freeze({ requested, applied, resolution });
}

export function defaultManagedAgentDelivery() {
  return Object.freeze({
    mode: MANAGED_AGENT_MODE,
    selection: Object.freeze({
      providerId: "qoder",
      runtimeId: "acp",
      requestedModelId: null,
      resolvedModelId: null,
      reasoning: Object.freeze({
        requested: null,
        applied: null,
        resolution: "provider-default",
      }),
    }),
    trustPolicyVersion: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
  });
}

export function normalizeAgentDelivery(value, { allowLegacy = true } = {}) {
  const input = record(value, "Agent delivery");
  if (input.mode === CLIPBOARD_DELIVERY_MODE) {
    return Object.freeze({ mode: CLIPBOARD_DELIVERY_MODE });
  }
  if (allowLegacy && input.mode === LEGACY_QODER_ACP_MODE) {
    if (input.trustPolicyVersion !== TRUSTED_LOCAL_AGENT_POLICY_VERSION) {
      throw deliveryError("Legacy Agent delivery trust policy is invalid.");
    }
    return defaultManagedAgentDelivery();
  }
  if (input.mode !== MANAGED_AGENT_MODE) {
    throw deliveryError("Agent delivery mode is unsupported.");
  }
  if (input.trustPolicyVersion !== TRUSTED_LOCAL_AGENT_POLICY_VERSION) {
    throw deliveryError("Agent delivery trust policy is invalid.");
  }
  const selection = record(input.selection, "Agent provider selection");
  const providerId = boundedIdentity(selection.providerId, "providerId");
  const requestedModelId = nullableModelId(selection.requestedModelId, "requestedModelId");
  const resolvedModelId = nullableModelId(selection.resolvedModelId, "resolvedModelId");
  for (const [modelId, label] of [
    [requestedModelId, "requestedModelId"],
    [resolvedModelId, "resolvedModelId"],
  ]) {
    if (modelId !== null && !modelId.startsWith(`${providerId}:`)) {
      throw deliveryError(`${label} must use the selected provider namespace.`);
    }
  }
  return Object.freeze({
    mode: MANAGED_AGENT_MODE,
    selection: Object.freeze({
      providerId,
      runtimeId: boundedIdentity(selection.runtimeId, "runtimeId"),
      requestedModelId,
      resolvedModelId,
      reasoning: reasoningSelection(selection.reasoning),
    }),
    trustPolicyVersion: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
  });
}

export function agentDeliveryIsManaged(value) {
  try {
    return normalizeAgentDelivery(value).mode === MANAGED_AGENT_MODE;
  } catch {
    return false;
  }
}

const SHIPPED_MANAGED_BINDINGS = Object.freeze([
  Object.freeze({ providerId: "qoder", runtimeId: "acp", legacyDriver: LEGACY_QODER_ACP_MODE }),
  Object.freeze({ providerId: "codex", runtimeId: "acp", legacyDriver: null }),
  Object.freeze({ providerId: "pageroot", runtimeId: "http", legacyDriver: null }),
]);

function shippedManagedBinding(selection) {
  return SHIPPED_MANAGED_BINDINGS.find((binding) => (
    binding.providerId === selection.providerId
    && binding.runtimeId === selection.runtimeId
  )) || null;
}

export function legacyDriverForAgentDelivery(value) {
  const delivery = normalizeAgentDelivery(value);
  if (delivery.mode !== MANAGED_AGENT_MODE) return null;
  const binding = shippedManagedBinding(delivery.selection);
  if (!binding) {
    const error = new Error("The persisted Agent provider is not installed in this build.");
    error.name = "AgentDeliveryError";
    error.code = "AGENT_PROVIDER_UNSUPPORTED";
    throw error;
  }
  return binding.legacyDriver;
}

// New durable writes are narrower than historical reads. Unknown providers are
// retained by normalizeAgentDelivery so their records remain inspectable and
// cancellable, but a build may create a managed Request only for a binding it
// can actually dispatch now.
export function normalizeNewAgentDelivery(value) {
  const delivery = normalizeAgentDelivery(value, { allowLegacy: false });
  if (delivery.mode === MANAGED_AGENT_MODE) legacyDriverForAgentDelivery(delivery);
  return delivery;
}
