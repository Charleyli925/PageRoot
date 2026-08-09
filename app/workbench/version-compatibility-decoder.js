import {
  decodeDirectEditIdentity,
} from "../../shared/direct-edit-compatibility.mjs";

const CHANGE_KINDS = new Set(["text", "style", "reorder", "structure"]);

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Version archive ingress. The view receives only DirectEditEvent's canonical
 * basedOnVersionId/revision names; retired wire names never escape this
 * decoder.
 */
export function decodeVersionAuditChange(value) {
  if (!isRecord(value)) return null;
  try {
    const identity = decodeDirectEditIdentity(value, {
      label: "Version edit event",
    });
    const hasEventId = Object.hasOwn(value, "eventId");
    const hasLegacyId = Object.hasOwn(value, "id");
    if (hasEventId && hasLegacyId) return null;
    const eventId = String(hasEventId ? value.eventId : value.id ?? "");
    const kind = String(value.kind ?? "");
    if (
      !/^edit_[A-Za-z0-9_-]+$/u.test(eventId)
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
