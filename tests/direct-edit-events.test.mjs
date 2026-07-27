import assert from "node:assert/strict";
import test from "node:test";

import { auditEventKey } from "../app/lib/audit-events.js";
import { appendDirectEditEvent } from "../app/lib/direct-edit-events.js";

const target = { id: "target-1", label: "Paragraph" };

function mutation({
  kind = "text",
  property,
  before = "before",
  after = "after",
  mutationTarget = target,
} = {}) {
  return {
    kind,
    target: mutationTarget,
    ...(property ? { property } : {}),
    before,
    after,
  };
}

function harness() {
  let eventSequence = 0;
  let state = { events: [], pendingEvents: [] };
  return {
    get state() {
      return state;
    },
    setPending(pendingEvents) {
      state = { ...state, pendingEvents };
    },
    apply(nextMutation, milliseconds, inFlightEvents = []) {
      state = appendDirectEditEvent({
        mutation: nextMutation,
        capturedRevision: milliseconds,
        createdAt: new Date(Date.UTC(2026, 6, 21, 0, 0, 0, milliseconds)).toISOString(),
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

test("each forward text edit appends one exact audit event", () => {
  const events = harness();
  events.apply(mutation(), 100);

  assert.equal(events.state.events.length, 1);
  assert.deepEqual(events.state.pendingEvents, events.state.events);
  assert.equal(events.state.events[0].eventId, "change-1");
  assert.equal(events.state.events[0].before, "before");
  assert.equal(events.state.events[0].after, "after");
});

test("a pending style gesture coalesces only its latest value", () => {
  const events = harness();
  events.apply(mutation({
    kind: "style",
    property: "fontWeight",
    before: "400",
    after: "500",
  }), 100);
  events.apply(mutation({
    kind: "style",
    property: "fontWeight",
    before: "500",
    after: "700",
  }), 500);

  assert.equal(events.createdEventCount, 1);
  assert.equal(events.state.events.length, 1);
  assert.equal(events.state.events[0].before, "400");
  assert.equal(events.state.events[0].after, "700");
  assert.deepEqual(events.state.pendingEvents, events.state.events);
});

test("an in-flight style event cannot absorb newer work", () => {
  const events = harness();
  events.apply(mutation({
    kind: "style",
    property: "fontWeight",
    before: "400",
    after: "500",
  }), 100);
  const inFlight = events.state.pendingEvents[0];
  events.apply(mutation({
    kind: "style",
    property: "fontWeight",
    before: "500",
    after: "700",
  }), 500, [inFlight]);

  assert.equal(events.createdEventCount, 2);
  assert.equal(events.state.events.length, 2);
  assert.equal(events.state.pendingEvents.length, 2);
  assert.notEqual(
    auditEventKey(events.state.pendingEvents[0]),
    auditEventKey(events.state.pendingEvents[1]),
  );
});

test("a persisted style event cannot absorb newer work", () => {
  const events = harness();
  events.apply(mutation({
    kind: "style",
    property: "color",
    before: "#000",
    after: "#111",
  }), 100);
  events.setPending([]);
  events.apply(mutation({
    kind: "style",
    property: "color",
    before: "#111",
    after: "#222",
  }), 500);

  assert.equal(events.createdEventCount, 2);
  assert.equal(events.state.events.length, 2);
  assert.equal(events.state.pendingEvents.length, 1);
  assert.equal(events.state.pendingEvents[0].after, "#222");
});

test("different targets, properties, or separated gestures stay distinct", () => {
  const cases = [
    mutation({
      kind: "style",
      property: "fontWeight",
      before: "400",
      after: "700",
    }),
    mutation({
      kind: "style",
      property: "color",
      before: "#222",
      after: "#333",
      mutationTarget: { id: "target-2", label: "Other" },
    }),
  ];

  for (const nextMutation of cases) {
    const events = harness();
    events.apply(mutation({
      kind: "style",
      property: "color",
      before: "#000",
      after: "#111",
    }), 100);
    events.apply(nextMutation, 500);
    assert.equal(events.createdEventCount, 2);
  }

  const separated = harness();
  separated.apply(mutation({
    kind: "style",
    property: "color",
    before: "#000",
    after: "#111",
  }), 100);
  separated.apply(mutation({
    kind: "style",
    property: "color",
    before: "#111",
    after: "#222",
  }), 1_600);
  assert.equal(separated.createdEventCount, 2);
});
