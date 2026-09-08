export function executionPhaseForEvent(event, current) {
  let next;
  switch (event?.kind) {
    case "initialized": next = "starting-session"; break;
    case "request-sent": next = "sending-task"; break;
    case "response-started": next = "receiving-response"; break;
    case "generation-started": next = "generating-modification"; break;
    case "response-ended": next = "response-received"; break;
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
    "receiving-response",
    "generating-modification",
    "response-received",
    "validating-html",
    "preparing-review",
  ];
  const currentRank = publicOrder.indexOf(current);
  const nextRank = publicOrder.indexOf(next);
  return currentRank >= 0 && nextRank >= 0 && nextRank < currentRank ? current : next;
}

// Apply to assembled text, never token fragments, so split credentials cannot
// bypass the public boundary. Renderer still renders this as plain text.
export function safePublicAgentText(value) {
  const text = String(value || "").slice(0, 65536)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "");
  if (/<(?:!doctype|\/?[a-z][a-z0-9:-]*(?:\s|>|\/))/iu.test(text)) return "生成内容已隐藏，校验通过后可查看修改。";
  return text
    .replace(/https?:\/\/[^\s]+/giu, "[链接已隐藏]")
    .replace(/\b(?:sk|rk|pk)-[A-Za-z0-9_-]+/gu, "[凭据已隐藏]")
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9+/_=.:-]+/giu, "[凭据已隐藏]")
    .replace(/((?:api[_ -]?key|access[_ -]?token|secret|password|authorization)\s*[=:]\s*)[^\s,;]+/giu, "$1[已隐藏]")
    .replace(/\/(?:Users|home|tmp|private|var|Volumes|Applications|etc|root)\/[^\s<>"']+/gu, "[路径已隐藏]")
    .replace(/(?:\/[A-Za-z0-9._~-]+){2,}(?:\/[A-Za-z0-9._~%+ -]*)?/gu, "[路径已隐藏]")
    .replace(/[A-Za-z]:\\(?:[^\s\\]+\\)*[^\s]*/gu, "[路径已隐藏]")
    .replace(/https?:\/\/[^\s]+/giu, "[链接已隐藏]");
}

// Sealed public narration only; callers must never supply reasoning or tool output.
export function safePublicAgentSummary(value) {
  const text = safePublicAgentText(value).trim();
  return text.length > 4096 ? `${text.slice(0, 4080)}\n（摘要已截断）` : text;
}

const MAX_VISIBLE_TEXT_UPDATES = 80;
const SENTENCE_END = /[。！？.!?]\s*$/u;

function cleanPublicId(value, fallback) {
  const normalized = String(value || "")
    .replace(/[\u0000-\u001f\u007f]/gu, "")
    .trim()
    .slice(0, 160);
  return /^[A-Za-z0-9_:-]{1,160}$/u.test(normalized) ? normalized : fallback;
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
    text: safePublicAgentText(update.text),
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
  let remaining = 65536;
  for (const event of Array.isArray(events) ? events : []) {
    if (event?.kind !== "visible-text" || typeof event.text !== "string") continue;
    const rawText = event.text
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "").slice(0, remaining);
    remaining -= rawText.length;
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
      text: safePublicAgentText(collapsed.map((update) => update.text).join("\n")),
    }),
    ...retained.map(freezePublicUpdate),
  ]);
}

export function publicExecutionSession(entry) {
  if (!entry) return null;
  return Object.freeze({
    providerId: entry.providerId || null,
    runtimeId: entry.runtimeId || null,
    // Retain this only for legacy in-memory sessions. Renderer identity is
    // provider/runtime based and must not infer a provider from a transport alias.
    ...(entry.driver ? { driver: entry.driver } : {}),
    state: entry.state,
    phase: entry.phase,
    startedAt: entry.startedAt,
    lastActivityAt: entry.lastActivityAt || null,
    receivedBytes: Number.isSafeInteger(entry.receivedBytes) && entry.receivedBytes >= 0
      ? entry.receivedBytes
      : 0,
    updatedAt: entry.updatedAt,
    agentName: entry.agentName ? safePublicAgentText(entry.agentName).slice(0, 160) : null,
    agentVersion: entry.agentVersion ? safePublicAgentText(entry.agentVersion).slice(0, 80) : null,
    eventCount: entry.eventCount || 0,
    visibleText: safePublicAgentText(entry.visibleText),
    visibleTextUpdates: Object.freeze((entry.visibleTextUpdates || []).map((update, index) => Object.freeze({
      id: cleanPublicId(update.id, `public-${index}`), sequence: update.sequence,
      text: safePublicAgentText(update.text),
    }))),
    textTruncated: entry.textTruncated === true,
    retryable: entry.retryable === true,
    safeToRetry: typeof entry.safeToRetry === "boolean"
      ? entry.safeToRetry
      : entry.retryable === true,
    recoveryKind: entry.recoveryKind || "end",
    errorCode: entry.errorCode || null,
    errorMessage: entry.errorMessage ? safePublicAgentText(entry.errorMessage).slice(0, 1000) : null,
  });
}
