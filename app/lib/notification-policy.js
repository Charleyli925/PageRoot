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
const INTERNAL_FIELD_OR_PATH =
  /(?:\b(?:projectId|documentId|sourcePath|expectedSourceSha256|actualSourceSha256|storageDirectoryName|pendingWrite)\b|(?:^|\s)\/(?:Users|private|var|tmp)\/|file:\/\/|[A-Za-z]:\\)/u;

const PRODUCT_ERROR_MESSAGES = Object.freeze({
  PROJECT_ID_MISMATCH:
    "项目身份暂时无法核对。当前内容仍保留，请重新打开源页后再试。",
  DOCUMENT_ID_MISMATCH:
    "项目身份暂时无法核对。当前内容仍保留，请重新打开源页后再试。",
  PROJECT_CONTEXT_MISMATCH:
    "项目身份暂时无法核对。当前内容仍保留，请重新打开源页后再试。",
  PROJECT_CONTEXT_PATH_MISMATCH:
    "当前文件与项目记录暂时无法对应。内容仍保留，请重新打开源页后再试。",
  INCOMPLETE_PROJECT_CONTEXT:
    "当前操作缺少完整的项目身份。内容仍保留，请重新打开源页后再试。",
  REGISTERED_PROJECT_NOT_FOUND:
    "当前项目记录暂时不可用。内容仍保留，请重新打开源页后再试。",
  PROJECT_IDENTITY_MISMATCH:
    "项目记录暂时无法核对。PageRoot 没有覆盖源文件，请重新打开后再试。",
  SOURCE_REGISTRY_MISMATCH:
    "当前文件与项目记录暂时无法对应。PageRoot 没有覆盖源文件。",
  CANONICAL_SOURCE_IDENTITY_MISMATCH:
    "当前源 HTML 的身份已经变化。PageRoot 没有覆盖它，请重新载入后再试。",
  ACTIVE_SOURCE_PATH_COLLISION:
    "当前文件已关联到另一份项目记录。PageRoot 没有覆盖它，请重新打开源页。",
  SOURCE_CHANGED:
    "源 HTML 已在其他位置发生变化；PageRoot 没有覆盖它。",
  SOURCE_HASH_CONFLICT:
    "源 HTML 已在其他位置发生变化；PageRoot 没有覆盖它。",
  REGISTERED_PROJECT_UNAVAILABLE:
    "项目暂不可用，修改仍保留；放回原登记位置后自动恢复。",
  WORKING_COPY_UNAVAILABLE:
    "文件暂不可用，修改仍保留。",
  WORKING_COPY_CONFLICT:
    "磁盘文件与当前未保存修改都已保留；请先核对内容后再决定如何继续。",
  MANAGED_PATH_AMBIGUOUS:
    "当前文件无法唯一对应到工作文件。PageRoot 没有写入，请先恢复唯一位置。",
  MANAGED_SOURCE_IDENTITY_MISMATCH:
    "当前工作文件身份无法核对，PageRoot 没有切换路径。",
  INVALID_RENAME_STEM:
    "请输入不含路径、后缀和特殊符号的文件名。",
  REGISTERED_PROJECT_PATH_MISMATCH:
    "当前文件夹不是项目的登记位置。PageRoot 没有写入。",
  REGISTERED_PROJECT_IDENTITY_CHANGED:
    "登记位置的项目身份无法核对。PageRoot 没有写入。",
  PROJECT_IDENTITY_CHANGED:
    "当前文件夹的项目身份已变化，PageRoot 没有写入。请重新打开正确的项目。",
  MANAGED_SOURCE_AMBIGUOUS:
    "项目中存在多个可能的当前 HTML。PageRoot 没有写入，请重新打开目标文件。",
  AMBIGUOUS_SOURCE_FILE_IDENTITY:
    "当前 HTML 无法唯一对应到一个项目。PageRoot 没有写入，请选择正确的项目文件。",
  CANDIDATE_SOURCE_CHANGED:
    "候选生成后当前工作文件已变化，PageRoot 没有采纳过期结果。请重新核对或重新发起修改。",
  DRAFT_REVISION_CONFLICT:
    "评论记录已在另一项操作中更新。当前内容仍保留，请重新载入后再试。",
  AUTOSAVE_NOT_FLUSHED:
    "最后一次修改尚未安全写入源 HTML，请等待保存完成后再发送。",
  FREEZE_REVISION_NOT_PERSISTED:
    "最后一次修改尚未安全写入源 HTML，请等待保存完成后再发送。",
  INVALID_AUTOSAVE_ACK:
    "保存结果无法核对。当前编辑仍保留，PageRoot 不会采用不一致的内容。",
  INVALID_SOURCE_HISTORY_ACK:
    "撤销结果无法核对。本次结果未采用，请重新打开源页后再试。",
  CANDIDATE_ASSESSMENT_INVALID:
    "某次 AI 结果的校验记录无法核对。当前 HTML 没有被改动，请重试读取。",
  CANDIDATE_ASSESSMENT_IDENTITY_MISMATCH:
    "某次 AI 结果与它的校验记录不一致。当前 HTML 没有被改动，请重试读取。",
  CANDIDATE_ASSESSMENT_LEGACY_EVIDENCE_MISSING:
    "旧版 AI 结果缺少复核所需的记录。当前 HTML 没有被改动，请重试读取。",
  CANDIDATE_ASSESSMENT_LEGACY_EVIDENCE_INVALID:
    "旧版 AI 结果的复核记录无法安全读取。当前 HTML 没有被改动。",
  CANDIDATE_ASSESSMENT_LEGACY_EVIDENCE_MISMATCH:
    "旧版 AI 结果与保留的复核记录不一致。当前 HTML 没有被改动。",
});

const NOTICE_DISPOSITIONS = new Set([
  "silent-recover",
  "defer-and-resume",
  "direct-action",
  "user-choice",
  "background-result",
  "inform-in-place",
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
  const disposition = noticeDisposition(notice);
  if (
    notice.sticky
    || tone === "error"
    || disposition === "direct-action"
    || disposition === "user-choice"
  ) return null;
  if (disposition === "background-result") return 7_000;
  if (tone === "warning") return 5_000;
  return 2_500;
}

/**
 * Decide who owns the next step before deciding whether to interrupt the user.
 * Presentation is opt-in. Severity and the existence of a button do not prove
 * that the user owns recovery, so callers without an explicit disposition stay
 * in their existing control or panel instead of creating a global interruption.
 *
 * @param {{ disposition?: string, tone?: string, sticky?: boolean, dedupeKey?: string, action?: unknown } | null} notice
 * @returns {"silent-recover" | "defer-and-resume" | "direct-action" | "user-choice" | "background-result" | "inform-in-place"}
 */
export function noticeDisposition(notice) {
  if (notice && NOTICE_DISPOSITIONS.has(notice.disposition)) {
    return notice.disposition;
  }
  return "inform-in-place";
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
  const disposition = noticeDisposition(notice);
  return disposition === "direct-action"
    || disposition === "user-choice"
    || disposition === "background-result";
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
  const nextDisposition = noticeDisposition(next);
  const nextNeedsDecision =
    nextDisposition === "direct-action"
    || nextDisposition === "user-choice";
  if (
    (current.sticky || currentTone === "error")
    && NOTICE_PRIORITIES[nextTone] < NOTICE_PRIORITIES[currentTone]
    && !nextNeedsDecision
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
  const code = cause && typeof cause === "object"
    ? String(cause.code || "")
    : "";
  if (code && PRODUCT_ERROR_MESSAGES[code]) {
    return PRODUCT_ERROR_MESSAGES[code];
  }
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
    || INTERNAL_FIELD_OR_PATH.test(message)
    || (
      !/[\u3400-\u9fff]/u.test(message)
      && /[A-Za-z]{4}/u.test(message)
    )
  ) {
    message = fallback;
  }
  if (message.length > 280) {
    message = `${message.slice(0, 277).trimEnd()}…`;
  }
  return message || fallback;
}
