import assert from "node:assert/strict";
import test from "node:test";

import { DiscussionTurnSession } from "../app/application/discussion-turn-session.js";
import { DiscussionTurnWorkflow } from "../app/application/discussion-turn-workflow.js";

// These pins hold the renderer side of a discussion turn: one turn per Document,
// no answer ever shown under the wrong page, polling that stops when the turn
// settles, and a drain boundary that cancels rather than waits. The Bridge stays
// the only authority; the session publishes a projection.

const CONTEXT = Object.freeze({
  projectId: "project_aaaaaaaaaaaaaaaa",
  documentId: "doc_bbbbbbbbbbbbbbbb",
  sourcePath: "/tmp/pageroot/page.html",
});
const OTHER_CONTEXT = Object.freeze({
  projectId: "project_aaaaaaaaaaaaaaaa",
  documentId: "doc_cccccccccccccccc",
  sourcePath: "/tmp/pageroot/other.html",
});
const SELECTION = Object.freeze({
  providerId: "qoder",
  runtimeId: "acp",
  requestedModelId: null,
  resolvedModelId: null,
  reasoning: Object.freeze({ requested: null, applied: null, resolution: "provider-default" }),
});

function turn(overrides = {}) {
  return {
    driver: "qoder-acp",
    state: "running",
    phase: "discussing",
    conversationId: "conversation_1",
    turnId: "turn_abc",
    sourceSha256: `sha256:${"a".repeat(64)}`,
    startedAt: "2026-08-22T00:00:00.000Z",
    updatedAt: "2026-08-22T00:00:01.000Z",
    agentName: "Qoder CLI",
    agentVersion: "1.1.27",
    eventCount: 3,
    interrupted: false,
    ...overrides,
  };
}

function fakeScheduler() {
  const state = { handlers: new Map(), next: 1, cleared: [] };
  return {
    state,
    setInterval(handler) {
      const handle = state.next;
      state.next += 1;
      state.handlers.set(handle, handler);
      return handle;
    },
    clearInterval(handle) {
      state.cleared.push(handle);
      state.handlers.delete(handle);
    },
    tick() {
      for (const handler of [...state.handlers.values()]) handler();
    },
  };
}

function createWorkflow(overrides = {}) {
  const calls = { starts: [], statuses: [], cancels: [], tickets: 0 };
  const session = new DiscussionTurnSession();
  const scheduler = fakeScheduler();
  const bridgeClient = {
    startDiscussion: async (body) => {
      calls.starts.push(body);
      return { ok: true, accepted: true, session: turn({ state: "starting" }) };
    },
    discussionStatus: async (sourcePath) => {
      calls.statuses.push(sourcePath);
      return { ok: true, discussion: turn({ state: "completed", phase: "completed" }) };
    },
    cancelDiscussion: async (body) => {
      calls.cancels.push(body);
      return { ok: true, cancelled: true, session: turn({ state: "cancelled", interrupted: true, interruptedReason: "cancelled" }) };
    },
    ...overrides.bridgeClient,
  };
  const workflow = new DiscussionTurnWorkflow({
    bridgeClient,
    discussionTurnSession: session,
    requestTicket: async () => {
      calls.tickets += 1;
      return { preflightId: "preflight_1", trustPolicyAccepted: "trusted-local-agent-v1" };
    },
    freezeSelection: () => SELECTION,
    scheduler,
    ...overrides.workflow,
  });
  return { workflow, session, scheduler, calls, bridgeClient };
}

test("the session clears the projection when the Document changes", () => {
  const session = new DiscussionTurnSession();
  const seen = [];
  session.subscribe((snapshot) => seen.push(snapshot));

  session.beginTurn(CONTEXT, { conversationId: "conversation_1" });
  assert.equal(session.snapshot.status, "starting");
  assert.equal(session.snapshot.busy, true);
  session.publish(CONTEXT, turn());
  assert.equal(session.snapshot.turnId, "turn_abc");

  // A reply for the Document the user already left is discarded, never shown.
  assert.equal(session.publish(OTHER_CONTEXT, turn({ turnId: "turn_other" })), false);
  assert.equal(session.snapshot.turnId, "turn_abc");

  session.beginTurn(OTHER_CONTEXT);
  assert.equal(session.snapshot.turn, null);
  assert.equal(session.snapshot.turnId, null);
  assert.ok(seen.length > 3);
});

test("an interrupted turn is never published as complete", () => {
  const session = new DiscussionTurnSession();
  session.beginTurn(CONTEXT);
  session.publish(CONTEXT, turn({
    state: "interrupted",
    interrupted: true,
    interruptedReason: "timeout",
  }));

  const snapshot = session.snapshot;
  assert.equal(snapshot.status, "interrupted");
  assert.equal(snapshot.interrupted, true);
  assert.equal(snapshot.interruptedReason, "timeout");
  assert.equal(snapshot.busy, false);
});

test("a started turn spends one ticket and polls until it settles", async () => {
  const { workflow, session, scheduler, calls } = createWorkflow();

  await workflow.start(CONTEXT, {
    question: "这个标题怎么改？",
    conversationId: "conversation_1",
    expectedSourceSha256: `sha256:${"a".repeat(64)}`,
  });

  assert.equal(calls.tickets, 1);
  assert.equal(calls.starts.length, 1);
  const body = calls.starts[0];
  assert.deepEqual(body.selection, SELECTION);
  assert.equal(body.preflightId, "preflight_1");
  assert.equal(body.trustPolicyAccepted, "trusted-local-agent-v1");
  assert.equal(body.sourcePath, CONTEXT.sourcePath);
  assert.equal(body.question, "这个标题怎么改？");
  assert.equal(body.expectedSourceSha256, `sha256:${"a".repeat(64)}`);
  // A live turn polls.
  assert.equal(workflow.polling, true);

  await workflow.pollNow();
  // The status read settled the turn, so polling stops on its own.
  assert.equal(session.snapshot.status, "completed");
  assert.equal(session.snapshot.busy, false);
  assert.equal(workflow.polling, false);
  assert.ok(scheduler.state.cleared.length > 0);
});

test("a second start for the same Document is refused locally", async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const { workflow, calls } = createWorkflow({
    bridgeClient: {
      startDiscussion: async (body) => {
        calls.starts.push(body);
        await gate;
        return { ok: true, accepted: true, session: turn({ state: "running" }) };
      },
    },
  });

  const first = workflow.start(CONTEXT, { question: "第一次" });
  const second = await workflow.start(CONTEXT, { question: "第二次" });
  assert.equal(second, null);
  release();
  await first;
  assert.equal(calls.starts.length, 1);
  assert.equal(calls.tickets, 1);
});

test("a poll that arrives after a Document switch is dropped", async () => {
  const { workflow, session } = createWorkflow({
    bridgeClient: {
      discussionStatus: async () => {
        // The user switches Document while the status read is in flight.
        session.beginTurn(OTHER_CONTEXT);
        return { ok: true, discussion: turn({ state: "completed" }) };
      },
    },
  });

  session.beginTurn(CONTEXT);
  session.publish(CONTEXT, turn({ state: "running" }));
  await workflow.pollNow();

  // The other Document's projection stays empty rather than showing the first
  // Document's answer.
  assert.equal(session.snapshot.context.documentId, OTHER_CONTEXT.documentId);
  assert.equal(session.snapshot.turn, null);
});

test("a failed start surfaces the error and starts no polling", async () => {
  const failure = new Error("stale page");
  const { workflow, session } = createWorkflow({
    bridgeClient: {
      startDiscussion: async () => {
        throw failure;
      },
    },
  });

  await workflow.start(CONTEXT, { question: "问题" });
  assert.equal(session.snapshot.status, "failed");
  assert.equal(session.snapshot.error, failure);
  assert.equal(workflow.polling, false);
});

test("a status read failure keeps the last projection instead of inventing one", async () => {
  const { workflow, session } = createWorkflow({
    bridgeClient: {
      discussionStatus: async () => {
        throw new Error("bridge unavailable");
      },
    },
  });

  session.beginTurn(CONTEXT);
  session.publish(CONTEXT, turn({ state: "running" }));
  await workflow.pollNow();

  assert.equal(session.snapshot.status, "running");
  assert.equal(session.snapshot.busy, true);
  // Still live, so it keeps polling rather than declaring an outcome.
  assert.equal(workflow.polling, true);
  workflow.dispose();
  assert.equal(workflow.polling, false);
});

test("drain cancels an in-flight turn instead of waiting for it", async () => {
  const { workflow, session, calls } = createWorkflow();
  session.beginTurn(CONTEXT);
  session.publish(CONTEXT, turn({ state: "running" }));

  await workflow.drain();

  assert.deepEqual(calls.cancels, [{ sourcePath: CONTEXT.sourcePath }]);
  assert.equal(session.snapshot.status, "cancelled");
  assert.equal(session.snapshot.interrupted, true);
  assert.equal(session.snapshot.interruptedReason, "cancelled");
  assert.equal(workflow.polling, false);

  // Draining with nothing in flight is a no-op, not a second cancel.
  await workflow.drain();
  assert.equal(calls.cancels.length, 1);
});

test("a settled turn asks the conversation to reload exactly once", async () => {
  const settled = [];
  const { workflow, session } = createWorkflow({
    workflow: { onSettled: (context) => settled.push(context) },
  });

  session.beginTurn(CONTEXT);
  session.publish(CONTEXT, turn({ state: "running" }));
  // The stub status read reports a completed turn.
  await workflow.pollNow();
  assert.equal(settled.length, 1);
  assert.equal(settled[0].documentId, CONTEXT.documentId);

  // Polling again on an already settled turn must not reload a second time.
  await workflow.pollNow();
  assert.equal(settled.length, 1);
});

test("the workflow requires its dependencies", () => {
  const session = new DiscussionTurnSession();
  const scheduler = fakeScheduler();
  const bridgeClient = { startDiscussion: () => {}, discussionStatus: () => {} };

  assert.throws(
    () => new DiscussionTurnWorkflow({ bridgeClient: {}, discussionTurnSession: session, requestTicket: async () => null, scheduler }),
    /discussion bridge client/u,
  );
  assert.throws(
    () => new DiscussionTurnWorkflow({ bridgeClient, discussionTurnSession: session, scheduler }),
    /ticket provider/u,
  );
  assert.throws(
    () => new DiscussionTurnWorkflow({
      bridgeClient,
      discussionTurnSession: session,
      requestTicket: async () => null,
      freezeSelection: () => SELECTION,
      scheduler: {},
    }),
    /Scheduler/u,
  );
});
