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
