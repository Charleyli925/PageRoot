/**
 * @typedef {{ eventId: string, revision?: number }} AuditEventIdentity
 */

/**
 * A style gesture may retain one eventId while its captured revision advances.
 * The pair, not the eventId alone, is therefore the autosave acknowledgement
 * identity.
 *
 * @param {AuditEventIdentity} event
 */
export function auditEventKey(event) {
  if (
    !event
    || typeof event.eventId !== "string"
    || !Number.isSafeInteger(event.revision)
    || event.revision < 1
  ) {
    throw new TypeError("A v3 audit event requires eventId and revision.");
  }
  return `${event.eventId}:${event.revision}`;
}

/**
 * @template {AuditEventIdentity} T
 * @param {T[]} queued
 * @param {AuditEventIdentity[]} acknowledged
 * @returns {T[]}
 */
export function removeAcknowledgedAuditEvents(queued, acknowledged) {
  const acknowledgedKeys = new Set(acknowledged.map(auditEventKey));
  return queued.filter((event) => !acknowledgedKeys.has(auditEventKey(event)));
}
