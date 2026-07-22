const NOTICE_PRIORITIES = Object.freeze({
  success: 1,
  info: 1,
  warning: 2,
  error: 3,
});

const IPC_ERROR_PREFIX =
  /^Error invoking remote method ['"][^'"]+['"]:\s*/i;
const ERROR_CLASS_PREFIX =
  /^(?:ProjectFileError|TypeError|RangeError|Error):\s*/i;

const BLOCKING_WARNING_KEYS = new Set([
  "ai-submit-commit-blocked",
  "ai-submit-freeze-blocked",
  "browser-file-error",
  "navigation-commit-blocked",
  "preview-commit-blocked",
  "project-switch-commit-blocked",
  "project-switch-persist-blocked",
  "submit-blocked",
  "unfinished-comment-draft",
  "user-flush-commit-blocked",
]);

/**
 * @param {unknown} value
 * @returns {"success" | "info" | "warning" | "error"}
 */
export function noticeTone(value) {
  return Object.hasOwn(NOTICE_PRIORITIES, value) ? value : "info";
}

/**
 * @param {{ tone?: string, sticky?: boolean } | null} notice
 * @returns {number | null}
 */
export function noticeAutoDismissMs(notice) {
  if (!notice) return null;
  const tone = noticeTone(notice.tone);
  if (notice.sticky || tone === "error") return null;
  if (tone === "warning") return 5_000;
  return 2_500;
}

/**
 * Keep transient notifications exceptional. Ongoing AI state belongs in the
 * process board; ordinary saves, copies and navigation confirmations remain
 * visible in their controls instead of producing another overlay.
 *
 * @param {{ tone?: string, sticky?: boolean, dedupeKey?: string, action?: unknown } | null} notice
 */
export function shouldPresentNotice(notice) {
  if (!notice) return true;
  const tone = noticeTone(notice.tone);
  if (tone === "error" || notice.sticky || notice.action) return true;
  return tone === "warning"
    && BLOCKING_WARNING_KEYS.has(String(notice.dedupeKey || ""));
}

/**
 * A persistent warning/error cannot be hidden by a lower-priority success or
 * info message. The same scoped notice may still replace itself after retry.
 *
 * @param {{ tone?: string, sticky?: boolean, dedupeKey?: string, title?: string, message?: string, action?: unknown } | null} current
 * @param {{ tone?: string, sticky?: boolean, dedupeKey?: string, title?: string, message?: string, action?: unknown } | null} next
 */
export function shouldReplaceNotice(current, next) {
  if (!next) return true;
  if (!current) return true;
  if (
    current.dedupeKey
    && next.dedupeKey
    && current.dedupeKey === next.dedupeKey
  ) {
    return current.title !== next.title
      || current.message !== next.message
      || current.tone !== next.tone
      || Boolean(current.sticky) !== Boolean(next.sticky)
      || current.action !== next.action;
  }
  const currentTone = noticeTone(current.tone);
  const nextTone = noticeTone(next.tone);
  if (
    (current.sticky || currentTone === "error")
    && NOTICE_PRIORITIES[nextTone] < NOTICE_PRIORITIES[currentTone]
  ) {
    return false;
  }
  return true;
}

/**
 * Remove Electron IPC plumbing and internal exception class names before an
 * error reaches product UI. Technical details remain available to the caller
 * for logging, while the visible message stays concise and actionable.
 *
 * @param {unknown} cause
 * @param {string} fallback
 */
export function productErrorMessage(cause, fallback) {
  const raw = cause instanceof Error
    ? cause.message
    : typeof cause === "string"
      ? cause
      : "";
  let message = raw
    .replace(IPC_ERROR_PREFIX, "")
    .replace(ERROR_CLASS_PREFIX, "")
    .replace(IPC_ERROR_PREFIX, "")
    .replace(ERROR_CLASS_PREFIX, "")
    .replace(/\s+at\s+\S+\s+\([^)]*\)(?:\s+at\s+.*)*$/s, "")
    .replace(/\bruntime-state\b/gi, "项目运行状态")
    .replace(/\brevision\b/gi, "编辑状态")
    .replace(/\bhash\b/gi, "内容校验")
    .trim();

  if (
    !message
    || /^(?:Failed to fetch|NetworkError|Load failed)$/i.test(message)
    || /(?:operation was aborted|signal timed out|timed out due to timeout)/i.test(message)
    || (
      cause instanceof Error
      && /^(?:AbortError|TimeoutError)$/i.test(cause.name)
    )
  ) {
    message = fallback;
  }
  if (message.length > 280) {
    message = `${message.slice(0, 277).trimEnd()}…`;
  }
  return message || fallback;
}
