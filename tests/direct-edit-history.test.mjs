import assert from "node:assert/strict";
import test from "node:test";

import {
  auditEventKey,
  removeAcknowledgedAuditEvents,
} from "../app/lib/audit-events.js";
import { reduceDirectEditHistory } from "../app/lib/direct-edit-history.js";

const target = { id: "target-1", label: "Paragraph" };

function mutation({
  historyId,
  historyAction,
  kind = "text",
  property,
  before = "before",
  after = "after",
}) {
  return {
    kind,
    target,
    ...(property ? { property } : {}),
    before,
    after,
    historyId,
    ...(historyAction ? { historyAction } : {}),
  };
}

function harness() {
  let eventSequence = 0;
  let state = {
    events: [],
    pendingEvents: [],
    undoFolds: new Map(),
    redoFolds: new Map(),
  };
  return {
    get state() {
      return state;
    },
    setPending(pendingEvents) {
      state = { ...state, pendingEvents };
    },
    apply(nextMutation, capturedRevision, inFlightEvents = []) {
      state = reduceDirectEditHistory({
        mutation: nextMutation,
        capturedRevision,
        createdAt: new Date(Date.UTC(2026, 6, 21, 0, 0, 0, capturedRevision * 100)).toISOString(),
        baseVersionId: "version-1",
        ...state,
        inFlightKeys: new Set(inFlightEvents.map(auditEventKey)),
        nextEventId: () => `change-${++eventSequence}`,
      });
      return state;
    },
    get createdEventCount() {
      return eventSequence;
    },
  };
}

test("pending forward, undo, and redo restore one original audit identity", () => {
  const history = harness();
  history.apply(mutation({ historyId: "history-1" }), 1);
  const forward = history.state.events[0];

  history.apply(mutation({
    historyId: "history-1",
    historyAction: "undo",
    before: "after",
    after: "before",
  }), 2);
  assert.deepEqual(history.state.events, []);
  assert.deepEqual(history.state.pendingEvents, []);

  history.apply(mutation({ historyId: "history-1", historyAction: "redo" }), 3);
  assert.equal(history.state.events.length, 1);
  assert.equal(history.state.pendingEvents.length, 1);
  assert.equal(auditEventKey(history.state.events[0]), auditEventKey(forward));
  assert.equal(auditEventKey(history.state.pendingEvents[0]), auditEventKey(forward));
  assert.equal(history.createdEventCount, 1, "redo must not manufacture an audit event");
});

test("persisted forward and queued undo are cancelled by redo before autosave starts", () => {
  const history = harness();
  history.apply(mutation({ historyId: "history-1" }), 1);
  const forward = history.state.events[0];
  history.setPending([]);

  history.apply(mutation({
    historyId: "history-1",
    historyAction: "undo",
    before: "after",
    after: "before",
  }), 2);
  const undoEvent = history.state.pendingEvents[0];
  assert.equal(undoEvent.undoesEventId, forward.eventId);

  history.apply(mutation({ historyId: "history-1", historyAction: "redo" }), 3);
  assert.deepEqual(history.state.pendingEvents, []);
  assert.equal(auditEventKey(history.state.events[0]), auditEventKey(forward));
  assert.equal(history.createdEventCount, 2, "the unstarted undo is removed instead of balanced by redo");

  history.apply(mutation({
    historyId: "history-1",
    historyAction: "undo",
    before: "after",
    after: "before",
  }), 4);
  assert.equal(history.state.pendingEvents.length, 1);
  assert.notEqual(history.state.pendingEvents[0].eventId, undoEvent.eventId);
});

test("in-flight forward cannot disappear when undo is queued", () => {
  const history = harness();
  history.apply(mutation({ historyId: "history-1" }), 1);
  const forward = history.state.pendingEvents[0];

  history.apply(mutation({
    historyId: "history-1",
    historyAction: "undo",
    before: "after",
    after: "before",
  }), 2, [forward]);
  assert.equal(history.state.pendingEvents.length, 2);
  assert.equal(auditEventKey(history.state.pendingEvents[0]), auditEventKey(forward));
  assert.equal(history.state.pendingEvents[1].undoesEventId, forward.eventId);

  const undoEvent = history.state.pendingEvents[1];
  history.apply(mutation({ historyId: "history-1", historyAction: "redo" }), 3, [forward]);
  assert.deepEqual(history.state.pendingEvents.map(auditEventKey), [auditEventKey(forward)]);
  assert.equal(history.state.pendingEvents.some((event) => event.eventId === undoEvent.eventId), false);
  assert.equal(auditEventKey(history.state.events[0]), auditEventKey(forward));
});

test("redo after an in-flight undo emits one new event and acknowledgements remove only exact keys", () => {
  const history = harness();
  history.apply(mutation({ historyId: "history-1" }), 1);
  history.setPending([]);
  history.apply(mutation({
    historyId: "history-1",
    historyAction: "undo",
    before: "after",
    after: "before",
  }), 2);
  const undoEvent = history.state.pendingEvents[0];

  history.apply(
    mutation({ historyId: "history-1", historyAction: "redo" }),
    3,
    [undoEvent],
  );
  assert.equal(history.state.pendingEvents.length, 2);
  const redoEvent = history.state.pendingEvents[1];
  assert.notEqual(redoEvent.eventId, undoEvent.eventId);
  assert.equal(redoEvent.historyId, "history-1");

  const afterUndoAck = removeAcknowledgedAuditEvents(
    history.state.pendingEvents,
    [undoEvent],
  );
  assert.deepEqual(afterUndoAck.map(auditEventKey), [auditEventKey(redoEvent)]);
  assert.deepEqual(
    removeAcknowledgedAuditEvents(afterUndoAck, [undoEvent]).map(auditEventKey),
    [auditEventKey(redoEvent)],
  );
});

test("redo after an acknowledged undo is a new exact-once audit event", () => {
  const history = harness();
  history.apply(mutation({ historyId: "history-1" }), 1);
  history.setPending([]);
  history.apply(mutation({
    historyId: "history-1",
    historyAction: "undo",
    before: "after",
    after: "before",
  }), 2);
  const undoEvent = history.state.pendingEvents[0];
  history.setPending([]);

  history.apply(mutation({ historyId: "history-1", historyAction: "redo" }), 3);
  assert.equal(history.state.pendingEvents.length, 1);
  const redoEvent = history.state.pendingEvents[0];
  assert.notEqual(redoEvent.eventId, undoEvent.eventId);
  assert.equal(history.state.events.length, 1);
  assert.equal(auditEventKey(history.state.events[0]), auditEventKey(redoEvent));
});

test("coalesced style undo and redo restore the prior pending revision without duplication", () => {
  const history = harness();
  history.apply(mutation({
    historyId: "history-1",
    kind: "style",
    property: "fontWeight",
    before: "400",
    after: "500",
  }), 1);
  const firstRevision = history.state.events[0];
  history.apply(mutation({
    historyId: "history-2",
    kind: "style",
    property: "fontWeight",
    before: "500",
    after: "700",
  }), 2);
  const secondRevision = history.state.events[0];
  assert.equal(firstRevision.eventId, secondRevision.eventId);
  assert.notEqual(auditEventKey(firstRevision), auditEventKey(secondRevision));

  history.apply(mutation({
    historyId: "history-2",
    historyAction: "undo",
    kind: "style",
    property: "fontWeight",
    before: "700",
    after: "500",
  }), 3);
  assert.deepEqual(history.state.events.map(auditEventKey), [auditEventKey(firstRevision)]);
  assert.deepEqual(history.state.pendingEvents.map(auditEventKey), [auditEventKey(firstRevision)]);

  history.apply(mutation({
    historyId: "history-2",
    historyAction: "redo",
    kind: "style",
    property: "fontWeight",
    before: "500",
    after: "700",
  }), 4);
  assert.deepEqual(history.state.events.map(auditEventKey), [auditEventKey(secondRevision)]);
  assert.deepEqual(history.state.pendingEvents.map(auditEventKey), [auditEventKey(secondRevision)]);
  assert.equal(history.createdEventCount, 1);
});
