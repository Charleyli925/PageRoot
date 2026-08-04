import {
  candidateAssessmentFromRecord,
  validationReviewFromRecord,
} from "../domain/run-lifecycle.js";
import { versionAuditCollections } from "../lib/version-audit-records";
import { commentsFromRecords, selectionFromRecord } from "./comment-model";
import { displayVersionLabel } from "./project-model";
import { isRecord } from "./record-model";
import type {
  DirectEditEvent,
  UserSupplementRecord,
  Version,
} from "./types";

export function changesFromRecords(raw: unknown): DirectEditEvent[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((value, index) => {
    if (!isRecord(value)) return [];
    const kind = String(value.kind || "");
    if (!["text", "style", "reorder", "structure"].includes(kind)) return [];
    return [{
      eventId: String(value.eventId || value.id || `change_unknown_${index + 1}`),
      createdAt: String(value.createdAt || ""),
      kind: kind as DirectEditEvent["kind"],
      target: selectionFromRecord(value.target || value),
      ...(value.property ? { property: String(value.property) } : {}),
      before: value.before,
      after: value.after,
      baseVersionId: value.baseVersionId || value.basedOnVersionId
        ? String(value.baseVersionId || value.basedOnVersionId)
        : null,
      ...(Number.isFinite(Number(value.capturedRevision ?? value.revision))
        ? {
            capturedRevision: Number(
              value.capturedRevision ?? value.revision,
            ),
          }
        : {}),
      ...(value.inherited === true ? { inherited: true } : {}),
      ...(value.inheritedFromVersionId
        ? { inheritedFromVersionId: String(value.inheritedFromVersionId) }
        : {}),
    }];
  });
}

export function supplementsFromRecords(raw: unknown): UserSupplementRecord[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((value) => {
    if (!isRecord(value)) return [];
    const action = String(value.action || "");
    const evidenceState = String(value.evidenceState || "text-only");
    if (!(["add", "amend", "retract"] as const).includes(
      action as "add" | "amend" | "retract",
    )) return [];
    if (!(["text-only", "original-file", "description-only"] as const).includes(
      evidenceState as "text-only" | "original-file" | "description-only",
    )) return [];
    const attachments = Array.isArray(value.attachments)
      ? value.attachments.flatMap((attachment) => {
          if (!isRecord(attachment)) return [];
          return [{
            attachmentId: String(attachment.attachmentId || ""),
            fileName: String(attachment.fileName || "附件"),
            mediaType: String(
              attachment.mediaType || "application/octet-stream",
            ),
            ...(attachment.relativePath
              ? { relativePath: String(attachment.relativePath) }
              : {}),
            ...(attachment.sha256 ? { sha256: String(attachment.sha256) } : {}),
          }];
        })
      : [];
    const refersTo = Array.isArray(value.refersTo)
      ? value.refersTo.map(String).filter(Boolean)
      : [];
    return [{
      recordId: String(value.recordId || ""),
      action: action as UserSupplementRecord["action"],
      text: String(value.userText || ""),
      createdAt: String(value.recordedAt || ""),
      ...(refersTo[0] ? { referenceId: refersTo[0] } : {}),
      evidenceState: evidenceState as UserSupplementRecord["evidenceState"],
      ...(value.evidenceDescription
        ? { evidenceDescription: String(value.evidenceDescription) }
        : {}),
      attachments,
    }];
  });
}

export function versionsFromWorkspace(
  payload: Record<string, unknown>,
): Version[] {
  if (!Array.isArray(payload.versions)) return [];
  return payload.versions.flatMap((raw) => {
    if (!isRecord(raw)) return [];
    if (!isRecord(raw.manifest) || raw.manifest.schemaVersion !== "3.0.0") {
      return [];
    }
    const manifest = raw.manifest;
    const id = String(manifest.versionId || "");
    if (!id) return [];
    const sourceType = String(manifest.sourceType || "");
    if (sourceType !== "initial" && sourceType !== "internal-ai") return [];
    const auditCollections = versionAuditCollections(raw);
    return [{
      id,
      ordinal: Number(manifest.versionOrdinal),
      label: displayVersionLabel(Number(manifest.versionOrdinal)),
      summary: String(manifest.summary),
      generatedAt: String(manifest.generatedAt),
      source: (
        sourceType === "internal-ai" ? "内部 AI" : "初始页面"
      ) as Version["source"],
      contentSha256: String(manifest.contentSha256 || raw.contentSha256 || ""),
      previousVersionId: manifest.previousVersionId
        ? String(manifest.previousVersionId)
        : null,
      basedOnVersionId: manifest.basedOnVersionId
        ? String(manifest.basedOnVersionId)
        : null,
      requestId: manifest.requestId ? String(manifest.requestId) : null,
      attemptId: manifest.attemptId ? String(manifest.attemptId) : null,
      committed: raw.committed !== false,
      comments: commentsFromRecords(auditCollections.comments).map((comment) => ({
        ...comment,
        ...(manifest.requestId && !comment.requestId
          ? { requestId: String(manifest.requestId) }
          : {}),
        ...(manifest.attemptId && !comment.attemptId
          ? { attemptId: String(manifest.attemptId) }
          : {}),
        resultVersionId: id,
      })),
      directEdits: changesFromRecords(auditCollections.editEvents),
      supplements: supplementsFromRecords(raw.supplements),
      validationReview: validationReviewFromRecord(raw.validationReview),
      candidateAssessment: candidateAssessmentFromRecord(
        raw.candidateAssessment,
      ),
    }];
  }).sort((a, b) => b.ordinal - a.ordinal);
}

export function changeKindLabel(event: DirectEditEvent): string {
  if (event.kind === "text") return "文字修改";
  if (event.kind === "reorder") return "位置移动";
  if (event.kind === "structure") return "结构调整";
  const labels: Record<string, string> = {
    fontSize: "字号",
    color: "文字颜色",
    backgroundColor: "模块填充",
    fontWeight: "加粗",
    fontStyle: "斜体",
    padding: "内边距",
    margin: "外间距",
    lineHeight: "行距",
  };
  return labels[event.property || ""] || "样式调整";
}

function compactHistoryText(value: unknown): string {
  if (value === null || value === undefined || value === "") return "未设置";
  const text = String(value).replace(/\s+/g, " ").trim();
  return text.length > 72 ? `${text.slice(0, 72)}…` : text;
}

function recordValueScalar(value: unknown): unknown {
  if (!isRecord(value)) return value;
  if (
    value.sourceValue !== null
    && value.sourceValue !== undefined
    && value.sourceValue !== ""
  ) {
    return value.sourceValue;
  }
  if (
    value.computedValue !== null
    && value.computedValue !== undefined
    && value.computedValue !== ""
  ) {
    return value.computedValue;
  }
  return value.value ?? value.index ?? value.toIndex ?? value.fromIndex ?? null;
}

function friendlyStyleValue(
  property: string | undefined,
  value: unknown,
): string {
  const scalar = recordValueScalar(value);
  const normalized = String(scalar ?? "").trim().toLowerCase();
  if (!normalized) return "未设置";
  if (property === "fontWeight") {
    const numeric = Number.parseInt(normalized, 10);
    if (
      normalized === "bold"
      || Number.isFinite(numeric) && numeric >= 600
    ) return "加粗";
    if (
      normalized === "normal"
      || Number.isFinite(numeric) && numeric < 600
    ) return "常规";
  }
  if (property === "fontStyle") {
    if (normalized === "italic" || normalized === "oblique") return "斜体";
    if (normalized === "normal") return "常规";
  }
  if (
    property === "backgroundColor"
    && ["transparent", "rgba(0, 0, 0, 0)"].includes(normalized)
  ) {
    return "透明";
  }
  return compactHistoryText(scalar);
}

export function historyRecordValue(
  event: DirectEditEvent,
  value: unknown,
): string {
  if (event.kind === "reorder" && isRecord(value)) {
    const index = Number(value.index ?? value.toIndex ?? value.fromIndex);
    return Number.isFinite(index) ? `第 ${index + 1} 位` : "原位置";
  }
  if (event.kind === "text") {
    const text = compactHistoryText(value);
    return text === "未设置" ? text : `“${text}”`;
  }
  if (event.kind === "style") return friendlyStyleValue(event.property, value);
  return compactHistoryText(recordValueScalar(value));
}

export function summarizeChangeEvents(
  events: DirectEditEvent[],
): DirectEditEvent[] {
  const summaries = new Map<string, DirectEditEvent>();
  for (const event of events) {
    const key = [
      event.target.id || event.target.selector,
      event.kind,
      event.property || "",
    ].join("::");
    const existing = summaries.get(key);
    summaries.set(key, existing
      ? {
          ...event,
          eventId: existing.eventId,
          before: existing.before,
          createdAt: event.createdAt,
        }
      : event);
  }
  return [...summaries.values()];
}
