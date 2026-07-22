import { auditEventKey } from "./audit-events.js";

function sameAuditEvent(left, right) {
  return auditEventKey(left) === auditEventKey(right);
}

function pendingEventById(events, eventId) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index].eventId === eventId) return events[index];
  }
  return null;
}

function hasPendingEvent(events, expected) {
  return events.some((event) => sameAuditEvent(event, expected));
}

function removePendingEvent(events, expected) {
  return events.filter((event) => !sameAuditEvent(event, expected));
}

function replaceEffectiveEvent(events, eventId, replacement) {
  const index = events.findIndex((event) => event.eventId === eventId);
  if (index < 0) return replacement ? [...events, replacement] : [...events];
  if (!replacement) {
    return [...events.slice(0, index), ...events.slice(index + 1)];
  }
  return [...events.slice(0, index), replacement, ...events.slice(index + 1)];
}

function eventFromMutation({
  mutation,
  eventId,
  createdAt,
  baseVersionId,
  capturedRevision,
  undoesEventId,
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
    ...(mutation.historyId ? { historyId: mutation.historyId } : {}),
    ...(undoesEventId ? { undoesEventId } : {}),
  };
}

function canCoalesceStyle(last, mutation, createdAt, forceCoalesce) {
  if (
    mutation.kind !== "style"
    || last?.kind !== "style"
    || last.target.id !== mutation.target.id
    || last.property !== mutation.property
  ) return false;
  if (forceCoalesce) return true;
  const elapsed = new Date(createdAt).getTime() - new Date(last.createdAt).getTime();
  return Number.isFinite(elapsed) && elapsed >= 0 && elapsed < 1500;
}

function appendForwardMutation(state, options = {}) {
  const {
    mutation,
    capturedRevision,
    createdAt,
    baseVersionId,
    nextEventId,
  } = state;
  const last = state.events.at(-1) || null;
  const sameStyle = canCoalesceStyle(
    last,
    mutation,
    createdAt,
    options.forceStyleCoalesce === true,
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
  const previousPendingEvent = sameStyle
    ? pendingEventById(state.pendingEvents, nextEvent.eventId)
    : null;
  const undoFolds = new Map(state.undoFolds);
  if (mutation.historyId) {
    undoFolds.set(mutation.historyId, {
      event: nextEvent,
      eventId: nextEvent.eventId,
      previousEvent: sameStyle ? last : null,
      previousPendingEvent,
    });
  }
  const events = sameStyle
    ? [...state.events.slice(0, -1), nextEvent]
    : [...state.events, nextEvent];
  const pendingEvents = sameStyle
    ? [
        ...state.pendingEvents.filter((event) => event.eventId !== nextEvent.eventId),
        nextEvent,
      ]
    : [...state.pendingEvents, nextEvent];
  return {
    ...state,
    events,
    pendingEvents,
    undoFolds,
  };
}

/**
 * Fold a canvas mutation into the current effective draft and the append-only
 * audit outbox. Pending and in-flight are deliberately separate: an event may
 * be removed from a queued write, but it may not be erased from a request that
 * has already started.
 */
export function reduceDirectEditHistory({
  mutation,
  capturedRevision,
  createdAt,
  baseVersionId,
  events,
  pendingEvents,
  undoFolds,
  redoFolds,
  inFlightKeys,
  nextEventId,
}) {
  let state = {
    mutation,
    capturedRevision,
    createdAt,
    baseVersionId,
    events: [...events],
    pendingEvents: [...pendingEvents],
    undoFolds: new Map(undoFolds),
    redoFolds: new Map(redoFolds),
    inFlightKeys: new Set(inFlightKeys),
    nextEventId,
  };

  if (mutation.historyAction === "undo") {
    const undoFold = mutation.historyId
      ? state.undoFolds.get(mutation.historyId) || null
      : null;
    if (!undoFold) {
      const fallbackEvent = eventFromMutation({
        mutation,
        eventId: nextEventId(),
        createdAt,
        baseVersionId,
        capturedRevision,
      });
      return {
        events: [...state.events, fallbackEvent],
        pendingEvents: [...state.pendingEvents, fallbackEvent],
        undoFolds: state.undoFolds,
        redoFolds: state.redoFolds,
      };
    }

    const restoredPreviousEvent = undoFold.previousEvent
      ? { ...undoFold.previousEvent, target: mutation.target }
      : null;
    const nextEvents = replaceEffectiveEvent(
      state.events,
      undoFold.eventId,
      restoredPreviousEvent,
    );
    const forwardIsPending = hasPendingEvent(state.pendingEvents, undoFold.event);
    const forwardIsInFlight = state.inFlightKeys.has(auditEventKey(undoFold.event));
    let nextPendingEvents;
    let undoAuditEvent = null;
    if (forwardIsPending && !forwardIsInFlight) {
      nextPendingEvents = removePendingEvent(state.pendingEvents, undoFold.event);
      if (undoFold.previousPendingEvent) {
        nextPendingEvents = [
          ...nextPendingEvents.filter(
            (event) => event.eventId !== undoFold.previousPendingEvent.eventId,
          ),
          undoFold.previousPendingEvent,
        ];
      }
    } else {
      undoAuditEvent = eventFromMutation({
        mutation,
        eventId: nextEventId(),
        createdAt,
        baseVersionId,
        capturedRevision,
        undoesEventId: undoFold.eventId,
      });
      nextPendingEvents = [...state.pendingEvents, undoAuditEvent];
    }

    const nextUndoFolds = new Map(state.undoFolds);
    nextUndoFolds.delete(mutation.historyId);
    const nextRedoFolds = new Map(state.redoFolds);
    nextRedoFolds.set(mutation.historyId, {
      undoFold,
      undoAuditEvent,
    });
    return {
      events: nextEvents,
      pendingEvents: nextPendingEvents,
      undoFolds: nextUndoFolds,
      redoFolds: nextRedoFolds,
    };
  }

  if (mutation.historyAction === "redo") {
    const redoFold = mutation.historyId
      ? state.redoFolds.get(mutation.historyId) || null
      : null;
    if (redoFold) {
      const undoAuditEvent = redoFold.undoAuditEvent;
      const undoCanBeCancelled = !undoAuditEvent || (
        hasPendingEvent(state.pendingEvents, undoAuditEvent)
        && !state.inFlightKeys.has(auditEventKey(undoAuditEvent))
      );
      if (undoCanBeCancelled) {
        const restoredEvent = {
          ...redoFold.undoFold.event,
          target: mutation.target,
        };
        const restoredEvents = replaceEffectiveEvent(
          state.events,
          redoFold.undoFold.eventId,
          restoredEvent,
        );
        const restoredPendingEvents = undoAuditEvent
          ? removePendingEvent(state.pendingEvents, undoAuditEvent)
          : [
              ...state.pendingEvents.filter(
                (event) => event.eventId !== restoredEvent.eventId,
              ),
              restoredEvent,
            ];
        const nextUndoFolds = new Map(state.undoFolds);
        nextUndoFolds.set(mutation.historyId, {
          ...redoFold.undoFold,
          event: restoredEvent,
        });
        const nextRedoFolds = new Map(state.redoFolds);
        nextRedoFolds.delete(mutation.historyId);
        return {
          events: restoredEvents,
          pendingEvents: restoredPendingEvents,
          undoFolds: nextUndoFolds,
          redoFolds: nextRedoFolds,
        };
      }

      const nextRedoFolds = new Map(state.redoFolds);
      nextRedoFolds.delete(mutation.historyId);
      state = {
        ...state,
        redoFolds: nextRedoFolds,
      };
      const forceStyleCoalesce = Boolean(
        redoFold.undoFold.previousEvent
        && state.events.at(-1)?.eventId === redoFold.undoFold.previousEvent.eventId,
      );
      const appended = appendForwardMutation(state, { forceStyleCoalesce });
      return {
        events: appended.events,
        pendingEvents: appended.pendingEvents,
        undoFolds: appended.undoFolds,
        redoFolds: appended.redoFolds,
      };
    }

    const appended = appendForwardMutation(state);
    return {
      events: appended.events,
      pendingEvents: appended.pendingEvents,
      undoFolds: appended.undoFolds,
      redoFolds: appended.redoFolds,
    };
  }

  state.redoFolds.clear();
  const appended = appendForwardMutation(state);
  return {
    events: appended.events,
    pendingEvents: appended.pendingEvents,
    undoFolds: appended.undoFolds,
    redoFolds: appended.redoFolds,
  };
}
