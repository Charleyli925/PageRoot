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

export function publicExecutionSession(entry, driver = "qoder-acp") {
  if (!entry) return null;
  return Object.freeze({
    driver,
    state: entry.state,
    phase: entry.phase,
    startedAt: entry.startedAt,
    updatedAt: entry.updatedAt,
    agentName: entry.agentName || null,
    agentVersion: entry.agentVersion || null,
    eventCount: entry.eventCount || 0,
    visibleText: entry.visibleText || "",
    retryable: entry.retryable === true,
    ...(entry.errorCode ? { errorCode: entry.errorCode } : {}),
    ...(entry.errorMessage ? { errorMessage: entry.errorMessage } : {}),
  });
}
