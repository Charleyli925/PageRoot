export const AGENT_PROVIDER_AVAILABILITY_STATUSES = Object.freeze([
  "checking",
  "ready",
  "not-installed",
  "auth-required",
  "unavailable",
]);

export const AGENT_PROVIDER_GUIDANCE_KINDS = Object.freeze(["install", "login"]);

export const INITIAL_AGENT_PROVIDER_AVAILABILITY = Object.freeze({
  status: "checking",
  reason: "initial",
  lastCheck: null,
  checkedAt: null,
  guidanceCopied: null,
  guidanceCopiedAt: null,
});

function cleanDate(value) {
  return typeof value === "string" && value ? value : null;
}

function cleanGuidanceKind(value) {
  return AGENT_PROVIDER_GUIDANCE_KINDS.includes(value) ? value : null;
}

function snapshot({
  status,
  reason = null,
  lastCheck = null,
  checkedAt = null,
  guidanceCopied = null,
  guidanceCopiedAt = null,
}) {
  return Object.freeze({
    status: AGENT_PROVIDER_AVAILABILITY_STATUSES.includes(status)
      ? status
      : "unavailable",
    reason: reason ? String(reason) : null,
    lastCheck: lastCheck === "local" || lastCheck === "use" ? lastCheck : null,
    checkedAt: cleanDate(checkedAt),
    guidanceCopied: cleanGuidanceKind(guidanceCopied),
    guidanceCopiedAt: cleanDate(guidanceCopiedAt),
  });
}

export function checkingAgentProviderAvailability(
  previous = INITIAL_AGENT_PROVIDER_AVAILABILITY,
) {
  return snapshot({
    status: "checking",
    reason: "checking",
    lastCheck: previous.lastCheck,
    checkedAt: previous.checkedAt,
    guidanceCopied: previous.guidanceCopied,
    guidanceCopiedAt: previous.guidanceCopiedAt,
  });
}

function preserveUseFailureAfterLocalReady(previous) {
  return Boolean(
    previous?.lastCheck === "use"
    && (
      previous.status === "auth-required"
      || (
        previous.status === "unavailable"
        && [
          "account-capacity",
          "endpoint-region-mismatch",
          "restart-required",
          "service-unavailable",
          "timeout",
        ].includes(previous.reason)
      )
    ),
  );
}

export function agentProviderAvailabilityFromLocalResult(
  result,
  previous = INITIAL_AGENT_PROVIDER_AVAILABILITY,
  checkedAt = null,
) {
  const status = String(result?.status || "unavailable");
  if (status === "ready") {
    if (preserveUseFailureAfterLocalReady(previous)) {
      return snapshot({ ...previous, checkedAt });
    }
    return snapshot({
      status: "checking",
      reason: "checking",
      lastCheck: "local",
      checkedAt,
      guidanceCopied: previous.guidanceCopied,
      guidanceCopiedAt: previous.guidanceCopiedAt,
    });
  }
  if (status === "not-installed") {
    return snapshot({
      status: "not-installed",
      reason: "not-installed",
      lastCheck: "local",
      checkedAt,
      guidanceCopied: previous.guidanceCopied,
      guidanceCopiedAt: previous.guidanceCopiedAt,
    });
  }
  return snapshot({
    status: "unavailable",
    reason: result?.reason === "invalid-installation"
      ? "invalid-installation"
      : "service-unavailable",
    lastCheck: "local",
    checkedAt,
    guidanceCopied: previous.guidanceCopied,
    guidanceCopiedAt: previous.guidanceCopiedAt,
  });
}

export function readyAgentProviderAvailability(checkedAt = null) {
  return snapshot({
    status: "ready",
    reason: null,
    lastCheck: "use",
    checkedAt,
  });
}

export function agentProviderAvailabilityFromFailureReason(
  reason,
  previous = INITIAL_AGENT_PROVIDER_AVAILABILITY,
  checkedAt = null,
) {
  return snapshot({
    status: reason === "not-installed"
      ? "not-installed"
      : reason === "auth-required"
        ? "auth-required"
        : "unavailable",
    reason,
    lastCheck: "use",
    checkedAt,
    guidanceCopied: previous.guidanceCopied,
    guidanceCopiedAt: previous.guidanceCopiedAt,
  });
}

export function agentProviderAvailabilityWithCopiedGuidance(
  previous,
  kind,
  copiedAt = null,
) {
  if (!AGENT_PROVIDER_GUIDANCE_KINDS.includes(kind)) return previous;
  return snapshot({
    ...previous,
    guidanceCopied: kind,
    guidanceCopiedAt: copiedAt,
  });
}

function cleanText(value) {
  return value === null || value === undefined ? null : String(value);
}

export function freezeAgentSelection(selection) {
  if (!selection || typeof selection !== "object" || Array.isArray(selection)) {
    throw new TypeError("Agent selection is required.");
  }
  const reasoning = selection.reasoning && typeof selection.reasoning === "object"
    ? selection.reasoning
    : {};
  const frozenReasoning = Object.freeze({
    requested: cleanText(reasoning.requested),
    applied: cleanText(reasoning.applied),
    resolution: String(reasoning.resolution || "provider-default"),
  });
  return Object.freeze({
    providerId: String(selection.providerId || ""),
    runtimeId: String(selection.runtimeId || ""),
    requestedModelId: cleanText(selection.requestedModelId),
    resolvedModelId: cleanText(selection.resolvedModelId),
    reasoning: frozenReasoning,
    ...(selection.installationDigest
      ? { installationDigest: String(selection.installationDigest) }
      : {}),
  });
}

export function agentSelectionKey(selection, {
  installationDigest = selection?.installationDigest || "",
  trustPolicyVersion = "",
  purpose = "execution",
} = {}) {
  const frozen = freezeAgentSelection(selection);
  return JSON.stringify([
    frozen.providerId,
    frozen.runtimeId,
    frozen.requestedModelId,
    frozen.resolvedModelId,
    frozen.reasoning.requested,
    frozen.reasoning.applied,
    frozen.reasoning.resolution,
    String(installationDigest || ""),
    String(trustPolicyVersion || ""),
    String(purpose || ""),
  ]);
}

export const agentPreflightKey = agentSelectionKey;
