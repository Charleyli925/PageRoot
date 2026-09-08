import test from "node:test";
import assert from "node:assert/strict";
import { createExecutionClock } from "../app/workbench/execution-clock.js";

test("elapsed time advances independently of 100ms activity and wall clock changes", () => {
  let monotonic = 0;
  let wall = 10_000;
  const clock = createExecutionClock({ startedAt: new Date(0).toISOString(), wallNow: () => wall, monotonicNow: () => monotonic });
  for (let i = 1; i <= 30; i += 1) {
    monotonic += 100;
    wall -= 10;
    assert.equal(clock.sample(), 10_000 + i * 100);
  }
  const ended = clock.stop();
  monotonic += 5000;
  wall = 99999;
  assert.equal(clock.sample({ resume: true }), ended);
});

test("resume corrects sleep and a new process uses epoch time only", () => {
  let wall = 10_000;
  const clock = createExecutionClock({ startedAt: new Date(0).toISOString(), wallNow: () => wall, monotonicNow: () => 2 });
  wall = 20_000;
  assert.equal(clock.sample({ resume: true }), wall);
  const recovered = createExecutionClock({ startedAt: new Date(0).toISOString(), wallNow: () => wall, monotonicNow: () => 0 });
  assert.equal(recovered.sample(), wall);
});
