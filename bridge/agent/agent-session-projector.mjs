export function executionPhaseForEvent(event, current) {
  switch (event?.kind) {
    case "initialized": return "starting-session";
    case "file-read": return "reading-task";
    case "file-written": return "writing-candidate";
    case "terminal-created": return "finalizing";
    case "completion":
    case "completion-verified":
    case "turn-stopping":
    case "turn-stopped": return "awaiting-validation";
    case "cancel-requested":
    case "host-cancelling": return "cancelling";
    default: return current;
  }
}

export function publicExecutionSession(entry) {
  if (!entry) return null;
  return Object.freeze({
    providerId: entry.providerId || null,
    runtimeId: entry.runtimeId || null,
    // Retain this only for legacy sessions. Renderer identity is provider/runtime
    // based and must not infer a provider from a transport alias.
    ...(entry.driver ? { driver: entry.driver } : {}),
    state: entry.state,
    phase: entry.phase,
    startedAt: entry.startedAt,
    updatedAt: entry.updatedAt,
    agentName: entry.agentName || null,
    agentVersion: entry.agentVersion || null,
    eventCount: entry.eventCount || 0,
    visibleText: entry.visibleText || "",
    textTruncated: entry.textTruncated === true,
    retryable: entry.retryable === true,
    ...(entry.errorCode ? { errorCode: entry.errorCode } : {}),
    ...(entry.errorMessage ? { errorMessage: entry.errorMessage } : {}),
  });
}
