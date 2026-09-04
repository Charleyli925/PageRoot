import {
  decodeDirectEditIdentity,
} from "../../shared/direct-edit-compatibility.mjs";

const CHANGE_KINDS = new Set(["text", "style", "reorder", "structure"]);

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function decodeAuditChange(value, {
  label,
  eventIdPattern,
  fallbackBasedOnVersionId,
  preserveUnassignedVersion = false,
}) {
  if (!isRecord(value)) return null;
  try {
    const identity = decodeDirectEditIdentity(value, {
      fallbackBasedOnVersionId,
      preserveUnassignedVersion,
      label,
    });
    const hasEventId = Object.hasOwn(value, "eventId");
    if (!hasEventId) return null;
    const eventId = String(value.eventId ?? "");
    const kind = String(value.kind ?? "");
    if (
      !eventIdPattern.test(eventId)
      || typeof value.createdAt !== "string"
      || !CHANGE_KINDS.has(kind)
      || !isRecord(value.target)
      || !Object.hasOwn(value, "before")
      || !Object.hasOwn(value, "after")
      || (
        Object.hasOwn(value, "property")
        && (typeof value.property !== "string" || !value.property)
      )
    ) return null;
    return {
      eventId,
      createdAt: value.createdAt,
      kind,
      target: value.target,
      ...(value.property ? { property: value.property } : {}),
      before: value.before,
      after: value.after,
      basedOnVersionId: identity.basedOnVersionId,
      revision: identity.revision,
    };
  } catch {
    return null;
  }
}

/**
 * Version archive ingress. Immutable Version records have normalized edit_*
 * identities and must carry their own complete Version identity.
 */
export function decodeVersionAuditChange(value) {
  return decodeAuditChange(value, {
    label: "Version edit event",
    eventIdPattern: /^edit_[A-Za-z0-9_-]+$/u,
  });
}

/**
 * Mutable Draft ingress. Workbench events retain their change_* identity and
 * an explicitly unassigned based-on Version until Request freeze can apply its
 * trusted fallback.
 */
export function decodeDraftAuditChange(value) {
  return decodeAuditChange(value, {
    label: "Draft edit event",
    eventIdPattern: /^change_[A-Za-z0-9_-]+$/u,
    preserveUnassignedVersion: true,
  });
}
