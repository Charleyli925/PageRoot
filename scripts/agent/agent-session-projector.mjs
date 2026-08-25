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

export function discussionPhaseForEvent(event, current) {
  switch (event?.kind) {
    case "initialized": return "starting-session";
    case "file-read": return "reading-page";
    case "visible-text": return "replying";
    case "session-update": return "discussing";
    case "turn-stopping":
    case "turn-stopped": return "finishing";
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

export function publicDiscussionSession(entry, driver = "qoder-acp") {
  if (!entry) return null;
  return Object.freeze({
    driver,
    state: entry.state,
    phase: entry.phase,
    conversationId: entry.conversationId,
    turnId: entry.turnId,
    sourceSha256: entry.sourceSha256,
    startedAt: entry.startedAt,
    updatedAt: entry.updatedAt,
    agentName: entry.agentName || null,
    agentVersion: entry.agentVersion || null,
    eventCount: entry.eventCount || 0,
    replyText: entry.replyText || "",
    replyTruncated: entry.replyTruncated === true,
    recorded: entry.recorded === true,
    interrupted: entry.interrupted === true,
    ...(entry.interruptedReason ? { interruptedReason: entry.interruptedReason } : {}),
    ...(entry.errorCode ? { errorCode: entry.errorCode } : {}),
    ...(entry.errorMessage ? { errorMessage: entry.errorMessage } : {}),
  });
}
