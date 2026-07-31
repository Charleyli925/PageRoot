import type { SourceHistoryEntry } from "../domain/source-history.js";
import type { RecoveryIdentity } from "./types";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function sourceHistoryOperationsFromRecord(
  value: unknown,
): SourceHistoryEntry[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is Record<string, unknown> => (
      isRecord(entry)
      && /^sourceop_[A-Za-z0-9_-]{12,180}$/.test(
        String(entry.operationId || ""),
      )
      && Array.isArray(entry.forwardPatches)
      && Array.isArray(entry.reversePatches)
    ))
    .map((entry) => structuredClone(entry) as unknown as SourceHistoryEntry);
}

export function ownsNativeTextHistory(target: Element | null): boolean {
  if (!target) return false;
  const editable = target.closest<HTMLElement>(
    "textarea, input, [contenteditable='true']",
  );
  if (!editable) return false;
  if (editable.isContentEditable) return true;
  if (editable instanceof HTMLTextAreaElement) {
    return !editable.disabled && !editable.readOnly;
  }
  if (!(editable instanceof HTMLInputElement)) return false;
  return (
    !editable.disabled
    && !editable.readOnly
    && [
      "email",
      "number",
      "password",
      "search",
      "tel",
      "text",
      "url",
    ].includes(editable.type)
  );
}

export function draftAuthorityFromWorkspace(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const runtime = isRecord(payload.runtimeState) ? payload.runtimeState : {};
  return isRecord(runtime.draft)
    ? runtime.draft
    : isRecord(payload.activeDraft)
      ? payload.activeDraft
      : {};
}

export function authoritativeDraftRevision(
  draft: Record<string, unknown>,
): number {
  const revision = Number(draft.draftRevision || 0);
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : 0;
}

function scopeDifferenceKindLabel(kind: unknown): string {
  if (kind === "text") return "文字";
  if (kind === "attribute") return "元素属性";
  if (kind === "structure") return "页面结构";
  if (kind === "inline-style") return "局部样式";
  if (kind === "shared-css") return "共享样式";
  return "页面内容";
}

function compactScopePreview(value: unknown): string {
  const text = String(value || "").replace(/\s+/gu, " ").trim();
  return text.length > 80 ? `${text.slice(0, 77)}…` : text;
}

export function scopeDecisionSummary(
  report: Record<string, unknown> | undefined,
): {
  message: string;
  examples: string[];
} {
  const differences = Array.isArray(report?.differences)
    ? report.differences.filter((item) => (
        isRecord(item)
        && item.allowed === false
        && item.material !== false
      ))
    : [];
  if (differences.length === 0) {
    return {
      message: "AI 结果包含评论范围外的变化。当前 HTML 尚未改变。",
      examples: [],
    };
  }
  const kinds = [...new Set(
    differences.map((item) => scopeDifferenceKindLabel(
      isRecord(item) ? item.kind : null,
    )),
  )];
  const examples = differences.slice(0, 3).map((item) => {
    if (!isRecord(item)) return "";
    const before = isRecord(item.before)
      ? compactScopePreview(item.before.preview)
      : "";
    const after = isRecord(item.after)
      ? compactScopePreview(item.after.preview)
      : "";
    const label = scopeDifferenceKindLabel(item.kind);
    if (before && after) return `${label}：“${before}” → “${after}”`;
    if (after) return `${label}：新增“${after}”`;
    if (before) return `${label}：移除“${before}”`;
    return `${label}发生了额外变化`;
  }).filter(Boolean);
  return {
    message: `AI 还修改了评论范围外的${kinds.join("、")}，共 ${differences.length} 处。当前 HTML 尚未改变。`,
    examples,
  };
}

export function recoveryIdentityFromRecord(
  value: unknown,
): RecoveryIdentity | null {
  if (!isRecord(value)) return null;
  const identity = {
    schemaVersion: String(value.schemaVersion || ""),
    projectId: String(value.projectId || ""),
    documentId: String(value.documentId || ""),
    sourcePath: String(value.sourcePath || ""),
    basedOnVersionId: String(value.basedOnVersionId || ""),
    sourceSha256: String(value.sourceSha256 || ""),
    editRevision: Number(value.editRevision),
    token: String(value.token || ""),
  };
  if (
    identity.schemaVersion !== "1.0.0"
    || !identity.projectId
    || !identity.documentId
    || !identity.sourcePath
    || !identity.basedOnVersionId
    || !/^sha256:[a-f0-9]{64}$/u.test(identity.sourceSha256)
    || !Number.isSafeInteger(identity.editRevision)
    || identity.editRevision < 0
    || !/^sha256:[a-f0-9]{64}$/u.test(identity.token)
  ) return null;
  return identity as RecoveryIdentity;
}

export function historyTextSelectionFromRecord(raw: unknown): {
  anchor: number;
  focus: number;
  affinity: "left" | "right";
} | null {
  if (!isRecord(raw)) return null;
  const anchor = Number(raw.anchor);
  const focus = Number(raw.focus);
  const affinity = String(raw.affinity || "");
  if (
    !Number.isSafeInteger(anchor)
    || !Number.isSafeInteger(focus)
    || anchor < 0
    || focus < 0
    || (affinity !== "left" && affinity !== "right")
  ) return null;
  return {
    anchor,
    focus,
    affinity,
  };
}
