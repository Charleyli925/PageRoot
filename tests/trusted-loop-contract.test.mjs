import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { activeRunFromRecord, isLockedLifecycleState, hasObservedCompletion } from "../app/domain/run-lifecycle.js";

const cases = JSON.parse(readFileSync(new URL("./fixtures/trusted-loop/scenarios.json", import.meta.url), "utf8"));
const scenario = (id) => cases.find((entry) => entry.id === id);
const decode = (id) => activeRunFromRecord({ requestId: "req_synthetic", ...scenario(id).run });

test("pre-execution service failures do not create a run authority", () => {
  for (const id of ["not-authenticated", "protocol-failed"]) {
    assert.equal(activeRunFromRecord(scenario(id).run), null);
  }
});
test("candidate completion is still locked for user decision", () => {
  const run = decode("candidate-review");
  assert.equal(hasObservedCompletion(run), true);
  assert.equal(isLockedLifecycleState(run.status), true);
  assert.notEqual(run.status, "complete");
});
test("application uncertainty stays locked and cannot masquerade as adoption", () => {
  assert.equal(isLockedLifecycleState(decode("application-unknown").status), true);
  assert.equal(isLockedLifecycleState(decode("adopted").status), false);
  assert.equal(isLockedLifecycleState(decode("no-change").status), false);
});
test("explicit quota failure and user stop remain distinct execution facts", () => {
  assert.equal(decode("user-stopped").status, "cancelled");
  assert.equal(decode("quota-exhausted").status, "error");
  assert.equal(hasObservedCompletion(decode("user-stopped")), false);
});
