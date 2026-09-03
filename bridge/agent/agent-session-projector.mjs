export function executionPhaseForEvent(event, current) {
  let next;
  switch (event?.kind) {
    case "initialized": next = "starting-session"; break;
    case "request-sent": next = "sending-task"; break;
    case "generation-started": next = "generating-modification"; break;
    case "html-validation-completed": next = "validating-html"; break;
    case "review-preparation-started": next = "preparing-review"; break;
    case "file-read": next = "reading-task"; break;
    case "file-written": next = "writing-candidate"; break;
    case "terminal-created": next = "finalizing"; break;
    case "completion":
    case "completion-verified":
    case "turn-stopping":
    case "turn-stopped": next = "preparing-review"; break;
    case "cancel-requested":
    case "host-cancelling": return "cancelling";
    default: return current;
  }
  const publicOrder = [
    "starting-session",
    "sending-task",
    "generating-modification",
    "validating-html",
    "preparing-review",
  ];
  const currentRank = publicOrder.indexOf(current);
  const nextRank = publicOrder.indexOf(next);
  return currentRank >= 0 && nextRank >= 0 && nextRank < currentRank ? current : next;
}

const MAX_VISIBLE_TEXT_UPDATES = 80;
const SENTENCE_END = /[。！？.!?]\s*$/u;

function cleanPublicId(value, fallback) {
  const normalized = String(value || "")
    .replace(/[\u0000-\u001f\u007f]/gu, "")
    .trim()
    .slice(0, 160);
  return normalized || fallback;
}

function appendUpdate(updates, {
  id,
  groupId = null,
  forceNew = false,
  sequence,
  text,
}) {
  const previous = updates.at(-1);
  if (previous && groupId && previous.groupId === groupId) {
    previous.text += text;
    previous.sequence = sequence;
    return;
  }
  if (
    previous
    && !forceNew
    && !groupId
    && !previous.groupId
    && !SENTENCE_END.test(previous.text)
  ) {
    previous.text += text;
    previous.sequence = sequence;
    return;
  }
  updates.push({ id, groupId, sequence, text });
}

function freezePublicUpdate(update) {
  return Object.freeze({
    id: update.id,
    sequence: update.sequence,
    text: update.text,
  });
}

/**
 * Projects only the Agent's public words into stable display updates.
 *
 * Codex supplies an item id, so token deltas from one public message remain one
 * row. ACP providers without a message id are coalesced until a sentence or
 * paragraph boundary. No tool event, hidden reasoning, prompt or filesystem
 * detail crosses this projection.
 */
export function publicVisibleTextUpdates(events) {
  const updates = [];
  for (const event of Array.isArray(events) ? events : []) {
    if (event?.kind !== "visible-text" || typeof event.text !== "string") continue;
    const rawText = event.text
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "");
    if (!rawText) continue;
    const eventId = cleanPublicId(event.eventId, `visible-${Number(event.sequence) || 0}`);
    const rawGroupId = cleanPublicId(event.messageId || event.segmentId, "");
    const parts = rawGroupId ? [rawText] : rawText.split(/\n{2,}/u);
    for (let index = 0; index < parts.length; index += 1) {
      const text = parts[index];
      if (!text.trim()) continue;
      const groupId = rawGroupId ? `${rawGroupId}:${index}` : null;
      appendUpdate(updates, {
        id: groupId ? `message:${groupId}` : `${eventId}:${index}`,
        groupId,
        // A blank-line paragraph is an explicit public boundary even when the
        // preceding paragraph is a heading or fragment without punctuation.
        forceNew: !rawGroupId && index > 0,
        sequence: Number.isSafeInteger(event.sequence) ? event.sequence : 0,
        text,
      });
    }
  }
  if (updates.length <= MAX_VISIBLE_TEXT_UPDATES) {
    return Object.freeze(updates.map(freezePublicUpdate));
  }
  const retained = updates.slice(-(MAX_VISIBLE_TEXT_UPDATES - 1));
  const collapsed = updates.slice(0, updates.length - retained.length);
  const first = collapsed[0];
  return Object.freeze([
    Object.freeze({
      id: `earlier:${first.id}`,
      sequence: collapsed.at(-1).sequence,
      text: collapsed.map((update) => update.text).join("\n"),
    }),
    ...retained.map(freezePublicUpdate),
  ]);
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
    lastActivityAt: entry.lastActivityAt || null,
    receivedBytes: Number.isSafeInteger(entry.receivedBytes) && entry.receivedBytes >= 0
      ? entry.receivedBytes
      : 0,
    updatedAt: entry.updatedAt,
    agentName: entry.agentName || null,
    agentVersion: entry.agentVersion || null,
    eventCount: entry.eventCount || 0,
    visibleText: entry.visibleText || "",
    visibleTextUpdates: Object.freeze([...(entry.visibleTextUpdates || [])]),
    textTruncated: entry.textTruncated === true,
    retryable: entry.retryable === true,
    safeToRetry: typeof entry.safeToRetry === "boolean"
      ? entry.safeToRetry
      : entry.retryable === true,
    recoveryKind: entry.recoveryKind || "end",
    errorCode: entry.errorCode || null,
    errorMessage: entry.errorMessage || null,
  });
}
