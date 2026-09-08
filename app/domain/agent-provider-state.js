export const AGENT_PROVIDER_AVAILABILITY_STATUSES = Object.freeze([
  "checking",
  "ready",
  "not-installed",
  "auth-required",
  "unavailable",
]);

// A shared, derived next step; authentication is not synonymous with protocol readiness.
export function agentSetupRecovery(diagnostic, availability) {
  if (!diagnostic || availability?.status !== "unavailable" || availability?.reason === "disabled") return null;
  if (["account-capacity", "model-unavailable"].includes(availability.reason)) return null;
  const cause = diagnostic.cause || "";
  const auth = diagnostic.facts?.authentication?.status;
  const protocol = diagnostic.facts?.protocol?.status;
  if (cause === "CODEX_EXECUTION_CONTRACT_UNSUPPORTED") {
    return { statusLabel: "当前 Codex 组件暂不支持完成修改",
      detail: `${auth === "ready" ? "账号已登录。" : ""}当前组件缺少所需的受限执行能力。`,
      tone: "attention", action: "change-provider", actionLabel: "使用其他 AI", allowRecheck: true };
  }
  if (/NETWORK|TIMEOUT|CONNECTION_FAILED/u.test(cause)) {
    return { statusLabel: "暂时无法连接", detail: "", tone: "attention", action: "recheck", actionLabel: "重新检查" };
  }
  if (cause === "CODEX_AUTH_UNVERIFIED") {
    return { statusLabel: "登录状态尚未确认", detail: "检测本机登录状态；仍无法确认时可重新登录。", tone: "attention",
      action: "recheck", actionLabel: "检测登录", allowLogin: true };
  }
  if (cause === "CODEX_AUTH_REQUIRED" && auth === "ready") {
    return { statusLabel: "连接组件未确认登录", detail: "本机已有认证，但连接组件未接受登录。", tone: "attention",
      action: "recheck", actionLabel: "检测登录", allowLogin: true };
  }
  if (/VERSION|PROTOCOL_UNSUPPORTED|IDENTITY_MISMATCH/u.test(cause)) {
    return { statusLabel: "当前组件无法使用", detail: auth === "ready" ? "账号已登录，需要更新连接组件。" : "需要更新受验证的连接组件。", tone: "attention",
      action: "install", actionLabel: "更新连接组件" };
  }
  if (protocol === "failed" && auth === "ready" && availability.reason !== "invalid-installation") {
    return { statusLabel: "暂时无法使用", detail: "账号已登录，但连接检查没有通过。", tone: "attention",
      action: "recheck", actionLabel: "重新检查" };
  }
  if (availability.reason === "invalid-installation") {
    return { statusLabel: "连接需要修复", detail: auth === "ready" ? "账号已登录，但连接组件未能启动。" : "连接组件未能启动。", tone: "attention",
      action: "install", actionLabel: "修复连接" };
  }
  return { statusLabel: "暂时无法连接", detail: "", tone: "attention", action: "recheck", actionLabel: "重新检查" };
}

export function agentSetupOperationLabel(operation, installState) {
  if (operation?.state === "stop-unconfirmed") return "尚未确认操作已停止";
  if (operation?.state === "cancelling" || installState === "cancelling") return "正在取消…";
  if (operation?.kind === "login" && ["running", "waiting"].includes(operation.state)) return "请在浏览器完成登录";
  if (installState === "installing") return "正在安装…";
  return null;
}

// Diagnostics are the safe, side-effect-free projection used by Settings.
// Keep this separate from availability/preflight: a diagnostic never carries
// an installation path, command, or process output back to the renderer.
export const AGENT_DIAGNOSTIC_READINESS = Object.freeze([
  "checking",
  "ready",
  "not-installed",
  "auth-required",
  "invalid-installation",
  "connection-failed",
]);

export const AGENT_DIAGNOSTIC_OPERATIONS = Object.freeze([
  "diagnose",
  "refresh",
]);

export const AGENT_DIAGNOSTIC_FACT_STATUSES = Object.freeze([
  "unknown",
  "configured",
  "ready",
  "missing",
  "invalid",
  "required",
  "failed",
  "unavailable",
]);

const AGENT_DIAGNOSTIC_FACT_SOURCES = new Set(["diagnose", "preflight", "use"]);
const AGENT_DIAGNOSTIC_FACT_NAMES = Object.freeze([
  "installation",
  "authentication",
  "protocol",
  "service",
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

function cleanDiagnosticCause(value) {
  const cause = String(value || "connection-failed").trim();
  return /^[A-Za-z0-9_-]{1,80}$/u.test(cause) ? cause : "connection-failed";
}

function cleanActiveInstallation(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const phase = String(value.phase || "");
  return ["installing", "cancelling"].includes(phase)
    ? Object.freeze({ phase })
    : null;
}

export function agentDiagnosticSnapshot(value = {}, checkedAt = null, previous = null) {
  const readiness = AGENT_DIAGNOSTIC_READINESS.includes(value?.readiness)
    ? value.readiness
    : "connection-failed";
  const previousFacts = previous?.facts
    ? previous.facts
    : {};
  const rawFacts = value?.facts && typeof value.facts === "object" && !Array.isArray(value.facts)
    ? value.facts
    : {};
  const fallbackStatuses = {
    installation: readiness === "not-installed" ? "missing"
      : readiness === "invalid-installation" ? "invalid" : "ready",
    authentication: readiness === "auth-required" ? "required" : "unknown",
    protocol: readiness === "connection-failed" ? "failed" : "unknown",
    service: "unknown",
  };
  const facts = Object.freeze(Object.fromEntries(AGENT_DIAGNOSTIC_FACT_NAMES.map((name) => {
    const raw = rawFacts[name];
    const candidate = raw && typeof raw === "object" && !Array.isArray(raw)
      ? raw
      : { status: raw };
    const status = AGENT_DIAGNOSTIC_FACT_STATUSES.includes(candidate?.status)
      ? candidate.status
      : fallbackStatuses[name];
    const source = AGENT_DIAGNOSTIC_FACT_SOURCES.has(candidate?.source)
      ? candidate.source
      : "diagnose";
    const cause = status === "ready" || status === "configured" || status === "unknown"
      ? null
      : cleanDiagnosticCause(candidate?.cause || value?.cause);
    const next = Object.freeze({ status, cause, source });
    const previous = previousFacts[name];
    if (name === "service"
      && previous?.status
      && previous.status !== "unknown"
      && source === "diagnose") {
      return [name, previous];
    }
    return [name, next];
  })));
  const incomingService = rawFacts.service && typeof rawFacts.service === "object"
    ? rawFacts.service
    : { status: rawFacts.service, source: "diagnose" };
  const preservesStrongerServiceFailure = readiness === "ready"
    && previous?.readiness
    && previousFacts.service?.source !== "diagnose"
    && ["failed", "unavailable"].includes(previousFacts.service?.status)
    && (!incomingService.source || incomingService.source === "diagnose");
  const effectiveReadiness = preservesStrongerServiceFailure
    ? previous.readiness
    : readiness;
  return Object.freeze({
    readiness: effectiveReadiness,
    failureStage: effectiveReadiness === "ready" ? null
      : AGENT_DIAGNOSTIC_FACT_NAMES.find((name) => ["missing", "invalid", "required", "failed", "unavailable"].includes(facts[name].status)) || null,
    ...(typeof value?.diagnosticId === "string" && /^[A-Za-z0-9_-]{1,120}$/u.test(value.diagnosticId)
      ? { diagnosticId: value.diagnosticId } : {}),
    cause: effectiveReadiness === "ready"
      ? null
      : cleanDiagnosticCause(preservesStrongerServiceFailure ? previous.cause : value?.cause),
    operation: AGENT_DIAGNOSTIC_OPERATIONS.includes(value?.operation)
      ? value.operation
      : "diagnose",
    checkedAt: cleanDate(value?.checkedAt || checkedAt),
    ...(typeof value?.operationId === "string" && /^[A-Za-z0-9_-]{1,120}$/u.test(value.operationId)
      ? { operationId: value.operationId } : {}),
    ...(Number.isSafeInteger(value?.configurationGeneration) && value.configurationGeneration >= 0
      ? { configurationGeneration: value.configurationGeneration } : {}),
    activeInstallation: cleanActiveInstallation(value?.activeInstallation),
    facts,
  });
}

export function agentProviderAvailabilityFromDiagnostic(
  diagnostic,
  previous = INITIAL_AGENT_PROVIDER_AVAILABILITY,
  checkedAt = null,
) {
  const snapshot = agentDiagnosticSnapshot(diagnostic, checkedAt);
  if (snapshot.readiness === "ready") {
    // Diagnosis is a real Bridge check, so Settings may show the connection as
    // ready. The send path still performs its own formal preflight/ticket.
    if (preserveUseFailureAfterLocalReady(previous)) {
      return snapshotAvailability({ ...previous, checkedAt: snapshot.checkedAt });
    }
    return readyAgentProviderAvailability(snapshot.checkedAt, "local");
  }
  if (snapshot.readiness === "not-installed") {
    return agentProviderAvailabilityFromFailureReason(
      "not-installed",
      previous,
      snapshot.checkedAt,
    );
  }
  if (snapshot.readiness === "auth-required") {
    return agentProviderAvailabilityFromFailureReason(
      "auth-required",
      previous,
      snapshot.checkedAt,
    );
  }
  const cause = String(snapshot.cause || "");
  const reason = cause.includes("CAPACITY") || cause.includes("BALANCE") || cause.includes("PLAN")
    ? "account-capacity"
    : cause.includes("TIMEOUT")
      ? "timeout"
      : cause.includes("MODEL") || cause.includes("SELECTION")
        ? "model-unavailable"
        : snapshot.readiness === "invalid-installation"
          ? "invalid-installation"
          : "service-unavailable";
  return agentProviderAvailabilityFromFailureReason(
    reason,
    previous,
    snapshot.checkedAt,
  );
}

function cleanDate(value) {
  return typeof value === "string" && value ? value : null;
}

function cleanGuidanceKind(value) {
  return AGENT_PROVIDER_GUIDANCE_KINDS.includes(value) ? value : null;
}

function snapshotAvailability({
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
  return snapshotAvailability({
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
      return snapshotAvailability({ ...previous, checkedAt });
    }
    return snapshotAvailability({
      status: "checking",
      reason: "checking",
      lastCheck: "local",
      checkedAt,
      guidanceCopied: previous.guidanceCopied,
      guidanceCopiedAt: previous.guidanceCopiedAt,
    });
  }
  if (status === "not-installed") {
    return snapshotAvailability({
      status: "not-installed",
      reason: "not-installed",
      lastCheck: "local",
      checkedAt,
      guidanceCopied: previous.guidanceCopied,
      guidanceCopiedAt: previous.guidanceCopiedAt,
    });
  }
  return snapshotAvailability({
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

export function readyAgentProviderAvailability(checkedAt = null, lastCheck = "use") {
  return snapshotAvailability({
    status: "ready",
    reason: null,
    lastCheck: lastCheck === "local" ? "local" : "use",
    checkedAt,
  });
}

export function agentProviderAvailabilityFromFailureReason(
  reason,
  previous = INITIAL_AGENT_PROVIDER_AVAILABILITY,
  checkedAt = null,
) {
  return snapshotAvailability({
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
  return snapshotAvailability({
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
