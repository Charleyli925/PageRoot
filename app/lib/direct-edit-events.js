import { auditEventKey } from "./audit-events.js";

function eventFromMutation({
  mutation,
  eventId,
  createdAt,
  baseVersionId,
  capturedRevision,
}) {
  return {
    eventId,
    createdAt,
    kind: mutation.kind,
    target: mutation.target,
    ...(mutation.property ? { property: mutation.property } : {}),
    before: mutation.before,
    after: mutation.after,
    baseVersionId,
    capturedRevision,
  };
}

function canCoalesceStyle(last, mutation, createdAt) {
  if (
    mutation.kind !== "style"
    || last?.kind !== "style"
    || last.target.id !== mutation.target.id
    || last.property !== mutation.property
  ) return false;
  const elapsed = new Date(createdAt).getTime() - new Date(last.createdAt).getTime();
  return Number.isFinite(elapsed) && elapsed >= 0 && elapsed < 1500;
}

/**
 * Append one forward-only direct-edit event.
 *
 * Consecutive style gestures may share one event only while that exact event
 * is still queued and has not entered an in-flight write. Once persistence
 * starts, a later gesture gets a new identity so acknowledgements cannot erase
 * newer work.
 */
export function appendDirectEditEvent({
  mutation,
  capturedRevision,
  createdAt,
  baseVersionId,
  events,
  pendingEvents,
  inFlightKeys,
  nextEventId,
}) {
  const last = events.at(-1) || null;
  const lastKey = last ? auditEventKey(last) : null;
  const sameStyle = Boolean(
    last
    && canCoalesceStyle(last, mutation, createdAt)
    && pendingEvents.some((event) => event.eventId === last.eventId)
    && (!lastKey || !inFlightKeys.has(lastKey)),
  );
  const nextEvent = sameStyle
    ? {
        ...last,
        after: mutation.after,
        target: mutation.target,
        capturedRevision,
      }
    : eventFromMutation({
        mutation,
        eventId: nextEventId(),
        createdAt,
        baseVersionId,
        capturedRevision,
      });
  const nextEvents = sameStyle
    ? [...events.slice(0, -1), nextEvent]
    : [...events, nextEvent];
  const nextPendingEvents = sameStyle
    ? [
        ...pendingEvents.filter((event) => event.eventId !== nextEvent.eventId),
        nextEvent,
      ]
    : [...pendingEvents, nextEvent];
  return {
    events: nextEvents,
    pendingEvents: nextPendingEvents,
  };
}
