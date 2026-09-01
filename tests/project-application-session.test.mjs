import assert from "node:assert/strict";
import test from "node:test";

import { ProjectApplicationSession } from "../app/application/project-application-session.js";

function application(id) {
  return {
    applicationId: `application_${id}`,
    value: { sourcePath: `/Users/demo/${id}.html` },
  };
}

test("project application session retains a deferred predecessor before its FIFO successor", async () => {
  const session = new ProjectApplicationSession();
  const order = [];
  let firstAttempt = true;
  const execute = async (entry) => {
    order.push(entry.applicationId);
    if (entry.applicationId === "application_first" && firstAttempt) {
      firstAttempt = false;
      return "deferred";
    }
    return "complete";
  };

  assert.equal(session.enqueue(application("first"), execute), true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(session.snapshot, {
    status: "deferred",
    activeApplicationId: null,
    queuedApplicationId: null,
    deferredApplicationId: "application_first",
    deferredSequence: 1,
  });

  assert.equal(session.enqueue(application("second"), execute), true);
  assert.deepEqual(session.snapshot, {
    status: "deferred",
    activeApplicationId: null,
    queuedApplicationId: "application_second",
    deferredApplicationId: "application_first",
    deferredSequence: 1,
  });

  assert.equal(session.resume(execute), true);
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(order, [
    "application_first",
    "application_first",
    "application_second",
  ]);
  assert.deepEqual(session.snapshot, {
    status: "idle",
    activeApplicationId: null,
    queuedApplicationId: null,
    deferredApplicationId: null,
    deferredSequence: 1,
  });
});

test("project application session sequences each repeated deferred transition", async () => {
  const session = new ProjectApplicationSession();
  const execute = async () => "deferred";

  assert.equal(session.enqueue(application("retry"), execute), true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(session.snapshot.deferredSequence, 1);

  assert.equal(session.resume(execute), true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(session.snapshot.deferredSequence, 2);
});

test("project application session resumes immediately when the switch drain is already clear", async () => {
  const session = new ProjectApplicationSession();
  const order = [];
  const execute = async (entry) => {
    order.push(entry.applicationId);
    return order.length === 1 ? "deferred" : "complete";
  };

  assert.equal(session.enqueue(application("clear"), execute), true);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(
    session.reconcileDeferredSwitch({ switchBlocked: false, execute }),
    "resumed",
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(order, ["application_clear", "application_clear"]);
  assert.equal(session.snapshot.status, "idle");
});

test("project application session resumes its FIFO predecessor only after a switch blocker clears", async () => {
  const session = new ProjectApplicationSession();
  const order = [];
  const execute = async (entry) => {
    order.push(entry.applicationId);
    return order.length === 1 ? "deferred" : "complete";
  };

  assert.equal(session.enqueue(application("blocker"), execute), true);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(
    session.reconcileDeferredSwitch({ switchBlocked: true, execute }),
    "blocked",
  );
  assert.deepEqual(order, ["application_blocker"]);

  assert.equal(
    session.reconcileDeferredSwitch({ switchBlocked: true, execute }),
    "blocked",
  );
  assert.equal(
    session.reconcileDeferredSwitch({ switchBlocked: false, execute }),
    "resumed",
  );
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(order, ["application_blocker", "application_blocker"]);
  assert.equal(session.snapshot.status, "idle");
});

test("project application session does not loop a second unblocked defer of the same application", async () => {
  const session = new ProjectApplicationSession();
  const execute = async () => "deferred";

  assert.equal(session.enqueue(application("loop"), execute), true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    session.reconcileDeferredSwitch({ switchBlocked: false, execute }),
    "resumed",
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(session.snapshot.status, "deferred");
  assert.equal(
    session.reconcileDeferredSwitch({ switchBlocked: false, execute }),
    "idle",
  );
  assert.equal(
    session.reconcileDeferredSwitch({ switchBlocked: false, execute }),
    "idle",
  );
  assert.equal(
    session.reconcileDeferredSwitch({ switchBlocked: true, execute }),
    "blocked",
  );
  assert.equal(
    session.reconcileDeferredSwitch({ switchBlocked: false, execute }),
    "resumed",
  );
});

test("project application session settles waiters and stale-closes them on dispose", async () => {
  const session = new ProjectApplicationSession();
  const waiting = session.waitFor("application_pending");
  assert.equal(session.enqueue(application("pending"), async () => "complete"), true);
  assert.deepEqual(await waiting, {
    applicationId: "application_pending",
    result: "succeeded",
  });
  assert.deepEqual(await session.waitFor("application_pending"), {
    applicationId: "application_pending",
    result: "succeeded",
  });

  const hanging = session.waitFor("application_hanging");
  session.dispose();
  assert.deepEqual(await hanging, {
    applicationId: "application_hanging",
    result: "stale",
  });
});

test("terminal cancellation retires a deferred application before any later resume", async () => {
  const session = new ProjectApplicationSession();
  let executions = 0;
  const execute = async () => {
    executions += 1;
    return "deferred";
  };
  assert.equal(session.enqueue(application("expired"), execute), true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(session.snapshot.status, "deferred");
  assert.equal(session.cancel("application_expired"), true);
  assert.deepEqual(await session.waitFor("application_expired"), {
    applicationId: "application_expired",
    result: "stale",
  });
  assert.equal(session.snapshot.status, "idle");
  assert.equal(session.resume(execute), false);
  assert.equal(executions, 1);
});
